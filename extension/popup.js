import { boardTree, call, listBoards, saveLink, settings } from './shared.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const asPage = params.has('page'); // opened in a tab from the menu
const forcedTab = Number(params.get('tab')) || null; // popup.html?tab=<id>: work on that tab
if (asPage) document.body.classList.add('page');

function status(el, text, kind = '') {
  el.textContent = text;
  el.className = 'status ' + kind;
}

async function showSetup(message, kind = 'error') {
  const s = await settings();
  $('server').value = s.server || $('server').value || 'http://localhost:3000';
  $('token').value = s.token || '';
  $('setup').hidden = false;
  $('main').hidden = true;
  $('open-settings').hidden = true;
  status($('setup-status'), message || '', kind);
}

$('connect').onclick = async () => {
  const server = $('server').value.trim().replace(/\/+$/, '');
  const token = $('token').value.trim();
  if (!/^https?:\/\//i.test(server)) return status($('setup-status'), 'The address must start with http:// or https://', 'error');
  if (!token) return status($('setup-status'), 'Paste the token from ZBoard', 'error');
  $('connect').disabled = true;
  status($('setup-status'), 'Connecting…');
  try {
    await call('/api/me', { server, token });
    await chrome.storage.local.set({ server, token });
    await chrome.runtime.sendMessage({ type: 'rebuild' });
    showMain();
  } catch (e) {
    status($('setup-status'), e.message, 'error');
  } finally {
    $('connect').disabled = false;
  }
};
$('open-settings').onclick = () => showSetup('', '');

// Runs inside the page: images at least 120 px, og:image, and large CSS backgrounds.
function collectImages() {
  const found = new Map();
  const add = (src, w, h) => {
    if (!src || src.startsWith('blob:')) return;
    try {
      src = new URL(src, location.href).href;
    } catch {
      return;
    }
    if (!found.has(src)) found.set(src, { src, w, h });
  };
  const og = document.querySelector('meta[property="og:image"], meta[property="og:image:url"], meta[name="og:image"]');
  if (og?.content) add(og.content, 0, 0);
  for (const img of document.images) if (img.naturalWidth >= 120 && img.naturalHeight >= 120) add(img.currentSrc || img.src, img.naturalWidth, img.naturalHeight);
  let checked = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (++checked > 6000 || found.size > 200) break;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || !bg.includes('url(')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 120) continue;
    const m = bg.match(/url\(["']?(.*?)["']?\)/);
    if (m) add(m[1], Math.round(r.width), Math.round(r.height));
  }
  return [...found.values()].slice(0, 200);
}

let tab = null;
const chosen = new Set();

function updateSaveButton() {
  $('save-images').disabled = !chosen.size;
  $('save-images').textContent = chosen.size ? `Save ${chosen.size} image${chosen.size === 1 ? '' : 's'}` : 'Save images';
}

async function showMain() {
  $('setup').hidden = true;
  $('main').hidden = false;
  $('open-settings').hidden = false;
  const s = await settings();
  let boards;
  try {
    boards = boardTree(await listBoards());
  } catch (e) {
    return showSetup(e.message);
  }
  $('board').innerHTML = '';
  for (const b of boards) {
    const o = document.createElement('option');
    o.value = b.id;
    o.textContent = ' '.repeat(b.depth) + (b.title || 'Untitled');
    $('board').append(o);
  }
  $('board').value = boards.some((b) => b.id === s.board) ? s.board : boards[0]?.id;
  $('board').onchange = () => chrome.storage.local.set({ board: $('board').value });

  tab = forcedTab ? await chrome.tabs.get(forcedTab) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const pageOk = tab?.url && /^https?:/.test(tab.url) && (!asPage || forcedTab);
  $('save-page').disabled = !pageOk;
  $('save-page').onclick = async () => {
    status($('status'), 'Saving…');
    try {
      await saveLink({ url: tab.url, title: tab.title, board: $('board').value, page: { url: tab.url, title: tab.title } });
      status($('status'), 'Page link saved ✓', 'ok');
    } catch (e) {
      status($('status'), e.message, 'error');
    }
  };

  if (!pageOk) {
    $('images-label').textContent = asPage ? 'Open the popup on a web page to pick images.' : 'No images on this page.';
    return;
  }
  let images = [];
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectImages });
    images = res?.result || [];
  } catch {
    $('images-label').textContent = "Can't read images on this page.";
    return;
  }
  $('images-label').textContent = images.length ? `${images.length} image${images.length === 1 ? '' : 's'} on this page` : 'No large images on this page.';
  $('select-all').hidden = !images.length;
  $('select-all').onclick = () => {
    const all = chosen.size !== images.length;
    chosen.clear();
    if (all) images.forEach((i) => chosen.add(i.src));
    for (const t of $('grid').children) t.classList.toggle('on', chosen.has(t.dataset.src));
    updateSaveButton();
  };
  $('grid').innerHTML = '';
  for (const img of images) {
    const t = document.createElement('button');
    t.className = 'tile';
    t.dataset.src = img.src;
    t.title = img.w ? `${img.w}×${img.h}` : 'og:image';
    const el = document.createElement('img');
    el.src = img.src;
    el.loading = 'lazy';
    t.append(el);
    t.onclick = () => {
      if (chosen.has(img.src)) chosen.delete(img.src);
      else chosen.add(img.src);
      t.classList.toggle('on', chosen.has(img.src));
      updateSaveButton();
    };
    $('grid').append(t);
  }
  // The service worker does the uploads, so closing the popup doesn't stop them.
  $('save-images').onclick = () => {
    chrome.runtime.sendMessage({ type: 'saveImages', items: [...chosen], board: $('board').value, page: { url: tab.url, title: tab.title }, tabId: tab.id });
    status($('status'), `Saving ${chosen.size}… (you can close this)`, 'ok');
    setTimeout(() => window.close(), 600);
  };
}

chrome.runtime.sendMessage({ type: 'rebuild' }).catch(() => {});
settings().then((s) => (s.server && s.token ? showMain() : showSetup('', '')));
