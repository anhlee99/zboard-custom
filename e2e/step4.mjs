// Step 4 checks: search + tags, local backup, export zip, Google Drive (against e2e/mock-google.mjs).
// Starts its own WSL test server (zb-test-serve drive) and restarts it for the restore check.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { api, BASE, center, check, done, launch, login, PNG, sleep } from './lib.mjs';

const MOCK = 'http://localhost:4555';
const WSL_TMP = process.env.WSL_TMP || '\\\\wsl.localhost\\ubuntu\\tmp';
let server;
async function startServer({ keep = false } = {}) {
  server?.kill();
  server = spawn('wsl.exe', ['-d', 'Ubuntu', '--exec', 'bash', '-c', `${keep ? 'KEEP=1 ' : ''}exec ~/.local/bin/zb-test-serve drive`], { stdio: 'ignore', windowsHide: true });
  await sleep(800);
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(BASE + '/api/me');
      await fetch(MOCK + '/__state');
      api.cookie = null;
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('server did not start');
}
async function upload(name, buf, type) {
  await api('GET', '/api/me');
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), name);
  const r = await fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd });
  return (await r.json()).file;
}
const mock = async () => (await fetch(MOCK + '/__state')).json();
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(300);
  }
  return null;
}

await startServer();
await fetch(MOCK + '/__reset', { method: 'POST' });

// ---------- seed ----------
const img = await upload('dot.png', PNG, 'image/png');
const seed = await api('POST', '/api/boards/root/cards', {
  cards: [
    { type: 'note', x: 40, y: 40, data: { html: '<div>Café crème with <b>friends</b> #minis</div>' } },
    { type: 'note', x: 320, y: 40, data: { html: '<div>Paint the #Minis tonight</div>' } },
    { type: 'todo', x: 600, y: 40, data: { title: 'Shopping', items: [{ id: 'i1', text: 'buy #paint', done: false }] } },
    { type: 'board', x: 40, y: 300, title: 'Résumé' },
  ],
});
const [cafe, paint, todo, resumeCard] = seed.cards;
const resume = resumeCard.data.boardId;
const nested = await api('POST', `/api/boards/${resume}/cards`, {
  cards: [
    { type: 'board', x: 40, y: 40, title: 'Inner' },
    { type: 'image', x: 300, y: 40, data: { fileId: img.id, caption: 'a dot' } },
  ],
});
await api('POST', `/api/boards/${nested.cards[0].data.boardId}/cards`, { cards: [{ type: 'note', data: { html: 'deep note' } }] });

// ---------- 4a search + tags ----------
const s1 = await api('GET', '/api/search?q=cafe');
check(s1.results[0]?.id === cafe.id, 'search "cafe" finds "Café" (accents ignored)');
const s2 = await api('GET', '/api/search?q=CAFÉ');
check(s2.results[0]?.id === cafe.id, 'search "CAFÉ" finds it too');
check(/\u0001/.test(s1.results[0]?.snippet || ''), 'snippet marks the match');
const s3 = await api('GET', '/api/search?q=resume');
check(s3.results.some((r) => r.kind === 'board' && r.id === resume), 'board titles are searchable ("resume" → Résumé)');
check((await api('GET', '/api/search?q=fri')).results.some((r) => r.id === cafe.id), 'prefix search ("fri" → friends)');
const t1 = await api('GET', '/api/search?tag=minis');
check(t1.results.length === 2 && t1.results.every((r) => [cafe.id, paint.id].includes(r.id)), '#minis lists its two cards (case-insensitive)');
const tags = (await api('GET', '/api/tags')).tags;
check(tags.find((t) => t.tag === 'minis')?.count === 2 && tags.some((t) => t.tag === 'paint'), '/api/tags counts tags (to-do items too)');
await api('PATCH', '/api/cards', { cards: [{ id: paint.id, data: { html: 'Paint later' } }] });
check((await api('GET', '/api/search?tag=minis')).results.length === 1, 'editing a note reindexes its tags');
check((await api('GET', '/api/search?q=later')).results[0]?.id === paint.id, 'editing a note reindexes its text');
await api('POST', '/api/cards/delete', { ids: [todo.id] }).then((r) => api('POST', '/api/restore', r));
check((await api('GET', '/api/search?q=shopping')).results[0]?.id === todo.id, 'deleted-then-restored card is searchable again');

