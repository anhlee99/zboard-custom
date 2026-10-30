// Drawing: pen, colour, size, eraser, select/move, undo, save as a card, edit again, resize,
// discard, phone-size toolbar and the terminal render. Needs a server on ZB_URL with an empty data dir.
import { api, BASE, check, done, drag, launch, login, sleep, solidPng } from './lib.mjs';

await api('GET', '/api/me');
const holder = await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', x: 60, y: 60, title: 'Sketches' }] });
const boardId = holder.cards[0].child.id;

const browser = await launch();
const { page } = await login(browser);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/#/b/${boardId}`);
await page.waitForSelector('.canvas');
await sleep(300);
const cb = await page.locator('.canvas').boundingBox();
const at = (x, y) => ({ x: cb.x + x, y: cb.y + y });
const drawings = () => api('GET', `/api/boards/${boardId}`).then((b) => b.cards.filter((c) => c.type === 'drawing'));
const bar = (label) => page.locator(`.draw-bar [aria-label="${label}"]`);

// Open, draw two strokes, change colour and size for the second.
await page.click('.toolbar [aria-label="Draw"]');
await page.waitForSelector('.draw-layer');
check((await page.locator('.draw-save').isDisabled()) && (await page.locator('.draw-cancel').textContent()) === 'Cancel', 'draw mode opens with Save off and Cancel');
await drag(page, at(300, 300), at(500, 360), 20);
await bar('Pen colour').click();
await bar('Pen colour #ef4444').click();
await bar('Stroke size').click();
await page.locator('.draw-size-pop input[type=range]').fill('24');

await drag(page, at(320, 420), at(520, 260), 20);
check((await page.locator('.draw-svg path').count()) === 2, 'two strokes drawn');
check((await page.locator('.draw-cancel').textContent()) === 'Discard' && !(await page.locator('.draw-save').isDisabled()), 'after drawing: Discard and Save');
check((await page.locator('.draw-svg path').nth(1).getAttribute('fill')) === '#ef4444', 'second stroke uses the picked colour');

// Undo / redo inside the drawing.
await page.keyboard.press('Control+z');
check((await page.locator('.draw-svg path').count()) === 1, 'Ctrl+Z removes the last stroke');
await page.keyboard.press('Control+y');
check((await page.locator('.draw-svg path').count()) === 2, 'Ctrl+Y brings it back');

// Eraser removes the whole stroke it touches.
await bar('Eraser').click();
await drag(page, at(400, 300), at(400, 335), 10); // crosses the thin stroke (y≈330), stays clear of the thick one (y≈356)
check((await page.locator('.draw-svg path').count()) === 1, 'eraser removes a stroke');
await page.keyboard.press('Control+z');
check((await page.locator('.draw-svg path').count()) === 2, 'undo brings an erased stroke back');

// Select and move a stroke.
await bar('Select strokes').click();
const before = await page.locator('.draw-svg path').nth(0).boundingBox();
await drag(page, at(400, 330), at(400, 230), 10);
const after = await page.locator('.draw-svg path').nth(0).boundingBox();
check(Math.abs(after.y - before.y + 100) < 6, 'select tool moves a stroke', `${before.y} -> ${after.y}`);

// Save: one drawing card where the strokes were.
await page.click('.draw-save');
await page.waitForSelector('.card-drawing');
let list = await drawings();
check(list.length === 1 && list[0].data.strokes.length === 2, 'Save makes one drawing card with both strokes');
const d1 = list[0];
check(d1.data.strokes[1].c === '#ef4444' && d1.data.strokes[1].s === 24, 'colour and size are saved per stroke');
const cardBox = await page.locator('.card-drawing').boundingBox();
check(Math.abs(cardBox.x - at(300, 0).x) < 30 && Math.abs(cardBox.y - at(0, 200).y) < 40, 'card sits where the strokes were drawn', JSON.stringify(cardBox));
check((await page.locator('.card-drawing svg path').count()) === 2, 'card shows the strokes as SVG');

// Undo the save on the board removes the card.
await page.keyboard.press('Control+z');
await sleep(500);
check((await drawings()).length === 0, 'board undo removes the new drawing');
await page.click('.toolbar [aria-label="Undo"]').catch(() => {});
await page.goto(`${BASE}/#/b/${boardId}`);

