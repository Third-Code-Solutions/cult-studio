/**
 * Scene/source model. Plain data, updated immutably. Each item has its own transform; `sid` names the underlying source
 * (media element in the compositor registry + the SHARED settings), so "paste as reference" items share a sid.
 */

export type Orientation = 'portrait' | 'landscape';
export const SIZE: Record<Orientation, { w: number; h: number }> = {
  portrait: { w: 1080, h: 1920 },
  landscape: { w: 1920, h: 1080 },
};

export type SourceKind = 'game' | 'display' | 'window' | 'camera' | 'image' | 'text' | 'video' | 'alert' | 'goal' | 'chatbox' | 'countdown' | 'tally' | 'ranking';
export type TallyMetric = 'likes' | 'gifts' | 'followers';

export type Shape = 'rect' | 'rounded' | 'circle';
export interface Crop { l: number; t: number; r: number; b: number } // fractions of the content, in its own (unrotated) frame
export interface Filters { brightness: number; contrast: number; saturate: number; hue: number; blur: number; opacity: number }
export const DEFAULT_FILTERS: Filters = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, opacity: 100 };

export interface Source {
  id: string;
  sid: string; // underlying source: media + SHARED settings
  kind: SourceKind;
  name: string;
  canvas: Orientation;
  // x/y/w/h: the on-canvas (visual) box. Rotation is in 90° steps, so it stays axis-aligned for drawing and hit-testing.
  x: number;
  y: number;
  w: number;
  h: number;
  home: Box; // where Reset puts it
  visible: boolean;
  locked: boolean;
  text?: string; // text source body, widget label
  color?: string;
  font?: string; // text source font family
  seconds?: number; // countdown length
  startedAt?: number; // countdown start (ms)
  metric?: TallyMetric;
  rot?: number; // 0 | 90 | 180 | 270, clockwise
  flipH?: boolean;
  flipV?: boolean;
  crop?: Crop;
  shape?: Shape;
  filters?: Filters;
}

/** Settings shared by every item with the same sid (references); everything else is per item. */
const SHARED = ['name', 'text', 'color', 'font', 'seconds', 'startedAt', 'metric'] as const;

/** The shared settings of an item, as they are now. */
export const sharedOf = (s: Source): Partial<Source> => Object.fromEntries(SHARED.map((k) => [k, s[k]]));

export interface Scene {
  id: string;
  name: string;
  sources: Source[]; // bottom → top
}

export type Box = Pick<Source, 'x' | 'y' | 'w' | 'h'>;

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const newScene = (name: string): Scene => ({ id: uid('sc'), name, sources: [] });

export const MEDIA_KINDS: SourceKind[] = ['game', 'display', 'window', 'camera', 'image', 'video'];
export const isMedia = (k: SourceKind) => MEDIA_KINDS.includes(k);

/** Largest box with the media's aspect that fits the canvas (`fill` covers it instead), centred. */
export function fitBox(mediaW: number, mediaH: number, o: Orientation, mode: 'fit' | 'fill' = 'fit'): Box {
  const c = SIZE[o];
  const s = mode === 'fit' ? Math.min(c.w / mediaW, c.h / mediaH) : Math.max(c.w / mediaW, c.h / mediaH);
  const w = Math.round(mediaW * s);
  const h = Math.round(mediaH * s);
  return { x: Math.round((c.w - w) / 2), y: Math.round((c.h - h) / 2), w, h };
}

/** Default box for a widget, by canvas. */
export function widgetBox(kind: SourceKind, o: Orientation): Box {
  const c = SIZE[o];
  const pad = Math.round(c.w * 0.04);
  const w = o === 'portrait' ? c.w - pad * 2 : Math.round(c.w * 0.34);
  switch (kind) {
    case 'alert':
      return { x: Math.round((c.w - w) / 2), y: Math.round(c.h * 0.18), w, h: Math.round(w * 0.28) };
    case 'goal':
      return { x: pad, y: pad, w, h: Math.round(w * 0.16) };
    case 'chatbox':
      return { x: pad, y: Math.round(c.h * (o === 'portrait' ? 0.58 : 0.45)), w: o === 'portrait' ? Math.round(c.w * 0.7) : w, h: Math.round(c.h * (o === 'portrait' ? 0.3 : 0.5)) };
    case 'countdown':
      return { x: c.w - pad - Math.round(w * 0.5), y: pad, w: Math.round(w * 0.5), h: Math.round(w * 0.2) };
    case 'tally':
      return { x: pad, y: Math.round(c.h * 0.12), w: Math.round(w * 0.5), h: Math.round(w * 0.2) };
    case 'ranking':
      return { x: c.w - pad - Math.round(w * 0.6), y: Math.round(c.h * 0.12), w: Math.round(w * 0.6), h: Math.round(w * 0.6) };
    default:
      return { x: 0, y: 0, w: c.w, h: c.h };
  }
}

