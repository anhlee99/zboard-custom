// A selected colour card shows its handles whole: on a touch screen the move / arrow / resize circles
// centred on its corners, on a desktop the resize square and the arrow dot past its right edge.
// (The card used to clip them to blue quarter-circles.) Needs a server on ZB_URL.
import { api, BASE, check, done, launch, sleep, PASSWORD } from './lib.mjs';

await api('GET', '/api/me');
const board = (await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', title: 'Colours', x: 40, y: 40 }] })).cards[0].data.boardId;
const { cards } = await api('POST', `/api/boards/${board}/cards`, { cards: [{ type: 'color', x: 120, y: 160, w: 200, data: { hex: '#ecbc1c', name: 'Fuel Yellow' } }] });
const id = cards[0].id;

// Every handle of the selected card: is its middle actually it (not clipped away), and is it whole?
const handles = (page) =>
  page.evaluate((id) => {
    const card = document.querySelector(`[data-id="${id}"]`) || document.querySelector('.card-color');
    return [...card.querySelectorAll('.handle')].map((h) => {
      const r = h.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const corner = document.elementFromPoint(r.left + 3, r.top + r.height / 2); // its left edge
      return { cls: h.className, w: Math.round(r.width), hit: !!hit && (hit === h || h.contains(hit)), edge: !!corner && (corner === h || h.contains(corner)) };
    });
  }, id);

const browser = await launch();
for (const [name, opts] of [
  ['touch', { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ['desktop', { viewport: { width: 1200, height: 800 } }],
]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.canvas');
  await page.goto(`${BASE}/#/b/${board}`);
  await page.waitForSelector('.card-color');
  await sleep(500);
  const swatch = page.locator('.card-color .color-swatch');
  if (name === 'touch') await swatch.tap();
  else await swatch.click();
  await sleep(500);
  const hs = await handles(page);
  check(hs.length >= 2, `${name}: the selected colour card shows its handles`, JSON.stringify(hs));
  check(hs.every((h) => h.hit && h.edge), `${name}: every handle is whole and can be pressed (not clipped by the card)`, JSON.stringify(hs));
  await page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/step24-${name}.png`, clip: { x: 0, y: 0, width: Math.min(opts.viewport.width, 700), height: 600 } });
  check(!errors.length, `${name}: no page errors`, errors.join(' | '));
  await ctx.close();
}
await browser.close();
done();
