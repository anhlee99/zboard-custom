// Colour cards: swatch + hex + name, the Color tool, editing, the eyedropper ("Pick a colour…" on an
// image), search, and the server's cleaning. Needs a server on ZB_URL started from an empty data dir.
import { api, BASE, check, done, launch, login, showTools, sleep, solidPng } from './lib.mjs';

await api('GET', '/api/me');
const fd = new FormData();
fd.append('file', new Blob([solidPng(400, 300, [217, 138, 92])], { type: 'image/png' }), 'mini.png');
const file = (await (await fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd })).json()).file;
const holder = await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', x: 60, y: 60, title: 'Palette' }] });
const boardId = holder.cards[0].child.id;
const [img] = (await api('POST', `/api/boards/${boardId}/cards`, { cards: [{ type: 'image', x: 600, y: 80, w: 300, data: { fileId: file.id } }] })).cards;
const colours = async () => (await api('GET', `/api/boards/${boardId}`)).cards.filter((c) => c.type === 'color');

const bad = (await api('POST', `/api/boards/${boardId}/cards`, { cards: [{ type: 'color', x: 0, y: 900, data: { hex: 'red', name: 'x'.repeat(200) } }] })).cards[0];
check(bad.data.hex === '#ecbc1c' && bad.data.name.length === 60, 'server keeps hex codes only and short names');
await api('POST', '/api/cards/delete', { ids: [bad.id] });

const browser = await launch();
const { page } = await login(browser);
// Stand-in for the browser's eyedropper (it needs a real person to click the screen).
await page.addInitScript(() => {
  window.EyeDropper = class {
    open() {
      return Promise.resolve({ sRGBHex: '#d98a5c' });
    }
  };
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/#/b/${boardId}`);
await page.reload(); // a hash change alone does not run the init script
await page.waitForSelector('.card-image img');
await sleep(300);

// The Color tool adds a colour card, open for editing.
await showTools(page);
await page.click('.tb-tools [aria-label="Color"]');
await page.waitForSelector('.card-color .color-hex-input');
check(await page.evaluate(() => document.activeElement?.classList.contains('color-hex-input')), 'Color tool adds a colour card with the hex box ready');
await page.keyboard.press('Control+a');
await page.keyboard.type('2f4f4f');
await page.keyboard.press('Enter');
await sleep(400);
let list = await colours();
check(list.length === 1 && list[0].data.hex === '#2f4f4f', 'typing a hex code (without #) sets the colour', JSON.stringify(list.map((c) => c.data)));
const card = page.locator('.card-color').first();
check((await card.locator('.color-swatch').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(47, 79, 79)', 'the swatch shows the colour');
await page.mouse.click(1300, 700);
await sleep(300);
check((await card.locator('.color-hex').textContent()) === '#2F4F4F' && (await card.locator('.color-name').textContent()) === 'Dark Slate Gray', 'the card shows the hex code and a colour name');

// Rename it.
await card.dblclick();
await card.locator('.color-name-input').fill('Skin shadow');
await page.keyboard.press('Enter');
await page.mouse.click(1300, 700);
await sleep(400);
check((await colours())[0].data.name === 'Skin shadow' && (await card.locator('.color-name').textContent()) === 'Skin shadow', 'a typed name replaces the suggested one');
const search = async (q) => (await api('GET', `/api/search?q=${encodeURIComponent(q)}`)).results.map((r) => r.id);
check((await search('skin shadow')).includes(list[0].id) && (await search('2f4f4f')).includes(list[0].id), 'colour cards are found by name and by hex');

// Eyedropper on an image: the picked colour lands beside it.
await page.locator(`[data-card-id="${img.id}"] .img-wrap`).click();
await page.click('.item-actions [aria-label="More actions"]');
await page.locator('.pop-menu .pop-row', { hasText: 'Pick a colour' }).click();
await sleep(600);
list = await colours();
const picked = list.find((c) => c.data.hex === '#d98a5c');
check(!!picked && picked.x > img.x + 300 && Math.abs(picked.y - img.y) < 5, '"Pick a colour…" on an image adds the picked colour beside it', JSON.stringify(picked && { x: picked.x, y: picked.y }));
check((await page.locator(`[data-card-id="${picked?.id}"] .color-name`).textContent()) === 'Peru', 'with a suggested name');

// The card's own Color (background) action is not offered on a colour card.
await page.locator(`[data-card-id="${picked.id}"]`).click();
await sleep(300);
check((await page.locator('.item-actions [aria-label="Colour"]').count()) === 0, 'colour cards skip the card-background picker');

check(!errors.length, 'no page errors', errors[0]);
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/step14.png' : 'step14.png' });
await browser.close();
done();
