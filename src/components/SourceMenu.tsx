import type { Display } from '../lib/bridge';
import { DEFAULT_FILTERS, type Filters, type Shape, type Source } from '../lib/scene';
import { ContextMenu, type MenuEntry, type MenuItem } from './ContextMenu';
import { Dialog } from './Dialog';

export type SourceAction =
  | 'settings' | 'reset' | 'delete' | 'rename' | 'copy' | 'paste-ref' | 'paste-dup'
  | 'fit' | 'stretch' | 'fill' | 'center-h' | 'center-v' | 'center-both' | 'crop'
  | 'rot-cw' | 'rot-ccw' | 'rot-180' | 'flip-h' | 'flip-v'
  | 'front' | 'forward' | 'backward' | 'back' | 'shape' | 'filters'
  | { project: number | 'windowed' };

type Props = { x: number; y: number; source: Source | null; canPaste: boolean; displays: Display[]; onAct: (a: SourceAction) => void; onClose: () => void };

/** The source right-click menu (TikTok LIVE Studio layout). With no source (empty canvas or list) it only offers Paste. */
export function SourceMenu({ x, y, source: s, canPaste, displays, onAct, onClose }: Props) {
  const paste: MenuItem[] = [
    { label: 'Paste as reference', shortcut: 'Ctrl+V', disabled: !canPaste, onSelect: () => onAct('paste-ref') },
    { label: 'Paste as duplicate', disabled: !canPaste, onSelect: () => onAct('paste-dup') },
  ];
  if (!s) return <ContextMenu x={x} y={y} label="Canvas" items={paste} onClose={onClose} />;
  const fixed = s.locked; // a locked item keeps its position and size
  const act = (label: string, a: SourceAction): MenuEntry => ({ label, onSelect: () => onAct(a) });
  const items: MenuItem[] = [
    act('Rename', 'rename'),
    'sep',
    { ...act('Copy', 'copy'), shortcut: 'Ctrl+C' },
    ...paste,
    'sep',
    { label: 'Full screen', disabled: fixed, sub: [act('Fit to screen', 'fit'), act('Stretch to screen', 'stretch'), act('Fill screen', 'fill')] },
    { label: 'Center', disabled: fixed, sub: [act('Horizontally', 'center-h'), act('Vertically', 'center-v'), act('Both', 'center-both')] },
    { ...act('Crop', 'crop'), shortcut: 'ALT+drag', disabled: fixed },
    { label: 'Rotate', disabled: fixed, sub: [act('90° clockwise', 'rot-cw'), act('90° counter-clockwise', 'rot-ccw'), act('180°', 'rot-180')] },
    { label: 'Flip', disabled: fixed, sub: [act('Horizontal', 'flip-h'), act('Vertical', 'flip-v')] },
    { label: 'Layer', sub: [act('Bring to front', 'front'), act('Bring forward', 'forward'), act('Send backward', 'backward'), act('Send to back', 'back')] },
    'sep',
    {
      label: 'Project on screen',
      sub: [
        ...displays.map((d) => ({ label: `${d.label} · ${d.width}×${d.height}${d.primary ? ' (main)' : ''}`, onSelect: () => onAct({ project: d.id }) })),
        act('Windowed', { project: 'windowed' }),
      ],
    },
    act('Shape', 'shape'),
    act('Advanced filters', 'filters'),
  ];
  const top = [
    { label: 'Settings', icon: 'gear' as const, onSelect: () => onAct('settings') },
    { label: 'Reset', icon: 'refresh' as const, disabled: fixed, onSelect: () => onAct('reset') },
    { label: 'Delete', icon: 'trash' as const, onSelect: () => onAct('delete') },
  ];
  return <ContextMenu x={x} y={y} label={`${s.name} menu`} top={top} items={items} onClose={onClose} />;
}

const SHAPES: { id: Shape; label: string }[] = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'rounded', label: 'Rounded rectangle' },
  { id: 'circle', label: 'Circle' },
];

export function ShapeDialog({ source, onPatch, onClose }: { source: Source; onPatch: (p: Partial<Source>) => void; onClose: () => void }) {
  const cur = source.shape ?? 'rect';
  return (
    <Dialog title={`Shape · ${source.name}`} side onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <p className="faint" style={{ margin: 0 }}>Masks the source on the canvas and in your LIVE.</p>
      <div className="seg" role="group" aria-label="Shape">
        {SHAPES.map((x) => (
          <button key={x.id} aria-pressed={cur === x.id} onClick={() => onPatch({ shape: x.id === 'rect' ? undefined : x.id })}>
            {x.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

const FILTERS: { k: keyof Filters; label: string; min: number; max: number; unit: string }[] = [
  { k: 'brightness', label: 'Brightness', min: 0, max: 200, unit: '%' },
  { k: 'contrast', label: 'Contrast', min: 0, max: 200, unit: '%' },
  { k: 'saturate', label: 'Saturation', min: 0, max: 200, unit: '%' },
  { k: 'hue', label: 'Hue', min: -180, max: 180, unit: '°' },
  { k: 'blur', label: 'Blur', min: 0, max: 40, unit: 'px' },
  { k: 'opacity', label: 'Opacity', min: 0, max: 100, unit: '%' },
];

// shortcut: no chroma key — it needs per-pixel work every frame (getImageData or a WebGL pass); add a WebGL keyer if creators ask.
export function FiltersDialog({ source, onPatch, onClose }: { source: Source; onPatch: (p: Partial<Source>) => void; onClose: () => void }) {
  const f = source.filters ?? DEFAULT_FILTERS;
  const set = (k: keyof Filters, v: number, min: number, max: number) => onPatch({ filters: { ...f, [k]: Math.min(max, Math.max(min, Number.isFinite(v) ? v : DEFAULT_FILTERS[k])) } });
  return (
    <Dialog
      title={`Advanced filters · ${source.name}`}
      side
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => onPatch({ filters: undefined })}>Reset all</button>
          <span className="sp" />
          <button className="btn primary" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="filters">
        {FILTERS.map(({ k, label, min, max, unit }) => (
          <div key={k} className="filter-row">
            <label htmlFor={`f-${k}`}>{label}</label>
            <input id={`f-${k}`} type="range" min={min} max={max} value={f[k]} onChange={(e) => set(k, Number(e.target.value), min, max)} />
            <span className="num-unit">
              <input className="input num" type="number" min={min} max={max} value={f[k]} aria-label={`${label} value`} onChange={(e) => set(k, Number(e.target.value), min, max)} />
              {unit}
            </span>
            <button className="btn sm" disabled={f[k] === DEFAULT_FILTERS[k]} aria-label={`Reset ${label.toLowerCase()}`} onClick={() => set(k, DEFAULT_FILTERS[k], min, max)}>
              Reset
            </button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
