// Browser Back walks up the board tree, also when ZBoard was opened straight on a nested board
// (a reload, a shared link, Safari restoring a tab). Needs a server on ZB_URL from an empty data dir.
import { api, BASE, check, done, launch, login, sleep } from './lib.mjs';

const nurgles = (await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', title: 'Nurgles', x: 60, y: 60 }] })).cards[0].data.boardId;
const plague = (await api('POST', `/api/boards/${nurgles}/cards`, { cards: [{ type: 'board', title: 'Plague', x: 60, y: 60 }] })).cards[0].data.boardId;

const browser = await launch();
const { page } = await login(browser, { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const where = () => page.evaluate(() => ({ hash: location.hash, crumbs: document.querySelector('.crumbs')?.textContent }));
const back = async () => {
  await page.goBack();
  await sleep(700);
  return where();
};

// A fresh load straight on Home › Nurgles › Plague.
await page.goto(`${BASE}/#/b/${plague}`);
await page.reload();
await page.waitForSelector('.canvas');
await sleep(800);
check((await where()).crumbs === 'Home/Nurgles/Plague', 'opened straight on a nested board');
let at = await back();
check(at.hash === `#/b/${nurgles}` && at.crumbs === 'Home/Nurgles', 'Back goes up to Nurgles', JSON.stringify(at));
at = await back();
check(at.hash === '#/b/root' && at.crumbs === 'Home', 'Back again goes up to Home', JSON.stringify(at));

// Forward and a reload in the middle don't stack the path twice.
await page.goForward();
await sleep(700);
await page.reload();
await page.waitForSelector('.canvas');
await sleep(800);
at = await back();
check(at.hash === '#/b/root', 'after a reload on Nurgles, Back still goes to Home (no doubled path)', JSON.stringify(at));

// Opening boards one by one still works as before.
await page.goto(`${BASE}/#/b/root`);
await sleep(600);
await page.evaluate((id) => (location.hash = `#/b/${id}`), nurgles);
await sleep(600);
at = await back();
check(at.hash === '#/b/root', 'Back after opening a board from Home', JSON.stringify(at));
// Boards seen before draw in the first frame (no empty canvas while the request is out),
// and as they were left (a change made while there doesn't flash back to the old copy).
const firstFrame = (go) =>
  page.evaluate(
    (go) =>
      new Promise((resolve) => {
        addEventListener('hashchange', () => requestAnimationFrame(() => resolve([...document.querySelectorAll('.world [data-card-id]')].map((e) => [e.dataset.cardId, e.style.left]))), { once: true });
        if (go === 'back') history.back();
        else location.hash = go;
      }),
    go
  );
const note = (await api('POST', `/api/boards/${nurgles}/cards`, { cards: [{ type: 'note', x: 300, y: 300, data: { html: '<p>moved</p>' } }] })).cards[0];
await page.evaluate((id) => (location.hash = `#/b/${id}`), nurgles);
await sleep(800);
await api('PATCH', '/api/cards', { cards: [{ id: note.id, x: 520 }] }); // arrives live while the board is open
await sleep(600);
const home = await firstFrame('back');
check(home.length > 0, 'Back to Home draws its cards in the first frame', JSON.stringify(home));
const again = await firstFrame(`#/b/${nurgles}`);
const n = again.find(([id]) => id === note.id);
check(n && n[1] === '520px', 'returning to a board shows it as it was left, not an older copy', JSON.stringify(again));

// Double-tapping a board on a phone: the bottom bar doesn't flip to the card's actions and back,
// and the top bar names the new board in the same frame the switch happens.
await page.evaluate(() => (location.hash = '#/b/root'));
await sleep(800);
await page.evaluate(() => {
  window.__seen = [];
  const tick = () => {
    const s = `${document.querySelector('.toolbar').className}|${location.hash}|${document.querySelector('.crumbs').textContent}`;
    if (window.__seen.at(-1) !== s) window.__seen.push(s);
    window.__raf = requestAnimationFrame(tick);
  };
  tick();
});
const tile = await page.locator('[data-card-id] .board-icon').first().boundingBox();
await page.touchscreen.tap(tile.x + 20, tile.y + 20);
await sleep(120);
await page.touchscreen.tap(tile.x + 20, tile.y + 20);
await sleep(800);
const seen = await page.evaluate(() => (cancelAnimationFrame(window.__raf), window.__seen));
check(!seen.some((s) => s.startsWith('toolbar show-actions')), 'double tap: the bottom bar never flips to the card actions', JSON.stringify(seen));
check(!seen.some((s) => s.includes(`#/b/${nurgles}|`) && s.endsWith('|Home')), 'double tap: the top bar shows the new board as soon as it opens', JSON.stringify(seen));
check(seen.at(-1).endsWith('Home/Nurgles'), 'double tap opens Nurgles', JSON.stringify(seen));

// A single tap still brings up the card's actions after the double-tap window.
await page.goBack();
await sleep(800);
await page.touchscreen.tap(tile.x + 20, tile.y + 20);
await sleep(600);
check((await page.locator('.toolbar.show-actions').count()) === 1, 'a single tap shows the card actions after a short pause');

check(!errors.length, 'no page errors', errors.join(' | '));

await browser.close();
done();
