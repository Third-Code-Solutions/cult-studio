import { useEffect, useRef, useState, type ReactNode } from 'react';
import glyph from '../assets/cult-glyph-yellow.png';
import { api, bridge, type Me } from '../lib/bridge';
import { Icon } from './Icon';

export function WindowControls() {
  const [max, setMax] = useState(false);
  useEffect(() => bridge().win.onMaximized((m) => setMax(!!m)), []);
  if (bridge().platform === 'darwin') return null; // macOS shows its own traffic lights (titleBarStyle: hidden)
  return (
    <div className="wc">
      <button onClick={() => void bridge().win.minimize()} aria-label="Minimize">
        <Icon name="min" />
      </button>
      <button onClick={() => void bridge().win.toggleMaximize()} aria-label={max ? 'Restore' : 'Maximize'}>
        <Icon name={max ? 'restore' : 'max'} size={14} />
      </button>
      <button className="x" onClick={() => void bridge().win.close()} aria-label="Close">
        <Icon name="close" />
      </button>
    </div>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <img src={glyph} alt="" />
      <h1>CULT Live Studio</h1>
    </div>
  );
}

/** Dropdown anchored to its trigger; closes on outside click or Escape. */
function Menu({ trigger, children, label }: { trigger: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', off);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`icon-btn${open ? ' on' : ''}`} aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        {trigger(open)}
      </button>
      {open && <div className="pop">{children(() => setOpen(false))}</div>}
    </div>
  );
}

type Notification = { id: string; title?: string; body?: string; createdAt?: string; readAt?: string | null };

export function Avatar({ me, apiBase, size = 26 }: { me: { displayName: string; avatarUrl: string | null }; apiBase: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const src = me.avatarUrl ? new URL(me.avatarUrl, apiBase).toString() : null;
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : me.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}

type Props = {
  me: Me;
  apiBase: string;
  title: string;
  category: string;
  isLive: boolean;
  onOpenSetup: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onSignOut: () => void;
};

export function TitleBar({ me, apiBase, title, category, isLive, onOpenSetup, onSettings, onHelp, onSignOut }: Props) {
  const [notes, setNotes] = useState<{ items: Notification[]; unread: number } | null>(null);
  const loadNotes = () => void api<{ items: Notification[]; unread: number }>('GET', '/v1/me/notifications').then(setNotes, () => setNotes({ items: [], unread: 0 }));
  useEffect(loadNotes, []);
  return (
    <header className="titlebar">
      <Brand />
      <button className="pill" onClick={onOpenSetup} title="LIVE setup">
        {isLive && <i className="live-dot" aria-label="LIVE" />}
        <span className="t">{title.trim() || 'Add a LIVE title'}</span>
        <span className="c">· {category}</span>
        <Icon name="chevron" size={14} />
      </button>
      <div className="tb-right">
        <button className="btn sm ghost" onClick={() => void bridge().openStudio('')}>
          Creator Studio <Icon name="external" size={14} />
        </button>
        <Menu label="Notifications" trigger={() => (
          <>
            <Icon name="bell" />
            {!!notes?.unread && <i className="badge-dot" />}
          </>
        )}>
          {() => (
            <div style={{ width: 300 }}>
              <div className="head" style={{ fontWeight: 600 }}>Notifications</div>
              {!notes?.items.length ? (
                <div className="head faint">No notifications yet.</div>
              ) : (
                notes.items.slice(0, 8).map((n) => (
                  <div key={n.id} className="head">
                    <div>{n.title ?? n.body}</div>
                    {n.title && n.body && <div className="faint">{n.body}</div>}
                  </div>
                ))
              )}
            </div>
          )}
        </Menu>
        <button className="icon-btn" aria-label="Help" onClick={onHelp}>
          <Icon name="help" />
        </button>
        <button className="icon-btn" aria-label="Settings" onClick={onSettings}>
          <Icon name="gear" />
        </button>
        <Menu label="Account" trigger={() => <Avatar me={me} apiBase={apiBase} />}>
          {(close) => (
            <>
              <div className="head" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Avatar me={me} apiBase={apiBase} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{me.displayName}</div>
                  <div className="faint">@{me.handle}</div>
                </div>
              </div>
              <hr />
              <button className="item" onClick={() => (close(), void bridge().openStudio(''))}>
                <Icon name="external" /> Open Creator Studio
              </button>
              <button className="item" onClick={() => (close(), onSignOut())}>
                <Icon name="logout" /> Sign out
              </button>
            </>
          )}
        </Menu>
        <WindowControls />
      </div>
    </header>
  );
}
