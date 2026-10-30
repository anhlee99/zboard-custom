// ZBoard Clipper service worker: the right-click menu, and the uploads (so they finish after the popup closes).
import { boardTree, listBoards, saveImage, saveLink, saveText, settings } from './shared.js';

const CONTEXTS = ['image', 'link', 'selection', 'page'];
// For debugging from the service worker console (the e2e checks use it too).
globalThis.zboard = { menu: [] };
const create = (props) => {
  globalThis.zboard.menu.push({ id: props.id, parentId: props.parentId, title: props.title, type: props.type });
  return new Promise((resolve) => chrome.contextMenus.create({ contexts: CONTEXTS, ...props }, () => resolve(void chrome.runtime.lastError)));
};

// Rebuilds go through one queue so two can never interleave (that would create duplicate ids).
let queue = Promise.resolve();
function rebuildMenus() {
  queue = queue.then(buildMenus).catch((e) => console.warn('ZBoard menu:', e));
  return queue;
}

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  globalThis.zboard.menu = [];
  await create({ id: 'zb', title: 'Save to ZBoard' });
  const s = await settings();
  if (!s.server || !s.token) return create({ id: 'setup', parentId: 'zb', title: 'Set up ZBoard Clipper…' });
  let boards;
  try {
    boards = await listBoards();
  } catch (e) {
    return create({ id: 'setup', parentId: 'zb', title: e.reconnect ? 'Reconnect ZBoard Clipper…' : "Can't reach ZBoard – open settings…" });
  }
  const tree = boardTree(boards);
  const def = tree.find((b) => b.id === s.board) || tree[0];
  await create({ id: `d:${def.id}`, parentId: 'zb', title: `${def.title || 'Untitled'}  (default)` });
  await create({ id: 'sep', parentId: 'zb', type: 'separator' });
  const kids = (id) => tree.filter((b) => b.parent_id === id);
  async function add(b, parentId) {
    const children = kids(b.id);
    if (!children.length) return create({ id: `b:${b.id}`, parentId, title: b.title || 'Untitled' });
    await create({ id: `n:${b.id}`, parentId, title: b.title || 'Untitled' });
    await create({ id: `b:${b.id}`, parentId: `n:${b.id}`, title: `Save to “${b.title || 'Untitled'}”` });
    await create({ id: `s:${b.id}`, parentId: `n:${b.id}`, type: 'separator' });
    for (const c of children) await add(c, `n:${b.id}`);
  }
  for (const top of tree.filter((b) => b.depth === 0)) await add(top, 'zb');
}

chrome.runtime.onInstalled.addListener(rebuildMenus);
chrome.runtime.onStartup.addListener(rebuildMenus);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.server || changes.token || changes.board) rebuildMenus();
});

// ✓ on the toolbar icon plus a small message in the page.
function toast(message, ok) {
  const id = 'zboard-clipper-toast';
  document.getElementById(id)?.remove();
  const d = document.createElement('div');
  d.id = id;
  d.textContent = message;
  Object.assign(d.style, {
    position: 'fixed',
    zIndex: 2147483647,
    right: '20px',
    bottom: '20px',
    maxWidth: '380px',
    padding: '10px 14px',
    borderRadius: '8px',
    font: '14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif',
    color: '#fff',
    background: ok ? '#23221f' : '#c93a32',
    boxShadow: '0 6px 24px rgba(0,0,0,.25)',
  });
  document.documentElement.append(d);
  setTimeout(() => d.remove(), ok ? 2500 : 7000);
}

async function report(tabId, ok, message) {
  if (tabId == null || tabId < 0) return;
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#2f9e44' : '#c93a32', tabId }).catch(() => {});
  chrome.action.setBadgeText({ text: ok ? '✓' : '!', tabId }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }).catch(() => {}), 2500);
  chrome.scripting.executeScript({ target: { tabId }, func: toast, args: [message, ok] }).catch(() => {});
}

// Alt text of the right-clicked image, read from the page (empty if it can't be found).
async function altOf(tabId, frameId, src) {
  if (!tabId) return '';
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId || 0] },
      args: [src],
      func: (src) => {
        const img = [...document.images].find((i) => i.currentSrc === src || i.src === src);
        return (img?.alt || img?.title || '').trim().slice(0, 500);
      },
    });
    return res?.result || '';
  } catch {
    return '';
  }
}

async function onMenuClick(info, tab) {
  const id = String(info.menuItemId);
  if (id === 'setup') return chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?page=1') });
  const m = id.match(/^[bd]:(.+)$/);
  if (!m) return;
  const board = m[1];
  const page = { url: info.pageUrl || tab?.url, title: tab?.title };
  try {
    if (info.mediaType === 'image' && info.srcUrl) await saveImage({ src: info.srcUrl, board, page, alt: await altOf(tab?.id, info.frameId, info.srcUrl) });
    else if (info.linkUrl) await saveLink({ url: info.linkUrl, title: info.selectionText, board, page });
    else if (info.selectionText) await saveText({ text: info.selectionText, board, page });
    else await saveLink({ url: page.url, title: page.title, board, page });
    report(tab?.id, true, 'Saved to ZBoard');
  } catch (e) {
    report(tab?.id, false, e.message);
    if (e.reconnect) rebuildMenus();
  }
}
chrome.contextMenus.onClicked.addListener(onMenuClick);
Object.assign(globalThis.zboard, { rebuildMenus, onMenuClick });

async function saveImages({ items, board, page, tabId }) {
  let saved = 0;
  let error = null;
  for (const item of items) {
    const { src, alt } = typeof item === 'string' ? { src: item, alt: '' } : item;
    try {
      await saveImage({ src, board, page, alt });
      saved++;
    } catch (e) {
      error = e;
      if (e.reconnect) break;
    }
  }
  const ok = saved === items.length;
  report(tabId, ok, ok ? `Saved ${saved} image${saved === 1 ? '' : 's'} to ZBoard` : `Saved ${saved} of ${items.length}. ${error?.message || ''}`);
  return { saved, failed: items.length - saved, error: error?.message };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'rebuild') {
    rebuildMenus().then(() => reply({ ok: true }));
    return true;
  }
  if (msg?.type === 'saveImages') {
    saveImages(msg).then(reply);
    return true;
  }
  return false;
});
