import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, net, protocol, screen, session, shell, systemPreferences, type BrowserWindowConstructorOptions, type DesktopCapturerSource, type IpcMainInvokeEvent } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import * as api from './api';
import { clientMessage, closeRealtime, initRealtime, send as rtSend } from './realtime';
import { initSentry } from './sentry';

/** CULT Live Studio main process: one locked-down window, a custom app:// origin, and validated IPC verbs. */

const APP_ORIGIN = 'app://studio';
const DIST = path.join(__dirname, '..', 'dist');

if (process.env.CULT_USER_DATA) app.setPath('userData', process.env.CULT_USER_DATA); // isolated profile for tests
if (process.env.CULT_FAKE_MEDIA === '1') {
  // Synthetic camera/mic (test pattern + tone) for automated tests: never touches real devices.
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
initSentry(); // after the userData override (its offline queue lives there), before app ready

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

let win: BrowserWindow | null = null;
let isLive = false;

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json' };

function csp(): string {
  const apiOrigin = new URL(api.getSettings().apiBase).origin; // avatars are served by the API
  return [
    "default-src 'none'",
    "script-src 'self'",
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${apiOrigin}`,
    "media-src 'self' blob: mediastream:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join('; ');
}

function serveApp(): void {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(DIST, rel);
    if (u.host !== 'studio' || !file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
    if (!res?.ok) return new Response('Not found', { status: 404 });
    return new Response(res.body, {
      headers: { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'content-security-policy': csp(), 'x-content-type-options': 'nosniff' },
    });
  });
}

const fromApp = (url: string | undefined) => !!url && url.startsWith(`${APP_ORIGIN}/`);
const isMac = process.platform === 'darwin';

/** macOS: camera/mic go through the system privacy prompt (TCC) first; a refusal there denies the request. */
async function macMediaAccess(types: ('video' | 'audio')[]): Promise<boolean> {
  for (const t of new Set(types)) {
    const kind = t === 'video' ? 'camera' : 'microphone';
    if (systemPreferences.getMediaAccessStatus(kind) !== 'granted' && !(await systemPreferences.askForMediaAccess(kind))) return false;
  }
  return true;
}

function lockDownSession(): void {
  const ses = session.defaultSession;
  const allowed = new Set(['media', 'clipboard-sanitized-write', 'display-capture']);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (!fromApp(details.requestingUrl) || !allowed.has(permission)) return cb(false);
    if (!isMac || permission !== 'media') return cb(true);
    void macMediaAccess('mediaTypes' in details ? (details.mediaTypes ?? []) : []).then(cb, () => cb(false));
  });
  ses.setPermissionCheckHandler((_wc, permission, origin) => origin === APP_ORIGIN && allowed.has(permission));
  // getDisplayMedia() only succeeds for a source the creator just picked in our own picker.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const choice = pendingCapture;
    pendingCapture = null;
    if (!choice || !fromApp(request.securityOrigin + '/')) return callback({});
    if (choice === 'desktop-audio') return callback({ video: request.frame!, audio: 'loopback' }); // own frame as the (discarded) video
    callback({ video: choice.source, ...(choice.audio ? { audio: 'loopback' as const } : {}) });
  });
}

// ── Capture sources (desktopCapturer is main-only) ──
const listed = new Map<string, DesktopCapturerSource>();
let pendingCapture: { source: DesktopCapturerSource; audio: boolean } | 'desktop-audio' | null = null;

const SCREEN_PERMISSION = 'Allow CULT Live Studio in System Settings › Privacy & Security › Screen Recording, then quit and reopen the app.';

async function captureSources(kind: 'window' | 'screen') {
  const sources = await desktopCapturer.getSources({ types: [kind], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
  // macOS: without Screen Recording access the list holds only wallpaper and our own windows. The getSources call
  // above is what shows the system prompt (and adds the app to the Settings list); the grant applies after a relaunch.
  if (isMac && systemPreferences.getMediaAccessStatus('screen') !== 'granted') return null;
  const own = win?.getMediaSourceId();
  listed.clear();
  return sources
    .filter((s) => s.id !== own && s.name !== 'CULT Live Studio')
    .map((s) => {
      listed.set(s.id, s);
      return { id: s.id, name: s.name, thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() };
    });
}

// ── IPC: every verb checks the sender is our page and validates its input ──
function handle<S extends z.ZodTypeAny>(channel: string, schema: S, fn: (arg: z.infer<S>) => unknown): void {
  ipcMain.handle(channel, async (e: IpcMainInvokeEvent, raw: unknown) => {
    if (!fromApp(e.senderFrame?.url)) return { ok: false, status: 0, code: 'FORBIDDEN', message: 'Untrusted sender' };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, status: 0, code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
    return fn(parsed.data);
  });
}

const none = z.undefined();

function registerIpc(): void {
  handle('auth:login', api.loginSchema, (b) => api.login(b));
  handle('auth:session', none, () => api.session());
  handle('auth:logout', none, async () => {
    closeRealtime();
    return api.logout();
  });
  handle('api:request', api.apiRequestSchema, (r) => api.proxy(r));
  handle('broadcast:start', api.streamIdSchema, ({ streamId }) => api.startBroadcast(streamId));
  handle('whip:offer', api.offerSchema, ({ streamId, sdp }) => api.whipOffer(streamId, sdp));
  handle('whip:stop', api.streamIdSchema, ({ streamId }) => api.whipStop(streamId));
  handle('rt:send', clientMessage, (m) => {
    rtSend(m);
    return { ok: true, data: null };
  });
  handle('capture:sources', z.object({ kind: z.enum(['window', 'screen']) }), async ({ kind }) => {
    const data = await captureSources(kind);
    return data ? { ok: true, data } : { ok: false, status: 0, code: 'SCREEN_PERMISSION', message: SCREEN_PERMISSION };
  });
  handle('capture:choose', z.object({ sourceId: z.string().max(200), audio: z.boolean() }), ({ sourceId, audio }) => {
    const source = listed.get(sourceId);
    if (!source) return { ok: false, status: 0, code: 'SOURCE_GONE', message: 'That window or screen is no longer available. Refresh the list.' };
    pendingCapture = { source, audio };
    return { ok: true, data: null };
  });
  handle('capture:desktop-audio', none, () => {
    // Electron's audio 'loopback' is Windows-only; elsewhere the display-media callback would throw in main.
    if (process.platform !== 'win32') return { ok: false, status: 0, code: 'NOT_SUPPORTED', message: 'Desktop audio capture isn’t available on this system yet.' };
    pendingCapture = 'desktop-audio';
    return { ok: true, data: null };
  });
  handle('app:metrics', none, () => {
    const m = app.getAppMetrics();
    return { ok: true, data: { cpu: m.reduce((t, p) => t + p.cpu.percentCPUUsage, 0), memoryMb: Math.round(m.reduce((t, p) => t + p.memory.workingSetSize, 0) / 1024) } };
  });
  handle('app:set-live', z.object({ live: z.boolean() }), ({ live }) => {
    isLive = live;
    return { ok: true, data: null };
  });
  handle('screen:displays', none, () => ({
    ok: true,
    data: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || `Display ${i + 1}`, width: d.size.width, height: d.size.height, primary: d.id === screen.getPrimaryDisplay().id })),
  }));
  handle('settings:get', none, () => ({ ok: true, data: api.getSettings() }));
  handle('settings:set', api.settingsSchema, (s) => {
    api.saveSettings(s);
    closeRealtime();
    win?.webContents.reload(); // new API origin → new CSP and a fresh session check
    return { ok: true, data: null };
  });
  handle('shell:open-studio', z.object({ path: z.enum(['', '/live', '/ingest']) }), async ({ path: sub }) => {
    await shell.openExternal(`${api.getSettings().studioUrl.replace(/\/+$/, '')}${sub}`);
    return { ok: true, data: null };
  });
  handle('clipboard:write', z.object({ text: z.string().max(2000) }), ({ text }) => {
    clipboard.writeText(text);
    return { ok: true, data: null };
  });
  handle('win:minimize', none, () => win?.minimize());
  handle('win:toggle-maximize', none, () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  handle('win:close', none, () => win?.close());
}

/** Projector window for `cult-projector:<displayId|windowed>:<n>`: fullscreen on a real display, else a plain window. */
function projectorOptions(frameName: string): BrowserWindowConstructorOptions | null {
  const m = /^cult-projector:(windowed|\d+):\d+$/.exec(frameName);
  if (!m) return null;
  const base: BrowserWindowConstructorOptions = { backgroundColor: '#000000', title: 'CULT Live Studio projector', autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } };
  const display = m[1] === 'windowed' ? undefined : screen.getAllDisplays().find((d) => String(d.id) === m[1]);
  if (!display) return { ...base, width: 960, height: 540 };
  return { ...base, ...display.bounds, frame: false, fullscreen: true };
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    // Custom title bar everywhere; macOS keeps its own traffic lights (the renderer hides its Windows-style buttons).
    ...(isMac ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 14, y: 15 } } : { frame: false }),
    show: false,
    backgroundColor: '#09090b',
    title: 'CULT Live Studio',
    icon: path.join(__dirname, '..', 'dist', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false, // the compositor and encoder must keep running while minimized
    },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('maximize', () => win?.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('win:maximized', false));
  win.on('close', (e) => {
    if (!isLive || !win) return;
    const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Keep streaming', 'Close anyway'], defaultId: 0, cancelId: 0, title: 'You’re LIVE', message: 'You’re still LIVE.', detail: 'End LIVE first. If you close now, viewers see a reconnecting stream that ends after about 90 seconds.' });
    if (choice === 0) e.preventDefault();
  });
  win.on('closed', () => {
    win = null;
    for (const w of BrowserWindow.getAllWindows()) w.close(); // projectors go with the studio
  });
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    const options = url === 'about:blank' ? projectorOptions(frameName) : null; // only our own projector windows
    return options ? { action: 'allow', overrideBrowserWindowOptions: options } : { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => {
    child.removeMenu();
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (e) => e.preventDefault());
  });
  win.webContents.on('will-navigate', (e, url) => !fromApp(url) && e.preventDefault());
  void win.loadURL(`${APP_ORIGIN}/index.html`);
}

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

void app.whenReady().then(() => {
  app.setAppUserModelId('dev.cult.livestudio');
  api.loadSettings();
  api.loadToken();
  initRealtime((event, payload) => win?.webContents.send(event, payload));
  serveApp();
  lockDownSession();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  closeRealtime();
  app.quit();
});
