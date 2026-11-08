// Service worker for the online demo: answers the app's /api and /files requests with the
// in-browser backend (backend.js). The database and the pictures live in this browser's IndexedDB,
// so every visitor starts with an empty board of their own and nothing is sent anywhere.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createBackend } from './backend.js';

const DB_NAME = 'zboard-demo';

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('db');
      r.result.createObjectStore('files');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function op(storeName, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => {
      db.close(); // closed after each step, so "Start over" can delete the database
      resolve(req?.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
const storage = {
  loadDb: () => op('db', 'readonly', (s) => s.get('main')),
  saveDb: (bytes) => op('db', 'readwrite', (s) => s.put(bytes, 'main')),
  putFile: (key, blob) => op('files', 'readwrite', (s) => s.put(blob, key)),
  getFile: (key) => op('files', 'readonly', (s) => s.get(key)),
};

// Size, see-through or not, main colour, and an 800 px preview, like the server's sharp step.
const images = {
  async describe(blob) {
    const bmp = await createImageBitmap(blob);
    const { width, height } = bmp;
    const k = Math.min(1, 800 / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * k));
    const th = Math.max(1, Math.round(height * k));
    const canvas = new OffscreenCanvas(tw, th);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, tw, th);
    const sample = new OffscreenCanvas(24, 24).getContext('2d', { willReadFrequently: true });
    sample.drawImage(bmp, 0, 0, 24, 24);
    const px = sample.getImageData(0, 0, 24, 24).data;
    let alpha = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 250) alpha = 1;
      const a = px[i + 3] / 255; // on white, as the server does
      r += px[i] * a + 255 * (1 - a);
      g += px[i + 1] * a + 255 * (1 - a);
      b += px[i + 2] * a + 255 * (1 - a);
    }
    const n = px.length / 4;
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
    bmp.close?.();
    const thumb = blob.type === 'image/gif' || blob.type === 'image/svg+xml' ? null : await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    return { width, height, alpha, color: '#' + hex(r) + hex(g) + hex(b), thumb };
  },
};

let backend = null;
const ready = () =>
  (backend ??= sqlite3InitModule({ locateFile: (f) => new URL(f, self.registration.scope).href }).then((sqlite3) => createBackend({ sqlite3, storage, images })));

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !/\/(api|files)\//.test(url.pathname)) return;
  e.respondWith(ready().then((b) => b.handle(e.request)));
});

// "Start over" in the menu: forget everything and begin with an empty Home board again.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'reset') return;
  e.waitUntil(
    (async () => {
      backend = null;
      await new Promise((resolve) => {
        const r = indexedDB.deleteDatabase(DB_NAME);
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      });
      e.source?.postMessage({ type: 'reset-done' });
    })()
  );
});