// Draw again, save, then edit it: double-click opens it with its strokes.
await page.click('.toolbar [aria-label="Draw"]');
await bar('Pen').click();
await drag(page, at(300, 300), at(560, 300), 20);
await page.click('.draw-save');
await page.waitForSelector('.card-drawing');
const d2 = (await drawings())[0];
await page.locator('.card-drawing').dblclick();
await page.waitForSelector('.draw-layer');
check((await page.locator('.draw-svg path').count()) === 1, 'double-click opens the drawing with its strokes');
check(await page.locator('.card-drawing').evaluate((e) => getComputedStyle(e).visibility === 'hidden'), 'the card hides while it is being edited');
await drag(page, at(300, 380), at(560, 380), 20);
await page.click('.draw-save');
await sleep(500);
list = await drawings();
check(list.length === 1 && list[0].id === d2.id && list[0].data.strokes.length === 2, 'editing updates the same card');

// Discard leaves it alone.
await page.locator('.card-drawing').dblclick();
await drag(page, at(700, 500), at(800, 520), 10);
await page.click('.draw-cancel');
await sleep(300);
check((await drawings())[0].data.strokes.length === 2 && (await page.locator('.draw-layer').count()) === 0, 'Discard keeps the saved drawing as it was');

// Escape also leaves without saving.
await page.click('.toolbar [aria-label="Draw"]');
await drag(page, at(700, 600), at(800, 620), 10);
await page.keyboard.press('Escape');
check((await page.locator('.draw-layer').count()) === 0 && (await drawings()).length === 1, 'Escape leaves without saving');

// Resizing the card scales the drawing.
await page.locator('.card-drawing').click();
const hb = await page.locator('.card-drawing .handle-resize').boundingBox();
const w0 = (await page.locator('.card-drawing').boundingBox()).width;
await drag(page, { x: hb.x + 4, y: hb.y + 4 }, { x: hb.x + 4 + 140, y: hb.y + 4 }, 10);
await sleep(400);
const box2 = await page.locator('.card-drawing').boundingBox();
const svgBox = await page.locator('.card-drawing svg').boundingBox();
check(box2.width > w0 + 100 && Math.abs(svgBox.width - box2.width) < 2, 'resizing scales the drawing', `${w0} -> ${box2.width}`);

// Board keys stay quiet while drawing: Delete does not delete selected cards.
await page.locator('.card-drawing').click();
await page.click('.toolbar [aria-label="Draw"]');
await page.keyboard.press('Delete');
await page.keyboard.press('Escape');
check((await drawings()).length === 1, 'board shortcuts are off while drawing');

// The terminal can show it.
const png = await fetch(`${BASE}/api/cards/${d2.id}/render?mode=png&w=400`, { headers: { cookie: api.cookie } });
const buf = Buffer.from(await png.arrayBuffer());
check(png.status === 200 && buf.subarray(1, 4).toString() === 'PNG', 'drawing renders to PNG for the terminal');
const ansi = await (await fetch(`${BASE}/api/cards/${d2.id}/render?mode=ansi&cols=40`, { headers: { cookie: api.cookie } })).text();
check(ansi.includes('▀'), 'and to terminal blocks');

// Server cleans junk stroke data.
const bad = await api('POST', `/api/boards/${boardId}/cards`, { cards: [{ type: 'drawing', x: 0, y: 0, data: { strokes: [{ c: 'red', s: 9999, p: [1, 2, 0.5, 'x', 3, 4] }, { p: [] }, 'nope'], vw: -5, vh: 0 } }] });
const bd = bad.cards[0].data;
check(bd.strokes.length === 0 && bd.vw === 1, 'bad strokes are dropped by the server', JSON.stringify(bd));

