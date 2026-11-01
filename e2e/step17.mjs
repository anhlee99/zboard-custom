// Arrange: a messy multi-selection becomes a tidy grid in reading order; undo puts it back.
// Needs a server on ZB_URL started from an empty data dir.
import { api, BASE, check, done, launch, login, sleep } from './lib.mjs';

const holder = await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', title: 'Arrange', x: 60, y: 60 }] });
const boardId = holder.cards[0].data.boardId;
// Six boards overlapping like a quick drop: roughly two rows, with one sitting across both.
const spots = [
  [100, 100], [240, 100], [310, 140],
  [100, 220], [235, 225], [360, 225],
];
const { cards } = await api('POST', `/api/boards/${boardId}/cards`, { cards: spots.map(([x, y], i) => ({ type: 'board', title: `B${i + 1}`, x, y })) });
const ids = cards.map((c) => c.id);
const note = (await api('POST', `/api/boards/${boardId}/cards`, { cards: [{ type: 'note', x: 900, y: 600, data: { html: '<p>not selected</p>' } }] })).cards[0];

const browser = await launch();
const { page } = await login(browser);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/#/b/${boardId}`);
await page.waitForSelector('[data-card-id]');
await sleep(500);

const boxes = async () => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await page.locator(`[data-card-id="${id}"]`).boundingBox()])));
const select = async (list) => {
  for (const [i, id] of list.entries()) await page.locator(`[data-card-id="${id}"] .card-title, [data-card-id="${id}"]`).first().click({ modifiers: i ? ['Shift'] : [], position: { x: 6, y: 6 } });
  await sleep(200);
};

await select(ids);
check((await page.locator('[aria-label="Arrange in a grid"]').count()) === 1, 'Arrange shows in the panel for several cards');
await page.click('[aria-label="Arrange in a grid"]');
await sleep(800);

const saved = Object.fromEntries((await api('GET', `/api/boards/${boardId}`)).cards.map((c) => [c.id, c]));
const at = ids.map((id) => [saved[id].x, saved[id].y]);
const xs = [...new Set(at.map(([x]) => x))];
const ys = [...new Set(at.map(([, y]) => y))];
check(xs.length === 3 && ys.length === 2, 'six cards land on a 3 x 2 grid', JSON.stringify(at));
check(at[0][0] === 100 && at[0][1] === 100, 'the grid starts at the selection’s top-left corner', JSON.stringify(at[0]));
const order = [...ids].sort((a, b) => saved[a].y - saved[b].y || saved[a].x - saved[b].x);
check(order.join() === ids.join(), 'reading order is kept (B1…B6)', order.map((id) => saved[id].data?.boardId && cards.find((c) => c.id === id).child.title).join(' '));
const b = await boxes();
const overlap = ids.some((p) => ids.some((q) => p !== q && b[p].x < b[q].x + b[q].width && b[q].x < b[p].x + b[p].width && b[p].y < b[q].y + b[q].height && b[q].y < b[p].y + b[p].height));
check(!overlap, 'no cards overlap after arranging');
check(saved[note.id].x === 900 && saved[note.id].y === 600, 'cards outside the selection stay put');

// Undo puts everything back.
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
await sleep(800);
const back = Object.fromEntries((await api('GET', `/api/boards/${boardId}`)).cards.map((c) => [c.id, c]));
check(ids.every((id, i) => back[id].x === spots[i][0] && back[id].y === spots[i][1]), 'Ctrl+Z restores the old spots');

// Three in a row stay a row.
await select(ids.slice(0, 3));
await page.click('[aria-label="Arrange in a grid"]');
await sleep(800);
const row = (await api('GET', `/api/boards/${boardId}`)).cards.filter((c) => ids.slice(0, 3).includes(c.id));
check(new Set(row.map((c) => c.y)).size === 1, 'a selection in one row stays one row', JSON.stringify(row.map((c) => [c.x, c.y])));

// One card: no Arrange.
await page.keyboard.press('Escape');
await select([ids[5]]);
check((await page.locator('[aria-label="Arrange in a grid"]').count()) === 0, 'no Arrange for a single card');
check(!errors.length, 'no page errors', errors.join(' | '));

await browser.close();
done();
