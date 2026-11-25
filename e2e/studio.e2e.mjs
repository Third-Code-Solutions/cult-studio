// End-to-end check of CULT Live Studio with Playwright's Electron driver.
// Synthetic media only: Chromium's fake camera/mic (CULT_FAKE_MEDIA=1), an image file and text. Never lists or
// captures real windows/screens and never turns on desktop audio. Screenshots are taken in-process (page.screenshot).
//
//   SHOTS=<dir> CULT_E2E_PASSWORD=... node e2e/studio.e2e.mjs
import { _electron as electron } from 'playwright';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceMenuChecks } from './source-menu.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const API = process.env.CULT_API_BASE ?? 'http://127.0.0.1:4000';
const MTX = process.env.CULT_MTX_API ?? 'http://127.0.0.1:9997';
const SHOTS = process.env.SHOTS ?? path.join(root, 'e2e', 'shots');
const IDENT = process.env.CULT_E2E_USER ?? 'kitchenbeats@cult.dev';
const PASS = process.env.CULT_E2E_PASSWORD; // the seed password; never committed
if (!PASS) throw new Error('Set CULT_E2E_PASSWORD (password of CULT_E2E_USER on the target API).');
const IMAGE = path.join(root, 'e2e', 'demo-slots.jpg');
const PROFILE = path.join(SHOTS, 'e2e-profile');

fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

const log = (...a) => console.log('[e2e]', ...a);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail);
};

// A separate API session for verification (logged out at the end).
async function apiLogin() {
  const r = await fetch(`${API}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: IDENT, password: PASS }) });
  const j = await r.json();
  if (!j.token) throw new Error(`verification login failed: ${JSON.stringify(j)}`);
  return j.token;
}
const get = (token, p) => fetch(`${API}${p}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: root,
  env: { ...process.env, CULT_USER_DATA: PROFILE, CULT_FAKE_MEDIA: '1', CULT_API_BASE: API },
});
const page = await app.firstWindow();
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `desktop-${name}.png`) });
  log('screenshot', name);
};
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

