// Step 5 checks: context menu, clipboard across boards and tabs, tooltips.
import { api, center, check, done, launch, login, sleep } from './lib.mjs';

const root = await api('GET', '/api/boards/root');
if (root.cards.length) await api('POST', '/api/cards/delete', { ids: root.cards.map((c) => c.id) });
const { cards } = await api('POST', '/api/boards/root/cards', {
  cards: [
    { type: 'note', x: 40, y: 40, w: 200, data: { html: 'Alpha' } },
    { type: 'note', x: 280, y: 40, w: 200, data: { html: 'Bravo' } },
    { type: 'note', x: 520, y: 40, w: 200, data: { html: 'Charlie' } },
    { type: 'board', x: 40, y: 260, title: 'Target' },
  ],
});
const [a, b, c, boardCard] = cards;
const target = boardCard.data.boardId;
await api('POST', `/api/boards/${a.id ? 'root' : ''}/arrows`, { from_card: a.id, to_card: b.id });

const browser = await launch();
const { page, context } = await login(browser);
await page.waitForSelector('.card-note');
const canvas = await page.locator('.canvas').boundingBox();
const at = (x, y) => ({ x: canvas.x + x, y: canvas.y + y });
const transform = () => page.locator('.world').evaluate((e) => e.style.transform);
const card = (id) => page.locator(`[data-card-id="${id}"]`);

// --- right-drag pans, still right-click opens ---
const t0 = await transform();
await page.mouse.move(at(900, 500).x, at(900, 500).y);
await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 8; i++) await page.mouse.move(at(900 - i * 10, 500 - i * 5).x, at(900 - i * 10, 500 - i * 5).y);
await page.mouse.up({ button: 'right' });
await sleep(200);
check((await transform()) !== t0 && (await page.locator('.ctx-menu').count()) === 0, 'right-drag pans without opening the menu');
await page.mouse.click(at(900, 600).x, at(900, 600).y, { button: 'right' });
await page.waitForSelector('.ctx-menu');
const emptyItems = await page.locator('.ctx-menu .ctx-label').allTextContents();
check(['Paste', 'Note', 'To-do', 'Link', 'Image', 'Board', 'Column', 'Select all', 'Fit to screen'].every((l) => emptyItems.includes(l)), 'still right-click on empty space opens the add menu', emptyItems.join(','));
await page.keyboard.press('Escape');
check((await page.locator('.ctx-menu').count()) === 0, 'Esc closes the menu');

// add a note at the clicked point
await page.mouse.click(at(1000, 650).x, at(1000, 650).y, { button: 'right' });
await page.locator('.ctx-item', { hasText: 'Note' }).click();
await page.keyboard.type('From menu');
await page.keyboard.press('Escape');
await sleep(500);
const fm = (await api('GET', '/api/boards/root')).cards.find((x) => x.data.html === 'From menu');
const fmBox = await page.locator('.card-note', { hasText: 'From menu' }).boundingBox();
check(fm && Math.abs(fmBox.x - at(1000, 650).x) < 30 && Math.abs(fmBox.y - at(1000, 650).y) < 30, 'menu adds a card at the clicked point');
await api('POST', '/api/cards/delete', { ids: [fm.id] });
await sleep(300);

// outside click closes
await page.mouse.click(at(900, 600).x, at(900, 600).y, { button: 'right' });
await page.waitForSelector('.ctx-menu');
await page.mouse.click(at(200, 700).x, at(200, 700).y);
check((await page.locator('.ctx-menu').count()) === 0, 'outside click closes the menu');

// --- card menu: move to board via nested submenu, undo ---
await card(c.id).click({ button: 'right' });
await page.waitForSelector('.ctx-menu');
const cardItems = await page.locator('.ctx-menu .ctx-label').allTextContents();
check(['Edit', 'Copy', 'Cut', 'Paste', 'Duplicate', 'Move to board', 'Colour', 'Bring to front', 'Send to back', 'Delete'].every((l) => cardItems.includes(l)), 'card menu has every action', cardItems.join(','));
await page.locator('.ctx-item', { hasText: 'Move to board' }).hover();
await page.locator('.ctx-menu[data-depth="1"] .ctx-item', { hasText: 'Home' }).hover();
await page.locator('.ctx-menu[data-depth="2"] .ctx-item', { hasText: 'Target' }).click();
await sleep(500);
check((await api('GET', `/api/boards/${target}`)).cards.some((x) => x.id === c.id) && (await card(c.id).count()) === 0, 'Move to board ▸ Home ▸ Target moves the card');
await page.keyboard.press('Control+z');
await sleep(600);
check((await api('GET', '/api/boards/root')).cards.some((x) => x.id === c.id) && (await card(c.id).count()) === 1, 'undo brings it back');

