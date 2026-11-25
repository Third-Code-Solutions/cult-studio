import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as comp from '../lib/compositor';
import { cropPatch, fullScreenBox, isMedia, resizeBox, SIZE, type Box, type Orientation, type Scene, type Source } from '../lib/scene';
import { Icon } from './Icon';
import type { Layout, View } from './LeftPanel';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const HANDLE_POS: Record<(typeof HANDLES)[number], [number, number]> = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };

type ScreenProps = {
  canvas: HTMLCanvasElement;
  orientation: Orientation;
  caption: ReactNode;
  scene: Scene | null; // editable overlay when set
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<Source>) => void;
  onAdd?: () => void;
  phone?: boolean;
  cropId: string | null; // the item in crop mode: its handles crop instead of resize
  onContext: (x: number, y: number, id: string | null) => void;
};

/** One canvas, scaled to fit its frame, with a DOM overlay for selection and handles (never drawn into the output). */
function Screen({ canvas, orientation, caption, scene, selectedId, onSelect, onPatch, onAdd, phone, cropId, onContext }: ScreenProps) {
  const frame = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ start: Source; handle: string | null; crop: boolean; x: number; y: number; box: Box; scale: number } | null>(null);
  const c = SIZE[orientation];

  useLayoutEffect(() => {
    const el = frame.current!;
    const fit = () => {
      const pad = phone ? 24 : 0;
      const s = Math.min((el.clientWidth - pad) / c.w, (el.clientHeight - pad) / c.h);
      setSize({ w: Math.max(0, Math.floor(c.w * s)), h: Math.max(0, Math.floor(c.h * s)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [c.w, c.h, phone]);

  useEffect(() => {
    const w = wrap.current!;
    w.prepend(canvas);
    return () => canvas.remove();
  }, [canvas]);

  const sources = scene?.sources.filter((s) => s.canvas === orientation) ?? [];

  const down = (e: React.PointerEvent, s: Source, handle: string | null) => {
    e.stopPropagation();
    onSelect(s.id);
    if (s.locked || e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const crop = !!handle && (e.altKey || cropId === s.id); // Alt+drag on a handle crops too
    drag.current = { start: s, handle, crop, x: e.clientX, y: e.clientY, box: { x: s.x, y: s.y, w: s.w, h: s.h }, scale: c.w / size.w };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * d.scale;
    const dy = (e.clientY - d.y) * d.scale;
    if (d.handle) onPatch(d.start.id, d.crop ? cropPatch(d.start, d.handle, dx, dy) : resizeBox(d.box, d.handle, dx, dy));
    else onPatch(d.start.id, { x: Math.round(d.box.x + dx), y: Math.round(d.box.y + dy) });
  };
  const up = () => {
    drag.current = null;
  };
  const context = (e: React.MouseEvent, id: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(id);
    onContext(e.clientX, e.clientY, id);
  };

  return (
    <div className="screen" style={{ flex: orientation === 'landscape' ? 1.6 : 1 }}>
      <div className="screen-cap">{caption}</div>
      <div className="screen-frame" ref={frame}>
        <div className={phone ? 'phone' : undefined}>
          <div className="canvas-wrap" ref={wrap} style={{ width: size.w, height: size.h }}>
            {scene && (
              <div className="overlay" onPointerDown={() => onSelect(null)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => context(e, null)}>
                {sources.map((s) =>
                  !s.visible ? null : (
                    <div
                      key={s.id}
                      className={`box${s.id === selectedId ? ' sel' : ''}${s.locked ? ' locked' : ''}${s.id === cropId ? ' crop' : ''}`}
                      data-crop={s.id === cropId || undefined}
                      style={{ left: `${(s.x / c.w) * 100}%`, top: `${(s.y / c.h) * 100}%`, width: `${(s.w / c.w) * 100}%`, height: `${(s.h / c.h) * 100}%` }}
                      onPointerDown={(e) => down(e, s, null)}
                      onContextMenu={(e) => context(e, s.id)}
                      aria-label={s.name}
                    >
                      {s.id === selectedId && (
                        <>
                          <span className="lbl">{s.name}{s.locked ? ' · locked' : s.id === cropId ? ' · crop' : ''}</span>
                          {!s.locked && HANDLES.map((h) => <span key={h} className={`h ${h}`} style={{ left: `${HANDLE_POS[h][0]}%`, top: `${HANDLE_POS[h][1]}%` }} onPointerDown={(e) => down(e, s, h)} />)}
                        </>
                      )}
                    </div>
                  ),
                )}
              </div>
            )}
            {scene && !sources.length && onAdd && (
              <div className="stage-empty">
                <div>
                  <span>Nothing on this canvas yet.</span>
                  <button className="btn" onClick={onAdd}>
                    <Icon name="plus" size={14} /> Add source
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  view: View;
  layout: Layout;
  director: boolean;
  mainOrientation: Orientation;
  editing: Scene | undefined;
  programScene: Scene | undefined;
  selected: Source | null;
  isLive: boolean;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<Source>) => void;
  onSwitch: () => void;
  onAddSource: (o: Orientation) => void;
  cropId: string | null;
  onContext: (x: number, y: number, id: string | null) => void;
};

const label = (o: Orientation) => (o === 'portrait' ? 'Portrait 1080×1920' : 'Landscape 1920×1080');

export function Stage(p: Props) {
  const edit = p.editing ?? null;
  const common = { selectedId: p.selected?.id ?? null, onSelect: p.onSelect, onPatch: p.onPatch, cropId: p.cropId, onContext: p.onContext };
  const mainTag = (o: Orientation) =>
    o === p.mainOrientation ? <span className={`tag${p.isLive ? ' live' : ''}`}>{p.isLive ? 'LIVE output' : 'Main output'}</span> : <span className="tag">Design only</span>;

  let screens: ReactNode;
  let note: ReactNode = null;
  if (p.view === 'mobile') {
    const bank = p.director ? comp.preview : comp.program;
    screens = <Screen {...common} canvas={bank.portrait} orientation="portrait" phone scene={edit} onAdd={() => p.onAddSource('portrait')} caption={<>Mobile view · {edit?.name} {mainTag('portrait')}</>} />;
    if (p.mainOrientation !== 'portrait') note = 'Your LIVE is landscape. Mobile view shows the portrait design.';
  } else if (p.director) {
    const o = p.mainOrientation;
    screens = (
      <>
        <Screen {...common} canvas={comp.preview[o]} orientation={o} scene={edit} onAdd={() => p.onAddSource(o)} caption={<>Preview · {edit?.name} <span className="tag prev">Next</span></>} />
        <div className="switch-bar">
          <button className="btn primary" onClick={p.onSwitch} disabled={edit?.id === p.programScene?.id}>
            Switch
          </button>
        </div>
        <Screen {...common} canvas={comp.program[o]} orientation={o} scene={null} caption={<>On air · {p.programScene?.name} {mainTag(o)}</>} />
      </>
    );
    note = 'Director mode: edit the preview, then Switch to send it out.';
  } else {
    const shown: Orientation[] = p.layout === 'both' ? ['portrait', 'landscape'] : [p.layout];
    screens = shown.map((o) => <Screen key={o} {...common} canvas={comp.program[o]} orientation={o} scene={edit} onAdd={() => p.onAddSource(o)} caption={<>{label(o)} {mainTag(o)}</>} />);
    if (p.layout === 'both') note = `${p.mainOrientation === 'portrait' ? 'Landscape' : 'Portrait'} output: design only — publishes when dual output ships.`;
  }

  const s = p.selected;
  const size = s && isMedia(s.kind) ? comp.mediaSize(s.sid) : null;
  return (
    <section className="stage" aria-label="Canvas" tabIndex={-1}>
      <div className="stage-bar">
        <span>{note ?? `${p.mainOrientation === 'portrait' ? 'Portrait' : 'Landscape'} LIVE · 30 fps`}</span>
        <span className="sp" />
        {s && <span className="faint">Selected: {s.name}</span>}
      </div>
      <div className="stage-body">{screens}</div>
      {s && (size || s.kind === 'countdown') && (
        <div className="props" role="toolbar" aria-label={`${s.name} options`}>
          {size && (
            <>
              <button className="btn sm" disabled={s.locked} onClick={() => p.onPatch(s.id, fullScreenBox(s, 'fit', size))}>
                <Icon name="fit" size={14} /> Fit
              </button>
              <button className="btn sm" disabled={s.locked} onClick={() => p.onPatch(s.id, fullScreenBox(s, 'fill', size))}>
                Fill
              </button>
            </>
          )}
          {s.kind === 'countdown' && (
            <button className="btn sm" onClick={() => p.onPatch(s.id, { startedAt: Date.now() })}>
              <Icon name="refresh" size={14} /> Restart countdown
            </button>
          )}
        </div>
      )}
    </section>
  );
}
