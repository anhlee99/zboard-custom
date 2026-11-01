// Milanote import. A script in the Milanote page reads the boards out of Milanote's own store and
// hands them to a ZBoard tab (window messages), which uploads the pictures and then sends the
// elements here; this turns them into cards.
// Nothing is written back to Milanote. Whatever can't be carried over is listed in the report.
import { HttpError } from './db.js';

const U = 10; // Milanote positions and widths are in 10 px grid units
const DEFAULT_UNITS = { COLOR_SWATCH: 17 };
const BOARD_COLORS = {
  RED: '#e35b5b',
  ORANGE: '#f19a45',
  YELLOW: '#f2c94c',
  GREEN: '#7cd651',
  TEAL: '#38bdb0',
  BLUE: '#4fb7f5',
  DEEP_BLUE: '#5882f8',
  PURPLE: '#9b6bf0',
  PINK: '#ec6fcf',
  BROWN: '#a0785a',
  GREY: '#8e8e93',
  BLACK: '#23221f',
};
// Milanote board icons are Font Awesome pictures; the common ones become emoji.
const ICONS = {
  pig: '🐷', dragon: '🐉', skull: '💀', paintbrush: '🖌️', 'paint-brush': '🖌️', palette: '🎨', robot: '🤖', star: '⭐', heart: '❤️',
  fire: '🔥', book: '📖', camera: '📷', music: '🎵', film: '🎬', lightbulb: '💡', rocket: '🚀', tree: '🌳', leaf: '🍃', sword: '⚔️',
  swords: '⚔️', shield: '🛡️', crown: '👑', ghost: '👻', bug: '🐛', cat: '🐱', dog: '🐶', fish: '🐟', globe: '🌍', home: '🏠', house: '🏠',
  flask: '🧪', gem: '💎', bolt: '⚡', moon: '🌙', sun: '☀️', cloud: '☁️', 'hat-wizard': '🧙', dice: '🎲', 'dice-d20': '🎲', gamepad: '🎮',
  'hand-dots': '✋', hand: '✋', 'face-angry-horns': '👿', 'face-smile': '🙂', user: '👤', users: '👥', pen: '🖊️', pencil: '✏️',
};
const HEX = /^#[0-9a-f]{6}$/i;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const safeHref = (h) => (/^(https?:|mailto:)/i.test(h || '') ? h : null);

// Milanote text is a ProseMirror document. Notes get HTML; captions and to-dos get plain text.
export function docHtml(doc, notes) {
  const inline = (nodes = []) =>
    nodes
      .map((n) => {
        if (n.type === 'hardBreak') return '<br>';
        if (n.type !== 'text') return inline(n.content);
        let s = esc(n.text || '');
        for (const m of n.marks || []) {
          if (m.type === 'bold' || m.type === 'strong') s = `<b>${s}</b>`;
          else if (m.type === 'italic' || m.type === 'em') s = `<i>${s}</i>`;
          else if (m.type === 'underline') s = `<u>${s}</u>`;
          else if (m.type === 'strike' || m.type === 'strikethrough') s = `<s>${s}</s>`;
          else if (m.type === 'code') s = `<code>${s}</code>`;
          else if (m.type === 'link' && safeHref(m.attrs?.href)) s = `<a href="${esc(m.attrs.href)}">${s}</a>`;
          else notes?.add(m.type === 'highlight' ? 'text highlight colours' : `text style "${m.type}"`);
        }
        return s;
      })
      .join('');
  const block = (n) => {
    switch (n.type) {
      case 'paragraph':
        return `<p>${inline(n.content) || '<br>'}</p>`;
      case 'heading':
        return `<h${Math.min(3, n.attrs?.level || 1)}>${inline(n.content)}</h${Math.min(3, n.attrs?.level || 1)}>`;
      case 'bulletList':
        return `<ul>${(n.content || []).map(block).join('')}</ul>`;
      case 'orderedList':
        return `<ol>${(n.content || []).map(block).join('')}</ol>`;
      case 'listItem':
        return `<li>${(n.content || []).map(block).join('')}</li>`;
      case 'blockquote':
        return `<blockquote>${(n.content || []).map(block).join('')}</blockquote>`;
      case 'codeBlock':
        return `<pre>${esc(plain(n))}</pre>`;
      case 'taskList':
        return `<ul>${(n.content || []).map(block).join('')}</ul>`;
      case 'taskItem':
        return `<li>${n.attrs?.checked ? '☑' : '☐'} ${(n.content || []).map((c) => inline(c.content)).join(' ')}</li>`;
      case 'horizontalRule':
        return '<p>———</p>';
      default:
        notes?.add(`text block "${n.type}"`);
        return n.content ? (n.content || []).map(block).join('') : '';
    }
  };
  return (doc?.content || []).map(block).join('');
}

export function plain(doc) {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  const walk = (n) => {
    if (n.type === 'text') return n.text || '';
    if (n.type === 'hardBreak') return '\n';
    const inner = (n.content || []).map(walk).join('');
    return ['paragraph', 'heading', 'listItem', 'taskItem', 'codeBlock'].includes(n.type) ? inner + '\n' : inner;
  };
  return walk(doc).replace(/\n+$/, '');
}

