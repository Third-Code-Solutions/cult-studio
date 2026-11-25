import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';

export type MenuEntry = { label: string; shortcut?: string; disabled?: boolean; onSelect?: () => void; sub?: MenuItem[] };
export type MenuItem = MenuEntry | 'sep';
export type TopItem = { label: string; icon: IconName; disabled?: boolean; onSelect: () => void };

const EDGE = 8; // keep menus this far inside the window

type PanelProps = {
  label: string;
  top?: TopItem[];
  items: MenuItem[];
  at: { x: number; y: number; flipX?: number }; // flipX: right edge to open against when there's no room on the right
  focusFirst: boolean;
  onDone: () => void; // an item ran, or Escape/Tab at the root
  onBack?: () => void; // submenus: ArrowLeft / Escape
};

/** One menu panel. Submenus render nested (position: fixed) so hover and focus stay inside the same tree. */
function Panel({ label, top, items, at, focusFirst, onDone, onBack }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState<{ i: number; focus: boolean } | null>(null);

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    let left = at.x;
    if (left + r.width > innerWidth - EDGE) left = at.flipX !== undefined ? at.flipX - r.width : innerWidth - EDGE - r.width;
    setPos({ left: Math.max(EDGE, left), top: Math.max(EDGE, Math.min(at.y, innerHeight - EDGE - r.height)) });
  }, [at.x, at.y, at.flipX]);

  const focusables = () => [...ref.current!.querySelectorAll<HTMLButtonElement>(':scope > [role=menuitem], :scope > .ctx-top > [role=menuitem]')].filter((b) => !b.disabled);
  useEffect(() => {
    if (!pos) return;
    if (focusFirst) focusables()[0]?.focus();
    else if (!onBack && !ref.current!.contains(document.activeElement)) ref.current!.focus(); // root takes keys; a hovered submenu leaves focus on its parent item
  }, [pos !== null]); // once, after placement

  const onKey = (e: React.KeyboardEvent) => {
    const list = focusables();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const itemIndex = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
    const sub = itemIndex >= 0 ? items[itemIndex] : undefined;
    const handled = () => (e.preventDefault(), e.stopPropagation());
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      handled();
      setOpen(null); // a hover-opened submenu closes when the keyboard moves on
      const n = list.length;
      list[i < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      handled();
      setOpen(null);
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'ArrowRight' && sub && sub !== 'sep' && sub.sub && !sub.disabled) {
      handled();
      setOpen({ i: itemIndex, focus: true });
    } else if ((e.key === 'ArrowLeft' || e.key === 'Escape') && onBack) {
      handled();
      onBack();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      handled();
      onDone();
    }
  };

  const back = (i: number) => () => {
    setOpen(null);
    itemRefs.current[i]?.focus();
  };

  return (
    <div className="ctx" role="menu" aria-label={label} tabIndex={-1} ref={ref} onKeyDown={onKey} style={pos ? { left: pos.left, top: pos.top } : { left: at.x, top: at.y, visibility: 'hidden' }} onContextMenu={(e) => e.preventDefault()}>
      {top && (
        <div className="ctx-top">
          {top.map((t) => (
            <button key={t.label} role="menuitem" className="ctx-icon" disabled={t.disabled} onMouseEnter={(e) => (e.currentTarget.focus(), setOpen(null))} onClick={() => (t.onSelect(), onDone())}>
              <Icon name={t.icon} size={18} />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
      {items.map((it, i) =>
        it === 'sep' ? (
          <hr key={`sep${i}`} />
        ) : (
          <button
            key={i}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            role="menuitem"
            className="ctx-item"
            disabled={it.disabled}
            aria-haspopup={it.sub ? 'menu' : undefined}
            aria-expanded={it.sub ? open?.i === i : undefined}
            onMouseEnter={(e) => {
              e.currentTarget.focus();
              setOpen(it.sub ? { i, focus: false } : null);
            }}
            onClick={() => (it.sub ? setOpen({ i, focus: true }) : (it.onSelect?.(), onDone()))}
          >
            <span>{it.label}</span>
            {it.shortcut && <span className="kbd">{it.shortcut}</span>}
            {it.sub && <Icon name="chevron" size={14} />}
          </button>
        ),
      )}
      {open && (() => {
        const it = items[open.i];
        const el = itemRefs.current[open.i];
        if (!it || it === 'sep' || !it.sub || !el) return null;
        const r = el.getBoundingClientRect();
        const pr = ref.current!.getBoundingClientRect();
        return <Panel key={open.i} label={it.label} items={it.sub} at={{ x: pr.right - 2, y: r.top - 7, flipX: pr.left + 2 }} focusFirst={open.focus} onDone={onDone} onBack={back(open.i)} />;
      })()}
    </div>
  );
}

type Props = { x: number; y: number; label: string; top?: TopItem[]; items: MenuItem[]; onClose: () => void };

/** Right-click menu: arrow keys, Home/End, Right/Left for submenus, Esc closes; stays inside the window. */
export function ContextMenu({ x, y, label, top, items, onClose }: Props) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const outside = (e: PointerEvent) => !(e.target as Element).closest?.('.ctx') && close.current();
    const dismiss = () => close.current();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      const now = document.activeElement;
      if (!now || now === document.body) prev?.focus(); // unless the chosen action moved focus (rename box, dialog)
    };
  }, []);
  return <Panel label={label} top={top} items={items} at={{ x, y }} focusFirst={false} onDone={onClose} />;
}