export function updateSource(scenes: Scene[], sceneId: string, sourceId: string, patch: Partial<Source>): Scene[] {
  const target = scenes.find((sc) => sc.id === sceneId)?.sources.find((s) => s.id === sourceId);
  if (!target) return scenes;
  const shared: Partial<Source> = {};
  for (const k of SHARED) if (k in patch) Object.assign(shared, { [k]: patch[k] });
  const linked = Object.keys(shared).length > 0;
  return scenes.map((sc) => ({
    ...sc,
    sources: sc.sources.map((s) => (sc.id === sceneId && s.id === sourceId ? { ...s, ...patch } : linked && s.sid === target.sid ? { ...s, ...shared } : s)),
  }));
}

export const addSource = (scenes: Scene[], sceneId: string, src: Source): Scene[] => scenes.map((sc) => (sc.id !== sceneId ? sc : { ...sc, sources: [...sc.sources, src] }));

export const removeSource = (scenes: Scene[], sceneId: string, sourceId: string): Scene[] =>
  scenes.map((sc) => (sc.id !== sceneId ? sc : { ...sc, sources: sc.sources.filter((s) => s.id !== sourceId) }));

/** Move a source one step up (towards the front) or down within its own canvas group. */
export function moveSource(scenes: Scene[], sceneId: string, sourceId: string, dir: 1 | -1): Scene[] {
  return scenes.map((sc) => {
    if (sc.id !== sceneId) return sc;
    const list = [...sc.sources];
    const i = list.findIndex((s) => s.id === sourceId);
    if (i < 0) return sc;
    let j = i + dir;
    while (j >= 0 && j < list.length && list[j]!.canvas !== list[i]!.canvas) j += dir;
    if (j < 0 || j >= list.length) return sc;
    [list[i], list[j]] = [list[j]!, list[i]!];
    return { ...sc, sources: list };
  });
}

/** Resize from a handle. Corners keep the aspect ratio; edges stretch. `dx/dy` are in canvas pixels. */
export function resizeBox(b: Box, handle: string, dx: number, dy: number): Box {
  const MIN = 40;
  let { x, y, w, h } = b;
  const corner = handle.length === 2;
  if (corner) {
    const ratio = b.w / b.h;
    const sx = handle.includes('e') ? dx : -dx;
    const sy = handle.includes('s') ? dy : -dy;
    const nw = Math.max(MIN, Math.abs(sx) > Math.abs(sy * ratio) ? b.w + sx : b.w + sy * ratio);
    const nh = nw / ratio;
    if (handle.includes('w')) x = b.x + b.w - nw;
    if (handle.includes('n')) y = b.y + b.h - nh;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(nw), h: Math.round(nh) };
  }
  if (handle === 'e') w = Math.max(MIN, b.w + dx);
  if (handle === 's') h = Math.max(MIN, b.h + dy);
  if (handle === 'w') {
    w = Math.max(MIN, b.w - dx);
    x = b.x + b.w - w;
  }
  if (handle === 'n') {
    h = Math.max(MIN, b.h - dy);
    y = b.y + b.h - h;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Bring to front / send to back (array order is draw order, bottom → top). */
export function layerSource(scenes: Scene[], sceneId: string, sourceId: string, to: 'front' | 'back'): Scene[] {
  return scenes.map((sc) => {
    const s = sc.id === sceneId ? sc.sources.find((x) => x.id === sourceId) : undefined;
    if (!s) return sc;
    const rest = sc.sources.filter((x) => x.id !== sourceId);
    return { ...sc, sources: to === 'front' ? [...rest, s] : [s, ...rest] };
  });
}

const swapped = (s: Source) => (s.rot ?? 0) % 180 !== 0;
const NO_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 };

/** Rotate by ±90/180 around the box centre. With exactly one flip, the stored angle turns the other way (F·R(a) = R(-a)·F). */
export function rotatePatch(s: Source, deg: 90 | -90 | 180): Partial<Source> {
  const d = s.flipH !== s.flipV ? -deg : deg;
  const rot = ((((s.rot ?? 0) + d) % 360) + 360) % 360;
  if (deg === 180) return { rot };
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  return { rot, x: Math.round(cx - s.h / 2), y: Math.round(cy - s.w / 2), w: s.h, h: s.w };
}

