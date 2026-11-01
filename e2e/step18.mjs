// Touch: a selected card shows a move handle that drags at once (no long press), and holding
// a card doesn't bring up the browser's image menu. Needs a server on ZB_URL from an empty data dir.
import { api, BASE, check, done, launch, login, sleep, solidPng } from './lib.mjs';

const holder = await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', title: 'Touch', x: 40, y: 40 }] });
const boardId = holder.cards[0].data.boardId;
const fd = new FormData();
fd.append('file', new Blob([solidPng(400, 300, [200, 80, 60])], { type: 'image/png' }), 'red.png');
const { file } = await (await fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd })).json();
const { cards } = await api('POST', `/api/boards/${boardId}/cards`, { cards: [{ type: 'image', x: 120, y: 160, w: 200, data: { fileId: file.id } }] });
const id = cards[0].id;

const browser = await launch();
const { context, page } = await login(browser, { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/#/b/${boardId}`);
await page.waitForSelector(`[data-card-id="${id}"] img`);
await sleep(600);
const card = page.locator(`[data-card-id="${id}"]`);

check(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'phone emulation has a coarse pointer');
const img = card.locator('img').first();
check((await img.evaluate((e) => getComputedStyle(e).userSelect)) === 'none', 'card images cannot be selected or long-pressed into the browser menu');

// Tap selects; the move handle appears off the top-left corner.
const box0 = await card.boundingBox();
await page.touchscreen.tap(box0.x + box0.width / 2, box0.y + box0.height / 2);
await sleep(400);
const handle = card.locator('[data-handle="move"]');
check(await handle.isVisible(), 'tapping a card shows the move handle');
const hb = await handle.boundingBox();
check(hb.width >= 36 && hb.width <= 44 && hb.x + hb.width <= box0.x + 2 && hb.y + hb.height <= box0.y + 2, 'handle is about 40 px on screen, just outside the top-left corner', JSON.stringify({ hb, box0 }));

// Drag the handle with a real touch: it moves at once, no hold.
const cdp = await context.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const sx = hb.x + hb.width / 2;
const sy = hb.y + hb.height / 2;
await touch('touchStart', sx, sy);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', sx + i * 8, sy + i * 12);
  await sleep(16);
}
await touch('touchEnd');
await sleep(800);
const box1 = await card.boundingBox();
check(Math.abs(box1.x - box0.x - 80) < 3 && Math.abs(box1.y - box0.y - 120) < 3, 'dragging the handle moves the card with the finger', JSON.stringify({ dx: box1.x - box0.x, dy: box1.y - box0.y }));
const saved = (await api('GET', `/api/boards/${boardId}`)).cards.find((c) => c.id === id);
check(saved.x !== 120 || saved.y !== 160, 'the new spot is saved', JSON.stringify([saved.x, saved.y]));

// A one-finger swipe on the board (not the handle) still pans instead of moving the card.
const view0 = await card.boundingBox();
await touch('touchStart', 200, 700);
for (let i = 1; i <= 6; i++) {
  await touch('touchMove', 200 - i * 10, 700);
  await sleep(16);
}
await touch('touchEnd');
await sleep(400);
const view1 = await card.boundingBox();
const after = (await api('GET', `/api/boards/${boardId}`)).cards.find((c) => c.id === id);
check(view1.x < view0.x - 40 && after.x === saved.x, 'swiping empty space pans the board', JSON.stringify({ dx: view1.x - view0.x }));
check(!errors.length, 'no page errors', errors.join(' | '));
await browser.close();

// Desktop: no move handle (the mouse drags the card itself).
const desk = await launch();
const { page: dp } = await login(desk);
await dp.goto(`${BASE}/#/b/${boardId}`);
await dp.waitForSelector(`[data-card-id="${id}"] img`);
await dp.locator(`[data-card-id="${id}"] img`).click();
await sleep(300);
check((await dp.locator(`[data-card-id="${id}"] [data-handle="move"]`).count()) === 0, 'no move handle with a mouse');
await desk.close();
done();
