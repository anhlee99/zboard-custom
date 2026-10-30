// Board covers, renaming by double-click, see-through PNGs and YouTube cards.
// Needs a server on ZB_URL started from an empty data dir.
import { api, BASE, center, check, cutoutPng, done, launch, login, sleep, solidPng } from './lib.mjs';

async function upload(name, buf) {
  await api('GET', '/api/me');
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'image/png' }), name);
  return (await (await fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd })).json()).file;
}

// ---------- server ----------
const cut = await upload('orc.png', cutoutPng(400, 500, [60, 140, 60]));
const flat = await upload('photo.png', solidPng(400, 300, [200, 120, 40]));
check(cut.alpha === 1, 'a PNG with a see-through background is marked as a cut-out');
check(flat.alpha === 0, 'an opaque PNG is not');

const holder = await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', x: 60, y: 60, title: 'Features' }] });
const featId = holder.cards[0].child.id;
const made = await api('POST', `/api/boards/${featId}/cards`, {
  cards: [
    { type: 'board', x: 60, y: 60, title: 'Orc, Goblin, Troll' },
    { type: 'image', x: 300, y: 60, w: 260, data: { fileId: cut.id } },
    { type: 'image', x: 600, y: 60, w: 260, data: { fileId: flat.id } },
    { type: 'link', x: 300, y: 420, w: 400, data: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s', title: 'A video' } },
  ],
});
const [orc, cutCard, flatCard, video] = made.cards;
const orcBoard = orc.child.id;

const bad = await api('PATCH', `/api/boards/${orcBoard}`, { data: { cover: { kind: 'text', value: 'TOOLONG', bg: 'red', fg: '#FFFFFF' } } });
check(bad.board.data.cover.value === 'TOOL' && bad.board.data.cover.bg === null && bad.board.data.cover.fg === '#ffffff', 'cover values are cleaned (4 letters, hex colours only)');
await api('PATCH', `/api/boards/${orcBoard}`, { data: { cover: null } });

// ---------- browser ----------
const browser = await launch();
const { page } = await login(browser);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/#/b/${featId}`);
await page.waitForSelector('.card-board');
await sleep(300);
const card = (c) => page.locator(`[data-card-id="${c.id}"]`);

// Cut-outs have no card frame.
check(await card(cutCard).evaluate((e) => e.classList.contains('cutout') && getComputedStyle(e).boxShadow === 'none' && getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)'), 'cut-out image is drawn without a card background or shadow');
check(!(await card(flatCard).evaluate((e) => e.classList.contains('cutout'))), 'normal image keeps its card');

// Cover picker.
await card(orc).locator('.board-icon').click();
await page.click('.item-actions [aria-label="Cover"]');
await page.waitForSelector('.cover-pop');
await page.click('.cover-icons [aria-label="Icon 👹"]');
await page.click('.cover-swatches [aria-label="Colour pair #e8735a #3b1d14"]');
await sleep(400);
let tile = card(orc).locator('.board-icon');
check((await tile.textContent()) === '👹', 'picking an icon shows it on the board card');
check((await tile.evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(232, 115, 90)' && (await tile.evaluate((e) => getComputedStyle(e).color)) === 'rgb(59, 29, 20)', 'a colour pair sets background and icon colour');
await page.click('.cover-tabs button:has-text("Text")');
await page.click('.cover-suggest button:has-text("OGT")');
await sleep(400);
check((await tile.textContent()) === 'OGT', 'text tab suggests initials from the board name (OGT)');
let saved = (await api('GET', `/api/boards/${featId}`)).cards.find((c) => c.id === orc.id).child.cover;
check(saved?.kind === 'text' && saved.value === 'OGT' && saved.bg === '#e8735a' && saved.fg === '#3b1d14', 'cover is saved on the server');
await page.keyboard.press('Control+z');
await sleep(400);
check((await tile.textContent()) === '👹', 'undo puts the previous cover back');
await page.click('.cover-close');
check((await page.locator('.cover-pop').count()) === 0, 'cover picker closes');
await page.reload();
await page.waitForSelector('.card-board');
check((await card(orc).locator('.board-icon').textContent()) === '👹', 'cover survives a reload');

// Double-click the board name to rename it (double-click elsewhere still opens).
await card(orc).locator('.board-title').dblclick();
await page.waitForSelector('.board-title-input');
await page.keyboard.press('Control+a');
await page.keyboard.type('Greenskins');
await page.keyboard.press('Enter');
await sleep(400);
check((await card(orc).locator('.board-title').textContent()) === 'Greenskins', 'double-clicking a board card name renames it');
check((await api('GET', `/api/boards/${orcBoard}`)).board.title === 'Greenskins', 'new name is saved');

// Rename the open board from the top bar.
await page.locator('.crumb.current').dblclick();
await page.waitForSelector('.crumb-input');
await page.keyboard.press('Control+a');
await page.keyboard.type('Feature tests');
await page.keyboard.press('Enter');
await sleep(400);
check((await page.locator('.crumb.current').textContent()) === 'Feature tests', 'double-clicking the board name in the top bar renames it');
check((await api('GET', `/api/boards/${featId}`)).board.title === 'Feature tests', 'top-bar rename is saved');

// YouTube plays inside the card.
check((await card(video).locator('.video-play').count()) === 1, 'YouTube link shows a play button');
await card(video).locator('.video-play').click();
const src = await card(video).locator('iframe').getAttribute('src');
check(/youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1.*start=65/.test(src || ''), 'play loads the video in the card, at the link time (1m5s)', src);
const vb = await card(video).locator('.link-meta').boundingBox();
await page.mouse.move(vb.x + 20, vb.y + 10);
await page.mouse.down();
for (let i = 1; i <= 15; i++) await page.mouse.move(vb.x + 20 + i * 10, vb.y + 10 - i * 4);
await page.mouse.up();
await sleep(300);
const moved = (await api('GET', `/api/boards/${featId}`)).cards.find((c) => c.id === video.id);
check(moved.x > video.x + 100, 'a playing video card can still be dragged by its title strip');
await card(video).locator('.video-stop').click();
check((await card(video).locator('iframe').count()) === 0, 'Stop goes back to the thumbnail');

check(!errors.length, 'no page errors', errors[0]);
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/step10.png' : 'step10.png' });
await browser.close();
done();