/** Content size in its own frame after crop: media size when known, else the current box. */
function contentSize(s: Source, media: { w: number; h: number } | null): { w: number; h: number } {
  const c = s.crop ?? NO_CROP;
  if (media) return { w: media.w * (1 - c.l - c.r), h: media.h * (1 - c.t - c.b) };
  return swapped(s) ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}

export function fullScreenBox(s: Source, mode: 'fit' | 'stretch' | 'fill', media: { w: number; h: number } | null): Box {
  if (mode === 'stretch') return { x: 0, y: 0, ...SIZE[s.canvas] };
  const c = contentSize(s, media);
  return swapped(s) ? fitBox(c.h, c.w, s.canvas, mode) : fitBox(c.w, c.h, s.canvas, mode);
}

export function centerBox(s: Source, axis: 'h' | 'v' | 'both'): Partial<Box> {
  const c = SIZE[s.canvas];
  return { ...(axis !== 'v' ? { x: Math.round((c.w - s.w) / 2) } : {}), ...(axis !== 'h' ? { y: Math.round((c.h - s.h) / 2) } : {}) };
}

export const resetPatch = (s: Source): Partial<Source> => ({ ...s.home, rot: 0, flipH: false, flipV: false, crop: undefined, shape: undefined, filters: undefined });

/** Which edge of the content (own frame) sits on a visual edge, given rotation and flips. */
function localEdge(s: Source, edge: 'n' | 's' | 'e' | 'w'): keyof Crop {
  const n = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[edge];
  const fx = n[0]! * (s.flipH ? -1 : 1);
  const fy = n[1]! * (s.flipV ? -1 : 1);
  const a = (-(s.rot ?? 0) * Math.PI) / 180;
  const lx = Math.round(fx * Math.cos(a) - fy * Math.sin(a));
  const ly = Math.round(fx * Math.sin(a) + fy * Math.cos(a));
  return lx < 0 ? 'l' : lx > 0 ? 'r' : ly < 0 ? 't' : 'b';
}

/** Crop from a handle drag: the content stays put and the box edge moves over it. `dx/dy` in canvas pixels. */
export function cropPatch(start: Source, handle: string, dx: number, dy: number): Partial<Source> {
  let s = { ...start, crop: { ...(start.crop ?? NO_CROP) } };
  for (const edge of handle.split('') as ('n' | 's' | 'e' | 'w')[]) {
    const inward = { n: dy, s: -dy, w: dx, e: -dx }[edge];
    const le = localEdge(s, edge);
    const c = s.crop;
    const horiz = le === 'l' || le === 'r';
    const local = swapped(s) ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
    const full = horiz ? local.w / (1 - c.l - c.r) : local.h / (1 - c.t - c.b); // uncropped extent along that axis
    const other = horiz ? (le === 'l' ? c.r : c.l) : le === 't' ? c.b : c.t;
    const next = Math.min(Math.max(0, c[le] + inward / full), 0.9 - other);
    const moved = (next - c[le]) * full; // px the box edge actually moves inward
    const box = { x: s.x, y: s.y, w: s.w, h: s.h };
    if (edge === 'n') Object.assign(box, { y: s.y + moved, h: s.h - moved });
    if (edge === 's') box.h = s.h - moved;
    if (edge === 'w') Object.assign(box, { x: s.x + moved, w: s.w - moved });
    if (edge === 'e') box.w = s.w - moved;
    s = { ...s, ...box, crop: { ...c, [le]: next } };
  }
  return { x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h), crop: s.crop };
}

/** A pasted copy: same sid (reference) or a new one (duplicate), with its own transform. */
export function pastedSource(clip: Source, mode: 'reference' | 'duplicate', canvas: Orientation, offset: number): Source {
  const k = clip.canvas === canvas ? 1 : SIZE[canvas].w / SIZE[clip.canvas].w;
  const scale = (b: Box): Box => ({ x: Math.round(b.x * k) + offset, y: Math.round(b.y * k) + offset, w: Math.round(b.w * k), h: Math.round(b.h * k) });
  return { ...clip, ...scale(clip), home: scale(clip.home), canvas, id: uid('src'), sid: mode === 'reference' ? clip.sid : uid('sid') };
}