let token = null;
let streamId = null;
try {
  // ── Sign in ──
  await page.getByLabel('Email or username').waitFor({ timeout: 20000 });
  await shot('01-signin');
  await page.getByLabel('Email or username').fill(IDENT);
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('alert').waitFor();
  check('wrong password shows plain error', /don’t match/.test(await page.getByRole('alert').innerText()));
  await page.getByLabel('Password').fill(PASS);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Go LIVE' }).waitFor({ timeout: 20000 });
  check('signed in to studio', true);
  const sessionFile = path.join(PROFILE, 'session.bin');
  const raw = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile) : Buffer.alloc(0);
  check('token stored encrypted (no plaintext)', raw.length > 0 && !raw.toString('latin1').includes('ses_') && !/^[A-Za-z0-9_\-.]+$/.test(raw.toString('latin1')), `${raw.length} bytes`);
  const leaked = await page.evaluate(() => JSON.stringify(Object.keys(window.cult)));
  check('renderer has bridge only, no node', (await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined')) && leaked.includes('startBroadcast'));
  await page.waitForTimeout(1200);
  await shot('02-studio-empty');

  // ── LIVE setup ──
  await page.getByTitle('LIVE setup').click();
  await page.getByLabel('Title').fill('Desktop studio test (automated)');
  await page.getByRole('checkbox').check();
  await shot('03-live-setup');
  await page.getByRole('button', { name: 'Save' }).click();

  // ── Sources: image, text, goal widget ──
  const addSource = async (type, fill) => {
    await page.getByRole('button', { name: 'Add source' }).first().click();
    await page.getByRole('navigation', { name: 'Source types' }).getByRole('button', { name: type, exact: true }).click();
    if (fill) await fill();
  };
  await addSource('Image', () => page.locator('input[type=file]').setInputFiles(IMAGE));
  await shot('04-add-image');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await addSource('Text', () => page.getByLabel('Text').fill('Sunday spin session'));
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await addSource('Goal bar');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await addSource('Chatbox');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(500);
  const rows = await page.locator('.panel.left .row .name').allInnerTexts();
  check('sources listed', ['demo-slots.jpg', 'Sunday spin session', 'Goal bar', 'Chatbox'].every((n) => rows.includes(n)), rows.join(', '));
  // Drag the text box down a bit (selection + move)
  const box = page.getByLabel('Sunday spin session', { exact: true }).last();
  const bb = await box.boundingBox();
  if (bb) {
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
  }
  const drawn = await page.evaluate(() => {
    const c = document.querySelector('.canvas-wrap canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
    return lit;
  });
  check('compositor draws sources on main canvas', drawn > 100, `${drawn} lit samples`);
  await shot('05-composed');

  // ── Layouts and views ──
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Both' }).click();
  await addSource('Camera');
  await page.getByRole('dialog').getByRole('button', { name: 'Landscape' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 });
  await page.waitForTimeout(1200);
  await shot('06-both-layout');
  await page.getByRole('button', { name: /Studio view/ }).click();
  await page.getByRole('button', { name: 'Mobile view' }).click();
  await shot('07-mobile-view');
  await page.getByRole('button', { name: /Mobile view/ }).click();
  await page.getByRole('button', { name: 'Studio view' }).click();
  await page.getByRole('button', { name: 'Add scene' }).click();
  await page.getByRole('button', { name: /Studio view/ }).click();
  await page.getByRole('switch', { name: /Director mode/ }).click();
  await page.locator('.stage-bar').click();
  await shot('08-director');
  await page.getByRole('button', { name: /Studio view/ }).click();
  await page.getByRole('switch', { name: /Director mode/ }).click();
  await page.locator('.stage-bar').click();
  await page.locator('.row', { hasText: 'Scene 1' }).click();
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Portrait' }).click();

  // ── OBS panel (kitchenbeats has no studio ingest) ──
  await page.getByRole('button', { name: 'Stream with OBS' }).click();
  await page.getByText('Streaming software isn’t enabled').waitFor({ timeout: 10000 });
  check('OBS panel explains STUDIO_NOT_APPROVED', true);
  await shot('09-obs-panel');
  await page.getByRole('button', { name: 'Done' }).click();

  // ── Source right-click menu (own scene; E2E_SKIP_MENU=1 skips) ──
  if (process.env.E2E_SKIP_MENU !== '1') await sourceMenuChecks({ page, app, check, shot, addSource, dir: SHOTS });

  // ── Go LIVE ── (E2E_SKIP_LIVE=1 stops here, for layout iterations)
  if (process.env.E2E_SKIP_LIVE === '1') throw new Error('SKIP_LIVE');
  token = await apiLogin();
  const handle = IDENT.split('@')[0];
  const alreadyLive = (await get(token, '/v1/feed?tab=live_now')).items?.some((it) => (it.creator ?? it.stream?.creator)?.handle === handle);
  if (alreadyLive) {
    log(`${handle} is LIVE elsewhere: not going live from the test`);
    throw new Error('SKIP_LIVE');
  }
  await page.getByRole('button', { name: 'Go LIVE' }).click();
  await page.getByRole('button', { name: /End LIVE/ }).waitFor({ timeout: 30000 });
  const streams = await get(token, '/v1/creator/streams');
  const mine = streams.items.find((s) => ['starting', 'live'].includes(s.state));
  streamId = mine?.id ?? null;
  check('broadcast started', !!streamId, `${streamId} ${mine?.state}`);
  let livePath = null;
  for (let i = 0; i < 20 && streamId; i++) {
    const paths = await fetch(`${MTX}/v3/paths/list`).then((r) => r.json());
    livePath = paths.items.find((p) => p.name === `s_${streamId}`);
    const st = await get(token, `/v1/broadcasts/${streamId}`);
    if (livePath?.ready && st.state === 'live') break;
    await page.waitForTimeout(1000);
  }
  check('MediaMTX has the WHIP path, ready', !!livePath?.ready, livePath ? `${livePath.name} tracks=${JSON.stringify(livePath.tracks)}` : 'missing');
  const feed = await get(token, '/v1/feed?tab=live_now');
  const inFeed = feed.items?.some((it) => it.stream?.id === streamId);
  check('stream is in live_now feed', !!inFeed);
  await page.getByLabel('Chat message').fill('Hello from the desktop studio');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.msg', { hasText: 'Hello from the desktop studio' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(6000); // let stats + encoder health arrive
  const chatAcked = (await page.locator('.msg.pending').count()) === 0;
  check('host chat message delivered', chatAcked);
  const stat = await page.getByLabel('Performance').innerText();
  const vis = await page.evaluate(() => document.visibilityState);
  check('stats line shows upload/fps', /Upload\s+[\d,]+ kbps/.test(stat) && /FPS\s+\d+/.test(stat), `${stat.replace(/\s+/g, ' ')} (page ${vis})`);
  const liveStats = await get(token, `/v1/broadcasts/${streamId}/live-stats`);
  check('live-stats reports chat message', liveStats.chatMessages >= 1, JSON.stringify({ chat: liveStats.chatMessages, state: liveStats.state }));
  await shot('10-live');

  // ── End LIVE ──
  await page.getByRole('button', { name: /End LIVE/ }).click();
  await shot('11-end-confirm');
  await page.getByRole('dialog').getByRole('button', { name: 'End LIVE' }).click();
  await page.getByRole('dialog', { name: 'LIVE ended' }).waitFor({ timeout: 20000 });
  await shot('12-ended-summary');
  const after = await get(token, `/v1/broadcasts/${streamId}`);
  check('broadcast ended', /^(ended|processing|replay_)/.test(after.state) && !!after.endedAt, after.state);
  const feed2 = await get(token, '/v1/feed?tab=live_now');
  check('gone from live_now feed', !feed2.items?.some((it) => it.stream?.id === streamId));
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

  // ── Sign out (revokes the app's session) ──
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Email or username').waitFor();
  check('signed out, session file removed', !fs.existsSync(sessionFile));
} catch (e) {
  if (String(e?.message) !== 'SKIP_LIVE') check('run completed', false, String(e?.stack ?? e));
  await shot('zz-failure').catch(() => undefined);
} finally {
  // Never leave a test stream live: end it through the app (it holds the publisher lease).
  const active = async () => {
    const st = token && streamId ? await get(token, `/v1/broadcasts/${streamId}`).catch(() => null) : null;
    return !!st && ['starting', 'live', 'reconnecting'].includes(st.state);
  };
  if (await active()) {
    log('cleanup: ending', streamId, 'via the app');
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.getByRole('button', { name: /End LIVE/ }).first().click({ timeout: 5000 }).catch(() => undefined);
    await page.getByRole('dialog').getByRole('button', { name: 'End LIVE' }).click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(3000);
    if (await active()) {
      // Last resort: kill the app so heartbeats stop; the server ends the stream when the lease and reconnect window lapse.
      log('WARNING: stream', streamId, 'still active; killing the app so the server ends it within ~2 min');
      app.process().kill();
    }
  }
  if (streamId) log('final state:', (await get(token, `/v1/broadcasts/${streamId}`).catch(() => ({}))).state);
  await page.evaluate(() => window.cult.logout()).catch(() => undefined); // revoke the app's session too
  if (token) await fetch(`${API}/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);
  await app.close().catch(() => undefined);
}

if (consoleErrors.length) log('console errors:', consoleErrors.slice(0, 10));
const failed = results.filter((r) => !r.ok);
log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
