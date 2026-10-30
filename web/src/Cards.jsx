import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_W, hostOf, sanitize, uid } from './util.js';
import { Icon } from './icons.jsx';
import { CoverTile } from './Cover.jsx';
import { strokePath } from './ink.js';

function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(range);
}

// Wrap #tags in text nodes (outside links) with clickable chips. Display only, never saved.
const TAG_RE = /(^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_-]{1,50})/gu;
function decorateTags(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('#') && !walker.currentNode.parentElement.closest('a')) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    TAG_RE.lastIndex = 0;
    if (!TAG_RE.test(text)) continue;
    TAG_RE.lastIndex = 0; // matchAll starts from lastIndex
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(TAG_RE)) {
      const start = m.index + m[1].length;
      frag.append(text.slice(last, start));
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.dataset.tag = m[2].toLowerCase();
      chip.textContent = '#' + m[2];
      frag.append(chip);
      last = start + 1 + m[2].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

function NoteBody({ card, editing, actions }) {
  const ref = useRef(null);
  const html = card.data.html || '';
  useLayoutEffect(() => {
    const el = ref.current;
    el.innerHTML = sanitize(html);
    if (editing) {
      el.focus();
      placeCaretAtEnd(el);
    } else {
      decorateTags(el);
    }
  }, [html, editing]);
  return (
    <div
      ref={ref}
      className="note-body rich"
      contentEditable={editing ? 'true' : 'false'}
      suppressContentEditableWarning
      data-placeholder="Write something…"
      onBlur={() => editing && actions.finishNote(card.id, sanitize(ref.current.innerHTML))}
    />
  );
}

function TodoBody({ card, editing, actions }) {
  const items = card.data.items || [];
  const focusNext = useRef(null);
  const titleRef = useRef(null);
  const save = (patch) => actions.saveData(card.id, patch);

  useEffect(() => {
    if (editing) titleRef.current?.focus();
  }, [editing]);
  useLayoutEffect(() => {
    if (focusNext.current) {
      const el = document.querySelector(`[data-item-id="${focusNext.current}"]`);
      focusNext.current = null;
      el?.focus();
    }
  });

  function addAfter(index) {
    const item = { id: uid(), text: '', done: false };
    const next = [...items];
    next.splice(index + 1, 0, item);
    focusNext.current = item.id;
    save({ items: next });
  }

  return (
    <div className="todo-body">
      <input
        ref={titleRef}
        className="todo-title"
        placeholder="To-do list"
        defaultValue={card.data.title || ''}
        key={'t' + (card.data.title || '')}
        onBlur={(e) => {
          if (e.target.value !== (card.data.title || '')) save({ title: e.target.value });
          if (editing) actions.stopEdit(card.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (items.length) document.querySelector(`[data-item-id="${items[0].id}"]`)?.focus();
            else addAfter(-1);
          }
        }}
      />
      <ul className="todo-items">
        {items.map((it, i) => (
          <li key={it.id} className={it.done ? 'done' : ''}>
            <input
              type="checkbox"
              checked={!!it.done}
              onChange={() => save({ items: items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) })}
              aria-label="Done"
            />
            <input
              className="todo-text"
              data-item-id={it.id}
              defaultValue={it.text}
              key={it.id + ':' + it.text}
              placeholder="Item"
              onBlur={(e) => {
                if (e.target.value !== it.text) save({ items: items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)) });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const text = e.target.value;
                  const next = items.map((x) => (x.id === it.id ? { ...x, text } : x));
                  const item = { id: uid(), text: '', done: false };
                  next.splice(i + 1, 0, item);
                  focusNext.current = item.id;
                  save({ items: next });
                } else if (e.key === 'Backspace' && !e.target.value) {
                  e.preventDefault();
                  focusNext.current = items[i - 1]?.id ?? null;
                  save({ items: items.filter((x) => x.id !== it.id) });
                }
              }}
            />
          </li>
        ))}
      </ul>
      <button className="todo-add" onClick={() => addAfter(items.length - 1)}>
        <Icon name="plus" size={14} /> Add item
      </button>
    </div>
  );
}

