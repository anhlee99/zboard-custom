// Quick save from the hover button (extension/hover.js): hover an image, click Save, type a board
// name, Enter. Loads the extension unpacked into Edge and serves a test site on SITE_PORT (default 4601).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { api, BASE, check, done, sleep, solidPng as png } from './lib.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright-core');
const SITE = `http://localhost:${process.env.SITE_PORT || 4601}`;
const site = http
  .createServer((req, res) => {
    const u = new URL(req.url, SITE);
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      // The big picture sits under a transparent overlay (as on Instagram or Pinterest) and offers a larger srcset copy.
      return res.end(`<!doctype html><html><head><title>Hover site</title></head><body style="margin:0">
        <div style="position:relative;width:400px;height:300px;margin:40px">
          <img id="big" src="/small.png" srcset="/small.png 400w, /large.png 1200w" sizes="400px" width="400" height="300" alt="Green knight">
          <div style="position:absolute;inset:0"></div>
        </div>
        <img id="tiny" src="/tiny.png" width="40" height="40" style="margin:40px">
        </body></html>`);
    }
    if (u.pathname === '/picker') {
      // A big picture behind everything (its corner off-screen), an opaque sticker panel on top whose
      // stickers are CSS backgrounds (not <img>), and an ordinary picture.
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><html><head><title>Picker</title></head><body style="margin:0;height:2000px">
        <img id="wall" src="/large.png" style="position:fixed;left:-300px;top:-200px;width:1600px;height:1200px">
        <div id="panel" style="position:fixed;right:20px;bottom:20px;width:300px;height:260px;background:#fff">
          <div id="sticker" style="margin:20px;width:120px;height:120px;background:url(/small.png) center/cover"></div>
        </div>
        <img id="plain" src="/small.png" width="200" height="150" style="position:fixed;left:120px;top:140px">
        </body></html>`);
    }
    const sizes = { '/small.png': [400, 300], '/large.png': [1200, 900], '/tiny.png': [40, 40] };
    if (sizes[u.pathname]) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(png(...sizes[u.pathname], [40, 160, 80]));
    }
    res.writeHead(404);
    res.end();
  })
  .listen(Number(new URL(SITE).port));

for (const c of (await api('GET', '/api/clips')).clips) await api('DELETE', `/api/clips/${c.id}`);
const made = await api('POST', '/api/boards/root/cards', { cards: [{ type: 'board', title: 'Knights reference', x: 40, y: 600 }] });
const knights = made.cards[0].data.boardId;
const { token } = await api('GET', '/api/token');

const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-ext-'));
fs.cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension'), ext, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-profile-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: process.env.PW_CHANNEL || 'msedge',
  headless: !process.env.HEADED,
  viewport: { width: 1200, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
await sw.evaluate(({ server, token }) => chrome.storage.local.set({ server, token, board: 'root' }), { server: BASE, token });

const page = ctx.pages()[0] || (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(SITE + '/');
await page.waitForFunction(() => document.querySelector('#big').complete && document.querySelector('zboard-clipper'));
const big = await page.locator('#big').boundingBox();
const host = page.locator('zboard-clipper');
check((await host.count()) === 1, 'the hover script is on the page');

const clips = async () => (await api('GET', '/api/clips')).clips;
const waitClips = async (n) => {
  for (let i = 0; i < 40; i++) {
    const c = await clips();
    if (c.length >= n) return c;
    await sleep(250);
  }
  return clips();
};

// Hover the picture (through the overlay), click the button in its top-left corner.
await page.mouse.move(big.x + 200, big.y + 150);
await sleep(300);
await page.mouse.move(big.x + 30, big.y + 22, { steps: 4 });
await sleep(150);
await page.mouse.click(big.x + 30, big.y + 23);
await sleep(600);
// The picker has focus in its search box: type part of the board name, Enter.
await page.keyboard.type('knight');
await sleep(150);
await page.keyboard.press('Enter');
let saved = await waitClips(1);
check(saved.length === 1 && saved[0].board_id === knights, 'hover → Save → type a board name → Enter saves to that board', JSON.stringify(saved.map((c) => c.board_id)));
const file = saved[0] && (await api('GET', `/api/files/${saved[0].data.fileId}/info`)).file;
check(file?.width === 1200, 'the largest srcset copy is saved, not the thumbnail on screen', String(file?.width));
check(saved[0]?.data.alt === 'Green knight' && saved[0]?.data.page_url === SITE + '/', 'alt text and page come along', JSON.stringify(saved[0]?.data));
check(/Saved to ZBoard/.test((await page.locator('#zboard-clipper-toast').textContent({ timeout: 3000 }).catch(() => '')) || ''), 'toast confirms the save');
check((await sw.evaluate(() => chrome.storage.local.get('board'))).board === knights, 'that board is remembered as last used');

// Second time: the last-used board is first in the list, so just Enter.
await page.mouse.move(600, 700);
await sleep(400);
await page.mouse.move(big.x + 200, big.y + 150, { steps: 3 });
await sleep(300);
await page.mouse.click(big.x + 30, big.y + 23);
await sleep(600);
await page.keyboard.press('Enter');
saved = await waitClips(2);
check(saved.length === 2 && saved.every((c) => c.board_id === knights), 'next time the last-used board is one Enter away');

// Escape closes the picker without saving; tiny images get no button.
await page.mouse.move(big.x + 200, big.y + 150, { steps: 3 });
await sleep(300);
await page.mouse.click(big.x + 30, big.y + 23);
await sleep(500);
await page.keyboard.press('Escape');
const tiny = await page.locator('#tiny').boundingBox();
await page.mouse.move(tiny.x + 20, tiny.y + 20, { steps: 3 });
await sleep(300);
await page.mouse.click(tiny.x + 12, tiny.y + 12);
await sleep(800);
check((await clips()).length === 2, 'Escape saves nothing, and small images have no button');

// Which image, and where: the button belongs to the <img> actually under the pointer, 2 px inside its
// visible top-left corner. Its shadow root is closed to the page, so the test reads the button's box
// through the browser's debugging protocol (which sees closed shadow roots); null = not shown.
const dbg = await page.context().newCDPSession(page);
async function buttonBox() {
  const { root } = await dbg.send('DOM.getDocument', { depth: -1, pierce: true });
  let id = null;
  const walk = (n, inside) => {
    if (!n || id) return;
    const here = inside || n.nodeName === 'ZBOARD-CLIPPER';
    if (here && n.nodeName === 'BUTTON' && (n.attributes || []).includes('btn')) id = n.nodeId;
    for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c, here);
  };
  walk(root, false);
  if (!id) return null;
  try {
    const { model } = await dbg.send('DOM.getBoxModel', { nodeId: id });
    return { x: Math.round(model.border[0]), y: Math.round(model.border[1]) };
  } catch {
    return null; // display: none has no box
  }
}
const hover = async (x, y) => {
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(500); // leaving a picture hides its button after 250 ms (time to reach the button)
};
await page.goto(SITE + '/picker');
await page.waitForFunction(() => [...document.images].every((i) => i.complete) && document.querySelector('zboard-clipper'));
const sticker = await page.locator('#sticker').boundingBox();
const plain = await page.locator('#plain').boundingBox();
await hover(plain.x + 100, plain.y + 75);
let at = await buttonBox();
check(at?.x === plain.x + 2 && at?.y === plain.y + 2, 'an ordinary picture: the button sits exactly 2 px inside its top-left corner', JSON.stringify({ at, plain }));
await hover(sticker.x + 60, sticker.y + 60);
at = await buttonBox();
check(at === null, 'a sticker that is not an <img>, on an opaque panel, gets no button (not one for the big picture behind it)', JSON.stringify(at));
await hover(700, 120); // on the big picture, whose corner is off-screen
at = await buttonBox();
check(at?.x === 2 && at?.y === 2, 'a picture whose corner is off-screen: the button sits 2 px inside its visible corner', JSON.stringify(at));
await hover(plain.x + 100, plain.y + 75); // and back: it follows the picture under the pointer
at = await buttonBox();
check(at?.x === plain.x + 2 && at?.y === plain.y + 2, 'moving back, the button follows the picture under the pointer', JSON.stringify(at));
await page.goto(SITE + '/');
await page.waitForFunction(() => document.querySelector('#big').complete && document.querySelector('zboard-clipper'));

// Switched off in the popup: no button.
await sw.evaluate(() => chrome.storage.local.set({ hover: false }));
await sleep(200);
await page.mouse.move(big.x + 200, big.y + 150, { steps: 3 });
await sleep(300);
await page.mouse.click(big.x + 30, big.y + 23);
await sleep(500);
await page.keyboard.type('knight');
await page.keyboard.press('Enter');
await sleep(800);
check((await clips()).length === 2, 'with the switch off, hovering shows no button');
check(!errors.length, 'no page errors', errors.join(' | '));

await ctx.close();
site.close();
for (const d of [ext, profile]) fs.rmSync(d, { recursive: true, force: true });
done();
