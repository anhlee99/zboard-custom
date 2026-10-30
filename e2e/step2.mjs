// Step 2 checks: web canvas. Needs a server on ZB_URL started from an empty data dir.
import { api, center, check, done, drag, launch, login, PNG, sleep } from './lib.mjs';

const browser = await launch();
const { page, context } = await login(browser);
const tool = (label) => page.locator(`.tool[aria-label="${label}"]`);
const canvasBox = await page.locator('.canvas').boundingBox();
const at = (x, y) => ({ x: canvasBox.x + x, y: canvasBox.y + y });
const cardsOf = (type) => page.locator(`.world > .card-${type}`);

// --- create each card type by dragging from the toolbar ---
await drag(page, await center(tool('Note')), at(150, 120));
await page.keyboard.type('Hello note');
await page.keyboard.press('Escape');

await drag(page, await center(tool('To-do')), at(450, 120));
await page.keyboard.type('Groceries');
await page.keyboard.press('Enter');
await page.keyboard.type('milk');
await page.mouse.click(at(1100, 700).x, at(1100, 700).y);

await drag(page, await center(tool('Link')), at(750, 120));
await page.keyboard.type('http://localhost:3000/');
await page.keyboard.press('Enter');

await drag(page, await center(tool('Board')), at(150, 420));
await page.keyboard.type('Minis');
await page.keyboard.press('Enter');

await drag(page, await center(tool('Column')), at(450, 420));
await page.keyboard.type('Backlog');
await page.keyboard.press('Enter');

const chooser = page.waitForEvent('filechooser');
await drag(page, await center(tool('Image')), at(900, 420));
await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });

await page.waitForSelector('.card-image img');
await page.waitForFunction(() => document.querySelector('.card-link .link-title')?.textContent === 'ZBoard', null, { timeout: 15000 }).catch(() => {});
await sleep(800);

for (const t of ['note', 'todo', 'link', 'board', 'column', 'image']) check((await cardsOf(t).count()) === 1, `toolbar created a ${t} card`);
check((await page.locator('.card-note .note-body').textContent()) === 'Hello note', 'note text typed');
check((await page.locator('.card-link .link-title').textContent()) === 'ZBoard', 'link preview fetched title');

const before = await page.evaluate(() => [...document.querySelectorAll('.world > .card')].map((c) => `${c.className.match(/card-(\w+)/)[1]}@${c.style.left},${c.style.top}`).sort().join(' '));
await page.reload();
await page.waitForSelector('.card-image img');
await sleep(500);
const after = await page.evaluate(() => [...document.querySelectorAll('.world > .card')].map((c) => `${c.className.match(/card-(\w+)/)[1]}@${c.style.left},${c.style.top}`).sort().join(' '));
check(before === after, 'reload: every card still there, in place', `${before} vs ${after}`);
check((await page.locator('.todo-text').first().inputValue()) === 'milk', 'reload: to-do item kept');

// --- drag the note into the column, then onto the board tile ---
await drag(page, await center(page.locator('.card-note')), await center(page.locator('.card-column .col-body')));
await sleep(400);
check((await page.locator('.card-column .card-note').count()) === 1, 'note dropped into column');
await drag(page, await center(page.locator('.card-column .card-note')), await center(page.locator('.card-board .board-icon')));
await sleep(500);
check((await page.locator('.card-note').count()) === 0, 'note dragged onto board tile leaves this board');
await page.locator('.card-board .board-icon').dblclick();
await page.waitForFunction(() => location.hash.startsWith('#/b/') && !location.hash.includes('root'));
await page.waitForSelector('.card-note');
check((await page.locator('.card-note .note-body').textContent()) === 'Hello note', 'note found inside the child board');
const crumbs = (await page.locator('.crumb').allTextContents()).join('/');
check(crumbs === 'Home/Minis', 'breadcrumbs show Home/Minis', crumbs);
await page.click('.logo');
await page.waitForSelector('.card-todo');

// --- arrow, delete, undo ---
await page.locator('.card-todo .todo-body').click({ position: { x: 200, y: 70 } });
const handle = page.locator('.card-todo .handle-arrow');
await drag(page, await center(handle), await center(page.locator('.card-link')));
await sleep(500);
check((await page.locator('.arrow-line:not(.temp)').count()) === 1, 'arrow drawn between cards');
await page.locator('.card-link .link-meta').click();
await page.keyboard.press('Delete');
await sleep(500);
check((await page.locator('.card-link').count()) === 0 && (await page.locator('.arrow-line').count()) === 0, 'delete removes card and its arrow');
await page.keyboard.press('Control+z');
await page.waitForSelector('.card-link');
await sleep(500);
check((await page.locator('.card-link').count()) === 1 && (await page.locator('.arrow-line').count()) === 1, 'undo brings card and arrow back');
const board = await api('GET', '/api/boards/root');
check(board.arrows.length === 1 && board.cards.some((c) => c.type === 'link'), 'undo restored on the server too');

// --- move undo ---
const todo = page.locator('.world > .card-todo');
const left0 = await todo.evaluate((e) => e.style.left);
await drag(page, await center(page.locator('.card-todo .todo-add')).then((p) => ({ x: p.x + 80, y: p.y })), at(1100, 300));
await sleep(300);
const left1 = await todo.evaluate((e) => e.style.left);
await page.keyboard.press('Control+z');
await sleep(500);
check(left1 !== left0 && (await todo.evaluate((e) => e.style.left)) === left0, 'undo puts a moved card back', `${left0} ${left1}`);

// --- live sync between two contexts ---
const second = await login(browser);
await second.page.waitForSelector('.card-todo');
const p = await center(page.locator('.card-todo .todo-title'));
const t0 = Date.now();
await drag(page, { x: p.x + 100, y: p.y - 4 }, { x: p.x + 100 + 160, y: p.y + 80 });
const want = await page.locator('.world > .card-todo').evaluate((e) => e.style.left);
await second.page.waitForFunction((w) => document.querySelector('.world > .card-todo')?.style.left === w, want, { timeout: 3000 }).catch(() => {});
const ms = Date.now() - t0;
check((await second.page.locator('.world > .card-todo').evaluate((e) => e.style.left)) === want && ms < 1500, `move shows in second browser (${ms} ms after drag)`);

// --- keyboard: select all, zoom ---
await page.mouse.click(at(1200, 750).x, at(1200, 750).y);
await page.keyboard.press('Control+a');
check((await page.locator('.world > .card.selected').count()) === (await page.locator('.world > .card').count()), 'Ctrl+A selects all');
await page.keyboard.press('Escape');
await page.keyboard.press('+');
check((await page.locator('.zoom-pct').textContent()) === '125%', '+ zooms in');
await page.keyboard.press('0');
check((await page.locator('.zoom-pct').textContent()) === '100%', '0 resets zoom');

// --- phone size smoke ---
const phone = await login(browser, { width: 390, height: 844 });
await phone.page.waitForSelector('.card-todo');
check(await phone.page.locator('.canvas').isVisible(), 'phone size: canvas renders');
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/step2-desktop.png' : 'step2-desktop.png' });

await browser.close();
done();
