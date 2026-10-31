// Action panel (left toolbar flips to the selected card's actions), labels, image crop/rotate,
// the More menu (download, replace) and the phone bottom bar. Needs a server on ZB_URL, empty data dir.
import { api, BASE, check, done, launch, login, noisePng, sleep, solidPng } from './lib.mjs';

async function upload(name, buf) {
  await api('GET', '/api/me');
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'image/png' }), name);
  return (await (await fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd })).json()).file;
}
const photo = await upload('ogre.png', noisePng(800, 600, 3));
const other = await upload('other.png', solidPng(300, 300, [200, 60, 60]));
const holder = await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', x: 60, y: 60, title: 'Panel' }] });
const boardId = holder.cards[0].child.id;
const made = await api('POST', `/api/boards/${boardId}/cards`, {
  cards: [
    { type: 'image', x: 80, y: 60, w: 400, data: { fileId: photo.id, caption: '' } },
    { type: 'note', x: 600, y: 60, data: { html: '<div>Skin recipe</div>' } },
    { type: 'note', x: 600, y: 260, data: { html: '<div>Metal recipe</div>' } },
  ],
});
const [img, n1, n2] = made.cards;
const fresh = async (cardOrId) => {
  const id = cardOrId.id || cardOrId;
  return (await api('GET', `/api/boards/${boardId}`)).cards.find((c) => c.id === id);
};

const browser = await launch();
const { page } = await login(browser);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/#/b/${boardId}`);
await page.waitForSelector('.card-image img');
await sleep(300);
const card = (c) => page.locator(`[data-card-id="${c.id}"]`);
const act = (label) => page.locator(`.item-actions [aria-label="${label}"]`);

// The panel flips in on select and back on a click outside.
check((await page.locator('.toolbar.show-actions').count()) === 0, 'tools show when nothing is selected');
await card(img).locator('.img-wrap').click();
await sleep(350);
check((await page.locator('.toolbar.show-actions').count()) === 1, 'selecting an image flips the toolbar to its actions');
const labels = await page.locator('.item-actions .tool span').allTextContents();
check(JSON.stringify(labels) === JSON.stringify(['Done', 'Draw on', 'Edit', 'Caption', 'Color', 'Labels', 'More']), 'image actions: Draw on, Edit, Caption, Color, Labels, More', JSON.stringify(labels));
check(await page.locator('.tb-tools').evaluate((e) => getComputedStyle(e).visibility === 'hidden'), 'the tools are tucked away meanwhile');
check((await page.locator('.item-actions .tool.open, .item-actions .tool.on').count()) === 0, 'no action looks pressed until used');
await page.mouse.click(1300, 700);
await sleep(350);
check((await page.locator('.toolbar.show-actions').count()) === 0 && (await page.locator('.tb-tools .tool').first().isVisible()), 'clicking empty board rolls back to the tools');

