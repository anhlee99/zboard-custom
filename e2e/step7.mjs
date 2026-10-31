// Step 7 checks: a 1000-image board (made with the stress script) stays fast.
// Frame times come from requestAnimationFrame while the page pans itself with wheel events.
import { execFileSync } from 'node:child_process';
import { api, BASE, check, done, launch, login, noisePng, sleep } from './lib.mjs';

const DATA_DIR = process.env.ZB_DATA_DIR || '/tmp/zb-e2e';
const stress = (args) =>
  execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', 'bash', '-lc', `. ~/.nvm/nvm.sh >/dev/null; cd ~/zboard && DATA_DIR=${DATA_DIR} bash server/scripts/stress-test.sh ${args}`], { encoding: 'utf8' });

// Some real-sized images to clone.
await api('GET', '/api/me');
for (let i = 0; i < 12; i++) {
  const fd = new FormData();
  fd.append('file', new Blob([noisePng(1000, 600 + (i % 4) * 120, i + 1)], { type: 'image/png' }), `photo-${i}.png`);
  await fetch(BASE + '/api/upload', { method: 'POST', headers: { cookie: api.cookie }, body: fd });
}
const statsBefore = await api('GET', '/api/stats');

const out = stress('1000 --title "Stress 1000"');
const boardId = out.match(/#\/b\/(\S+)/)?.[1];
check(/1000 image cards \(1000 file copies\)/.test(out), 'stress script made a 1000-image board with real file copies', out.trim());
const stats = await api('GET', '/api/stats');
check(stats.files === statsBefore.files + 1000 && stats.cards === statsBefore.cards + 1001, 'stats count the new cards and files');

const browser = await launch();
const { page } = await login(browser);
await page.waitForSelector('.canvas');

async function framesWhilePanning(ms = 2500) {
  return page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const canvas = document.querySelector('.canvas');
        const r = canvas.getBoundingClientRect();
        const frames = [];
        let last = 0;
        let end = 0;
        let i = 0;
        let net = 0; // how far the pan has gone, so it can come back at the end
        function tick(t) {
          if (last) frames.push(t - last);
          last = t;
          if (!end) end = t + ms;
          const dir = Math.floor(i++ / 60) % 2 ? -1 : 1;
          net += dir;
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 14 * dir, deltaY: 9 * dir, bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
          if (t < end) requestAnimationFrame(tick);
          else {
            // Return to where it started, whatever the frame rate was.
            canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: -14 * net, deltaY: -9 * net, bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
            const sorted = [...frames].sort((a, b) => a - b);
            const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
            resolve({ fps: Math.round(1000 / avg), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), max: Math.round(sorted.at(-1)), frames: frames.length });
          }
        }
        requestAnimationFrame(tick);
      }),
    ms
  );
}
const visibleImages = () => page.evaluate(() => [...document.querySelectorAll('.card-image img')].length);

// --- open the board cold ---
const t0 = Date.now();
await page.goto(`${BASE}/#/b/${boardId}`);
await page.waitForSelector('.card-image img');
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const openMs = Date.now() - t0;
check(openMs < 3000, `cold open is usable in ${openMs} ms (< 3 s)`);
await sleep(1500);
const rendered = await visibleImages();
check(rendered < 400, `only cards near the screen are rendered at 100% (${rendered} of 1000)`);

// --- pan at 100% ---
const pan = await framesWhilePanning();
console.log('  100% pan:', JSON.stringify(pan));
check(pan.fps >= 55, `pans at ${pan.fps} fps at 100% zoom (target 60)`);