// colour submenu
await card(a.id).click({ button: 'right' });
await page.locator('.ctx-item', { hasText: 'Colour' }).hover();
await page.locator('.ctx-menu[data-depth="1"] .ctx-item', { hasText: 'Green' }).click();
await sleep(400);
const aCls = await card(a.id).getAttribute('class');
const aSrv = (await api('GET', '/api/boards/root')).cards.find((x) => x.id === a.id);
check(aCls.includes('c-green') && aSrv.color === 'green', 'Colour ▸ Green colours the card', `${aCls} / server ${aSrv.color}`);

// --- submenus flip near the screen edge ---
const vw = page.viewportSize().width;
await page.mouse.click(vw - 30, at(0, 700).y, { button: 'right' });
await page.waitForSelector('.ctx-menu');
const m0 = await page.locator('.ctx-menu[data-depth="0"]').boundingBox();
check(m0.x + m0.width <= vw && m0.x < vw - 30, 'menu flips left at the right edge');
await page.keyboard.press('Escape');
await page.locator('.world').evaluate(() => {}); // noop
await page.mouse.move(at(600, 300).x, at(600, 300).y);
// put Charlie near the right edge and open its Move submenu
await api('PATCH', '/api/cards', { cards: [{ id: c.id, x: Math.round(vw - canvas.x - 260 - (await page.locator('.world').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).e))) }] });
await sleep(500);
await card(c.id).click({ button: 'right', position: { x: 180, y: 10 } });
await page.locator('.ctx-item', { hasText: 'Move to board' }).hover();
await page.waitForSelector('.ctx-menu[data-depth="1"]');
const m1 = await page.locator('.ctx-menu[data-depth="1"]').boundingBox();
const p1 = await page.locator('.ctx-menu[data-depth="0"]').boundingBox();
check(m1.x + m1.width <= vw && m1.x < p1.x, 'submenu flips to the left near the edge', `${JSON.stringify(m1)} parent ${JSON.stringify(p1)}`);
await page.keyboard.press('Escape');

// --- copy 3 cards on board A, paste in board B in another tab ---
await card(a.id).click();
await card(b.id).click({ modifiers: ['Shift'] });
await card(c.id).click({ modifiers: ['Shift'] });
check((await page.locator('.card.selected').count()) === 3, 'three cards selected');
await page.keyboard.press('Control+c');
await sleep(300);
const tab2 = await context.newPage();
await tab2.goto(`${page.url().split('#')[0]}#/b/${target}`);
await tab2.waitForSelector('.canvas');
await sleep(500);
const c2 = await tab2.locator('.canvas').boundingBox();
await tab2.mouse.move(c2.x + 300, c2.y + 300);
await tab2.keyboard.press('Control+v');
await sleep(1200);
const tgt = await api('GET', `/api/boards/${target}`);
const pasted = tgt.cards.filter((x) => ['Alpha', 'Bravo', 'Charlie'].includes(x.data.html));
check(pasted.length === 3 && pasted.every((x) => ![a.id, b.id, c.id].includes(x.id)), 'paste in the other tab creates 3 new cards on board B');
check(tgt.arrows.length === 1, 'the arrow between copied cards comes along');
check((await api('GET', '/api/boards/root')).cards.filter((x) => ['Alpha', 'Bravo', 'Charlie'].includes(x.data.html)).length === 3, 'board A is unchanged');
const minX = Math.min(...pasted.map((x) => x.x));
const tv = await tab2.locator('.world').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform));
check(Math.abs(minX - (300 - tv.e) / tv.a) < 5, 'pasted at the pointer');

