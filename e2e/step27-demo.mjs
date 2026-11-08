// The online demo (web/dist-demo, built by web/demo/build.mjs), served the way GitHub Pages serves
// it (under /zboard/): it opens without a password on an empty Home board with the demo banner;
// notes, pictures and boards work and survive a reload; search works; Start over empties it again.
// Needs no ZBoard server. Usage: node e2e/step27-demo.mjs   (DEMO_DIR to point at another build)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, done, launch, sleep, solidPng } from './lib.mjs';

const dir = process.env.DEMO_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist-demo');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const PORT = Number(process.env.DEMO_PORT || 4700);
const server = http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith('/zboard/')) return res.writeHead(404).end('not found'); // like Pages: nothing outside the site
    let f = path.join(dir, decodeURIComponent(u.pathname.slice('/zboard/'.length)) || 'index.html');
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  })
  .listen(PORT);
const URL0 = `http://localhost:${PORT}/zboard/`;

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL0);
await page.waitForSelector('.canvas', { timeout: 20000 });
await sleep(800);
check((await page.locator('input[type=password]').count()) === 0, 'opens without a password');
check(/Demo/.test(await page.locator('.demo-banner').innerText()), 'shows the demo banner');
check((await page.locator('.card').count()) === 0, 'a new visitor gets an empty Home board');

// A note, typed in.
await page.locator('.toolbar .tool', { hasText: 'Note' }).click(); // added in the middle, ready to type
await sleep(600);
await page.keyboard.type('Gold #nmm recipe');
await page.mouse.click(1000, 650);
await sleep(800);
const notes = await page.locator('.card-note').allInnerTexts();
check(notes.length === 1 && /Gold/.test(notes[0]), 'a note can be added and typed into', JSON.stringify(notes));

// A picture, dropped in through the file picker.
const pic = path.join(dir, '..', 'demo-test.png');
fs.writeFileSync(pic, solidPng(600, 400, [40, 160, 90]));
const chooser = page.waitForEvent('filechooser');
await page.locator('.toolbar .tool', { hasText: 'Image' }).click();
await (await chooser).setFiles(pic);
await page.waitForSelector('.card-image img[data-img="loaded"]', { timeout: 15000 });
const shown = await page.locator('.card-image img').evaluate((i) => ({ w: i.naturalWidth, src: i.getAttribute('src') }));
check(shown.w > 0, 'a picture can be added and shows', JSON.stringify(shown));
fs.rmSync(pic, { force: true });

// A board inside.
await page.locator('.toolbar .tool', { hasText: 'Board' }).click();
await sleep(400);
await page.mouse.click(300, 600);
await sleep(800);
check((await page.locator('.card-board').count()) === 1, 'a board can be added');

// Everything is still there after a reload.
await page.reload();
await page.waitForSelector('.card-image img[data-img="loaded"]', { timeout: 15000 });
await sleep(500);
check((await page.locator('.card-note').count()) === 1 && (await page.locator('.card-image').count()) === 1 && (await page.locator('.card-board').count()) === 1, 'all of it is still there after a reload');

// Search.
await page.keyboard.press('Control+k');
await page.waitForSelector('.search-panel');
await page.keyboard.type('nmm');
await sleep(800);
check((await page.locator('.search-results li').count()) >= 1, 'search finds the note');
await page.keyboard.press('Escape');

// The menu: about the demo, Start over; no backups or extension.
await page.locator('[aria-label="Menu"]').click();
await sleep(400);
const menu = await page.locator('.menu-panel').innerText();
check(/about this demo/i.test(menu) && !/Backup & Restore|Browser extension|Log out/.test(menu), 'the menu explains the demo and hides server-only parts', menu.replace(/\s+/g, ' ').slice(0, 400));
await page.screenshot({ path: `${process.env.SHOT_DIR || '.'}/step27-demo.png` });
page.once('dialog', (d) => d.accept());
await page.locator('.menu-panel button', { hasText: 'Start over' }).click();
await page.waitForLoadState('load');
await page.waitForSelector('.canvas', { timeout: 20000 });
await sleep(1000);
check((await page.locator('.card').count()) === 0, 'Start over empties it again');

// Another visitor (another browser profile) starts empty too.
const other = await (await browser.newContext()).newPage();
await other.goto(URL0);
await other.waitForSelector('.canvas', { timeout: 20000 });
await sleep(500);
check((await other.locator('.card').count()) === 0, "another visitor doesn't see anyone else's boards");

check(!errors.length, 'no page errors', errors.join(' | '));
await browser.close();
server.close();
done();
