import { uid } from './util.js';

// Every write carries this tab's id; the server echoes it in events so we can drop our own.
export const clientId = uid();

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export async function api(method, url, body) {
  const opts = { method, headers: { 'X-Client-Id': clientId }, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error("Can't reach the ZBoard server");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401 && url !== '/api/login') onUnauthorized();
  if (!res.ok) {
    const err = new Error(data?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function uploadFiles(files) {
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name || 'pasted.png');
  return (await api('POST', '/api/upload', fd)).files;
}

// Live updates for one board. Handlers: cards, delete, arrows, board, resync.
export function openEvents(boardId, handlers) {
  const es = new EventSource(`/api/events?board=${encodeURIComponent(boardId)}`);
  let dropped = false;
  for (const type of ['cards', 'delete', 'arrows', 'board', 'reload', 'clips']) {
    es.addEventListener(type, (e) => {
      const d = JSON.parse(e.data);
      if (d.clientId === clientId) return;
      handlers[type]?.(d);
    });
  }
  es.onerror = () => {
    dropped = true;
  };
  es.onopen = () => {
    if (dropped) {
      dropped = false;
      handlers.resync?.();
    }
  };
  return () => es.close();
}
