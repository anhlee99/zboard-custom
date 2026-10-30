import { Fragment, memo, useEffect, useLayoutEffect, useRef } from 'react';
import { DEFAULT_W, hostOf, sanitize, uid } from './util.js';
import { Icon } from './icons.jsx';

function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(range);
}

function NoteBody({ card, editing, actions }) {
  const ref = useRef(null);
  const html = card.data.html || '';
  useLayoutEffect(() => {
    const el = ref.current;
    if (editing) {
      el.innerHTML = sanitize(html);
      el.focus();
      placeCaretAtEnd(el);
    } else if (el.innerHTML !== sanitize(html)) {
      el.innerHTML = sanitize(html);
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

function ImageBody({ card, editing, file, actions }) {
  const fileId = card.data.fileId;
  useEffect(() => {
    if (fileId && !file) actions.ensureFile(fileId);
  }, [fileId, file, actions]);
  const ratio = file?.width && file?.height ? `${file.width} / ${file.height}` : undefined;
  return (
    <>
      <div className="img-wrap" style={{ aspectRatio: ratio }}>
        {fileId && <img src={`/files/${fileId}/thumb`} alt={card.data.caption || ''} draggable={false} loading="lazy" decoding="async" />}
      </div>
      {editing ? (
        <input
          className="caption-input"
          autoFocus
          placeholder="Add a caption"
          defaultValue={card.data.caption || ''}
          onBlur={(e) => {
            if (e.target.value !== (card.data.caption || '')) actions.saveData(card.id, { caption: e.target.value });
            actions.stopEdit(card.id);
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        />
      ) : (
        card.data.caption && <div className="caption">{card.data.caption}</div>
      )}
    </>
  );
}

function LinkBody({ card, editing, actions }) {
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
  return (
    <div className="link-body">
      {d.image && <img className="link-img" src={`/files/${d.image}/thumb`} alt="" draggable={false} loading="lazy" decoding="async" />}
      <div className="link-meta">
        <div className="link-title">{d.loading ? 'Fetching preview…' : d.title || d.url}</div>
        {d.description && <div className="link-desc">{d.description}</div>}
        <div className="link-site">{d.site || hostOf(d.url)}</div>
      </div>
    </div>
  );
}

function BoardBody({ card, editing, actions }) {
  const child = card.child;
  return (
    <div className="board-body">
      <div className="board-icon">
        <Icon name="board" size={28} />
      </div>
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

function ColumnBody({ card, editing, kids, sel, editingId, files, actions, dropIndex, dragIds }) {
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
            />
          </Fragment>
        ))}
        {dropIndex === kids.length && <div className="drop-line" />}
        {!kids.length && dropIndex == null && <div className="col-empty">Drop cards here</div>}
      </div>
    </>
  );
}

const BODIES = { note: NoteBody, todo: TodoBody, image: ImageBody, link: LinkBody, board: BoardBody };

export const CardView = memo(function CardView(props) {
  const { card, inColumn, selected, editing, dragging } = props;
  const style = inColumn ? undefined : { left: card.x, top: card.y, width: card.w || DEFAULT_W[card.type], zIndex: card.z };
  const cls = ['card', `card-${card.type}`, selected && 'selected', editing && 'editing', dragging && 'dragging', card.color && `c-${card.color}`, inColumn && 'in-column']
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
