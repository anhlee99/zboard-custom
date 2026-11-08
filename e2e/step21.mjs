// Menu → Backup & Restore: one section for the full backup (interval, this PC, Google Drive) and the
// unused-pictures cleanup. Needs a server on ZB_URL from an empty data dir (no Google Drive set up).
import { api, check, done, launch, login, sleep } from './lib.mjs';

await api('GET', '/api/me');
const browser = await launch();
const { page } = await login(browser, { width: 1200, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.click('[aria-label="Menu"]');
const titles = await page.locator('.menu-section h4').allTextContents();
check(titles.includes('Backup & Restore') && !titles.includes('Backups') && !titles.includes('Google Drive') && !titles.includes('Unused files'), 'one Backup & Restore section instead of three', titles.join(' | '));
const section = page.locator('.menu-section').filter({ has: page.locator('h4', { hasText: 'Backup & Restore' }) });
const text = async () => (await section.innerText()).replace(/\s+/g, ' ');
await section.locator('#backup-days').waitFor();

check(/Google Drive not set up/.test(await text()), 'it says Google Drive is not set up', await text());
check((await section.locator('.menu-sub h5').textContent()) === 'Unused pictures', 'the unused-pictures cleanup sits inside it');
check(/Back up every 1 day/.test(await text()) || (await section.locator('#backup-days').inputValue()) === '1', 'backs up every 1 day by default');

// Back up now: this PC (no Drive here).
await section.locator('button', { hasText: 'Back up now' }).click();
await page.waitForFunction(() => /this PC ✓/.test(document.querySelector('.menu-panel').innerText), null, { timeout: 10000 });
check(/Last backup .+ · this PC ✓/.test(await text()) && !/Google Drive ✓/.test(await text()), 'Back up now: last backup shows this PC ✓');
check((await api('GET', '/api/backup')).snapshots.length === 1, 'and a snapshot was saved');

// The interval: type a number, Enter saves it; out of range is ignored.
const days = section.locator('#backup-days');
await days.fill('7');
await days.press('Enter');
await sleep(600);
check((await api('GET', '/api/backup')).every_days === 7, 'typing 7 + Enter saves every 7 days');
check((await section.locator('#backup-days').inputValue()) === '7' && /days · next \d/.test(await text()), 'and shows 7 with the next date', await text());
await section.locator('#backup-days').fill('99');
await section.locator('#backup-days').press('Enter');
await sleep(600);
check((await api('GET', '/api/backup')).every_days === 7, 'an out-of-range number is not saved');

await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step21-backup.png' });
check(!errors.length, 'no page errors', errors.join(' | '));
await browser.close();
done();