// ---------- browser: Ctrl+K, focus, tag chips ----------
const browser = await launch();
const { page } = await login(browser);
await page.waitForSelector('.card-note');
await page.keyboard.press('Control+k');
await page.waitForSelector('.search-panel');
await page.waitForSelector('.tag-cloud .tag-chip', { timeout: 5000 }).catch(() => {});
check((await page.locator('.tag-cloud .tag-chip').count()) >= 2, 'empty search shows the tag cloud');
await page.keyboard.type('creme');
await page.waitForSelector('.search-results li mark');
await page.keyboard.press('Enter');
await page.waitForFunction((id) => location.hash.includes('focus=' + id), cafe.id);
await sleep(400);
check((await page.locator(`.card.selected[data-card-id="${cafe.id}"]`).count()) === 1, 'picking a result focuses and selects the card');
const chip = page.locator(`[data-card-id="${cafe.id}"] .tag-chip`);
check((await chip.count()) === 1 && (await chip.textContent()) === '#minis', 'tags in notes render as chips');
await chip.click();
await page.waitForSelector('.search-results li:not(.sr-empty)', { timeout: 5000 }).catch(() => {});
const chipQ = await page.locator('.search-input-row input').inputValue().catch(() => '(no search box)');
const chipN = await page.locator('.search-results li:not(.sr-empty)').count();
check(chipQ === '#minis' && chipN === 1, 'clicking a chip searches that tag', `${chipQ}, ${chipN} results`);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
await page.keyboard.type('deep');
await page.waitForSelector('.search-results li:not(.sr-empty)');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('.crumb').length === 3);
check((await page.locator('.crumb').allTextContents()).join('/') === 'Home/Résumé/Inner', 'result in a nested board opens that board');

// ---------- 4b local backup ----------
const b = await api('POST', '/api/backup');
check(b.status?.ok && b.status.files_copied === 1, 'backup creates a snapshot and copies new files', JSON.stringify(b.status));
const { DatabaseSync } = await import('node:sqlite');
// SQLite can't lock files over the \\wsl$ share, so open a local copy.
const snapFile = path.join(os.tmpdir(), b.status.snapshot);
fs.copyFileSync(path.join(WSL_TMP, 'zb-backup', 'db', b.status.snapshot), snapFile);
const snapDb = new DatabaseSync(snapFile, { readOnly: true });
const snapCards = snapDb.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
const snapIntegrity = snapDb.prepare('PRAGMA integrity_check').get().integrity_check;
snapDb.close();
const stats = await api('GET', '/api/stats');
check(snapIntegrity === 'ok' && snapCards === stats.cards, `snapshot opens in SQLite and matches live data (${snapCards} cards)`);
check(fs.existsSync(path.join(WSL_TMP, 'zb-backup', 'files', img.id + img.ext)), 'original file copied to the backup folder');
const b2 = await api('POST', '/api/backup');
check(b2.status.files_copied === 0, 'second backup copies no files (incremental)');
check(stats.stored_bytes === PNG.length, 'stats count stored bytes');

