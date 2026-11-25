import { SIZE, type Filters, type Orientation, type Scene, type Source } from './scene';

/**
 * The compositor: persistent canvases per orientation (program, plus preview for director mode), drawn at 30 fps from
 * a worker clock. React owns the scene data and pushes it here with setDrawState(); media elements and live widget data
 * live in module state so the draw loop never waits on a render.
 */

type Bank = Record<Orientation, HTMLCanvasElement>;
const makeCanvas = (o: Orientation) => {
  const c = document.createElement('canvas');
  c.width = SIZE[o].w;
  c.height = SIZE[o].h;
  return c;
};
export const program: Bank = { portrait: makeCanvas('portrait'), landscape: makeCanvas('landscape') };
export const preview: Bank = { portrait: makeCanvas('portrait'), landscape: makeCanvas('landscape') };

interface DrawState {
  scenes: Scene[];
  programId: string;
  previewId: string | null; // director mode only
}
let state: DrawState = { scenes: [], programId: '', previewId: null };
export const setDrawState = (s: DrawState) => {
  state = s;
};

// ── Media registry: <video>/<img> per source (sid). Duplicates alias the same element, so one capture feeds both. ──
type Media = HTMLVideoElement | HTMLImageElement;
const media = new Map<string, Media>();
const blobUrls = new Map<Media, string>();

export function registerMedia(sid: string, el: Media, blobUrl?: string): void {
  releaseMedia(sid);
  media.set(sid, el);
  if (blobUrl) blobUrls.set(el, blobUrl);
}

export function aliasMedia(sid: string, from: string): void {
  const el = media.get(from);
  if (el) media.set(sid, el);
}

/** Drop a source's media; the element is stopped only when no other source still uses it. */
export function releaseMedia(sid: string): void {
  const el = media.get(sid);
  media.delete(sid);
  if (!el || [...media.values()].includes(el)) return;
  if (el instanceof HTMLVideoElement) {
    const s = el.srcObject;
    if (s instanceof MediaStream) s.getTracks().forEach((t) => t.stop()); // turns the camera / capture off
    el.pause();
    el.srcObject = null;
    el.removeAttribute('src');
  }
  const u = blobUrls.get(el);
  if (u) URL.revokeObjectURL(u);
  blobUrls.delete(el);
}

/** Camera device currently feeding a source, for the settings dialog. */
export function mediaDeviceId(sid: string): string | null {
  const el = media.get(sid);
  const s = el instanceof HTMLVideoElement ? el.srcObject : null;
  return s instanceof MediaStream ? (s.getVideoTracks()[0]?.getSettings().deviceId ?? null) : null;
}

export const hasMedia = (id: string) => media.has(id);

export function mediaSize(id: string): { w: number; h: number } | null {
  const el = media.get(id);
  if (el instanceof HTMLVideoElement) return el.videoWidth ? { w: el.videoWidth, h: el.videoHeight } : null;
  if (el instanceof HTMLImageElement) return el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null;
  return null;
}

/** Load a video element (file loop or MediaStream) and resolve once it has a frame size. */
export function loadVideo(src: { url: string } | { stream: MediaStream }): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true; // video audio is not mixed into the output (see audio.ts)
  v.playsInline = true;
  if ('url' in src) {
    v.src = src.url;
    v.loop = true;
  } else v.srcObject = src.stream;
  return new Promise((resolve, reject) => {
    v.onloadedmetadata = () => {
      void v.play().catch(() => undefined);
      resolve(v);
    };
    v.onerror = () => reject(new Error('That video can’t be played. Try an MP4 (H.264) or WebM file.'));
  });
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(
    () => img,
    () => {
      throw new Error('That image can’t be opened. Use PNG, JPG, GIF or WebP.');
    },
  );
}

// ── Live data for widgets (updated by the live session) ──
export const widgets = {
  live: false,
  goalCurrent: 0,
  goalTarget: 10,
  likes: 0,
  gifts: 0,
  followers: 0,
  chat: [] as { name: string; body: string }[],
  ranking: [] as { name: string; value: string }[],
  alerts: [] as { title: string; sub: string; at: number }[],
};

export function pushAlert(title: string, sub: string): void {
  widgets.alerts.push({ title, sub, at: 0 });
  if (widgets.alerts.length > 20) widgets.alerts.shift();
}

