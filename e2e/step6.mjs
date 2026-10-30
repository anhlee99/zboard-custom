// Step 6 checks: Saved items + the ZBoard Clipper extension, loaded unpacked into Edge.
// Serves a small test site (images behind a login cookie) on SITE_PORT (default 4600).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { api, BASE, check, done, PASSWORD, sleep, solidPng as png } from './lib.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PW || 'playwright-core');
const SITE = `http://localhost:${process.env.SITE_PORT || 4600}`;
const COLORS = [[220, 60, 60], [60, 160, 80], [60, 100, 220], [230, 180, 40], [150, 70, 200]];
const site = http
  .createServer((req, res) => {
    const u = new URL(req.url, SITE);
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'auth=1; Path=/' });
      return res.end(`<!doctype html><html><head><title>Test site</title><meta property="og:image" content="/og.png"></head><body>
        ${COLORS.map((_, i) => `<img src="/p${i + 1}.png" width="150">`).join('')}
        <img src="/tiny.png"><div style="width:200px;height:200px;background:url(/bg.png)"></div>
        <a href="https://example.com/article">Article</a><p id="words">Selected words here</p></body></html>`);
    }
    const m = u.pathname.match(/^\/p(\d)\.png$/);
    if (m) {
      // "behind a login": only with the cookie the page set
      if (!/auth=1/.test(req.headers.cookie || '')) {
        res.writeHead(403);
        return res.end('login required');
      }
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(png(300, 200, COLORS[Number(m[1]) - 1]));
    }
    const sizes = { '/og.png': [600, 315], '/bg.png': [200, 200], '/tiny.png': [32, 32] };
    if (sizes[u.pathname]) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(png(...sizes[u.pathname], [90, 90, 90]));
    }
    res.writeHead(404);
    res.end();
  })
  .listen(Number(new URL(SITE).port));

// Clean board, token for the extension.
const root = await api('GET', '/api/boards/root');
if (root.cards.length) await api('POST', '/api/cards/delete', { ids: root.cards.map((c) => c.id) });
for (const c of (await api('GET', '/api/clips')).clips) await api('DELETE', `/api/clips/${c.id}`);
await api('POST', '/api/boards/root/cards', { type: 'board', title: 'Moodboard', x: 40, y: 40 });
const { token } = await api('GET', '/api/token');

const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-ext-'));
fs.cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension'), ext, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-profile-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: process.env.PW_CHANNEL || 'msedge',
  headless: !process.env.HEADED,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
