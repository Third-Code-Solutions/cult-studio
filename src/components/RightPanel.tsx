import type { LiveStats } from '../lib/bridge';
import { money, type ChatItem } from '../lib/useLive';
import { Icon } from './Icon';
import { LiveChat } from './LiveChat';
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
  floating: boolean;
  onToggleFloat: () => void;
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

export function RightPanel({ isLive, viewers, stats, chat, chatError, rtState, apiBase, onSend, floating, onToggleFloat }: Props) {
  const n = (v: number | undefined) => (isLive ? (v ?? 0).toLocaleString('en') : null);
  const cur = stats?.gifts.currency ?? 'PHP';

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
      <LiveChat
        isLive={isLive}
        chat={chat}
        chatError={chatError}
        rtState={rtState}
        onSend={onSend}
        actions={
          <button className={`icon-btn float-toggle${floating ? ' on' : ''}`} onClick={onToggleFloat} aria-pressed={floating} aria-label="Floating chat" title="Floating chat, always on top (Ctrl+Shift+C)">
            <Icon name="external" size={14} />
          </button>
        }
      />
    </aside>
  );
}