// ── Drawing ──
const ALERT_MS = 5000;
const FONT = 'Barlow, system-ui, sans-serif';
const YELLOW = '#ffe100';

function panel(ctx: CanvasRenderingContext2D, s: Source, alpha = 0.62): void {
  const r = Math.min(s.w, s.h) * 0.12;
  ctx.fillStyle = `rgba(9,9,11,${alpha})`;
  ctx.beginPath();
  ctx.roundRect(s.x, s.y, s.w, s.h, r);
  ctx.fill();
}

function text(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, px: number, color = '#fff', weight = 600, maxW?: number, family = FONT): void {
  ctx.font = `${weight} ${Math.round(px)}px ${family}`;
  ctx.fillStyle = color;
  ctx.fillText(t, x, y, maxW);
}

function wrap(ctx: CanvasRenderingContext2D, t: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of t.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxW && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function drawWidget(ctx: CanvasRenderingContext2D, s: Source, now: number): void {
  const pad = Math.min(s.w, s.h) * 0.14;
  ctx.textBaseline = 'middle';
  switch (s.kind) {
    case 'goal': {
      panel(ctx, s);
      const px = s.h * 0.24;
      const cur = Math.min(widgets.goalCurrent, widgets.goalTarget);
      text(ctx, s.text || 'Gift goal', s.x + pad, s.y + s.h * 0.3, px, '#fff', 600, s.w * 0.6);
      ctx.textAlign = 'right';
      text(ctx, `${widgets.goalCurrent} / ${widgets.goalTarget}`, s.x + s.w - pad, s.y + s.h * 0.3, px, '#fff', 600);
      ctx.textAlign = 'left';
      const bx = s.x + pad;
      const bw = s.w - pad * 2;
      const by = s.y + s.h * 0.6;
      const bh = s.h * 0.18;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, bh / 2);
      ctx.fill();
      if (cur > 0) {
        ctx.fillStyle = YELLOW;
        ctx.beginPath();
        ctx.roundRect(bx, by, Math.max(bh, (bw * cur) / widgets.goalTarget), bh, bh / 2);
        ctx.fill();
      }
      break;
    }
    case 'countdown': {
      panel(ctx, s);
      const left = Math.max(0, (s.seconds ?? 300) - (now - (s.startedAt ?? now)) / 1000);
      text(ctx, s.text || 'Starting in', s.x + pad, s.y + s.h * 0.3, s.h * 0.2, '#b9b9c3', 500, s.w - pad * 2);
      text(ctx, left > 0 ? mmss(Math.ceil(left)) : '0:00', s.x + pad, s.y + s.h * 0.66, s.h * 0.4, '#fff', 600);
      break;
    }
    case 'tally': {
      panel(ctx, s);
      const value = s.metric === 'gifts' ? widgets.gifts : s.metric === 'followers' ? widgets.followers : widgets.likes;
      const label = s.text || (s.metric === 'gifts' ? 'Gifts' : s.metric === 'followers' ? 'New followers' : 'Likes');
      text(ctx, label, s.x + pad, s.y + s.h * 0.3, s.h * 0.2, '#b9b9c3', 500, s.w - pad * 2);
      text(ctx, value.toLocaleString('en'), s.x + pad, s.y + s.h * 0.66, s.h * 0.4, '#fff', 600);
      break;
    }
    case 'ranking': {
      panel(ctx, s);
      const row = s.h / 6.5;
      text(ctx, s.text || 'Top gifters', s.x + pad, s.y + row * 0.8, row * 0.5, '#fff', 600, s.w - pad * 2);
      if (!widgets.ranking.length) {
        text(ctx, widgets.live ? 'No gifts yet' : 'Top gifters show here', s.x + pad, s.y + row * 1.9, row * 0.42, '#8a8a96', 500, s.w - pad * 2);
        break;
      }
      widgets.ranking.slice(0, 5).forEach((r, i) => {
        const y = s.y + row * (1.9 + i);
        text(ctx, `${i + 1}  ${r.name}`, s.x + pad, y, row * 0.42, i === 0 ? YELLOW : '#fff', 500, s.w * 0.6);
        ctx.textAlign = 'right';
        text(ctx, r.value, s.x + s.w - pad, y, row * 0.42, '#b9b9c3', 500);
        ctx.textAlign = 'left';
      });
      break;
    }
    case 'chatbox': {
      const px = Math.max(18, Math.min(44, s.w / 18));
      ctx.font = `500 ${px}px ${FONT}`;
      const lines: { name?: string; t: string }[] = [];
      const msgs = widgets.chat.length ? widgets.chat : widgets.live ? [] : [{ name: 'CULT', body: 'LIVE chat shows here while you stream.' }];
      for (const m of msgs) {
        const parts = wrap(ctx, `${m.name} ${m.body}`, s.w - pad * 2); // wrap() joins words with single spaces
        parts.forEach((t, i) => lines.push(i === 0 ? { name: m.name, t } : { t }));
      }
      const lh = px * 1.35;
      const fit = lines.slice(-Math.max(1, Math.floor((s.h - pad) / lh)));
      if (fit.length) panel(ctx, { ...s, y: s.y + s.h - fit.length * lh - pad, h: fit.length * lh + pad }, 0.45);
      fit.forEach((l, i) => {
        const y = s.y + s.h - (fit.length - i) * lh - pad / 2 + lh / 2;
        if (l.name) {
          const nameT = `${l.name} `;
          text(ctx, nameT, s.x + pad, y, px, YELLOW, 600);
          const nw = ctx.measureText(nameT).width;
          text(ctx, l.t.slice(nameT.length), s.x + pad + nw, y, px, '#fff', 500);
        } else text(ctx, l.t, s.x + pad, y, px, '#fff', 500);
      });
      break;
    }
    case 'alert': {
      const a = widgets.alerts[0];
      if (!a) {
        if (!widgets.live) {
          panel(ctx, s, 0.35);
          ctx.textAlign = 'center';
          text(ctx, 'Gift and follow alerts pop up here', s.x + s.w / 2, s.y + s.h / 2, s.h * 0.16, '#b9b9c3', 500, s.w - pad * 2);
          ctx.textAlign = 'left';
        }
        break;
      }
      if (!a.at) a.at = now;
      const t = now - a.at;
      if (t > ALERT_MS) {
        widgets.alerts.shift();
        break;
      }
      const base = ctx.globalAlpha; // keeps the source opacity filter
      ctx.globalAlpha = base * Math.min(1, t / 250, (ALERT_MS - t) / 400);
      panel(ctx, s, 0.8);
      ctx.textAlign = 'center';
      text(ctx, a.title, s.x + s.w / 2, s.y + s.h * 0.4, s.h * 0.24, YELLOW, 600, s.w - pad * 2);
      text(ctx, a.sub, s.x + s.w / 2, s.y + s.h * 0.68, s.h * 0.16, '#fff', 500, s.w - pad * 2);
      ctx.textAlign = 'left';
      ctx.globalAlpha = base;
      break;
    }
  }
}

