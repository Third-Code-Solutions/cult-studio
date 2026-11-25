import { useEffect, useState, type KeyboardEvent } from 'react';
import { api, bridge, call, type Category, type LiveStats, type Settings } from '../lib/bridge';
import { errorCode, errorText } from '../lib/errors';
import type { Orientation } from '../lib/scene';
import { money, type Setup, type Summary } from '../lib/useLive';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

// ── LIVE setup ──
type SetupProps = { setup: Setup; categories: Category[]; isLive: boolean; streamId: string | null; onSave: (s: Setup) => void; onClose: () => void };

export function LiveSetup({ setup, categories, isLive, streamId, onSave, onClose }: SetupProps) {
  const [s, setS] = useState(setup);
  const [tag, setTag] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cat = categories.find((c) => c.slug === s.category);
  const titleOk = s.title.trim().length >= 3;

  const addTag = () => {
    const t = tag.trim().replace(/^#/, '').slice(0, 24);
    if (t && !s.tags.includes(t) && s.tags.length < 5) setS({ ...s, tags: [...s.tags, t] });
    setTag('');
  };
  const onTagKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  };

  const save = async () => {
    if (!titleOk) return setError('Add a title of at least 3 characters.');
    if (!s.rights) return setError('Confirm you have the rights to stream this content.');
    if (s.category === 'sports-betting' && !s.betting) return setError('Classify this Sports Betting stream.');
    if (isLive && streamId) {
      setBusy(true);
      try {
        await api('PATCH', `/v1/broadcasts/${streamId}`, { title: s.title.trim(), category: s.category, tags: s.tags, ...(s.category === 'sports-betting' ? { bettingClassification: s.betting } : {}) });
      } catch (e) {
        setBusy(false);
        return setError(errorText(e));
      }
    }
    onSave(s);
    onClose();
  };

  return (
    <Dialog
      title="LIVE setup"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>{isLive ? 'Update LIVE' : 'Save'}</button>
        </>
      }
    >
      <label className="field">
        <span>Title</span>
        <input className="input" maxLength={100} value={s.title} placeholder="What’s happening on your LIVE?" onChange={(e) => setS({ ...s, title: e.target.value })} autoFocus />
      </label>
      <div className="two">
        <label className="field">
          <span>Category</span>
          <select className="input" value={s.category} onChange={(e) => setS({ ...s, category: e.target.value })}>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug} disabled={!c.availableToViewer}>
                {c.name}{c.restricted ? ` · ${c.minAge}+` : ''}{c.availableToViewer ? '' : ' (not available to you)'}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Orientation</span>
          <div className="seg" role="group" aria-label="Orientation">
            {(['portrait', 'landscape'] as Orientation[]).map((o) => (
              <button key={o} aria-pressed={s.orientation === o} disabled={isLive} onClick={() => setS({ ...s, orientation: o })}>
                {o === 'portrait' ? 'Portrait' : 'Landscape'}
              </button>
            ))}
          </div>
        </div>
      </div>
      {cat?.restricted && <div className="notice">{cat.name} is a {cat.minAge}+ category. Only viewers {cat.minAge} and older in allowed countries can watch.</div>}
      {s.category === 'sports-betting' && (
        <label className="field">
          <span>This stream is</span>
          <select className="input" value={s.betting ?? ''} onChange={(e) => setS({ ...s, betting: (e.target.value || null) as Setup['betting'] })}>
            <option value="">Choose…</option>
            <option value="commentary">Commentary (talking about matches and odds)</option>
            <option value="promotion">Promotion (needs CULT review)</option>
          </select>
        </label>
      )}
      <div className="field">
        <span>Tags ({s.tags.length}/5)</span>
        {!!s.tags.length && (
          <div className="chips">
            {s.tags.map((t) => (
              <span key={t} className="chip">
                #{t}
                <button aria-label={`Remove tag ${t}`} onClick={() => setS({ ...s, tags: s.tags.filter((x) => x !== t) })}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <input className="input" value={tag} maxLength={24} disabled={s.tags.length >= 5} placeholder={s.tags.length >= 5 ? 'Five tags maximum' : 'Type a tag, press Enter'} onChange={(e) => setTag(e.target.value)} onKeyDown={onTagKey} onBlur={addTag} />
      </div>
      <button className="check" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} role="switch" aria-checked={s.replay} disabled={isLive} onClick={() => setS({ ...s, replay: !s.replay })}>
        <span className="switch" aria-checked={s.replay} />
        <span>
          Save a replay
          <span className="faint" style={{ display: 'block', fontSize: 12 }}>{isLive ? 'Fixed once the LIVE starts.' : 'Viewers can watch it after you end.'}</span>
        </span>
      </button>
      <label className="check">
        <input type="checkbox" checked={s.rights} onChange={(e) => setS({ ...s, rights: e.target.checked })} />
        <span>I own or have permission to stream everything in this LIVE, including games, music and video.</span>
      </label>
      {error && <div className="notice error" role="alert">{error}</div>}
    </Dialog>
  );
}

// ── Stream with OBS ──
type Keys = { items: { id: string; prefix: string; label: string | null; createdAt: string; revokedAt: string | null }[]; rtmpBase: string; srtBase: string };
type NewKey = { id: string; key: string; rtmpUrl: string; srtUrl: string };

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(!secret);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="keyrow">
        <input className="input" readOnly value={show ? value : '•'.repeat(Math.min(32, value.length))} aria-label={label} onFocus={(e) => e.target.select()} />
        {secret && (
          <button className="btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide key' : 'Show key'}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={14} />
          </button>
        )}
        <button className="btn" onClick={() => void bridge().copy(value).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}>
          <Icon name={done ? 'check' : 'copy'} size={14} /> {done ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function ObsPanel({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<Keys | null>(null);
  const [fresh, setFresh] = useState<NewKey | null>(null);
  const [error, setError] = useState<{ code: string | null; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Keys>('GET', '/v1/creator/ingest-keys').then(setKeys, (e) => setError({ code: errorCode(e), text: errorText(e) }));
  }, []);
  const active = keys?.items.find((k) => !k.revokedAt);
  const create = async () => {
    if (active && !confirm('Creating a new stream key stops the current key from working. Continue?')) return;
    setBusy(true);
    try {
      setFresh(await api<NewKey>('POST', '/v1/creator/ingest-keys', {}));
      setKeys(await api<Keys>('GET', '/v1/creator/ingest-keys'));
    } catch (e) {
      setError({ code: errorCode(e), text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  const notApproved = error?.code === 'STUDIO_NOT_APPROVED';
  return (
    <Dialog title="Stream with OBS" onClose={onClose} footer={<button className="btn" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ margin: 0 }}>Use OBS or other streaming software instead of this studio. Paste the server and stream key into OBS under Settings → Stream → Custom.</p>
      {notApproved ? (
        <div className="notice" style={{ display: 'grid', gap: 8 }}>
          <strong style={{ color: 'var(--text)' }}>Streaming software isn’t enabled for your channel yet.</strong>
          <span>CULT turns on RTMP/SRT ingest per channel. Ask for it in Creator Studio. Until then, go LIVE right here with the yellow button.</span>
          <span><button className="link" onClick={() => void bridge().openStudio('/ingest')}>Open Creator Studio → Ingest</button></span>
        </div>
      ) : error ? (
        <div className="notice error" role="alert">Couldn’t load your stream keys. {error.text}</div>
      ) : !keys ? (
        <div className="faint">Loading stream keys…</div>
      ) : (
        <>
          <CopyRow label="RTMP server" value={keys.rtmpBase} />
          <CopyRow label="SRT server" value={keys.srtBase} />
          {fresh ? (
            <>
              <CopyRow label="Stream key (shown once: copy it now)" value={fresh.key} secret />
              <CopyRow label="Full RTMP URL" value={fresh.rtmpUrl} secret />
              <CopyRow label="Full SRT URL" value={fresh.srtUrl} secret />
            </>
          ) : (
            <div className="field">
              <span>Stream key</span>
              <div className="notice">{active ? <>Current key starts with <span className="mono">{active.prefix}…</span>. Keys are shown only once; create a new one if you lost it.</> : 'You don’t have a stream key yet.'}</div>
            </div>
          )}
          <div>
            <button className="btn" disabled={busy} onClick={() => void create()}>
              <Icon name="refresh" size={14} /> {active ? 'Create new key' : 'Create stream key'}
            </button>
          </div>
        </>
      )}
      <div className="field">
        <span>OBS output settings</span>
        <ul className="steps">
          <li>Portrait LIVE: canvas and output 1080×1920. Landscape LIVE: 1920×1080.</li>
          <li>30 fps, H.264, about 6,000 kbps, keyframe every 2 s, AAC audio at 160 kbps.</li>
          <li>Start the broadcast in Creator Studio → Live and choose streaming software, then press Start Streaming in OBS.</li>
        </ul>
      </div>
    </Dialog>
  );
}

// ── LIVE Goal / Viewer ranking tools ──
export function GoalDialog({ target, current, hasWidget, onSave, onAddWidget, onClose }: { target: number; current: number; hasWidget: boolean; onSave: (n: number) => void; onAddWidget: () => void; onClose: () => void }) {
  const [n, setN] = useState(target);
  return (
    <Dialog
      title="LIVE Goal"
      onClose={onClose}
      footer={
        <>
          {!hasWidget && <button className="btn" onClick={() => (onSave(Math.max(1, n)), onAddWidget(), onClose())}>Save and add goal bar</button>}
          <button className="btn primary" onClick={() => (onSave(Math.max(1, n)), onClose())}>Save</button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>Set a gift goal for this LIVE. The goal bar on your canvas fills as viewers send gifts.</p>
      <label className="field" style={{ width: 200 }}>
        <span>Goal (number of gifts)</span>
        <input className="input num" type="number" min={1} max={100000} value={n} onChange={(e) => setN(Number(e.target.value) || 1)} autoFocus />
      </label>
      <div className="notice">Progress this LIVE: <b className="num" style={{ color: 'var(--text)', marginLeft: 4 }}>{current} of {target}</b></div>
    </Dialog>
  );
}

export function RankingDialog({ stats, isLive, hasWidget, onAddWidget, onClose }: { stats: LiveStats | null; isLive: boolean; hasWidget: boolean; onAddWidget: () => void; onClose: () => void }) {
  const list = stats?.topGifters ?? [];
  const cur = stats?.gifts.currency ?? 'PHP';
  return (
    <Dialog title="Viewer ranking" onClose={onClose} footer={<>{!hasWidget && <button className="btn" onClick={() => (onAddWidget(), onClose())}>Add ranking to canvas</button>}<button className="btn primary" onClick={onClose}>Done</button></>}>
      <p className="muted" style={{ margin: 0 }}>Your top gifters for this LIVE, by total gift value.</p>
      {list.length ? (
        <div className="gifters">
          {list.map((g, i) => (
            <div key={g.handle} className="gifter" style={{ gridTemplateColumns: '18px 1fr auto auto' }}>
              <span className="rk">{i + 1}</span>
              <span className="nm">{g.displayName} <span className="faint">@{g.handle}</span></span>
              <span className="faint num">{g.gifts} gifts</span>
              <span className="v">{money(g.valueMinor, cur)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">{isLive ? 'No gifts yet this LIVE.' : 'The ranking fills in while you’re LIVE.'}</div>
      )}
    </Dialog>
  );
}

// ── Settings / help ──
export function SettingsDialog({ settings, isLive, onClose }: { settings: Settings; isLive: boolean; onClose: () => void }) {
  const [s, setS] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await call(bridge().saveSettings(s)); // the window reloads with the new server
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <Dialog title="Settings" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={isLive} onClick={() => void save()}>Save and reload</button></>}>
      <label className="field">
        <span>CULT server</span>
        <input className="input" value={s.apiBase} onChange={(e) => setS({ ...s, apiBase: e.target.value })} spellCheck={false} />
      </label>
      <label className="field">
        <span>Creator Studio address</span>
        <input className="input" value={s.studioUrl} onChange={(e) => setS({ ...s, studioUrl: e.target.value })} spellCheck={false} />
      </label>
      {isLive && <div className="notice">End LIVE before changing the server.</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
    </Dialog>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Help" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      <ol className="steps">
        <li>Open LIVE setup from the title at the top: add a title, pick a category and confirm you have the rights to stream.</li>
        <li>Add sources: a camera, a game or window, images and text. Drag to move, pull the corners to resize.</li>
        <li>Check your mic level in the bottom bar, then press Go LIVE.</li>
        <li>Read chat and gifts on the right. Press End LIVE when you’re done.</li>
      </ol>
      <p className="muted" style={{ margin: 0 }}>Game capture on Windows captures the game’s window. Fullscreen games may need borderless windowed mode.</p>
      <p className="muted" style={{ margin: 0 }}>Need help? Email support@cult.ph.</p>
    </Dialog>
  );
}

// ── End confirmation + summary ──
export function EndConfirm({ onEnd, onClose }: { onEnd: () => void; onClose: () => void }) {
  return (
    <Dialog title="End LIVE?" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Keep streaming</button><button className="btn primary" style={{ background: 'var(--live)', borderColor: 'var(--live)', color: '#fff' }} onClick={() => (onEnd(), onClose())}>End LIVE</button></>}>
      <p className="muted" style={{ margin: 0 }}>Viewers will see that your LIVE has ended. You can’t restart this broadcast; going LIVE again starts a new one.</p>
    </Dialog>
  );
}

export function SummaryDialog({ s, onClose }: { s: Summary; onClose: () => void }) {
  const mins = Math.floor(s.durationSec / 60);
  return (
    <Dialog title="LIVE ended" onClose={onClose} footer={<><button className="btn" onClick={() => void bridge().openStudio('/live')}>Open in Creator Studio <Icon name="external" size={14} /></button><button className="btn primary" onClick={onClose}>Done</button></>}>
      <p style={{ margin: 0, fontWeight: 500 }}>{s.title}</p>
      {s.reason && <div className="notice">{s.reason}</div>}
      <div className="summary">
        <div className="kpi"><span>Duration</span><b>{mins ? `${mins} min` : `${s.durationSec} s`}</b></div>
        <div className="kpi"><span>Peak viewers</span><b>{s.peak.toLocaleString('en')}</b></div>
        <div className="kpi"><span>New followers</span><b>{s.followers.toLocaleString('en')}</b></div>
        <div className="kpi"><span>Gifts</span><b>{s.gifts.toLocaleString('en')}</b></div>
        <div className="kpi"><span>Est. earnings</span><b>{money(s.earningsMinor, s.currency)}</b></div>
        <div className="kpi" />
      </div>
    </Dialog>
  );
}
