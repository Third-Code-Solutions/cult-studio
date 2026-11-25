import { useEffect, useState } from 'react';
import { bridge, call, type CaptureSource } from '../lib/bridge';
import * as comp from '../lib/compositor';
import { errorText } from '../lib/errors';
import { fitBox, SIZE, uid, widgetBox, type Box, type Orientation, type Source, type SourceKind, type TallyMetric } from '../lib/scene';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { KIND_ICON } from './LeftPanel';

type Kind = SourceKind | 'phone';

const INFO: Record<Kind, { name: string; desc: string }> = {
  game: { name: 'Game capture', desc: 'Shows a game on your LIVE. On Windows this works as window capture: pick the game’s window below. If a fullscreen game shows black, switch it to borderless windowed mode.' },
  display: { name: 'Display capture', desc: 'Shows everything on one of your screens. Anything that pops up on that screen, like notifications, is visible to viewers.' },
  window: { name: 'Window capture', desc: 'Shows one app window, even when other windows cover it. Minimised windows can’t be captured.' },
  camera: { name: 'Camera', desc: 'A webcam, or a capture card connected to a console or camera. Capture cards appear in this list like any camera.' },
  image: { name: 'Image', desc: 'A logo, frame or background from a PNG, JPG, GIF or WebP file. Transparent PNGs keep their transparency.' },
  text: { name: 'Text', desc: 'A line or two of text: a title, a schedule or a handle. Resize the box to change the size.' },
  video: { name: 'Video file', desc: 'An MP4 or WebM file that plays on a loop. Its sound isn’t included in your LIVE.' },
  phone: { name: 'Phone screen', desc: 'To stream your phone, use Mobile gaming mode in the CULT app to go LIVE straight from the phone, or connect the phone to a capture card and add it here as a Camera.' },
  alert: { name: 'Alert', desc: 'Pops up when someone sends a gift or follows you while you’re LIVE.' },
  goal: { name: 'Goal bar', desc: 'A gift goal that fills up as viewers send gifts during this LIVE.' },
  chatbox: { name: 'Chatbox', desc: 'Shows your LIVE chat on screen, newest at the bottom.' },
  countdown: { name: 'Countdown', desc: 'Counts down to a moment you set, like the start of a match.' },
  tally: { name: 'Tally counter', desc: 'Counts likes, gifts or new followers during this LIVE.' },
  ranking: { name: 'Viewer ranking', desc: 'Lists your top gifters for this LIVE.' },
};
const GENERAL: Kind[] = ['game', 'display', 'window', 'camera', 'image', 'text', 'video', 'phone'];
const WIDGETS: Kind[] = ['alert', 'goal', 'chatbox', 'countdown', 'tally', 'ranking'];

export const FONTS: { label: string; css: string }[] = [
  { label: 'Barlow', css: 'Barlow, system-ui, sans-serif' },
  { label: 'Barlow Condensed', css: '"Barlow Condensed", Barlow, sans-serif' },
  { label: 'JetBrains Mono', css: '"JetBrains Mono", monospace' },
  { label: 'Georgia (serif)', css: 'Georgia, serif' },
  { label: 'Impact', css: 'Impact, sans-serif' },
];

type NewMedia = { el: HTMLVideoElement | HTMLImageElement; url?: string };
type Props = {
  canvases: Orientation[];
  initialCanvas: Orientation;
  goalTarget: number;
  onGoalTarget: (n: number) => void;
  onAdd: (s: Source) => void;
  onClose: () => void;
  edit?: Source; // Settings for an existing source: same form, that type only
  onSave?: (patch: Partial<Source>, media?: NewMedia) => void;
};

const elSize = (el: HTMLVideoElement | HTMLImageElement) => (el instanceof HTMLImageElement ? { w: el.naturalWidth, h: el.naturalHeight } : { w: el.videoWidth, h: el.videoHeight });

