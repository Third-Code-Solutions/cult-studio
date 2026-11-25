import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  bare?: boolean; // body without padding (pickers)
  side?: boolean; // docked right, no dimming: for live tweaks where the canvas must stay visible
};

/** Modal dialog: Escape closes, focus moves in on open and returns on close. */
export function Dialog({ title, onClose, children, footer, wide, bare, side }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not(.dialog-x)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className={`scrim${side ? ' side' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dialog-h">
          <h2>{title}</h2>
          <button className="icon-btn dialog-x" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {bare ? children : <div className="dialog-b">{children}</div>}
        {footer && <div className="dialog-f">{footer}</div>}
      </div>
    </div>
  );
}