const extId = sw.url().split('/')[2];
check(/^chrome-extension:\/\//.test(sw.url()), 'extension loads (MV3 service worker running)');

// ZBoard with the Saved items panel open
const zb = ctx.pages()[0] || (await ctx.newPage());
await zb.goto(BASE + '/');
await zb.fill('input[type=password]', PASSWORD);
await zb.click('button[type=submit]');
await zb.waitForSelector('.canvas');
await zb.click('button[aria-label="Saved items"]');
await zb.waitForSelector('.saved-panel');

// --- popup: first-run setup ---
const pop = await ctx.newPage();
await pop.goto(`chrome-extension://${extId}/popup.html?page=1`);
await pop.waitForSelector('#setup:not([hidden])');
await pop.fill('#server', BASE);
await pop.fill('#token', 'wrong-token');
await pop.click('#connect');
await pop.waitForFunction(() => /rejected/.test(document.querySelector('#setup-status').textContent));
check(true, 'popup setup rejects a wrong token with a clear message');
await pop.fill('#token', token);
await pop.click('#connect');
await pop.waitForSelector('#main:not([hidden])');
const opts = await pop.locator('#board option').allTextContents();
check(opts[0] === 'Home' && opts.some((o) => o.trim() === 'Moodboard'), 'popup board picker lists the board tree', opts.join('|'));
await pop.close();
await sleep(500);
const menu = await sw.evaluate(() => globalThis.zboard.menu);
const top = menu.filter((m) => m.parentId === 'zb');
check(menu[0].id === 'zb' && top[0].id === 'd:root' && top[1].type === 'separator' && menu.some((m) => m.title === 'Moodboard'), 'right-click menu: Save to ZBoard ▸ default board, then the tree', JSON.stringify(top.slice(0, 3)));

// --- right-click an image on a page that needs its login cookie ---
const page = await ctx.newPage();
await page.goto(SITE + '/');
await page.waitForLoadState('load');
const tabId = await sw.evaluate(async (s) => (await chrome.tabs.query({ url: s + '/*' }))[0].id, SITE);
const click = (info) => sw.evaluate(({ info, tabId, site }) => globalThis.zboard.onMenuClick({ pageUrl: site + '/', ...info }, { id: tabId, url: site + '/', title: 'Test site' }), { info, tabId, site: SITE });
await zb.bringToFront();
const t0 = Date.now();
await click({ menuItemId: 'd:root', mediaType: 'image', srcUrl: SITE + '/p1.png' });
await zb.waitForSelector('.saved-item', { timeout: 5000 }).catch(() => {});
const ms = Date.now() - t0;
check((await zb.locator('.saved-item').count()) === 1 && ms < 1500, `image saved via the menu shows in Saved items (${ms} ms)`);
let clips = (await api('GET', '/api/clips')).clips;
const info = await api('GET', `/api/files/${clips[0].data.fileId}/info`);
check(info.file.width === 300 && info.file.height === 200, 'the browser fetched it with the page login (server alone gets 403)');
check(/Saved to ZBoard/.test((await page.locator('#zboard-clipper-toast').textContent({ timeout: 3000 }).catch(() => '')) || ''), 'in-page toast confirms the save');

await click({ menuItemId: 'd:root', linkUrl: 'https://example.com/article', selectionText: 'Article' });
await click({ menuItemId: 'd:root', selectionText: 'Selected words here' });
await sleep(500);
clips = (await api('GET', '/api/clips')).clips;
check(clips.some((c) => c.kind === 'link' && c.data.url === 'https://example.com/article') && clips.some((c) => c.kind === 'text' && c.data.text === 'Selected words here'), 'links and selected text can be saved too');

// --- popup image grid: save 5, close the popup at once ---
const pp = await ctx.newPage();
await pp.goto(`chrome-extension://${extId}/popup.html?page=1&tab=${tabId}`);
await pp.waitForSelector('.tile');
await sleep(300);
const srcs = await pp.locator('.tile').evaluateAll((ts) => ts.map((t) => t.dataset.src));
check(srcs.includes(SITE + '/og.png') && srcs.includes(SITE + '/bg.png') && srcs.filter((s) => /\/p\d\.png$/.test(s)).length === 5 && !srcs.some((s) => s.includes('tiny')), 'popup grid: page images ≥120 px, og:image, CSS background; no tiny icons', srcs.join(' '));
for (let i = 1; i <= 5; i++) await pp.locator(`.tile[data-src="${SITE}/p${i}.png"]`).click();
check((await pp.locator('#save-images').textContent()) === 'Save 5 images', 'five images selected');
await pp.click('#save-images');
await pp.close().catch(() => {});
let images = [];
for (let i = 0; i < 40; i++) {
  images = (await api('GET', '/api/clips')).clips.filter((c) => c.kind === 'image');
  if (images.length >= 6) break;
  await sleep(250);
}
check(images.length === 6, `all 5 arrive after the popup closed (${images.length - 1}/5)`);

// --- drag a clip onto the canvas ---
await zb.bringToFront();
await zb.waitForFunction(() => document.querySelectorAll('.saved-item').length >= 8);
const before = (await api('GET', '/api/clips')).clips.length;
const firstId = await zb.locator('.saved-item').first().getAttribute('data-clip-id');
await zb.locator('.saved-item').first().dragTo(zb.locator('.canvas'), { targetPosition: { x: 500, y: 450 } });
await sleep(800);
const after = (await api('GET', '/api/clips')).clips;
const cardsNow = (await api('GET', '/api/boards/root')).cards;
check(after.length === before - 1 && !after.some((c) => c.id === firstId) && cardsNow.length === 2, 'dragging a clip onto the canvas makes it a card and empties it from the inbox');
check((await zb.locator(`.saved-item[data-clip-id="${firstId}"]`).count()) === 0, 'the panel drops it at once');
const textClip = after.find((c) => c.kind === 'text');
await zb.locator(`.saved-item[data-clip-id="${textClip.id}"] [aria-label="Add to this board"]`).click();
await sleep(600);
const note = (await api('GET', '/api/boards/root')).cards.find((c) => c.type === 'note');
check(note && /Selected words here/.test(note.data.html) && /href="http:\/\/localhost:4600\/"/.test(note.data.html), 'text clips become notes with a link to the page');
await zb.locator('button[aria-label="Saved items"]').click();
await zb.locator('button[aria-label="Saved items"]').click();
await zb.locator('.seg button', { hasText: 'All boards' }).click();
check((await zb.locator('.saved-item').count()) === after.length - 1, 'All boards tab lists every saved item');

// --- token rotated → clear reconnect error ---
await api('POST', '/api/token/rotate');
await click({ menuItemId: 'd:root', mediaType: 'image', srcUrl: SITE + '/p2.png' });
await sleep(800);
const toast = await page.locator('#zboard-clipper-toast').textContent().catch(() => '');
check(/rejected the token/.test(toast) && /[Rr]econnect/.test(toast), 'after a token change the page shows a reconnect message', toast);
const menu2 = await sw.evaluate(() => globalThis.zboard.menu);
check(menu2.some((m) => /Reconnect/.test(m.title || '')), 'the right-click menu turns into "Reconnect ZBoard Clipper…"');
const pop2 = await ctx.newPage();
await pop2.goto(`chrome-extension://${extId}/popup.html`);
await pop2.waitForSelector('#setup:not([hidden])');
check(/rejected the token/.test(await pop2.locator('#setup-status').textContent()), 'the popup asks to reconnect');
await pop2.close();

// --- menu: extension setup and zip ---
await zb.click('[aria-label="Menu"]');
await zb.locator('button', { hasText: 'Set up ZBoard Clipper' }).click();
await zb.waitForFunction(() => document.querySelectorAll('.copy-field input')[1]?.value.length > 20, null, { timeout: 5000 }).catch(() => {});
const tokenShown = await zb.locator('.copy-field input').nth(1).inputValue();
check((await zb.locator('.copy-field input').first().inputValue()) === BASE && tokenShown.length > 20 && tokenShown !== token, 'menu shows the server address and the current token');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zb-zip-'));
fs.writeFileSync(path.join(tmp, 'x.zip'), Buffer.from(await (await fetch(BASE + '/api/extension.zip', { headers: { cookie: api.cookie } })).arrayBuffer()));
execFileSync('tar', ['-xf', 'x.zip'], { cwd: tmp });
check(fs.existsSync(path.join(tmp, 'zboard-clipper', 'manifest.json')) && fs.existsSync(path.join(tmp, 'zboard-clipper', 'icons', 'icon-128.png')), '/api/extension.zip has the extension');
await zb.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step6-saved.png' });

await ctx.close();
site.close();
for (const d of [ext, profile, tmp]) fs.rmSync(d, { recursive: true, force: true });
done();