// ---------- 4c export ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-export-'));
const res = await fetch(`${BASE}/api/export/${resume}`, { headers: { cookie: api.cookie } });
check(/attachment; filename="?zboard-Resume-\d{4}-\d\d-\d\d\.zip/.test(res.headers.get('content-disposition') || ''), 'export downloads as zboard-<board>-<date>.zip', res.headers.get('content-disposition'));
fs.writeFileSync(path.join(tmp, 'x.zip'), Buffer.from(await res.arrayBuffer()));
execFileSync('tar', ['-xf', 'x.zip'], { cwd: tmp });
const doc = JSON.parse(fs.readFileSync(path.join(tmp, 'board.json'), 'utf8'));
check(doc.boards.map((x) => x.title).join() === 'Résumé,Inner' && doc.cards.some((c) => c.data.html === 'deep note'), 'zip has the board JSON with nested boards');
const zipped = path.join(tmp, 'files', img.id + img.ext);
check(fs.existsSync(zipped) && fs.readFileSync(zipped).equals(PNG), 'zip has every original image, unmodified');
fs.rmSync(tmp, { recursive: true, force: true });

// ---------- 4d Google Drive ----------
const c = await api('POST', '/api/drive/connect');
check(c.pending?.user_code === 'ZBRD-TEST', 'connect starts device sign-in with a code');
check(!!(await until(async () => (await api('GET', '/api/drive')).connected)), 'device sign-in completes');
const first = await until(async () => (await api('GET', '/api/drive')).last_sync, 20000);
let m = await mock();
check(!!first && m.snapshots.length === 1 && m.files.length === 1, 'first backup after connect: 1 snapshot + originals', JSON.stringify(m));
check(m.snapshots[0].head === 'ZBE1' && m.files[0].name.endsWith('.enc'), 'uploads are encrypted with the passphrase');
await api('PATCH', '/api/cards', { cards: [{ id: cafe.id, x: 50 }] });
await sleep(1000);
await api('PATCH', '/api/cards', { cards: [{ id: cafe.id, x: 60 }] });
await sleep(1000);
await api('PATCH', '/api/cards', { cards: [{ id: cafe.id, x: 70 }] });
check((await mock()).snapshots.length === 1, 'no upload while edits keep coming');
await until(async () => (await mock()).snapshots.length === 2, 15000);
await sleep(4000);
m = await mock();
check(m.snapshots.length === 2 && m.files.length === 1, 'edits → exactly one new snapshot after they stop, no duplicate files', JSON.stringify(m));
check((await api('GET', '/api/drive')).last_error === null, 'no Drive error reported');

// menu shows it
await page.click('[aria-label="Menu"]');
await page.waitForSelector('.menu-panel');
await page.waitForSelector('text=Files copied');
check((await page.locator('.menu-panel').textContent()).includes('Disconnect'), 'menu shows the Drive connection');
await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step4-menu.png' });

const before = {
  boards: (await api('GET', '/api/boards')).boards.map((x) => x.title).sort().join('|'),
  cards: (await api('GET', '/api/stats')).cards,
};
await browser.close();

// restore onto an empty data dir
await startServer();
check((await api('GET', '/api/stats')).cards === 0, 'fresh server starts empty');
await api('POST', '/api/drive/connect');
await until(async () => (await api('GET', '/api/drive')).connected);
await sleep(4500);
check((await mock()).snapshots.length === 2, 'connecting an empty server does not upload an empty snapshot');
const r = await api('POST', '/api/drive/restore');
check(r.files_fetched === 1 && r.files_missing === 0, 'restore downloads the originals', JSON.stringify(r));
const after = {
  boards: (await api('GET', '/api/boards')).boards.map((x) => x.title).sort().join('|'),
  cards: (await api('GET', '/api/stats')).cards,
};
check(after.boards === before.boards && after.cards === before.cards, 'restore onto an empty data dir gives the same boards and cards', `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
const thumb = await fetch(`${BASE}/files/${img.id}/thumb`, { headers: { cookie: api.cookie } });
check(thumb.status === 200, 'thumbnails rebuilt after restore');
check((await api('GET', '/api/search?q=deep')).results.length === 1, 'search works after restore');

server.kill();
execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', 'bash', '-c', 'pkill -f "[s]rc/index.js"; true']);
done();