/** The source's content filling the box `s` (already in its own, unrotated frame). */
function drawContent(ctx: CanvasRenderingContext2D, s: Source, now: number): void {
  if (s.kind === 'text') {
    const lines = (s.text || ' ').split('\n');
    const px = s.h / (lines.length * 1.2);
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = px * 0.12;
    lines.forEach((l, i) => text(ctx, l, s.x, s.y + px * 1.2 * (i + 0.5), px, s.color ?? '#ffffff', 600, undefined, s.font ?? FONT));
    return;
  }
  const el = media.get(s.sid);
  if (el) {
    if (el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete) ctx.drawImage(el, s.x, s.y, s.w, s.h);
    return;
  }
  drawWidget(ctx, s, now);
}

function filterCss(f: Filters | undefined): string {
  if (!f) return 'none';
  const parts = [
    f.brightness !== 100 && `brightness(${f.brightness}%)`,
    f.contrast !== 100 && `contrast(${f.contrast}%)`,
    f.saturate !== 100 && `saturate(${f.saturate}%)`,
    f.hue !== 0 && `hue-rotate(${f.hue}deg)`,
    f.blur > 0 && `blur(${f.blur}px)`,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'none';
}

/** Draw one item: flip and rotate around the box centre, crop, shape mask, filters and opacity. */
function drawSource(ctx: CanvasRenderingContext2D, s: Source, now: number): void {
  const rot = s.rot ?? 0;
  const lw = rot % 180 ? s.h : s.w; // box size in the content's own frame
  const lh = rot % 180 ? s.w : s.h;
  const c = s.crop;
  const fw = c ? lw / (1 - c.l - c.r) : lw; // uncropped content size
  const fh = c ? lh / (1 - c.t - c.b) : lh;
  ctx.save();
  ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
  ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1); // flips act on the canvas axes, after rotation
  ctx.rotate((rot * Math.PI) / 180);
  if (c || (s.shape && s.shape !== 'rect')) {
    ctx.beginPath();
    if (s.shape === 'circle') ctx.arc(0, 0, Math.min(lw, lh) / 2, 0, Math.PI * 2);
    else if (s.shape === 'rounded') ctx.roundRect(-lw / 2, -lh / 2, lw, lh, Math.min(lw, lh) * 0.12);
    else ctx.rect(-lw / 2, -lh / 2, lw, lh);
    ctx.clip();
  }
  if (s.filters) {
    ctx.filter = filterCss(s.filters);
    ctx.globalAlpha = s.filters.opacity / 100;
  }
  drawContent(ctx, { ...s, x: -lw / 2 - (c ? c.l * fw : 0), y: -lh / 2 - (c ? c.t * fh : 0), w: fw, h: fh }, now);
  ctx.restore();
}

