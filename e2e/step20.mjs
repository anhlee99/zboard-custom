// Menu → Backup & Restore → Unused files → "Clean up now…": the confirm window says what goes and that it can't be undone;
// pictures show a preview and other files (a PDF here) a tile with their type; Cancel and Escape keep everything;
// Remove deletes. Needs a server on ZB_URL from an empty data dir (no Google Drive set up).
import { api, BASE, check, done, launch, login, sleep, solidPng } from './lib.mjs';

await api('GET', '/api/me');
const upload = (blob, name) => {
  const fd = new FormData();
  fd.append('file', blob, name);
  return fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd });
};
const colors = [[200, 70, 60], [60, 160, 90], [60, 100, 210], [230, 180, 40], [150, 80, 200]];
for (const [i, c] of colors.entries()) await upload(new Blob([solidPng(400 + i * 60, 300, c)], { type: 'image/png' }), `old-${i + 1}.png`);
await upload(new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), 'notes.pdf');
const files = async () => (await api('GET', '/api/stats')).files;

const browser = await launch();
const { page } = await login(browser, { width: 1200, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.click('[aria-label="Menu"]');
const section = page.locator('.menu-sub', { hasText: 'Unused files' });
await section.locator('button', { hasText: 'Check now' }).click();
await sleep(500);
check(/6 \(/.test(await section.locator('.kv').innerText()), 'Check now counts the 6 unused files (5 pictures and a PDF)');

await section.locator('button', { hasText: 'Clean up now' }).click();
const dialog = page.locator('[role="alertdialog"]');
await dialog.waitFor();
await sleep(400);
await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step20-confirm.png' });
const text = (await dialog.innerText()).replace(/\s+/g, ' ');
check(/Permanently remove 6 unused files\?/.test(text), 'title says how many files will go', text.slice(0, 60));
check(/can’t be undone/.test(text) && /not with Undo, not from a local backup/.test(text), 'the loss is spelled out');
check(!/Google Drive restore/.test(text), 'Google Drive is only mentioned when it is connected');
check(/this computer/.test(text) && /local backup folder/.test(text), 'it lists where they are deleted from');
check((await dialog.locator('.confirm-thumbs img').count()) === 5, 'pictures show their preview');
check((await dialog.locator('.confirm-file').textContent()) === 'PDF', 'the PDF shows as a tile with its type');
check((await page.evaluate(() => document.activeElement?.textContent)) === 'Cancel', 'Cancel has the focus (Enter does not delete)');

await dialog.locator('button', { hasText: 'Cancel' }).click();
await sleep(400);
check((await dialog.count()) === 0 && (await files()) === 6, 'Cancel closes it and removes nothing');
await section.locator('button', { hasText: 'Clean up now' }).click();
await dialog.waitFor();
await page.keyboard.press('Escape');
await sleep(300);
check((await dialog.count()) === 0 && (await page.locator('.menu-panel').count()) === 1 && (await files()) === 6, 'Escape closes the window only, removing nothing');

await section.locator('button', { hasText: 'Clean up now' }).click();
await dialog.waitFor();
await dialog.locator('button', { hasText: 'Remove 6 files' }).click();
await dialog.waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
check((await dialog.count()) === 0, 'Remove closes the window at once (the removal runs in the background)');
await section.locator('.ok-text').waitFor();
check(/Removed 6 files and freed/.test(await section.locator('.ok-text').textContent()) && (await files()) === 0, 'Remove deletes them all, the PDF too, and says so');
check(await section.locator('button', { hasText: 'Clean up now' }).isDisabled(), 'with nothing left, the button is off');
check(!errors.length, 'no page errors', errors.join(' | '));

await browser.close();
done();
