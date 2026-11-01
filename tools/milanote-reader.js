// Milanote -> ZBoard import, the half that runs in the Milanote page. Read-only on Milanote.
//
// How to run (Chrome, logged in to both Milanote and ZBoard):
//  1. Open the Milanote board to copy (its sub-boards come along) and paste this file into the
//     DevTools console. It opens (or reuses) a ZBoard tab named "zboard-import".
//  2. In that ZBoard tab's console, paste the RECEIVER snippet at the bottom of this file.
//  3. Back in the Milanote tab:  await zbImport({ rootId: '<board id from the URL>', title: 'From Milanote' })
//     Progress is in window.zbProg; the import report ends up in zbProg.result.
//
// The Milanote page hands everything to the ZBoard tab with window messages, so Milanote never
// talks to localhost (no Chrome "local network" permission) and no ZBoard token enters its page.
// Pictures are downloaded one at a time at a human pace; the board itself is built by
// POST /api/import/milanote (server/src/milanote.js).
(() => {
  const ZB = 'http://localhost:3000';

  // Milanote's Redux store hangs off the React root.
  const app = document.getElementById('app');
  const rootKey = Object.keys(app).find((k) => k.startsWith('__reactContainer$'));
  let store = null;
  for (let q = [app[rootKey]], n = 0; q.length && !store && n < 5000; n++) {
    const f = q.shift();
    if (!f) continue;
    if (f.memoizedProps?.store?.getState) store = f.memoizedProps.store;
    q.push(f.child, f.sibling);
  }
  if (!store) throw new Error('Milanote store not found');

  const win = window.open(ZB + '/#/', 'zboard-import');
  let seq = 0;
  const waiting = new Map();
  window.addEventListener('message', (ev) => {
    if (ev.origin !== ZB || ev.data?.zb !== 'reply') return;
    waiting.get(ev.data.n)?.(ev.data);
    waiting.delete(ev.data.n);
  });
  const send = (msg, ms = 120000) =>
    new Promise((res, rej) => {
      const n = ++seq;
      waiting.set(n, res);
      setTimeout(() => waiting.delete(n) && rej(new Error('ZBoard tab did not answer')), ms);
      win.postMessage({ ...msg, n }, ZB);
    });

  window.zbImport = async ({ rootId, title, x, y, onlyCount }) => {
    const P = (window.zbProg = { phase: 'reading', done: 0, total: 0, failed: [], result: null, error: null });
    try {
      const st = store.getState();
      const all = Object.values(st.get('elements').toJS());
      const byId = new Map(all.map((e) => [e.id, e]));
      const kids = new Map();
      for (const e of all) {
        if (e.location?.section === 'TRASH') continue;
        const p = e.location?.parentId;
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p).push(e);
      }
      const pick = new Map([[rootId, byId.get(rootId)]]);
      const walk = (id) => {
        for (const e of kids.get(id) || []) if (!pick.has(e.id)) pick.set(e.id, e), walk(e.id);
      };
      walk(rootId);
      // Clones point at an element that may live on another board.
      for (const e of [...pick.values()]) if (e.elementType === 'CLONE' && byId.has(e.content?.linkTo)) pick.set(e.content.linkTo, byId.get(e.content.linkTo));

      const labels = {};
      for (const l of Object.values(st.get('labels')?.toJS?.().currentUserLabels || {})) if (l._id && l.name) labels[l._id] = l.name;

      // Big inline pictures (drawing previews, icon art, embed HTML) are not needed.
      const elements = [...pick.values()].map((e) => {
        const c = JSON.parse(JSON.stringify(e.content || {}));
        if (c.drawing) delete c.drawing.svg;
        if (c.icon) delete c.icon.svg, delete c.icon.png;
        if (c.media) delete c.media.html;
        return { id: e.id, elementType: e.elementType, content: c, location: e.location };
      });
      const jobs = [];
      for (const e of pick.values()) {
        const c = e.content || {};
        if (e.location?.section === 'TRASH') continue;
        if (e.elementType === 'IMAGE') jobs.push({ id: e.id, urls: [c.image?.original, c.image?.huge, c.image?.large].filter(Boolean), name: c.file?.filename || 'image' });
        if (e.elementType === 'LINK' && (c.image?.large || c.image?.regular)) jobs.push({ id: e.id, urls: [c.image.large, c.image.regular].filter(Boolean), name: 'link-preview' });
      }
      Object.assign(P, { total: jobs.length, elements: elements.length });
      if (onlyCount) return (P.phase = 'counted');

      P.phase = 'pictures';
      const files = {};
      for (const j of jobs) {
        for (const u of j.urls) {
          try {
            const r = await fetch(u, { credentials: u.startsWith(location.origin) ? 'include' : 'omit' });
            if (!r.ok) continue;
            const blob = await r.blob();
            if (!blob.type.startsWith('image/') && blob.type !== 'application/octet-stream') continue;
            const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
            const rep = await send({ zb: 'file', blob, name: /\.[a-z0-9]{2,5}$/i.test(j.name) ? j.name : `${j.name}.${ext}` });
            if (rep.fileId) {
              files[j.id] = rep.fileId;
              break;
            }
          } catch {}
        }
        if (!files[j.id]) P.failed.push(j.id);
        P.done++;
        await new Promise((r) => setTimeout(r, 350 + Math.random() * 400));
      }

      P.phase = 'cards';
      const rep = await send({ zb: 'import', payload: { rootId, title, x, y, labels, files, elements } });
      if (rep.error) throw new Error(rep.error);
      P.result = rep.result;
      P.phase = 'done';
    } catch (e) {
      P.error = String(e);
      P.phase = 'error';
    }
    return P;
  };
})();

/* RECEIVER: paste into the ZBoard tab's console (uses that tab's login).

window.addEventListener('message', async (ev) => {
  if (ev.origin !== 'https://app.milanote.com' || !ev.data?.zb) return;
  const m = ev.data;
  const reply = (x) => ev.source.postMessage({ zb: 'reply', n: m.n, ...x }, ev.origin);
  try {
    if (m.zb === 'file') {
      const fd = new FormData();
      fd.append('file', m.blob, m.name);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const j = await r.json();
      return reply(r.ok ? { fileId: j.file.id } : { error: j.error || r.status });
    }
    if (m.zb === 'import') {
      const r = await fetch('/api/import/milanote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m.payload) });
      const j = await r.json();
      return reply(r.ok ? { result: j } : { error: j.error || r.status });
    }
  } catch (e) {
    reply({ error: String(e) });
  }
});
*/
