// Pictures on a weak connection: a dropped request never shows the browser's broken-image icon (the
// picture stays invisible over the card's colour with a shimmer) and is tried again, after 1, 3 and 10 s,
// then when the connection comes back. Needs a server on ZB_URL. The service worker is blocked so the
// test sees every request the page makes.
import { api, BASE, check, done, launch, sleep, solidPng, PASSWORD } from './lib.mjs';

await api('GET', '/api/me');
const upload = async (w, h, color, name) => {
  const fd = new FormData();
  fd.append('file', new Blob([solidPng(w, h, color)], { type: 'image/png' }), name);
  return (await (await fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd })).json()).file;
};
const ok = await upload(600, 400, [60, 160, 90], 'fine.png');
const flaky = await upload(600, 400, [200, 70, 60], 'flaky.png');
const dead = await upload(600, 400, [60, 100, 210], 'dead.png');
const board = (await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', title: 'Weak signal', x: 40, y: 40 }] })).cards[0].data.boardId;
await api('POST', `/api/boards/${board}/cards`, {
  cards: [
    { type: 'image', x: 40, y: 40, w: 260, data: { fileId: ok.id } },
    { type: 'image', x: 340, y: 40, w: 260, data: { fileId: flaky.id } },
    { type: 'image', x: 640, y: 40, w: 260, data: { fileId: dead.id } },
  ],
});

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// flaky: the first 2 requests drop. dead: every request drops until `deadAlive`.
const hits = { [ok.id]: 0, [flaky.id]: 0, [dead.id]: 0 };
let deadAlive = false;
await context.route(/\/files\/[^/?]+\/(thumb|mini|micro)/, (route) => {
  const id = new URL(route.request().url()).pathname.split('/')[2];
  if (id in hits) hits[id]++;
  if (id === flaky.id && hits[id] <= 2) return route.abort('connectionreset');
  if (id === dead.id && !deadAlive) return route.abort('internetdisconnected');
  return route.continue();
});

await page.goto(BASE + '/');
await page.fill('input[type=password]', PASSWORD);
await page.click('button[type=submit]');
await page.waitForSelector('.canvas');
await page.goto(`${BASE}/#/b/${board}`);
await page.waitForSelector('.card-image img');

const state = (id) =>
  page.evaluate((id) => {
    const img = [...document.querySelectorAll('.card-image img')].find((i) => i.src.includes(`/files/${id}/`));
    if (!img) return null;
    const wrap = img.closest('.img-wrap');
    return {
      data: img.dataset.img,
      opacity: getComputedStyle(img).opacity,
      shown: img.complete && img.naturalWidth > 0,
      shimmer: getComputedStyle(wrap, '::after').content !== 'none',
      src: img.getAttribute('src'),
    };
  }, id);

await sleep(700);
let s = await state(flaky.id);
check(s && s.data === 'loading' && s.opacity === '0' && s.shimmer, 'a dropped picture is invisible with a shimmer, not a broken icon', JSON.stringify(s));
s = await state(ok.id);
check(s?.shown && s.data === 'loaded' && !s.shimmer && hits[ok.id] === 1, 'a picture that loads shows at once, one request, no shimmer', JSON.stringify({ s, hits: hits[ok.id] }));

await sleep(5000); // retries after 1 s and 3 s; the second retry gets through
s = await state(flaky.id);
check(s?.shown && s.data === 'loaded' && hits[flaky.id] === 3, 'it is tried again after 1 s and 3 s and then shows', JSON.stringify({ s, hits: hits[flaky.id] }));
await sleep(400);
s = await state(flaky.id);
check(s?.opacity === '1' && !s.shimmer, 'and fades in, shimmer gone', JSON.stringify(s));

await sleep(10000); // the third retry (10 s) for the dead one fails too
s = await state(dead.id);
check(s?.data === 'loading' && s.opacity === '0' && hits[dead.id] === 4, 'still failing after 1, 3 and 10 s: stays invisible, no broken icon', JSON.stringify({ s, hits: hits[dead.id] }));
await sleep(2500);
check(hits[dead.id] === 4, 'then it waits instead of hammering the server', String(hits[dead.id]));

deadAlive = true;
await context.setOffline(true);
await sleep(200);
await context.setOffline(false); // the browser says the connection is back
await sleep(1500);
s = await state(dead.id);
check(s?.shown && s.data === 'loaded', 'when the connection comes back it loads', JSON.stringify({ s, hits: hits[dead.id] }));

await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step22-images.png' });
check(!errors.length, 'no page errors', errors.join(' | '));
await browser.close();
done();