// Size slider and [ ] keys.
await page.click('.toolbar [aria-label="Draw"]');
await bar('Stroke size').click();
await page.locator('.draw-size-pop input[type=range]').fill('10');
const n0 = Number(await page.locator('.draw-size-num').textContent());
await page.keyboard.press(']');
const n1 = Number(await page.locator('.draw-size-num').textContent());
await page.keyboard.press('[');
await page.keyboard.press('[');
const n2 = Number(await page.locator('.draw-size-num').textContent());
check(n0 === 10 && n1 > 10 && n2 < n1, 'size slider, with ] bigger and [ smaller', `${n0} ${n1} ${n2}`);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// Draw on an image: strokes stay on the image card, clipped to the picture, and scale with it.
const fd = new FormData();
fd.append('file', new Blob([solidPng(400, 300, [70, 110, 160])], { type: 'image/png' }), 'mini.png');
const file = (await (await fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd })).json()).file;
const imgCard = (await api('POST', `/api/boards/${boardId}/cards`, { cards: [{ type: 'image', x: 900, y: 120, w: 300, data: { fileId: file.id, caption: '' } }] })).cards[0];
await page.reload();
await page.waitForSelector(`[data-card-id="${imgCard.id}"] img`);
await sleep(300);
const imgEl = page.locator(`[data-card-id="${imgCard.id}"]`);
await imgEl.locator('.img-wrap').click();
await page.click('.float-bar [aria-label="Draw on image"]');
await page.waitForSelector('.draw-layer.on-image');
check((await page.locator('.draw-frame').count()) === 1, 'draw on image: the picture is framed, the rest dimmed');
const wb = await imgEl.locator('.img-wrap').boundingBox();
await bar('Pen').click();
await drag(page, { x: wb.x + 40, y: wb.y + 40 }, { x: wb.x + wb.width - 40, y: wb.y + wb.height - 40 }, 15);
await page.click('.draw-save');
await sleep(500);
let ink = (await api('GET', `/api/boards/${boardId}`)).cards.find((c) => c.id === imgCard.id).data.ink;
check(ink?.strokes?.length === 1 && ink.vw === 1000 && Math.abs(ink.vh - 750) <= 2, 'strokes are saved on the image card', JSON.stringify(ink && { n: ink.strokes.length, vw: ink.vw, vh: ink.vh }));
check((await imgEl.locator('.img-ink path').count()) === 1, 'the drawing shows over the image');
// Resize: the overlay keeps covering the picture.
await imgEl.locator('.img-wrap').click();
const rh = await imgEl.locator('.handle-resize').boundingBox();
await drag(page, { x: rh.x + 4, y: rh.y + 4 }, { x: rh.x + 124, y: rh.y + 4 }, 10);
await sleep(400);
const wrap2 = await imgEl.locator('.img-wrap').boundingBox();
const ink2 = await imgEl.locator('.img-ink').boundingBox();
check(wrap2.width > wb.width + 80 && Math.abs(ink2.width - wrap2.width) < 2 && Math.abs(ink2.height - wrap2.height) < 2, 'resizing the image scales its drawing');
// Reopen, erase it all, save: the ink goes away; board undo brings it back.
await page.click('.float-bar [aria-label="Draw on image"]');
await page.waitForSelector('.draw-layer.on-image');
check((await page.locator('.draw-svg path:not(.draw-dim)').count()) === 1, 'reopening shows the existing strokes');
await bar('Eraser').click();
const wb2 = await imgEl.locator('.img-wrap').boundingBox();
await drag(page, { x: wb2.x + 10, y: wb2.y + wb2.height / 2 + 10 }, { x: wb2.x + wb2.width - 10, y: wb2.y + wb2.height / 2 - 10 }, 30);
await page.click('.draw-save');
await sleep(500);
ink = (await api('GET', `/api/boards/${boardId}`)).cards.find((c) => c.id === imgCard.id).data.ink;
check(ink === null && (await imgEl.locator('.img-ink').count()) === 0, 'erasing everything removes the drawing from the image');
await page.keyboard.press('Control+z');
await sleep(500);
check((await imgEl.locator('.img-ink path').count()) === 1, 'board undo puts it back');

// Phone size: the toolbar fits on screen.
const phone = await login(browser, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
await phone.page.goto(`${BASE}/#/b/${boardId}`);
await phone.page.waitForSelector('.canvas');
await phone.page.evaluate(() => document.querySelector('[aria-label="Draw"]')?.click());
await phone.page.waitForSelector('.draw-bar');
const pb = await phone.page.locator('.draw-bar').boundingBox();
check(pb.x >= 0 && pb.x + pb.width <= 390, 'phone: drawing toolbar fits the screen', JSON.stringify(pb));
await phone.page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/step12-phone.png' : 'step12-phone.png' });
await phone.context.close();

check(!errors.length, 'no page errors', errors[0]);
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/step12.png' : 'step12.png' });
await browser.close();
done();
