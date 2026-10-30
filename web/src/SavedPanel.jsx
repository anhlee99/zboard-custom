import { useState } from 'react';
import { Icon } from './icons.jsx';
import { hostOf } from './util.js';

export const CLIP_DRAG_TYPE = 'application/x-zboard-clip';

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
export default function SavedPanel({ clips, boardId, boardTitles, onPlace, onDelete, onClose }) {
  const [scope, setScope] = useState('board');
  const list = scope === 'board' ? clips.filter((c) => c.board_id === boardId) : clips;
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
          <div
            key={clip.id}
            className="saved-item"
            data-clip-id={clip.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(CLIP_DRAG_TYPE, clip.id);
              e.dataTransfer.effectAllowed = 'copyMove';
            }}
          >
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
          </div>
        ))}
        {!list.length && (
          <div className="saved-empty">
            {scope === 'board' ? 'Nothing saved to this board yet.' : 'Nothing saved yet.'} Save images, links and text from any web page with the ZBoard Clipper extension (Menu → Browser extension), then drag them onto the board.
          </div>
        )}
      </div>
    </aside>
  );
}
