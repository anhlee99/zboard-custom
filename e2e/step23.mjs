// Phone: hold a picture in Saved items, drag it onto the board. No iOS "Save image / Copy" menu on the
// thumbnail; a quick swipe still scrolls the list instead of picking the item up; letting go over the
// panel puts nothing on the board. Needs a server on ZB_URL. Touches go through the debugging protocol.
import { api, BASE, check, done, launch, sleep, solidPng, PASSWORD } from './lib.mjs';

await api('GET', '/api/me');
const board = (await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', title: 'Phone drag', x: 40, y: 40 }] })).cards[0].data.boardId;
const clipOf = async (name, color) => {
  const fd = new FormData();
  fd.append('board_id', board);
  fd.append('page_url', 'https://example.com/minis');
  fd.append('file', new Blob([solidPng(500, 400, color)], { type: 'image/png' }), name);
  return (await (await fetch(BASE + '/api/clips', { method: 'POST', headers: { cookie: api.cookie }, body: fd })).json()).clip;
};
const a = await clipOf('lantern.png', [230, 140, 40]);
const b = await clipOf('cloak.png', [60, 60, 150]);

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/');
await page.fill('input[type=password]', PASSWORD);
await page.click('button[type=submit]');
await page.waitForSelector('.canvas');
await page.goto(`${BASE}/#/b/${board}`);
await page.waitForSelector('.canvas');
if (!(await page.locator('.saved-panel').count())) await page.locator('[aria-label="Saved items"]').first().tap();
await page.waitForSelector(`.saved-item[data-clip-id="${a.id}"] img`);

const cdp = await context.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function gesture(from, to, holdMs) {
  await touch('touchStart', from.x, from.y);
  await sleep(holdMs);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
    await sleep(16);
  }
  await sleep(100);
  return { ghost: await page.locator('.saved-ghost').count(), end: () => touch('touchEnd') };
}
const cards = async () => (await api('GET', `/api/boards/${board}`)).cards.filter((c) => c.type === 'image');
const clipsLeft = async () => (await api('GET', '/api/clips')).clips.map((c) => c.id);
const box = async (id) => {
  const r = await page.locator(`.saved-item[data-clip-id="${id}"]`).boundingBox();
  return { x: r.x + r.width / 2, y: r.y + 30 };
};

// -webkit-touch-callout is Safari-only (this Chromium drops it), so read it from the stylesheet text.
const style = await page.locator(`.saved-item[data-clip-id="${a.id}"] img`).evaluate(async (el) => {
  const css = (await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map((l) => fetch(l.href).then((r) => r.text())))).join('');
  const rule = css.match(/\.saved-item img\{[^}]*\}/)?.[0] || '';
  return { callout: /-webkit-touch-callout:none/.test(rule) ? 'none' : rule, select: getComputedStyle(el).userSelect, draggable: el.closest('.saved-item').draggable };
});
check(style.callout === 'none' && style.select === 'none', 'the thumbnail has no long-press image menu or text selection', JSON.stringify(style));
check(style.draggable === false, 'on a phone the browser\'s own drag is off (the finger drag takes over)');

// A quick swipe (no hold): no pick-up.
let g = await gesture(await box(a.id), { x: 195, y: 250 }, 40);
check(g.ghost === 0, 'a quick swipe does not pick the item up');
await g.end();
await sleep(500);
check((await cards()).length === 0 && (await clipsLeft()).includes(a.id), 'and puts nothing on the board');

// Hold, then let go over the panel itself: nothing happens.
const from = await box(a.id);
g = await gesture(from, { x: from.x + 4, y: from.y - 6 }, 450);
check(g.ghost === 1, 'holding picks it up: a small copy follows the finger');
await g.end();
await sleep(500);
check((await cards()).length === 0 && (await clipsLeft()).includes(a.id), 'letting go over the Saved panel puts nothing on the board');
check((await page.locator('.saved-ghost').count()) === 0, 'and the copy goes away');

// Hold, drag up onto the board, let go: it becomes a card there.
g = await gesture(await box(a.id), { x: 195, y: 260 }, 450);
await g.end();
await sleep(1200);
const placed = await cards();
check(placed.length === 1 && !(await clipsLeft()).includes(a.id), 'hold and drag onto the board places it as a card', JSON.stringify(placed.map((c) => c.data.fileId)));
const shown = await page.locator('.card-image img').first().boundingBox();
check(shown && Math.abs(shown.y - 260) < 120, 'where the finger let go', JSON.stringify(shown));
check((await clipsLeft()).includes(b.id), 'the other saved item is still there');

await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step23-phone-drag.png' });
check(!errors.length, 'no page errors', errors.join(' | '));
await browser.close();
done();