export function AddSource({ canvases, initialCanvas, goalTarget, onGoalTarget, onAdd, onClose, edit, onSave }: Props) {
  const [kind, setKind] = useState<Kind>(edit?.kind ?? 'camera');
  const [canvas, setCanvas] = useState<Orientation>(initialCanvas);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // per-kind options
  const [captures, setCaptures] = useState<CaptureSource[] | null>(null);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState(() => (edit ? (comp.mediaDeviceId(edit.sid) ?? '') : ''));
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState(edit?.text ?? 'Welcome to the stream');
  const [color, setColor] = useState(edit?.color ?? '#ffffff');
  const [font, setFont] = useState(edit?.font ?? FONTS[0]!.css);
  const [minutes, setMinutes] = useState(edit?.seconds ? Math.round(edit.seconds / 60) : 5);
  const [metric, setMetric] = useState<TallyMetric>(edit?.metric ?? 'likes');
  const [goal, setGoal] = useState(goalTarget);

  useEffect(() => {
    setError(null);
    setCaptures(null);
    setCaptureId(null);
    setFile(null);
    if (kind !== 'camera') return;
    void navigator.mediaDevices.enumerateDevices().then((d) => {
      const v = d.filter((x) => x.kind === 'videoinput');
      setCams(v);
      setCamId((cur) => cur || v[0]?.deviceId || '');
    });
  }, [kind]);

  // Only lists windows/screens after an explicit click: never captures anything on its own.
  const listCaptures = async () => {
    setError(null);
    try {
      setCaptures(await call<CaptureSource[]>(bridge().captureSources(kind === 'display' ? 'screen' : 'window')));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const make = (k: SourceKind, name: string, box: Box, extra: Partial<Source> = {}): Source => ({ id: uid('src'), sid: uid('sid'), kind: k, name, canvas, visible: true, locked: false, ...box, home: box, ...extra });

  /** Opens the media this kind needs. In Settings, null means "keep the current one" (nothing new picked). */
  const openMedia = async (): Promise<(NewMedia & { name: string }) | null> => {
    if (kind === 'game' || kind === 'display' || kind === 'window') {
      const pick = captures?.find((c) => c.id === captureId);
      if (!pick) {
        if (edit) return null;
        throw new Error(kind === 'display' ? 'Choose a screen first.' : 'Choose a window first.');
      }
      await call(bridge().chooseCapture(pick.id, false));
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      return { el: await comp.loadVideo({ stream }), name: pick.name.slice(0, 40) || INFO[kind].name };
    }
    if (kind === 'camera') {
      if (edit && camId === (comp.mediaDeviceId(edit.sid) ?? '')) return null;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false });
      const label = cams.find((c) => c.deviceId === camId)?.label || stream.getVideoTracks()[0]?.label || 'Camera';
      return { el: await comp.loadVideo({ stream }), name: label.slice(0, 40) };
    }
    if (kind === 'image' || kind === 'video') {
      if (!file) {
        if (edit) return null;
        throw new Error('Choose a file first.');
      }
      const url = URL.createObjectURL(file);
      try {
        return { el: kind === 'image' ? await comp.loadImage(url) : await comp.loadVideo({ url }), url, name: file.name.slice(0, 40) };
      } catch (e) {
        URL.revokeObjectURL(url);
        throw e;
      }
    }
    return null;
  };

  const textLines = () => {
    const body = text.trim();
    if (!body) throw new Error('Type some text first.');
    return body.split('\n').slice(0, 6);
  };

  const save = async () => {
    if (kind === 'phone') return setKind('camera');
    setBusy(true);
    setError(null);
    try {
      const m = await openMedia();
      if (kind === 'goal') onGoalTarget(Math.max(1, goal));
      const seconds = Math.max(1, Math.min(600, minutes)) * 60;
      if (edit) {
        const patch: Partial<Source> = {};
        if (kind === 'text') Object.assign(patch, { text: textLines().join('\n'), color, font });
        if (kind === 'countdown') Object.assign(patch, { seconds, startedAt: Date.now() });
        if (kind === 'tally') patch.metric = metric;
        onSave?.(patch, m ? { el: m.el, url: m.url } : undefined);
        return onClose();
      }
      let src: Source;
      if (m) {
        const { w, h } = elSize(m.el);
        src = make(kind, m.name, fitBox(w, h, canvas, kind === 'camera' ? 'fill' : 'fit'));
        comp.registerMedia(src.sid, m.el, m.url);
      } else if (kind === 'text') {
        const lines = textLines();
        const px = Math.round(SIZE[canvas].w * (canvas === 'portrait' ? 0.07 : 0.04));
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = `600 ${px}px ${font}`;
        const w = Math.min(SIZE[canvas].w, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + px * 0.2));
        const h = Math.round(lines.length * px * 1.2);
        src = make('text', lines[0]!.slice(0, 40), { x: Math.round((SIZE[canvas].w - w) / 2), y: Math.round(SIZE[canvas].h * 0.1), w, h }, { text: lines.join('\n'), color, font });
      } else {
        src = make(kind, INFO[kind].name, widgetBox(kind, canvas));
        if (kind === 'countdown') Object.assign(src, { seconds, startedAt: Date.now() });
        if (kind === 'tally') src.metric = metric;
      }
      onAdd(src);
      onClose();
    } catch (e) {
      setError(e instanceof DOMException && e.name === 'NotAllowedError' ? (bridge().platform === 'darwin' ? 'Access was blocked. Allow CULT Live Studio in System Settings › Privacy & Security › Camera.' : 'Access was blocked. Check Windows privacy settings for camera access.') : e instanceof DOMException && e.name === 'NotReadableError' ? 'That device is in use by another app.' : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const listItem = (k: Kind) => (
    <button key={k} className={`row${kind === k ? ' sel' : ''}`} onClick={() => setKind(k)}>
      <Icon name={k === 'phone' ? 'phone' : KIND_ICON[k]} size={14} />
      <span className="name">{INFO[k].name}</span>
    </button>
  );
  const isCapture = kind === 'game' || kind === 'display' || kind === 'window';

  return (
    <Dialog
      title={edit ? `Settings · ${edit.name}` : 'Add source'}
      wide={!edit}
      bare
      onClose={onClose}
      footer={
        <>
          {!edit && canvases.length > 1 && (
            <div className="seg" role="group" aria-label="Add to canvas" style={{ width: 220 }}>
              {canvases.map((o) => (
                <button key={o} aria-pressed={canvas === o} onClick={() => setCanvas(o)}>
                  {o === 'portrait' ? 'Portrait' : 'Landscape'}
                </button>
              ))}
            </div>
          )}
          <span className="sp" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {kind === 'phone' ? 'Add a capture card' : edit ? (busy ? 'Saving…' : 'Save') : busy ? 'Adding…' : 'Add'}
          </button>
        </>
      }
    >
      <div className={edit ? undefined : 'picker'}>
        {!edit && (
          <nav className="picker-list" aria-label="Source types">
            <div className="grp">General</div>
            {GENERAL.map(listItem)}
            <div className="grp">Widgets</div>
            {WIDGETS.map(listItem)}
          </nav>
        )}
        <div className="picker-desc">
          <h3>{INFO[kind].name}</h3>
          <p>{INFO[kind].desc}</p>
          {isCapture &&
            (captures ? (
              captures.length ? (
                <div className="thumbs">
                  {captures.map((c) => (
                    <button key={c.id} className={`thumb${captureId === c.id ? ' sel' : ''}`} onClick={() => setCaptureId(c.id)}>
                      {c.thumbnail ? <img src={c.thumbnail} alt="" /> : <div className="ph" />}
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty">Nothing to capture. Open the {kind === 'display' ? 'screen' : 'app or game'} first, then refresh.</div>
              )
            ) : null)}
          {isCapture && (
            <div>
              <button className="btn" onClick={() => void listCaptures()}>
                <Icon name="refresh" size={14} /> {captures ? 'Refresh' : kind === 'display' ? 'Show screens' : 'Show windows'}
              </button>
            </div>
          )}
          {kind === 'camera' && (
            <label className="field">
              <span>Device</span>
              <select className="input" value={camId} onChange={(e) => setCamId(e.target.value)}>
                {cams.length ? cams.map((c, i) => <option key={c.deviceId || i} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>) : <option value="">No camera found</option>}
              </select>
            </label>
          )}
          {(kind === 'image' || kind === 'video') && (
            <label className="field">
              <span>File</span>
              <input className="input" style={{ paddingTop: 6 }} type="file" accept={kind === 'image' ? 'image/png,image/jpeg,image/gif,image/webp' : 'video/mp4,video/webm'} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          {kind === 'text' && (
            <>
              <label className="field">
                <span>Text</span>
                <textarea className="input" rows={3} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <div className="two">
                <label className="field">
                  <span>Font</span>
                  <select className="input" value={font} onChange={(e) => setFont(e.target.value)}>
                    {FONTS.map((f) => <option key={f.css} value={f.css}>{f.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Colour</span>
                  <input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ padding: 2 }} />
                </label>
              </div>
            </>
          )}
          {kind === 'goal' && (
            <label className="field" style={{ width: 180 }}>
              <span>Gift goal (number of gifts)</span>
              <input className="input num" type="number" min={1} max={100000} value={goal} onChange={(e) => setGoal(Number(e.target.value) || 1)} />
            </label>
          )}
          {kind === 'countdown' && (
            <label className="field" style={{ width: 180 }}>
              <span>Minutes</span>
              <input className="input num" type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 1)} />
            </label>
          )}
          {kind === 'tally' && (
            <label className="field" style={{ width: 220 }}>
              <span>Count</span>
              <select className="input" value={metric} onChange={(e) => setMetric(e.target.value as TallyMetric)}>
                <option value="likes">Likes</option>
                <option value="gifts">Gifts</option>
                <option value="followers">New followers</option>
              </select>
            </label>
          )}
          {error && <div className="notice error" role="alert">{error}</div>}
        </div>
      </div>
    </Dialog>
  );
}
