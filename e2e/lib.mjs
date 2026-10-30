// Shared helpers for the headless browser checks.
// Uses playwright-core with an installed Edge/Chrome (no browser download):
//   PW=<path to node_modules/playwright-core> node e2e/step2.mjs
import { createRequire } from 'node:module';

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

// 1×1 PNG, enough for upload tests.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
