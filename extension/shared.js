// Shared by the service worker (background.js) and the popup.

export class ZBError extends Error {
  constructor(message, reconnect = false) {
    super(message);
    this.reconnect = reconnect;
  }
}

export async function settings() {
  const s = await chrome.storage.local.get(['server', 'token', 'board']);
  return { server: (s.server || '').replace(/\/+$/, ''), token: s.token || '', board: s.board || 'root' };
}

export async function call(path, { method = 'GET', json, form, server, token } = {}) {
  const s = await settings();
  server = (server ?? s.server).replace(/\/+$/, '');
  token = token ?? s.token;
  if (!server || !token) throw new ZBError('ZBoard Clipper is not set up yet. Click its icon to connect.', true);
  let res;
  try {
    res = await fetch(server + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(json ? { 'content-type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : form,
    });
  } catch {
    throw new ZBError(`Can't reach ZBoard at ${server}. Is it running, and is the address right?`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    throw new ZBError('ZBoard rejected the token (it was probably replaced). Reconnect: open ZBoard → Menu → Browser extension, copy the token and paste it here.', true);
  }
  if (!res.ok) throw new ZBError(data.error || `ZBoard answered ${res.status}`);
  return data;
}

export const listBoards = async () => (await call('/api/boards')).boards;

// Boards in tree order with their depth, Home first.
export function boardTree(boards) {
  const out = [];
  const walk = (parent, depth) => {
    for (const b of boards.filter((x) => x.parent_id === parent).sort((a, c) => (a.title || '').localeCompare(c.title || ''))) {
      out.push({ ...b, depth });
      walk(b.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function fileName(src, type) {
  const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  try {
    const base = decodeURIComponent(new URL(src).pathname.split('/').pop() || '');
    if (/\.\w{2,5}$/.test(base)) return base.slice(-120);
    if (base) return `${base.slice(0, 80)}.${ext}`;
  } catch {}
  return `image.${ext}`;
}

// The browser fetches the image first (that keeps the site's login cookies);
// if it can't, the server downloads it.
export async function saveImage({ src, board, page, alt }) {
  if (!src.startsWith('blob:')) {
    try {
      const r = await fetch(src, { credentials: 'include' });
      const blob = r.ok ? await r.blob() : null;
      if (blob && blob.size && (blob.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif|heic)(\?|$)/i.test(src))) {
        const form = new FormData();
        form.append('board_id', board);
        form.append('src_url', src.startsWith('data:') ? '' : src);
        form.append('page_url', page?.url || '');
        form.append('page_title', page?.title || '');
        form.append('alt', alt || '');
        form.append('file', blob, fileName(src, blob.type || 'image/png'));
        return (await call('/api/clips', { method: 'POST', form })).clip;
      }
    } catch (e) {
      if (e instanceof ZBError) throw e;
    }
  }
  if (!/^https?:/i.test(src)) throw new ZBError("This image can't be saved: it only exists inside the page.");
  return (await call('/api/clips', { method: 'POST', json: { board_id: board, kind: 'image', src_url: src, alt, page_url: page?.url, page_title: page?.title } })).clip;
}

export const saveLink = async ({ url, title, board, page }) =>
  (await call('/api/clips', { method: 'POST', json: { board_id: board, kind: 'link', url, title, page_url: page?.url, page_title: page?.title } })).clip;

export const saveText = async ({ text, board, page }) =>
  (await call('/api/clips', { method: 'POST', json: { board_id: board, kind: 'text', text, page_url: page?.url, page_title: page?.title } })).clip;
