import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';

// items: [{ label, icon, shortcut, onClick, submenu: items, disabled, danger, swatch } | { separator: true }]
// An item may have both onClick (click) and submenu (hover / tap on the arrow).
function MenuList({ items, x, y, parent, onClose, depth }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [open, setOpen] = useState(null);
  const rowRefs = useRef([]);

  // Flip left/up when the menu would leave the screen.
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (parent) {
      left = parent.right - 4;
      top = parent.top - 5;
      if (left + r.width > vw - 4) left = Math.max(4, parent.left - r.width + 4);
    } else if (left + r.width > vw - 4) left = Math.max(4, x - r.width);
    if (top + r.height > vh - 4) top = Math.max(4, (parent ? parent.bottom + 5 : y) - r.height);
    setPos({ left, top });
  }, [x, y, parent]);

  return (
    <div
      ref={ref}
      className="ctx-menu scrolls"
      role="menu"
      style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y, visibility: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
      data-depth={depth}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <div key={i} className="ctx-row">
            <div
              ref={(el) => (rowRefs.current[i] = el)}
              role="menuitem"
              aria-disabled={it.disabled || undefined}
              className={['ctx-item', it.disabled && 'disabled', it.danger && 'danger', open === i && 'open'].filter(Boolean).join(' ')}
              onMouseEnter={() => setOpen(it.submenu?.length ? i : null)}
              onClick={(e) => {
                e.stopPropagation();
                if (it.disabled && !it.submenu) return;
                if (it.onClick && !it.disabled && !e.target.closest('.ctx-more')) {
                  it.onClick();
                  onClose();
                } else if (it.submenu?.length) setOpen(open === i ? null : i);
              }}
            >
              <span className="ctx-icon">{it.swatch !== undefined ? <span className={`swatch ${it.swatch ? 'c-' + it.swatch : 'none'}`} /> : it.icon && <Icon name={it.icon} size={16} />}</span>
              <span className="ctx-label">{it.label}</span>
              {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
              {it.submenu?.length > 0 && <span className="ctx-more">›</span>}
            </div>
            {open === i && it.submenu?.length > 0 && (
              <MenuList items={it.submenu} parent={rowRefs.current[i].getBoundingClientRect()} onClose={onClose} depth={depth + 1} />
            )}
          </div>
        )
      )}
    </div>
  );
}

export default function ContextMenu({ x, y, items, onClose }) {
  useEffect(() => {
    const outside = (e) => !e.target.closest?.('.ctx-menu') && onClose();
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return <MenuList items={items} x={x} y={y} onClose={onClose} depth={0} />;
}