// --- cut, paste elsewhere → originals move; undo puts them back ---
await page.bringToFront();
await page.keyboard.press('Escape');
await card(a.id).click();
await card(b.id).click({ modifiers: ['Shift'] });
await page.keyboard.press('Control+x');
await sleep(200);
check((await page.locator('.card.cut').count()) === 2, 'cut dims the cards until pasted');
await tab2.bringToFront();
await tab2.mouse.move(c2.x + 600, c2.y + 500);
await tab2.keyboard.press('Control+v');
await sleep(1200);
const tgt2 = await api('GET', `/api/boards/${target}`);
check(
  [a.id, b.id].every((id) => tgt2.cards.some((x) => x.id === id)),
  'paste after cut moves the originals to board B',
  `target now: ${tgt2.cards.map((x) => x.id + ':' + (x.data.html || x.type)).join(', ')}; a=${a.id} b=${b.id}`
);
await page.bringToFront();
await sleep(500);
check((await card(a.id).count()) === 0 && (await page.locator('.card.cut').count()) === 0, 'they leave board A in the first tab, dimming cleared');
await tab2.bringToFront();
await tab2.keyboard.press('Control+z');
await sleep(1200);
const back = await api('GET', '/api/boards/root');
check([a.id, b.id].every((id) => back.cards.some((x) => x.id === id)), 'undo moves them back to board A');
await tab2.close();

// --- copying a board card deep-copies its board ---
await page.bringToFront();
await page.reload();
await page.waitForSelector('.card-board');
await card(boardCard.id).click();
await page.keyboard.press('Control+c');
await page.mouse.move(at(900, 400).x, at(900, 400).y);
await page.keyboard.press('Control+v');
await sleep(1000);
const boards = (await api('GET', '/api/boards')).boards.filter((x) => x.title === 'Target');
const copyId = boards.find((x) => x.id !== target)?.id;
check(boards.length === 2 && (await api('GET', `/api/boards/${copyId}`)).cards.length === tgt2.cards.length - 2, 'pasting a board card deep-copies its board');

// --- tooltips ---
const tips = [];
for (const btn of await page.locator('.toolbar [data-tip], .topbar [data-tip], .zoom-ctl [data-tip]').all()) {
  if (!(await btn.isVisible())) continue;
  await btn.hover();
  await sleep(550);
  // The pseudo-element's box: computed left/top (resolved px) plus its translate().
  const info = await btn.evaluate((el) => {
    const s = getComputedStyle(el, '::after');
    const r = el.getBoundingClientRect();
    const m = new DOMMatrix(s.transform === 'none' ? undefined : s.transform);
    const w = parseFloat(s.width) + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
    const h = parseFloat(s.height) + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
    const x = r.x + parseFloat(s.left) + m.e;
    const y = r.y + parseFloat(s.top) + m.f;
    return { tip: el.dataset.tip, content: s.content, opacity: s.opacity, box: { x, y, w, h } };
  });
  tips.push(info);
}
const bad = tips.filter((t) => t.content !== `"${t.tip}"` || Number(t.opacity) < 0.99);
check(tips.length >= 10 && !bad.length, `every toolbar/topbar button shows its tooltip (${tips.length})`, JSON.stringify(bad[0]));
const vh = page.viewportSize().height;
const outside = tips.filter(({ box: b }) => b.x < 0 || b.y < 0 || b.x + b.w > vw || b.y + b.h > vh);
check(!outside.length, 'no tooltip runs off the screen', JSON.stringify(outside[0]));
await card(c.id).click();
const cb = await card(c.id).boundingBox();
const hb = await page.locator(`[data-card-id="${c.id}"] .handle-resize`).boundingBox();
check(Math.abs(hb.x + hb.width - (cb.x + cb.width + 6)) < 3 && Math.abs(hb.y + hb.height - (cb.y + cb.height + 6)) < 3, 'resize handle still sits on the corner');
await page.locator(`[data-card-id="${c.id}"] .handle-resize`).hover();
await sleep(550);
check((await page.locator(`[data-card-id="${c.id}"] .handle-resize`).evaluate((e) => getComputedStyle(e, '::after').content)) === '"Resize"', 'resize handle has a tooltip');
await page.locator('.toolbar .tool').first().hover();
await sleep(550);
await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step5-tooltip.png' });

await browser.close();
done();
