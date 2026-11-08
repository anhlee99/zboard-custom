// Menu → Unused files → "Clean up now…": the confirm window says what goes and that it can't be undone;
// Cancel and Escape keep everything; Remove deletes. Needs a server on ZB_URL from an empty data dir
// (no Google Drive set up).
import { api, BASE, check, done, launch, login, sleep, solidPng } from './lib.mjs';

await api('GET', '/api/me');
const colors = [[200, 70, 60], [60, 160, 90], [60, 100, 210], [230, 180, 40], [150, 80, 200]];
for (const [i, c] of colors.entries()) {
  const fd = new FormData();
  fd.append('file', new Blob([solidPng(400 + i * 60, 300, c)], { type: 'image/png' }), `old-${i + 1}.png`);
  await fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd });
}
const files = async () => (await api('GET', '/api/stats')).files;

const browser = await launch();
const { page } = await login(browser, { width: 1200, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.click('[aria-label="Menu"]');
const section = page.locator('.menu-section', { hasText: 'Unused files' });
await section.locator('button', { hasText: 'Check now' }).click();
await sleep(500);
check(/5 \(/.test(await section.locator('.kv').innerText()), 'Check now counts the 5 unused pictures');

await section.locator('button', { hasText: 'Clean up now' }).click();
const dialog = page.locator('[role="alertdialog"]');
await dialog.waitFor();
await sleep(400);
await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step20-confirm.png' });
const text = (await dialog.innerText()).replace(/\s+/g, ' ');
check(/Permanently remove 5 unused pictures\?/.test(text), 'title says how many will go', text.slice(0, 60));
check(/can’t be undone/.test(text) && /not with Undo, not from a local backup/.test(text), 'the loss is spelled out');
check(!/Google Drive restore/.test(text), 'Google Drive is only mentioned when it is connected');
check(/this computer/.test(text) && /local backup folder/.test(text), 'it lists where they are deleted from');
check((await dialog.locator('.confirm-thumbs img').count()) === 5, 'it shows the pictures that go');
check((await page.evaluate(() => document.activeElement?.textContent)) === 'Cancel', 'Cancel has the focus (Enter does not delete)');

await dialog.locator('button', { hasText: 'Cancel' }).click();
await sleep(400);
check((await dialog.count()) === 0 && (await files()) === 5, 'Cancel closes it and removes nothing');
await section.locator('button', { hasText: 'Clean up now' }).click();
await dialog.waitFor();
await page.keyboard.press('Escape');
await sleep(300);
check((await dialog.count()) === 0 && (await page.locator('.menu-panel').count()) === 1 && (await files()) === 5, 'Escape closes the window only, removing nothing');

await section.locator('button', { hasText: 'Clean up now' }).click();
await dialog.waitFor();
await dialog.locator('button', { hasText: 'Remove 5 pictures' }).click();
await dialog.waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
check((await dialog.count()) === 0, 'Remove closes the window at once (the removal runs in the background)');
await section.locator('.ok-text').waitFor();
check(/Removed 5 pictures and freed/.test(await section.locator('.ok-text').textContent()) && (await files()) === 0, 'Remove deletes them and says so');
check(await section.locator('button', { hasText: 'Clean up now' }).isDisabled(), 'with nothing left, the button is off');
check(!errors.length, 'no page errors', errors.join(' | '));

await browser.close();
done();
