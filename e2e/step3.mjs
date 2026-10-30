// Step 3 checks: touch gestures at phone size, phone layout, PWA installability.
import { api, center, check, chromiumPersistent, done, launch, login, sleep } from './lib.mjs';

// Seed a note and a column on a fresh board.
const root = await api('GET', '/api/boards/root');
await api('POST', '/api/cards/delete', { ids: root.cards.map((c) => c.id) });
const { cards } = await api('POST', '/api/boards/root/cards', {
  cards: [
    { type: 'note', x: 20, y: 20, w: 200, data: { html: '<div>Phone note</div>' } },
    { type: 'column', x: 20, y: 240, w: 260, data: { title: 'Inbox' } },
  ],
});
const [noteId, colId] = cards.map((c) => c.id);

const browser = await launch();
const { page, context } = await login(browser, { width: 390, height: 844 }, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await page.waitForSelector('.card-note');
const cdp = await context.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
async function swipe(from, to, { hold = 0, steps = 10, id = 0 } = {}) {
  await touch('touchStart', [{ ...from, id }]);
  if (hold) await sleep(hold);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id }]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await sleep(200);
}
const transform = () => page.locator('.world').evaluate((e) => e.style.transform);
const zoom = async () => Number((await page.locator('.zoom-pct').textContent()).replace('%', ''));

// --- layout ---
const tb = await page.locator('.toolbar').boundingBox();
check(tb.y > 700 && tb.width <= 390, 'toolbar sits at the bottom under 700 px', JSON.stringify(tb));
check(await page.locator('.tool-camera').isVisible(), 'camera button shown on the phone');
check((await page.locator('input[capture="environment"]').count()) === 1, 'camera input uses capture=environment');

// --- one finger on empty space pans ---
const t0 = await transform();
await swipe({ x: 330, y: 650 }, { x: 280, y: 560 });
const t1 = await transform();
check(t0 !== t1 && t1.includes('translate(30px, -50px)'), 'one finger on empty space pans', `${t0} -> ${t1}`);

// --- quick swipe starting on a card pans instead of moving it ---
const noteLeft = await page.locator('.world > .card-column').evaluate((e) => e.style.left + e.style.top);
const p = await center(page.locator('.card-column .col-head'));
await swipe(p, { x: p.x + 40, y: p.y + 60 }, { steps: 6 });
const noteLeft2 = await page.locator('.world > .card-column').evaluate((e) => e.style.left + e.style.top);
const t2 = await transform();
check(noteLeft2 === noteLeft && t2 !== t1, 'quick swipe on a card pans, card stays', `left ${noteLeft}->${noteLeft2}, ${t1} -> ${t2}`);

// --- two fingers pinch-zoom ---
const z0 = await zoom();
await touch('touchStart', [{ x: 150, y: 450, id: 1 }, { x: 240, y: 450, id: 2 }]);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', [{ x: 150 - i * 6, y: 450, id: 1 }, { x: 240 + i * 6, y: 450, id: 2 }]);
  await sleep(16);
}
await touch('touchEnd', []);
await sleep(200);
const z1 = await zoom();
check(z1 > z0 + 20, `pinch zooms in (${z0}% -> ${z1}%)`);
// pinch back out so cards fit again
await touch('touchStart', [{ x: 90, y: 450, id: 1 }, { x: 300, y: 450, id: 2 }]);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', [{ x: 90 + i * 6, y: 450, id: 1 }, { x: 300 - i * 6, y: 450, id: 2 }]);
  await sleep(16);
}
await touch('touchEnd', []);
await sleep(200);
check((await zoom()) < z1, 'pinch out zooms back');

// --- hold a card, then drag it into the column ---
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.card-note');
await sleep(300);
const from = await center(page.locator('.card-note'));
const to = await center(page.locator('.card-column .col-body'));
await swipe(from, to, { hold: 400, steps: 14 });
await sleep(400);
check((await page.locator('.card-column .card-note').count()) === 1, 'long-press drag moves the note into the column');
const server = await api('GET', '/api/boards/root');
check(server.cards.find((c) => c.id === noteId)?.column_id === colId, 'column move saved on the server');

// --- tap selects; floating toolbar fits the screen ---
const inCol = await center(page.locator('.card-column .card-note'));
await touch('touchStart', [inCol]);
await touch('touchEnd', []);
await sleep(300);
check((await page.locator('.card-note.selected').count()) === 1, 'tap selects a card');
const fb = await page.locator('.float-bar').boundingBox();
check(fb && fb.x >= 0 && fb.x + fb.width <= 390, 'floating toolbar fits a 390 px screen', JSON.stringify(fb));

// --- double-tap edits a note; format bar fits ---
await touch('touchStart', [inCol]);
await touch('touchEnd', []);
await sleep(80);
await touch('touchStart', [inCol]);
await touch('touchEnd', []);
await sleep(300);
check((await page.locator('.card-note .note-body[contenteditable="true"]').count()) === 1, 'double-tap opens the note editor');
const fmt = await page.locator('.format-bar').boundingBox();
check(fmt && fmt.x >= 0 && fmt.x + fmt.width <= 390, 'format bar fits a 390 px screen', JSON.stringify(fmt));
await page.keyboard.press('Escape');

// --- hold empty space opens the add menu ---
await touch('touchStart', [{ x: 340, y: 160 }]);
await sleep(700);
await touch('touchEnd', []);
await sleep(200);
check(await page.locator('.add-menu').isVisible(), 'long-press on empty space opens the add menu');
await page.locator('.add-menu button', { hasText: 'To-do' }).tap();
await sleep(500);
check((await page.locator('.card-todo').count()) === 1, 'add menu creates a card there');
await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step3-phone.png' });

// --- PWA: service worker, manifest, installability ---
const desk = await login(browser);
await desk.page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 10000 });
await desk.page.reload();
await desk.page.waitForSelector('.canvas');
const controlled = await desk.page.evaluate(() => !!navigator.serviceWorker.controller);
check(controlled, 'service worker controls the page');
const caches = await desk.page.evaluate(async () => (await caches.keys()).join(','));
const swSrc = await (await fetch('http://localhost:3000/sw.js')).text();
const version = swSrc.match(/VERSION = '([^']+)'/)[1];
check(caches.includes('zb-shell-' + version), `shell cached under the build version (${caches})`);
const manifest = await (await fetch('http://localhost:3000/manifest.webmanifest')).json();
check(manifest.name === 'ZBoard' && manifest.display === 'standalone' && manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'), 'manifest: name, standalone, icons incl. maskable');
// Installability is not reported in incognito contexts, so use a throwaway persistent profile.
const os = await import('node:os');
const fs = await import('node:fs');
const profile = fs.mkdtempSync(os.tmpdir() + '/zb-pwa-');
const persistent = await chromiumPersistent(profile);
const pp = persistent.pages()[0] || (await persistent.newPage());
await pp.goto('http://localhost:3000/');
await pp.evaluate(() => navigator.serviceWorker.ready);
await pp.reload();
await sleep(1000);
const inst = await (await persistent.newCDPSession(pp)).send('Page.getInstallabilityErrors');
check(inst.installabilityErrors.length === 0, 'Chromium reports the app installable', JSON.stringify(inst.installabilityErrors));
await persistent.close();
fs.rmSync(profile, { recursive: true, force: true });
const apiCached = await desk.page.evaluate(async () => {
  for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (new URL(r.url).pathname.startsWith('/api/')) return true;
  return false;
});
check(!apiCached, 'no /api responses in any cache');

await browser.close();
done();
