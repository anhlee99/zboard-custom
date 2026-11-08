// Touch screens: a selected card shows an Arrow button in a pill above it (at least 44 px on screen,
// at any zoom) and a resize circle on its bottom-right corner; moving is hold-and-drag on the card
// (step18). Dragging Arrow to another card connects them, dragging the corner resizes. A mouse gets no pill.
// Needs a server on ZB_URL. Touches go through the debugging protocol.
import { api, BASE, check, done, launch, sleep, PASSWORD } from './lib.mjs';

await api('GET', '/api/me');
const board = (await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', title: 'Pill', x: 40, y: 40 }] })).cards[0].data.boardId;
const made = (await api('POST', `/api/boards/${board}/cards`, {
  cards: [
    { type: 'note', x: 120, y: 260, w: 220, data: { html: '<p>Pick me</p>' } },
    { type: 'note', x: 520, y: 620, w: 220, data: { html: '<p>Target</p>' } },
  ],
})).cards;
const [a, b] = made.map((c) => c.id);
const card = async (id) => (await api('GET', `/api/boards/${board}`)).cards.find((c) => c.id === id);
const arrows = async () => (await api('GET', `/api/boards/${board}`)).arrows || [];

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/');
await page.fill('input[type=password]', PASSWORD);
await page.click('button[type=submit]');
await page.waitForSelector('.canvas');
await page.goto(`${BASE}/#/b/${board}`);
await page.waitForSelector(`[data-card-id="${a}"]`);
await sleep(500);

const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function drag(from, to) {
  await touch('touchStart', from.x, from.y);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
    await sleep(16);
  }
  await touch('touchEnd');
  await sleep(700);
}
const mid = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const sel = (h) => page.locator(`[data-card-id="${a}"] [data-handle="${h}"]`);

await page.locator(`[data-card-id="${a}"]`).tap();
await sleep(500);
const pill = await page.locator(`[data-card-id="${a}"] .handle-pill`).boundingBox();
const cardBox = await page.locator(`[data-card-id="${a}"]`).boundingBox();
const ar = await sel('arrow').boundingBox();
const rs = await sel('resize').boundingBox();
check(!!pill && pill.y + pill.height <= cardBox.y, 'the pill sits above the selected card', JSON.stringify({ pill, cardBox }));
check(Math.abs(mid(pill).x - mid(cardBox).x) < 3, 'centred on it');
check(ar.width >= 44 && (await sel('move').count()) === 0, 'the Arrow button is at least 44 px for a finger, and there is no Move button', JSON.stringify({ ar }));
check(Math.abs(mid(rs).x - (cardBox.x + cardBox.width)) < 3 && Math.abs(mid(rs).y - (cardBox.y + cardBox.height)) < 3, 'resize stays on the bottom-right corner');

// Zoomed out, the pill keeps its size on screen.
await page.locator('[aria-label="Zoom out"]').tap();
await page.locator('[aria-label="Zoom out"]').tap();
await sleep(900);
const mvSmall = await sel('arrow').boundingBox();
check(mvSmall && Math.abs(mvSmall.width - ar.width) < 2, 'zoomed out, the buttons are still finger-sized', JSON.stringify(mvSmall));
await page.locator('[aria-label="Fit to screen"]').tap().catch(() => {});
await page.goto(`${BASE}/#/b/${board}`);
await page.reload();
await page.waitForSelector(`[data-card-id="${a}"]`);
await sleep(600);
await page.locator(`[data-card-id="${a}"]`).tap();
await sleep(500);

const after = await card(a);
const scale = await page.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.world').style.transform)?.[1] || 1));

// Resize: pull the corner 80 px right.
await page.locator(`[data-card-id="${a}"]`).tap();
await sleep(400);
const r = mid(await sel('resize').boundingBox());
await drag(r, { x: r.x + 80, y: r.y });
const resized = await card(a);
check(resized.w > after.w + 40 / scale - 6, 'pulling the corner resizes it', JSON.stringify({ w0: after.w, w1: resized.w }));

// Arrow: drag from the Arrow button onto the other card.
await page.locator(`[data-card-id="${a}"]`).tap();
await sleep(400);
const ab = mid(await sel('arrow').boundingBox());
const target = mid(await page.locator(`[data-card-id="${b}"]`).boundingBox());
await drag(ab, target);
const ars = await arrows();
check(ars.some((x) => x.from_card === a && x.to_card === b), 'dragging Arrow onto another card connects them', JSON.stringify(ars));

await page.locator(`[data-card-id="${a}"]`).tap();
await sleep(400);
await page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/step25-pill.png`, clip: { x: 0, y: 0, width: 820, height: 900 } });
check(!errors.length, 'no page errors', errors.join(' | '));

// A mouse gets the small desktop handles, no pill.
const desk = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const dp = await desk.newPage();
await dp.goto(BASE + '/');
await dp.fill('input[type=password]', PASSWORD);
await dp.click('button[type=submit]');
await dp.waitForSelector('.canvas');
await dp.goto(`${BASE}/#/b/${board}`);
await dp.waitForSelector(`[data-card-id="${b}"]`);
await dp.locator(`[data-card-id="${b}"]`).click();
await sleep(400);
check((await dp.locator('.handle-pill').count()) === 0 && (await dp.locator(`[data-card-id="${b}"] .handle-resize`).count()) === 1, 'with a mouse: no pill, the usual small handles');
await browser.close();
done();
