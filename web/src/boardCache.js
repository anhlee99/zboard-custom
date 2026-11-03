// Board contents fetched ahead (a board card was selected, so it's probably about to be opened)
// or seen earlier in this visit. Opening such a board draws it at once instead of showing an
// empty canvas while the request crosses the network; Board still fetches it fresh right after.
import { api } from './api.js';

const MAX = 30;
const boards = new Map(); // id -> { data, at } | { pending: Promise }

const url = (id) => `/api/boards/${encodeURIComponent(id)}?files=1`;

export function remember(id, data) {
  boards.delete(id); // re-insert so the newest stays last
  boards.set(id, { data, at: Date.now() });
  while (boards.size > MAX) boards.delete(boards.keys().next().value);
}

export const cachedBoard = (id) => boards.get(id)?.data || null;

// Fresh contents; shares a prefetch that is still on its way.
export function fetchBoard(id) {
  const hit = boards.get(id);
  if (hit?.pending) return hit.pending;
  return api('GET', url(id)).then((d) => {
    remember(id, d);
    return d;
  });
}

export function prefetchBoard(id) {
  const hit = boards.get(id);
  if (hit && (hit.pending || Date.now() - hit.at < 5000)) return;
  const pending = api('GET', url(id)).then((d) => {
    remember(id, d);
    return d;
  });
  boards.set(id, { ...hit, pending });
  // A failed prefetch leaves whatever was there before (opening the board reports the error).
  pending.catch(() => {
    const now = boards.get(id);
    if (now?.pending !== pending) return;
    if (now.data) boards.set(id, { data: now.data, at: now.at });
    else boards.delete(id);
  });
}
