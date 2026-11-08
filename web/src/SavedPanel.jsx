import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { hostOf } from './util.js';

export const CLIP_DRAG_TYPE = 'application/x-zboard-clip';
const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const HOLD_MS = 300;

// Phones and tablets: hold an item, then drag it out onto the board (the browser's own drag and drop
// doesn't work there, and holding a picture opened iOS's "Save image / Copy" menu instead). Moving
// before the hold scrolls the list as usual.
function useTouchPickUp(ref, clip, onLift) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    let start = null;
    let lifted = false;
    const reset = () => {
      clearTimeout(timer);
      start = null;
      lifted = false;
    };
    const down = (e) => {
      if (e.touches.length !== 1 || e.target.closest('button')) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      timer = setTimeout(() => {
        lifted = true;
        navigator.vibrate?.(10);
        onLift.current?.start(clip, start.x, start.y);
      }, HOLD_MS);
    };
    const move = (e) => {
      if (!start) return;
      const t = e.touches[0];
      if (lifted) {
        e.preventDefault(); // the finger drags the item, not the list
        onLift.current?.move(t.clientX, t.clientY);
      } else if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8) reset(); // a scroll
    };
    const up = (e) => {
      if (lifted) {
        e.preventDefault();
        const t = e.changedTouches[0];
        onLift.current?.end(t.clientX, t.clientY, e.type === 'touchend');
      }
      reset();
    };
    const menu = (e) => e.preventDefault(); // Android's long-press menu
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('contextmenu', menu);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
      el.removeEventListener('contextmenu', menu);
    };
  }, [ref, clip, onLift]);
}

function SavedItem({ clip, children, onLift }) {
  const ref = useRef(null);
  useTouchPickUp(ref, clip, onLift);
  return (
    <div
      ref={ref}
      className="saved-item"
      data-clip-id={clip.id}
      draggable={!TOUCH}
      onDragStart={(e) => {
        e.dataTransfer.setData(CLIP_DRAG_TYPE, clip.id);
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
    >
      {children}
    </div>
  );
}

function ghostSrc(clip) {
  const id = clip.kind === 'image' ? clip.data.fileId : clip.data.image;
  return id ? `/files/${id}/thumb` : null;
}

function Preview({ clip }) {
  const d = clip.data;
  if (clip.kind === 'image') return <img className="saved-thumb" src={`/files/${d.fileId}/thumb`} alt="" loading="lazy" draggable={false} />;
  if (clip.kind === 'link')
    return (
      <div className="saved-link">
        {d.image && <img className="saved-thumb" src={`/files/${d.image}/thumb`} alt="" loading="lazy" draggable={false} />}
        <div className="saved-title">{d.title || d.url}</div>
        <div className="saved-site">{d.site || hostOf(d.url)}</div>
      </div>
    );
  return <div className="saved-text">{d.text}</div>;
}

// Inbox of things saved with the browser extension. Drag one onto the board to make it a card.
// onDropAt(clipId, clientX, clientY) places it where the finger let go; false if that isn't the board.
export default function SavedPanel({ clips, boardId, boardTitles, onPlace, onDropAt, onDelete, onClose }) {
  const [scope, setScope] = useState('board');
  const [ghost, setGhost] = useState(null); // { clip, x, y } while a finger carries an item
  const list = scope === 'board' ? clips.filter((c) => c.board_id === boardId) : clips;
  const lift = useRef(null);
  const carried = useRef(null);
  lift.current = {
    start: (clip, x, y) => {
      carried.current = clip;
      setGhost({ clip, x, y });
    },
    move: (x, y) => setGhost((g) => g && { ...g, x, y }),
    end: (x, y, dropped) => {
      const clip = carried.current;
      carried.current = null;
      setGhost(null);
      if (clip && dropped) onDropAt?.(clip.id, x, y);
    },
  };
  return (
    <aside className="saved-panel" aria-label="Saved items">
      <header className="saved-head">
        <div className="saved-heading">Saved items</div>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={scope === 'board'} className={scope === 'board' ? 'on' : ''} onClick={() => setScope('board')}>
            This board
          </button>
          <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
            All boards
          </button>
        </div>
        <button className="icon-btn" onClick={onClose} data-tip="Close" aria-label="Close saved items">
          <Icon name="x" size={18} />
        </button>
      </header>
      <div className="saved-list scrolls">
        {list.map((clip) => (
          <SavedItem key={clip.id} clip={clip} onLift={lift}>
            <Preview clip={clip} />
            <div className="saved-foot">
              <span className="saved-from">
                {scope === 'all' && clip.board_id !== boardId ? `${boardTitles[clip.board_id] || 'Another board'} · ` : ''}
                {clip.data.page_url ? hostOf(clip.data.page_url) : ''}
              </span>
              <button className="icon-btn" onClick={() => onPlace(clip.id)} data-tip="Add to this board" aria-label="Add to this board">
                <Icon name="plus" size={16} />
              </button>
              <button className="icon-btn danger" onClick={() => onDelete(clip.id)} data-tip="Delete" aria-label="Delete saved item">
                <Icon name="trash" size={16} />
              </button>
            </div>
          </SavedItem>
        ))}
        {!list.length && (
          <div className="saved-empty">
            {scope === 'board' ? 'Nothing saved to this board yet.' : 'Nothing saved yet.'} Save images, links and text from any web page with the ZBoard Clipper extension (Menu → Browser extension), then drag them onto the board.
          </div>
        )}
      </div>
      {ghost && (
        <div className="saved-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          {ghostSrc(ghost.clip) ? <img src={ghostSrc(ghost.clip)} alt="" /> : <div className="saved-ghost-text">{ghost.clip.data.text || ghost.clip.data.title || ghost.clip.data.url}</div>}
        </div>
      )}
    </aside>
  );
}