function ImageBody({ card, editing, selected, inColumn, file, actions, lowRes }) {
  const d = card.data;
  const fileId = d.fileId;
  useEffect(() => {
    if (fileId && !file) actions.ensureFile(fileId);
  }, [fileId, file, actions]);
  const ratio = file?.width && file?.height ? `${file.width} / ${file.height}` : undefined;
  const site = d.source_url ? hostOf(d.source_url) : '';
  return (
    <>
      <div className="img-wrap" style={{ aspectRatio: ratio }}>
        {fileId && <img src={`/files/${fileId}/${lowRes ? 'mini' : 'thumb'}`} alt={d.caption || d.alt || file?.name || ''} title={d.alt || undefined} draggable={false} loading="lazy" decoding="async" />}
      </div>
      {editing ? (
        <input
          className="caption-input"
          autoFocus
          placeholder={d.alt ? `Caption (page said: ${d.alt.slice(0, 60)})` : 'Add a caption (searchable)'}
          defaultValue={d.caption || ''}
          onBlur={(e) => {
            if (e.target.value !== (d.caption || '')) actions.saveData(card.id, { caption: e.target.value });
            actions.stopEdit(card.id);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
      ) : d.caption ? (
        <div className="caption">{d.caption}</div>
      ) : (
        selected &&
        !inColumn && (
          <button className="caption-add" onClick={() => actions.editCard(card.id)}>
            Add a caption
          </button>
        )
      )}
      {site && (
        <div className="img-source">
          From{' '}
          <a href={d.source_url} target="_blank" rel="noopener noreferrer" title={d.source_title || d.source_url} draggable={false}>
            {site}
          </a>
        </div>
      )}
    </>
  );
}

function LinkBody({ card, editing, actions, lowRes }) {
  const d = card.data;
  if (!d.url || editing) {
    return (
      <div className="link-empty">
        <Icon name="link" size={16} />
        <input
          className="link-input"
          autoFocus
          placeholder="Paste a link and press Enter"
          defaultValue={d.url || ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const v = e.target.value.trim();
              if (v) actions.setLink(card.id, /^https?:\/\//i.test(v) ? v : 'https://' + v);
              actions.stopEdit(card.id);
            }
          }}
          onBlur={(e) => {
            actions.stopEdit(card.id);
            if (!e.target.value.trim() && !d.url) actions.dropIfFresh(card.id);
          }}
        />
      </div>
    );
  }
  const video = youtubeId(d.url);
  if (video) return <VideoBody card={card} video={video} lowRes={lowRes} />;
  return (
    <div className="link-body">
      {d.image && <img className="link-img" src={`/files/${d.image}/${lowRes ? 'mini' : 'thumb'}`} alt="" draggable={false} loading="lazy" decoding="async" />}
      <div className="link-meta">
        <div className="link-title">{d.loading ? 'Fetching preview…' : d.title || d.url}</div>
        {d.description && <div className="link-desc">{d.description}</div>}
        <div className="link-site">{d.site || hostOf(d.url)}</div>
      </div>
    </div>
  );
}

// YouTube links: watch, youtu.be, shorts, live and embed URLs. Returns { id, start } or null.
export function youtubeId(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = u.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/)?.[1] ?? null;
  }
  if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
  const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  const start = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  return { id, start };
}

