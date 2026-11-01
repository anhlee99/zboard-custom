// Saved items open by themselves on a board that has some, once per visit.
// Needs a server on ZB_URL started from an empty data dir.
import { api, BASE, check, done, launch, login, sleep } from './lib.mjs';

const made = await api('POST', '/api/boards/root/cards', {
  cards: [
    { type: 'board', title: 'Has saved items', x: 60, y: 60 },
    { type: 'board', title: 'Nothing saved', x: 300, y: 60 },
  ],
});
const [withId, emptyId] = made.cards.map((c) => c.data.boardId);
await api('POST', '/api/clips', { board_id: withId, kind: 'text', text: 'Saved from a page' });

const browser = await launch();
const { page } = await login(browser);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const panel = page.locator('.saved-panel');
const go = async (id) => {
  await page.goto(`${BASE}/#/b/${id}`);
  await page.waitForSelector('.canvas');
  await sleep(700);
};

await go('root');
check((await panel.count()) === 0, 'no panel on a board without saved items');
await go(withId);
check((await panel.count()) === 1 && (await page.locator('.saved-item').count()) === 1, 'entering a board with saved items opens the panel');
await go(emptyId);
check((await panel.count()) === 0, 'a panel that opened by itself closes on a board without saved items');
await go(withId);
check((await panel.count()) === 1, 'it opens again on the next visit');
await page.click('[aria-label="Close saved items"]');
await sleep(300);
await api('POST', '/api/clips', { board_id: withId, kind: 'text', text: 'Another one' });
await sleep(800);
check((await panel.count()) === 0, 'closed by hand, it stays closed on that visit (even when more arrive)');

// Opened by hand on an empty board: it stays open when moving on.
await go(emptyId);
await page.click('[aria-label="Saved items"]');
await page.waitForSelector('.saved-panel');
await page.click('.logo');
await sleep(700);
check((await panel.count()) === 1, 'a panel opened by hand stays open across boards');

// Something saved to the board being viewed opens the panel.
await page.click('[aria-label="Close saved items"]');
await go(emptyId);
await api('POST', '/api/clips', { board_id: emptyId, kind: 'text', text: 'Arrived live' });
await page.waitForSelector('.saved-panel', { timeout: 4000 }).catch(() => {});
check((await panel.count()) === 1, 'a saved item arriving on the board being viewed opens the panel');
check(!errors.length, 'no page errors', errors.join(' | '));

await browser.close();
done();
