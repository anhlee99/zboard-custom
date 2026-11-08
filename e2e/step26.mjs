// Phones: search opens full screen (no floating box to tap out of by accident) with a Cancel button
// instead of the Esc hint; on a desktop it stays the floating panel. Needs a server on ZB_URL.
import { api, BASE, check, done, launch, sleep, PASSWORD } from './lib.mjs';

await api('GET', '/api/me');
await api('POST', '/api/boards/root/cards', { cards: [{ type: 'note', x: 60, y: 60, data: { html: '<p>Gold NMM recipe</p>' } }] });

const browser = await launch();
async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.canvas');
  await page.locator('[aria-label="Search"]').first().click();
  await page.waitForSelector('.search-panel');
  await page.keyboard.type('nmm');
  await sleep(700);
  return { ctx, page };
}

const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const p = await page.locator('.search-panel').boundingBox();
check(p.x === 0 && p.y === 0 && Math.round(p.width) === 390 && Math.round(p.height) === 844, 'on a phone, search fills the screen', JSON.stringify(p));
check(await page.locator('.search-cancel').isVisible(), 'with a Cancel button');
check(!(await page.locator('.search-input-row kbd').isVisible()), 'and no Esc hint');
check((await page.locator('.search-results li').count()) >= 1, 'results show', String(await page.locator('.search-results li').count()));
await page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/step26-search.png` });
await page.locator('.search-cancel').tap();
await sleep(300);
check((await page.locator('.search-panel').count()) === 0, 'Cancel closes it');
await ctx.close();

const d = await open({ viewport: { width: 1200, height: 800 } });
const dp = await d.page.locator('.search-panel').boundingBox();
check(dp.width <= 640 && dp.y > 20 && !(await d.page.locator('.search-cancel').isVisible()), 'on a desktop it stays the floating panel', JSON.stringify(dp));
await browser.close();
done();
