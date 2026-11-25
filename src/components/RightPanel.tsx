import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LiveStats } from '../lib/bridge';
import { CHAT_REJECT } from '../lib/errors';
import { money, type ChatItem } from '../lib/useLive';
import { Icon } from './Icon';
import { Avatar } from './TitleBar';

type Props = {
  isLive: boolean;
  viewers: number;
  stats: LiveStats | null;
  chat: ChatItem[];
  chatError: string | null;
  rtState: string;
  apiBase: string;
  onSend: (body: string) => void;
};

function Kpi({ label, value, sub }: { label: string; value: string | null; sub?: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b className={value == null ? 'na' : undefined}>{value ?? '—'}</b>
      {sub && <span>{sub}</span>}
    </div>
  );
}

export function RightPanel({ isLive, viewers, stats, chat, chatError, rtState, apiBase, onSend }: Props) {
  const [body, setBody] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const n = (v: number | undefined) => (isLive ? (v ?? 0).toLocaleString('en') : null);
  const cur = stats?.gifts.currency ?? 'PHP';

  useEffect(() => {
    const el = list.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight; // stick to bottom unless scrolled up
  }, [chat]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = body.trim();
    if (!t) return;
    onSend(t.slice(0, 300));
    setBody('');
  };

  return (
    <aside className="panel right">
      <section className="sec">
        <div className="sec-h">
          <h2>LIVE performance</h2>
          {!isLive && <span className="faint">Offline</span>}
        </div>
        <div className="kpis">
          <Kpi label="Viewers" value={n(viewers)} sub={isLive ? `Peak ${(stats?.viewers.peak ?? viewers).toLocaleString('en')}` : undefined} />
          <Kpi label="Likes" value={n(stats?.reactions)} />
          <Kpi label="Gifts" value={n(stats?.gifts.count)} />
          <Kpi label="Est. earnings" value={isLive ? money(stats?.estimatedEarningsMinor ?? 0, cur) : null} />
          <Kpi label="New followers" value={n(stats?.newFollowers)} />
        </div>
      </section>
      <section className="sec">
        <div className="sec-h">
          <h2>Top gifters</h2>
          {isLive && !!stats?.topGifters.length && <span className="faint num">{stats.topGifters.length}</span>}
        </div>
        {stats?.topGifters.length ? (
          <div className="gifters">
            {stats.topGifters.slice(0, 5).map((g, i) => (
              <div key={g.handle} className="gifter">
                <span className="rk">{i + 1}</span>
                <Avatar me={g} apiBase={apiBase} />
                <span className="nm">{g.displayName}</span>
                <span className="v">{money(g.valueMinor, cur)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">{isLive ? 'No gifts yet this LIVE.' : 'Your top gifters show here while you’re LIVE.'}</div>
        )}
      </section>
      <section className="chat" aria-label="LIVE chat">
        <div className="sec-h" style={{ padding: '12px 14px 0', marginBottom: 0 }}>
          <h2>LIVE chat</h2>
          {isLive && (
            <span className={`rt-state${rtState === 'open' ? ' open' : ''}`}>
              <i /> {rtState === 'open' ? 'Connected' : rtState === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
            </span>
          )}
        </div>
        <div className="chat-list scroll" ref={list} aria-live="polite">
          {!isLive ? (
            <div className="empty" style={{ marginTop: 4 }}>Chat opens when you go LIVE.</div>
          ) : !chat.length ? (
            <div className="faint" style={{ marginTop: 4 }}>No messages yet. Say hi to your viewers.</div>
          ) : (
            chat.map((m) =>
              m.kind === 'gift' ? (
                <div key={m.key} className="msg gift">
                  <Icon name="gift" size={14} />
                  <span><b style={{ color: 'inherit' }}>{m.name}</b>sent {m.gift}</span>
                </div>
              ) : (
                <div key={m.key} className={`msg${m.mine ? ' mine' : ''}${m.pending ? ' pending' : ''}`}>
                  <b>{m.name}</b>
                  {m.body}
                </div>
              ),
            )
          )}
        </div>
        {isLive && chatError && <div className="notice error" style={{ margin: '0 14px 8px' }}>{CHAT_REJECT[chatError] ?? 'Message not sent.'}</div>}
        <form className="composer" onSubmit={send}>
          <input className="input" placeholder={isLive ? 'Chat as the host' : 'Go LIVE to chat'} maxLength={300} value={body} disabled={!isLive} onChange={(e) => setBody(e.target.value)} aria-label="Chat message" />
          <button className="icon-btn" style={{ width: 34, height: 34 }} disabled={!isLive || !body.trim()} aria-label="Send">
            <Icon name="send" />
          </button>
        </form>
      </section>
    </aside>
  );
}