// --- zoomed out, everything visible ---
// Right-click a gap between cards (the board is covered at 100%).
const gap = await page.evaluate(() => {
  const c = document.querySelector('.canvas');
  const r = c.getBoundingClientRect();
  for (let y = r.top + 100; y < r.bottom - 50; y += 7)
    for (let x = r.left + 100; x < r.right - 300; x += 7) if (document.elementFromPoint(x, y) === c) return { x, y };
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(gap.x, gap.y, { button: 'right' });
await page.locator('.ctx-item', { hasText: 'Fit to screen' }).click();
await sleep(500);
const zoom = Number((await page.locator('.zoom-pct').textContent()).replace('%', ''));
await page.waitForFunction(() => document.querySelectorAll('.card-image img').length >= 1000, null, { timeout: 15000 }).catch(() => {});
const all = await visibleImages();
const minis = await page.evaluate(() => [...document.querySelectorAll('.card-image img')].filter((i) => /\/(mini|micro)$/.test(i.src)).length);
check(zoom < 45 && all === 1000 && minis === all, `zoomed out to ${zoom}%: all ${all} cards shown with small previews (${minis})`);
await sleep(2500); // let the minis arrive
const far = await framesWhilePanning();
console.log('  zoomed-out pan:', JSON.stringify(far));
check(far.fps >= 17 && far.max < 1000, `zoomed out: ${far.fps} fps, longest frame ${far.max} ms (target ≥ 17 fps, no multi-second freeze)`);

// --- far out the board is one picture; the real cards still take clicks ---
const snapInfo = await page.evaluate(() => ({ snap: document.querySelector('.world').classList.contains('snap'), canvas: !!document.querySelector('.far-snapshot')?.width }));
check(snapInfo.snap && snapInfo.canvas, 'far out, the board is drawn as one picture', JSON.stringify(snapInfo));
const hiddenCard = await page.evaluate(() => {
  for (const el of document.querySelectorAll('.world > .card-image')) {
    const r = el.getBoundingClientRect();
    if (r.left > 120 && r.top > 120 && r.right < innerWidth - 120 && r.bottom < innerHeight - 120 && getComputedStyle(el).opacity === '0') return { id: el.dataset.cardId, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return null;
});
await page.mouse.click(hiddenCard.x, hiddenCard.y);
await sleep(300);
check(await page.evaluate((id) => { const el = document.querySelector(`[data-card-id="${id}"]`); return el.classList.contains('selected') && getComputedStyle(el).opacity === '1'; }, hiddenCard.id), 'clicking the picture selects the real card, which then shows live');
await page.keyboard.press('Escape');

// --- drag still works on the big board ---
await page.keyboard.press('0');
await sleep(800);
const canvasBox = await page.locator('.canvas').boundingBox();
const cx = canvasBox.x + canvasBox.width / 2;
const cy = canvasBox.y + canvasBox.height / 2;
// A card fully on screen, nearest the middle (the exact middle may be a gap between cards).
const pickCard = await page.evaluate(([x, y]) => {
  let best = null;
  for (const el of document.querySelectorAll('.world > .card-image')) {
    const r = el.getBoundingClientRect();
    if (r.top < 60 || r.left < 80 || r.bottom > innerHeight - 10 || r.right > innerWidth - 10) continue;
    const d = Math.hypot(r.x + r.width / 2 - x, r.y + r.height / 2 - y);
    if (!best || d < best.d) best = { d, id: el.dataset.cardId, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return best;
}, [cx, cy]);
const id = pickCard?.id;
const x0 = (await api('GET', `/api/boards/${boardId}`)).cards.find((c) => c.id === id)?.x;
const tDrag = Date.now();
await page.mouse.move(pickCard.x, pickCard.y);
await page.mouse.down();
for (let i = 1; i <= 15; i++) await page.mouse.move(pickCard.x + i * 6, pickCard.y + i * 4);
await page.mouse.up();
const dragMs = Date.now() - tDrag;
await sleep(500);
const moved = (await api('GET', `/api/boards/${boardId}`)).cards.find((c) => c.id === id);
check(id && Math.abs(moved.x - (x0 + 90)) < 3, `dragging a card on the big board works (${dragMs} ms for 15 moves)`, `${id} ${x0} -> ${moved?.x}`);
await page.screenshot({ path: (process.env.SHOT_DIR || '.') + '/step7-zoomed.png' });
await browser.close();

// --- cleanup ---
const cleaned = stress('--cleanup');
const statsAfter = await api('GET', '/api/stats');
check(/Removed 1 stress board\(s\), 1001 card\(s\), 1000 copied file\(s\)/.test(cleaned), 'stress-test.sh --cleanup removes board, cards and copied files', cleaned.trim());
check(statsAfter.boards === statsBefore.boards && statsAfter.cards === statsBefore.cards && statsAfter.files === statsBefore.files && statsAfter.stored_bytes === statsBefore.stored_bytes, 'stats are back to what they were');
const left = execFileSync('wsl.exe', ['-d', 'Ubuntu', '--exec', 'bash', '-c', `ls ${DATA_DIR}/files | wc -l; ls ${DATA_DIR}/thumbs | wc -l`], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
check(left[0] === statsBefore.files && left[1] === statsBefore.files, `copied files gone from disk (${left.join('/')} left)`);
done();