// Colour from the panel.
await card(n1).click();
await act('Colour').click();
check((await page.locator('.action-pop .cp-tabs button').allTextContents()).join('|') === 'Background|Top strip', 'Color opens the picker with Background and Top strip');
await page.locator('.action-pop [aria-label="Colour #ffd44f"]').click();
await sleep(400);
check((await fresh(n1)).color === '#ffd44f' && (await card(n1).evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(255, 212, 79)', 'Background colour fills the card');
await page.locator('.action-pop .cp-tabs button', { hasText: 'Top strip' }).click();
await page.locator('.action-pop [aria-label="Colour #5a86f7"]').click();
await sleep(400);
check((await fresh(n1)).data.strip === '#5a86f7' && (await card(n1).locator('.card-strip').count()) === 1, 'Top strip draws a coloured band across the card');
await page.locator('.action-pop [aria-label="No colour"]').click();
await sleep(400);
check(!(await fresh(n1)).data.strip && (await card(n1).locator('.card-strip').count()) === 0, 'No colour removes the strip');
await page.keyboard.press('Control+z');
await sleep(400);
check((await fresh(n1)).data.strip === '#5a86f7', 'undo brings the strip back');
// A see-through picture gets a coloured background behind it; a custom colour joins the recent row.
await page.mouse.click(1300, 700);
await card(img).locator('.img-wrap').click();
await act('Colour').click();
await page.locator('.action-pop .cp-custom input').fill('#123456');
await sleep(700);
check((await fresh(img)).color === '#123456', 'a custom colour is applied');
check((await page.locator('.action-pop .cp-recent [aria-label="Colour #123456"]').count()) === 1, 'and shows up in the recent colours');
await page.locator('.action-pop [aria-label="No colour"]').click();
await sleep(400);
check(!(await fresh(img)).color, 'No colour clears the background');
await page.mouse.click(1300, 700);

// Labels: create, reuse, show as chips, search, apply to several cards.
await card(img).locator('.img-wrap').click();
await act('Labels').click();
await page.locator('.label-pop input').fill('ab');
await page.keyboard.press('Enter');
await page.locator('.label-pop input').fill('Ogre skin');
await page.keyboard.press('Enter');
await sleep(500);
check(JSON.stringify((await fresh(img)).data.labels) === '["ab","Ogre skin"]', 'labels created from the picker', JSON.stringify((await fresh(img)).data.labels));
const chips = await card(img).locator('.img-wrap .label-chip').allTextContents();
check(JSON.stringify(chips) === '["ab","Ogre skin"]', 'labels show as chips on the picture');
const search = async (q) => (await api('GET', `/api/search?q=${encodeURIComponent(q)}`)).results.map((r) => r.id);
check((await search('ogre skin')).includes(img.id), 'search finds the card by label');
check((await api('GET', '/api/search?tag=ogre-skin')).results.some((r) => r.id === img.id), 'a label is also a #tag');
check((await api('GET', '/api/labels')).labels.some((l) => l.label === 'ab'), 'labels in use are listed for the picker');
await page.keyboard.press('Escape');
await page.mouse.click(1300, 700);
await card(n1).click();
await card(n2).click({ modifiers: ['Shift'] });
await act('Labels').click();
await page.locator('.label-pop input').fill('a');
await page.locator('.label-pop [aria-label="Label ab"]').click();
await sleep(500);
check(((await fresh(n1)).data.labels || []).includes('ab') && ((await fresh(n2)).data.labels || []).includes('ab'), 'a label can be put on several cards at once');
await page.keyboard.press('Control+z');
await sleep(500);
check(!((await fresh(n1)).data.labels || []).includes('ab'), 'undo takes it off again');
await page.mouse.click(1300, 700);

// Clicking a chip searches for that label.
await card(img).locator('.label-chip', { hasText: 'Ogre skin' }).click();
await page.waitForSelector('.search-panel');
check((await page.locator('.search-panel input').inputValue()) === '#ogre-skin', 'clicking a label chip searches for it');
await page.keyboard.press('Escape');

// Crop and rotate (kept on the card; the file is untouched).
const r0 = await card(img).locator('.img-wrap').boundingBox();
await card(img).locator('.img-wrap').click();
await act('Edit image').click();
await page.waitForSelector('.img-edit');
const stage = await page.locator('.img-edit-stage').boundingBox();
const se = await page.locator('.crop-handle.h-se').boundingBox();
await page.mouse.move(se.x + 8, se.y + 8);
await page.mouse.down();
await page.mouse.move(se.x + 8 - stage.width / 2, se.y + 8 - stage.height / 4, { steps: 8 });
await page.mouse.up();
await page.click('.img-edit [aria-label="Rotate right"]');
await page.click('.img-edit-save');
await sleep(500);
const d = (await fresh(img)).data;
check(d.rotate === 90 && d.crop && Math.abs(d.crop.w - 0.75) < 0.05 && Math.abs(d.crop.h - 0.5) < 0.05, 'crop and rotation are saved on the card', JSON.stringify({ rotate: d.rotate, crop: d.crop }));
const r1 = await card(img).locator('.img-wrap').boundingBox();
// Cropped to a 400x450 piece (half the width, three quarters of the height), then turned a quarter: 450x400.
check(Math.abs(r1.height / r1.width - 400 / 450) < 0.03, 'the card shows the cropped, rotated picture', `${r0.width}x${r0.height} -> ${r1.width}x${r1.height}`);
await page.keyboard.press('Control+z');
await sleep(500);
check(!(await fresh(img)).data.crop && !(await fresh(img)).data.rotate, 'undo restores the uncropped picture');

// More: open, download original, replace image.
await card(img).locator('.img-wrap').click();
await act('More actions').click();
const rows = await page.locator('.pop-menu .pop-row').allTextContents();
check(['Open full size', 'Download original', 'Replace image…', 'Duplicate', 'Delete'].every((r) => rows.some((x) => x.startsWith(r))), 'More menu: open, download, replace, duplicate, delete', JSON.stringify(rows));
const dl = page.locator('.pop-menu a', { hasText: 'Download original' });
check((await dl.getAttribute('href')) === `/files/${photo.id}?original=1` && (await dl.getAttribute('download')) === 'ogre.png', 'Download links to the original file');
const chooser = page.waitForEvent('filechooser');
await page.locator('.pop-menu .pop-row', { hasText: 'Replace image' }).click();
await (await chooser).setFiles({ name: 'other.png', mimeType: 'image/png', buffer: solidPng(300, 300, [200, 60, 60]) });
await sleep(800);
const replaced = await fresh(img);
check(replaced.data.fileId !== photo.id && JSON.stringify(replaced.data.labels) === '["ab","Ogre skin"]', 'Replace swaps the picture and keeps the labels');
await page.keyboard.press('Control+z');
await sleep(500);
check((await fresh(img)).data.fileId === photo.id, 'undo brings the old picture back');

// Caption from the panel.
await card(img).locator('.img-wrap').click();
await act('Caption').click();
await page.keyboard.type('Ogre palette');
await page.keyboard.press('Enter');
await sleep(400);
check((await fresh(img)).data.caption === 'Ogre palette', 'Caption opens the caption box');

check(!errors.length, 'no page errors', errors[0]);
await card(img).locator('.img-wrap').click();
await sleep(350);
await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/step13.png' : 'step13.png' });

// Phone: the bottom bar flips to the actions, pop-ups open above it.
const phone = await login(browser, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
await phone.page.goto(`${BASE}/#/b/${boardId}`);
await phone.page.waitForSelector('.card-image img');
await phone.page.evaluate((id) => document.querySelector(`[data-card-id="${id}"] .img-wrap`).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', clientX: 100, clientY: 200, button: 0 })), img.id);
await phone.page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })));
await sleep(400);
const bar = await phone.page.locator('.item-actions').boundingBox();
check((await phone.page.locator('.toolbar.show-actions').count()) === 1 && bar.y > 700, 'phone: the bottom bar shows the actions', JSON.stringify(bar));
await phone.page.locator('.item-actions [aria-label="More actions"]').click();
const pb = await phone.page.locator('.action-pop').boundingBox();
check(pb && pb.x >= 0 && pb.x + pb.width <= 390 && pb.y + pb.height <= bar.y + 2, 'phone: the More menu opens above the bar', JSON.stringify(pb));
await phone.page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/step13-phone.png' : 'step13-phone.png' });
await phone.context.close();

await browser.close();
done();
