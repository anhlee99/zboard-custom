// Shared helpers for the headless browser checks.
// Uses playwright-core with an installed Edge/Chrome (no browser download):
//   PW=<path to node_modules/playwright-core> node e2e/step2.mjs
import { createRequire } from 'node:module';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright-core');

export const BASE = process.env.ZB_URL || 'http://localhost:3000';
export const PASSWORD = process.env.ZB_PASSWORD || 'testpw';

let fails = 0;
export function check(ok, name, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && extra ? ` (${extra})` : ''}`);
  if (!ok) fails++;
}
export const done = () => {
  console.log(`FAILS=${fails}`);
  process.exitCode = fails ? 1 : 0;
};

export async function launch() {
  return chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: process.env.HEADED ? false : true });
}

export function chromiumPersistent(dir) {
  return chromium.launchPersistentContext(dir, { channel: process.env.PW_CHANNEL || 'msedge', headless: !process.env.HEADED });
}

export async function login(browser, viewport = { width: 1440, height: 900 }, extra = {}) {
  const context = await browser.newContext({ viewport, ...extra });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  page error:', e.message));
  await page.goto(BASE + '/');
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.canvas');
  return { context, page };
}

// Drag with real mouse events in small steps.
export async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
}

export async function center(locator) {
  locator = await locator;
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export async function api(method, path, body) {
  if (!api.cookie) {
    const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
    api.cookie = r.headers.get('set-cookie').split(';')[0];
  }
  const r = await fetch(BASE + path, { method, headers: { cookie: api.cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Solid-colour PNG of any size, so tests need no image files.
export function solidPng(w, h, [r, g, b]) {
  const table = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

// Random-noise PNG: decodes and compresses like a real photo, unlike a flat colour.
export function noisePng(w, h, seed = 1) {
  let s = seed >>> 0 || 1;
  const rand = () => ((s ^= s << 13), (s ^= s >>> 17), (s ^= s << 5), s >>> 0);
  const pixels = Buffer.alloc(w * h * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = rand() & 255;
  const png = solidPng(w, h, [0, 0, 0]);
  // Rebuild the IDAT from the noise rows (filter byte 0 per row).
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), pixels.subarray(y * w * 3, (y + 1) * w * 3));
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 1 });
  const head = png.subarray(0, 8 + 25); // signature + IHDR chunk
  const chunk = (type, data) => {
    const table = [...Array(256)].map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const td = Buffer.concat([Buffer.from(type), data]);
    let c = 0xffffffff;
    for (const x of td) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  return Buffer.concat([head, chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// 1×1 PNG, enough for upload tests.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

// See-through PNG: a coloured disc on a transparent background, like a product cut-out.
export function cutoutPng(w, h, [r, g, b]) {
  const table = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type), data]);
    let c = 0xffffffff;
    for (const x of td) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) {
      const inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (Math.min(w, h) * 0.4) ** 2;
      row.set([r, g, b, inside ? 255 : 0], 1 + x * 4);
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

// With a card selected, the left toolbar shows that card's actions; Esc (like clicking
// empty board) flips it back to the tools.
export async function showTools(page) {
  for (let i = 0; i < 3 && (await page.locator('.toolbar.show-actions').count()); i++) {
    await page.keyboard.press('Escape');
    await sleep(120);
  }
  await sleep(320); // flip animation
}
