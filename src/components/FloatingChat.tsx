import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { LiveChat, type LiveChatProps } from './LiveChat';

/** Frame name main allows for the always-on-top chat window (electron/main.ts chatWindowOptions). */
export const FLOAT_CHAT_FRAME = 'cult-chat';

/**
 * LIVE chat in its own small window that stays on top of games and other apps (like TikTok LIVE Studio's floating
 * comments). It renders the studio's own chat state into a child window, so it needs no second realtime connection.
 */
export function FloatingChat({ onClose, ...chat }: LiveChatProps & { onClose: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const w = window.open('about:blank', FLOAT_CHAT_FRAME);
    if (!w) return closeRef.current();
    const doc = w.document;
    doc.title = 'CULT LIVE chat';
    for (const n of document.querySelectorAll('style, link[rel="stylesheet"]')) doc.head.append(n.cloneNode(true));
    doc.body.className = 'float-chat';
    const root = doc.createElement('div');
    root.className = 'float-root';
    doc.body.append(root);
    const closed = () => closeRef.current(); // closed from the window itself (close button, Alt+F4)
    w.addEventListener('pagehide', closed);
    w.addEventListener('keydown', (e) => e.key === 'Escape' && w.close());
    setHost(root);
    return () => {
      w.removeEventListener('pagehide', closed);
      w.close();
    };
  }, []);

  if (!host) return null;
  const close = <button className="icon-btn float-close" onClick={() => host.ownerDocument.defaultView?.close()} aria-label="Close floating chat"><Icon name="close" size={14} /></button>;
  return createPortal(<LiveChat {...chat} actions={close} />, host);
}