function firstLink(doc) {
  let href = null;
  const walk = (n) => {
    if (href || !n) return;
    href = safeHref((n.marks || []).find((m) => m.type === 'link')?.attrs?.href) || null;
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return href;
}

function taskItems(doc) {
  const out = [];
  const walk = (n) => {
    if (n.type === 'taskItem') out.push({ text: plain({ type: 'doc', content: n.content }), done: !!n.attrs?.checked });
    else (n.content || []).forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}

const initials = (title) =>
  (String(title || '?').match(/[\p{L}\p{N}]+/gu) || ['?'])
    .slice(0, 2)
    .map((w) => [...w][0].toUpperCase())
    .join('');

export function boardCover(content) {
  const c = content?.color;
  const bg = HEX.test(c || '') ? c.toLowerCase() : BOARD_COLORS[c] || null;
  const icon = ICONS[content?.icon?.id];
  if (icon) return { kind: 'icon', value: icon, bg, fg: null };
  // Letter icons: { type: 'string', id: 'str-nmm' }.
  if (content?.icon?.type === 'string' && /^str-./.test(content.icon.id || '')) return { kind: 'text', value: content.icon.id.slice(4, 8).toUpperCase(), bg, fg: null };
  return { kind: 'text', value: initials(content?.title), bg, fg: null };
}

// payload: { title, rootId, elements: [...], labels: { id: name }, files: { elementId: fileId } }
export function importMilanote(store, payload, { parentId = 'root', newId }) {
  const all = Array.isArray(payload?.elements) ? payload.elements : [];
  const byId = new Map(all.filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  const root = byId.get(payload?.rootId);
  if (!root || root.elementType !== 'BOARD') throw new HttpError(400, 'rootId must be one of the Milanote boards sent');
  if (!store.getBoard(parentId)) throw new HttpError(404, 'Target board not found');
  const files = payload.files && typeof payload.files === 'object' ? payload.files : {};
  const labelNames = payload.labels && typeof payload.labels === 'object' ? payload.labels : {};

  const kids = new Map();
  for (const e of byId.values()) {
    if (e.location?.section === 'TRASH') continue;
    const p = e.location?.parentId;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(e);
  }
  const report = { boards: 0, cards: {}, arrows: 0, skipped: [], notes: new Set() };
  const count = (t) => (report.cards[t] = (report.cards[t] || 0) + 1);
  const skip = (e, why, board) => report.skipped.push({ type: e.elementType, id: e.id, board, why });
  const score = (e) => e.location?.position?.score ?? e.location?.position?.index ?? 0;

  // One Milanote element as a ZBoard card (without position); null if it can't be carried over.
  function convert(e, boardTitle, depth = 0) {
    const c = e.content || {};
    const w = (units) => Math.round((units ?? DEFAULT_UNITS[e.elementType] ?? 34) * U);
    const labels = (c.labels || []).map((id) => labelNames[id]).filter(Boolean);
    const withLabels = (data) => (labels.length ? { ...data, labels } : data);
    const color = HEX.test(c.color || '') ? c.color.toLowerCase() : null;
    switch (e.elementType) {
      case 'CARD':
        return { type: 'note', w: w(c.width), color, data: withLabels({ html: docHtml(c.textContent, report.notes) }) };
      case 'TASK_LIST': {
        const items = taskItems(c.textContent).map((it) => ({ id: newId(), ...it }));
        return { type: 'todo', w: w(c.width), data: withLabels({ title: c.showTitle && c.title ? plain(c.title) : '', items }) };
      }
      case 'IMAGE': {
        const fileId = files[e.id];
        if (!fileId) return skip(e, 'picture could not be downloaded', boardTitle), null;
        // The web clipper writes "From <page>": that becomes the card's source link. Hidden
        // captions stay searchable as alt text.
        let caption = plain(c.caption).trim();
        const href = firstLink(c.caption);
        const source_url = /^from\b/i.test(caption) && href ? href : undefined;
        if (source_url && caption.split('\n').length === 1) caption = '';
        const shown = c.showCaption !== false && caption;
        return {
          type: 'image',
          w: w(c.width),
          color,
          data: withLabels({ fileId, caption: shown ? caption : undefined, alt: (!shown && caption) || c.file?.filename || undefined, source_url }),
        };
      }
      case 'LINK': {
        const url = c.link?.url || c.url;
        if (!url) return skip(e, 'link has no address', boardTitle), null;
        const caption = c.showCaption ? plain(c.caption).trim() : '';
        return {
          type: 'link',
          w: w(c.width),
          color,
          data: withLabels({ url, title: c.link?.title || c.title || null, description: caption || null, site: c.provider?.display || c.provider?.name || null, image: files[e.id] || null }),
        };
      }
      case 'COLOR_SWATCH': {
        const hex = c.color?.value;
        if (!HEX.test(hex || '')) return skip(e, 'colour has no hex value', boardTitle), null;
        return { type: 'color', w: w(c.width), data: { hex, name: plain(c.caption).trim().slice(0, 60) } };
      }
      case 'ANNOTATION': {
        const d = c.drawing;
        const strokes = (d?.paths || [])
          .filter((p) => Array.isArray(p.points) && p.points.length)
          .map((p) => ({ c: HEX.test(p.color || '') ? p.color : '#23221f', s: Number(p.size) || 4, p: p.points.flatMap(([x, y, pr]) => [x, y, pr || 0.5]) }));
        if (!strokes.length) return skip(e, 'drawing is empty or was not loaded', boardTitle), null;
        // Shown at width x 10 px less a 1 px border on each side.
        return { type: 'drawing', w: Math.max(8, Math.round((c.width || 1) * U - 2)), data: { strokes, vw: d.width || 10, vh: d.height || 10 } };
      }
      case 'CLONE': {
        const src = byId.get(c.linkTo);
        if (!src || depth) return skip(e, 'copy of an item that is not available', boardTitle), null;
        if (src.elementType === 'BOARD') return skip(e, 'shortcut to a board (the board itself is copied where it lives)', boardTitle), null;
        const card = convert({ ...src, content: { ...src.content, width: c.width ?? src.content?.width } }, boardTitle, depth + 1);
        if (card) report.notes.add('linked copies (clones) became independent copies');
        return card;
      }
      default:
        return skip(e, 'this kind of item is not supported', boardTitle), null;
    }
  }

  function fill(mnBoard, zbBoardId, title) {
    const children = kids.get(mnBoard.id) || [];
    const onCanvas = children.filter((e) => e.location?.section === 'CANVAS' && e.elementType !== 'LINE').sort((a, b) => score(a) - score(b));
    const unsorted = children.filter((e) => e.location?.section === 'INBOX').sort((a, b) => score(a) - score(b));
    const lines = children.filter((e) => e.elementType === 'LINE' && e.location?.section === 'CANVAS');
    const made = new Map(); // Milanote id -> ZBoard card id
    const subBoards = [];
    let minX = Infinity;
    let minY = Infinity;

    for (const e of onCanvas) {
      const x = Math.round((e.location.position?.x ?? 0) * U);
      const y = Math.round((e.location.position?.y ?? 0) * U);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      if (e.elementType === 'BOARD') {
        const [card] = store.createCards(zbBoardId, [{ type: 'board', title: e.content?.title || 'Untitled board', x, y }]);
        made.set(e.id, card.id);
        subBoards.push([e, card.data.boardId]);
        continue;
      }
      const card = convert(e, title);
      if (!card) continue;
      const [saved] = store.createCards(zbBoardId, [{ ...card, x, y }]);
      made.set(e.id, saved.id);
      count(card.type);
    }

    // Milanote's "unsorted" tray becomes a column to the left of the board.
    const tray = unsorted.map((e) => [e, convert(e, title)]).filter(([, c]) => c);
    if (tray.length) {
      const x0 = (minX === Infinity ? 0 : minX) - 340;
      const [col] = store.createCards(zbBoardId, [{ type: 'column', x: x0, y: minY === Infinity ? 0 : minY, w: 300, data: { title: 'Unsorted (from Milanote)' } }]);
      tray.forEach(([e, c], i) => {
        const [saved] = store.createCards(zbBoardId, [{ ...c, w: undefined, column_id: col.id, sort: i + 1 }]);
        made.set(e.id, saved.id);
        count(c.type);
      });
    }
    for (const e of unsorted.filter((x) => x.elementType === 'BOARD')) skip(e, 'board in the unsorted tray', title);

    for (const e of lines) {
      const c = e.content || {};
      const from = made.get(c.start?.elementId);
      const to = made.get(c.end?.elementId);
      if (!from || !to) {
        skip(e, 'line with an end not attached to a card', title);
        continue;
      }
      const weight = (c.lineWeight || 2) <= 1 ? 1 : c.lineWeight <= 2 ? 2 : 3;
      store.createArrow(zbBoardId, {
        from_card: from,
        to_card: to,
        label: plain(c.label).trim() || null,
        color: HEX.test(c.color || '') ? c.color : null,
        data: { start: c.startStyle === 'ARROW', end: c.endStyle === 'ARROW', dashed: !!c.lineStyle && c.lineStyle !== 'SOLID', weight },
      });
      report.arrows++;
    }

    for (const [e, childId] of subBoards) {
      store.patchBoard(childId, { data: { cover: boardCover(e.content) } });
      if (e.content?.image) report.notes.add('board cover pictures (colour and icon kept)');
      report.boards++;
      fill(e, childId, e.content?.title || 'Untitled board');
    }
  }

  const title = String(payload.title || root.content?.title || 'From Milanote').slice(0, 200);
  const [top] = store.createCards(parentId, [{ type: 'board', title, x: Number(payload.x) || 0, y: Number(payload.y) || 0 }]);
  store.patchBoard(top.data.boardId, { data: { cover: { kind: 'text', value: 'MN', bg: '#23221f', fg: '#ffffff' } } });
  report.boards++;
  fill(root, top.data.boardId, title);
  return { boardId: top.data.boardId, card: store.getCard(top.id), ...report, notes: [...report.notes] };
}
