import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CHAT_REJECT } from '../lib/errors';
import type { ChatItem } from '../lib/useLive';
import { Icon } from './Icon';

export type LiveChatProps = {
  isLive: boolean;
  chat: ChatItem[];
  chatError: string | null;
  rtState: string;
  onSend: (body: string) => void;
};

/** LIVE chat: list that sticks to the newest message, plus the host composer. Docked in the right panel and floating. */
export function LiveChat({ isLive, chat, chatError, rtState, onSend, actions }: LiveChatProps & { actions?: ReactNode }) {
  const [body, setBody] = useState('');
  const list = useRef<HTMLDivElement>(null);

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
    <section className="chat" aria-label="LIVE chat">
      <div className="sec-h chat-h">
        <h2>LIVE chat</h2>
        {isLive && (
          <span className={`rt-state${rtState === 'open' ? ' open' : ''}`}>
            <i /> {rtState === 'open' ? 'Connected' : rtState === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
          </span>
        )}
        {actions}
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
  );
}
