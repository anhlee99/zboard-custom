// Arrow styles, image captions, "From site" sources and searching images by caption, alt, site or file name.
// Needs a server on ZB_URL started from an empty data dir.
import { api, BASE, check, done, launch, login, sleep, solidPng } from './lib.mjs';

await api('GET', '/api/me');
const holder = await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', x: 60, y: 60, title: 'Arrows and images' }] });
const boardId = holder.cards[0].child.id;

// A clip saved by the extension: the page, its alt text and the image file name come along.
const fd = new FormData();
fd.append('board_id', boardId);
fd.append('page_url', 'https://www.facebook.com/groups/minis/posts/123');
fd.append('page_title', 'Saturated palette – Facebook');
fd.append('alt', 'Bust painted with a saturated palette');
fd.append('src_url', 'https://scontent.example.net/saturated-palette.png');
fd.append('file', new Blob([solidPng(600, 500, [30, 30, 30])], { type: 'image/png' }), 'saturated-palette.png');
const { clip } = await (await fetch(BASE + '/api/clips', { method: 'POST', headers: { cookie: api.cookie }, body: fd })).json();
check(clip.data.alt === 'Bust painted with a saturated palette', 'extension clips keep the image alt text');
const { card: placed } = await api('POST', `/api/clips/${clip.id}/place`, { board_id: boardId, x: 60, y: 60 });
check(placed.data.source_url === 'https://www.facebook.com/groups/minis/posts/123' && placed.data.alt === clip.data.alt, 'placing the clip keeps the page and alt on the image card');

const made = await api('POST', `/api/boards/${boardId}/cards`, {
  cards: [
    { type: 'note', x: 700, y: 80, data: { html: '<div>From here</div>' } },
    { type: 'note', x: 1100, y: 80, data: { html: '<div>To there</div>' } },
  ],
});
const [n1, n2] = made.cards;
const { arrow } = await api('POST', `/api/boards/${boardId}/arrows`, { from_card: n1.id, to_card: n2.id });

const search = async (q) => (await api('GET', `/api/search?q=${encodeURIComponent(q)}`)).results.map((r) => r.id);
check((await search('saturated bust')).includes(placed.id), 'image found by its alt text');
check((await search('facebook')).includes(placed.id), 'image found by the site it came from');
check((await search('palette.png')).includes(placed.id) || (await search('saturated-palette')).includes(placed.id), 'image found by its file name');

const browser = await launch();
const { page } = await login(browser);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/#/b/${boardId}`);
await page.waitForSelector('.card-image img');
await sleep(400);
const img = page.locator(`[data-card-id="${placed.id}"]`);

// "From facebook.com" under the image, as a link to the page.
const src = img.locator('.img-source a');
check((await img.locator('.img-source').textContent()).trim() === 'From facebook.com' && (await src.getAttribute('href')) === placed.data.source_url && (await src.getAttribute('target')) === '_blank', 'image shows "From facebook.com" linking to the page');

// Caption: select, click "Add a caption", type, it becomes searchable.
await img.locator('.img-wrap').click();
await img.locator('.caption-add').click();
await page.keyboard.type('Red oxide skin recipe');
await page.keyboard.press('Enter');
await sleep(500);
check((await img.locator('.caption').textContent()) === 'Red oxide skin recipe', 'caption added from the "Add a caption" spot');
check((await search('oxide recipe')).includes(placed.id), 'image found by its caption');

// Arrow bar.
const hit = page.locator(`[data-arrow-id="${arrow.id}"] .arrow-hit`);
const box = await hit.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForSelector('.show-actions .item-actions [aria-label="Arrow colour"]');
check((await page.locator('.item-actions button').count()) >= 7, 'clicking an arrow shows its actions in the left panel');
const line = page.locator(`[data-arrow-id="${arrow.id}"] .arrow-line`);
await page.click('.item-actions [aria-label="Arrow colour"]');
await page.click('.action-pop [aria-label="Arrow colour #ef4444"]');
await page.click('.item-actions [aria-label="Start arrowhead"]');
await page.click('.item-actions [aria-label="End arrowhead"]');
await page.click('.item-actions [aria-label="Dashed"]');
await page.click('.item-actions [aria-label="Weight"]');
await page.click('.item-actions [aria-label="Label"]');
await page.locator('.arrow-label-input').fill('leads to');
await page.keyboard.press('Enter');
await sleep(500);
const look = await line.evaluate((e) => ({ stroke: e.style.stroke, width: e.style.strokeWidth, dash: e.getAttribute('stroke-dasharray'), start: e.getAttribute('marker-start'), end: e.getAttribute('marker-end') }));
check(look.stroke === 'rgb(239, 68, 68)', 'arrow colour changes', JSON.stringify(look));
check(look.start === 'url(#zb-head)' && !look.end, 'arrowheads move from end to start');
check(!!look.dash, 'arrow becomes dashed');
check(parseFloat(look.width) === 3.5, 'weight goes to thick', look.width);
check((await page.locator(`[data-arrow-id="${arrow.id}"] .arrow-label`).textContent()) === 'leads to', 'label set from the bar');
const saved = (await api('GET', `/api/boards/${boardId}`)).arrows.find((a) => a.id === arrow.id);
check(saved.color === '#ef4444' && saved.label === 'leads to' && saved.data.start === true && saved.data.end === false && saved.data.dashed === true && saved.data.weight === 3, 'arrow style is saved');

await page.keyboard.press('Control+z');
await sleep(400);
check((await page.locator(`[data-arrow-id="${arrow.id}"] .arrow-label`).count()) === 0, 'undo removes the label again');
await page.reload();
await page.waitForSelector('.arrows');
await sleep(400);
check((await page.locator(`[data-arrow-id="${arrow.id}"] .arrow-line`).evaluate((e) => e.getAttribute('stroke-dasharray'))) !== null, 'style survives a reload');

// Double-clicking an arrow opens the label box (no browser prompt).
const box2 = await page.locator(`[data-arrow-id="${arrow.id}"] .arrow-hit`).boundingBox();
await page.mouse.dblclick(box2.x + box2.width / 2, box2.y + box2.height / 2);
check((await page.locator('.arrow-label-input').count()) === 1, 'double-click an arrow to edit its label');
await page.keyboard.press('Escape');

check(!errors.length, 'no page errors', errors[0]);
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/step11.png' : 'step11.png' });
await browser.close();
done();