// Plays inside the card. Drag the card by its title strip while the video is showing.
function VideoBody({ card, video, lowRes }) {
  const d = card.data;
  const [playing, setPlaying] = useState(false);
  const thumb = d.image ? `/files/${d.image}/${lowRes ? 'mini' : 'thumb'}` : `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
  return (
    <div className="link-body video-body">
      <div className="video-frame">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0${video.start ? '&start=' + video.start : ''}`}
            title={d.title || 'YouTube video'}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <>
            <img src={thumb} alt="" draggable={false} loading="lazy" decoding="async" />
            <button className="video-play" onClick={() => setPlaying(true)} aria-label="Play video" data-tip="Play here">
              <Icon name="play" size={22} />
            </button>
          </>
        )}
      </div>
      <div className="link-meta">
        <div className="link-title">{d.loading ? 'Fetching preview…' : d.title || d.url}</div>
        <div className="link-site video-site">
          <span>YouTube</span>
          {playing && (
            <button className="video-stop" onClick={() => setPlaying(false)}>
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BoardBody({ card, editing, actions }) {
  const child = card.child;
  return (
    <div className="board-body">
      <CoverTile cover={child?.cover} fallback={<Icon name="board" size={28} />} />
      {editing ? (
        <input
          className="board-title-input"
          autoFocus
          defaultValue={child?.title || ''}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => {
            if (child && e.target.value !== child.title) actions.renameBoard(card.id, e.target.value);
            actions.stopEdit(card.id);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
      ) : (
        <div className="board-title">{child?.title || 'Untitled'}</div>
      )}
      <div className="board-count">{child ? `${child.count} card${child.count === 1 ? '' : 's'}` : ''}</div>
    </div>
  );
}

function ColumnBody({ card, editing, kids, sel, editingId, files, actions, dropIndex, dragIds, cutIds, lowRes }) {
  return (
    <>
      <div className="col-head">
        {editing ? (
          <input
            className="col-title-input"
            autoFocus
            defaultValue={card.data.title || ''}
            placeholder="Column"
            onBlur={(e) => {
              if (e.target.value !== (card.data.title || '')) actions.saveData(card.id, { title: e.target.value });
              actions.stopEdit(card.id);
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          />
        ) : (
          <div className="col-title">{card.data.title || 'Column'}</div>
        )}
        <div className="col-count">{kids.length}</div>
      </div>
      <div className="col-body" data-drop-column={card.id}>
        {kids.map((k, i) => (
          <Fragment key={k.id}>
            {dropIndex === i && <div className="drop-line" />}
            <CardView
              card={k}
              inColumn
              selected={sel.has(k.id)}
              editing={editingId === k.id}
              file={files[k.data.fileId]}
              actions={actions}
              dragging={dragIds.has(k.id)}
              cut={cutIds?.has(k.id)}
              lowRes={lowRes}
            />
          </Fragment>
        ))}
        {dropIndex === kids.length && <div className="drop-line" />}
        {!kids.length && dropIndex == null && <div className="col-empty">Drop cards here</div>}
      </div>
    </>
  );
}

// Strokes drawn as SVG, scaled to the card's width. Double-click to draw on it again.
function DrawingBody({ card }) {
  const d = card.data;
  return (
    <svg className="drawing-svg" viewBox={`0 0 ${d.vw || 1} ${d.vh || 1}`} style={{ aspectRatio: `${d.vw || 1} / ${d.vh || 1}` }}>
      {(d.strokes || []).map((st, i) => (
        <path key={i} d={strokePath(st)} fill={st.c} />
      ))}
    </svg>
  );
}

const BODIES = { note: NoteBody, todo: TodoBody, image: ImageBody, link: LinkBody, board: BoardBody, drawing: DrawingBody };

export const CardView = memo(function CardView(props) {
  const { card, inColumn, selected, editing, dragging, cut, hidden } = props;
  const style = inColumn ? undefined : { left: card.x, top: card.y, width: card.w || DEFAULT_W[card.type], zIndex: card.z };
  const cutout = card.type === 'image' && props.file?.alpha === 1; // see-through PNG: no card frame
  const cls = ['card', `card-${card.type}`, cutout && 'cutout', selected && 'selected', editing && 'editing', dragging && 'dragging', cut && 'cut', hidden && 'ink-editing', card.color && `c-${card.color}`, inColumn && 'in-column']
    .filter(Boolean)
    .join(' ');
  const Body = card.type === 'column' ? ColumnBody : BODIES[card.type];
  return (
    <div className={cls} style={style} data-card-id={card.id} data-drop-board={card.type === 'board' ? card.data.boardId : undefined}>
      {Body && <Body {...props} />}
      {selected && !inColumn && !editing && (
        <>
          <div className="handle handle-resize" data-handle="resize" data-tip="Resize" />
          <div className="handle handle-arrow" data-handle="arrow" data-tip="Drag to a card to connect" />
        </>
      )}
    </div>
  );
});