function drawScene(canvas: HTMLCanvasElement, scene: Scene | undefined, o: Orientation, now: number): void {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!scene) return;
  for (const s of scene.sources) if (s.canvas === o && s.visible) drawSource(ctx, s, now);
}

// ── Projectors: one canvas per projected item, streamed (captureStream) into a child window's <video> ──
const projectors = new Map<Window, { id: string; canvas: HTMLCanvasElement; stream: MediaStream }>();
let projectorSeq = 0;

/** Open a projector for one item, fullscreen on a display (main validates the id) or windowed. Esc closes it. */
export function openProjector(id: string, name: string, display: number | 'windowed'): void {
  const win = window.open('about:blank', `cult-projector:${display}:${++projectorSeq}`);
  if (!win) throw new Error('The projector window couldn’t open.');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const stream = canvas.captureStream(30);
  const doc = win.document;
  doc.title = `Projector · ${name}`;
  doc.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
  const v = doc.createElement('video');
  v.muted = v.autoplay = v.playsInline = true;
  v.style.cssText = 'display:block;width:100vw;height:100vh;object-fit:contain';
  v.srcObject = stream;
  doc.body.append(v);
  win.addEventListener('keydown', (e) => e.key === 'Escape' && win.close());
  projectors.set(win, { id, canvas, stream });
}

function drawProjectors(now: number): void {
  for (const [win, p] of projectors) {
    if (win.closed) {
      p.stream.getTracks().forEach((t) => t.stop());
      projectors.delete(win);
      continue;
    }
    const s = state.scenes.flatMap((sc) => sc.sources).find((x) => x.id === p.id);
    const ctx = p.canvas.getContext('2d')!;
    if (s) {
      const k = Math.min(1, 1920 / Math.max(s.w, s.h)); // cap the projector canvas at 1080p-ish
      const w = Math.max(2, Math.round(s.w * k));
      const h = Math.max(2, Math.round(s.h * k));
      if (p.canvas.width !== w || p.canvas.height !== h) Object.assign(p.canvas, { width: w, height: h });
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.scale(k, k);
      ctx.translate(-s.x, -s.y);
      drawSource(ctx, s, now);
      ctx.restore();
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, p.canvas.width, p.canvas.height); // item deleted: black
    }
  }
}

let frames = 0;
let fps = 0;
let started = false;

export const currentFps = () => fps;

export function start(): void {
  if (started) return;
  started = true;
  const worker = new Worker(new URL('./tick.worker.ts', import.meta.url), { type: 'module' });
  let last = performance.now();
  worker.onmessage = () => {
    const now = performance.now();
    const prog = state.scenes.find((s) => s.id === state.programId);
    drawScene(program.portrait, prog, 'portrait', Date.now());
    drawScene(program.landscape, prog, 'landscape', Date.now());
    if (state.previewId) {
      const pre = state.scenes.find((s) => s.id === state.previewId);
      drawScene(preview.portrait, pre, 'portrait', Date.now());
      drawScene(preview.landscape, pre, 'landscape', Date.now());
    }
    if (projectors.size) drawProjectors(Date.now());
    frames++;
    if (now - last >= 1000) {
      fps = Math.round((frames * 1000) / (now - last));
      frames = 0;
      last = now;
    }
  };
}
