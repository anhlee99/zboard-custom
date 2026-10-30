// ZBoard server: one Express process serving the API, files and live sync.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import sharp from 'sharp';
import cron from 'node-cron';
import { ZipArchive } from 'archiver';
import { createStore, HttpError, isId, newId } from './db.js';
import { createDrive, createLocalBackups } from './backup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const BACKUP_DIR = path.resolve(ROOT, process.env.BACKUP_DIR || 'backup');
const BACKUP_CRON = (process.env.BACKUP_CRON ?? '0 3 * * *').trim();
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP) || 14;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 50;
const APP_PASSWORD = process.env.APP_PASSWORD;

if (!APP_PASSWORD) {
  console.error('APP_PASSWORD is not set. Copy .env.example to .env and set a password.');
  process.exit(1);
}

const DIRS = Object.fromEntries(['files', 'thumbs', 'minis', 'tmp'].map((d) => [d, path.join(DATA_DIR, d)]));
for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(DIRS.tmp)) fs.rmSync(path.join(DIRS.tmp, f), { force: true });

const DB_FILE = path.join(DATA_DIR, 'zboard.db');
let store = createStore(DB_FILE); // replaced by a Google Drive restore

// ---- secrets ----
const secret = (key) => {
  let v = store.getMeta(key);
  if (!v) store.setMeta(key, (v = crypto.randomBytes(32).toString('base64url')));
  return v;
};
const SESSION_SECRET = secret('session_secret');
let apiToken = secret('api_token');

function writeCliToken() {
  const file = path.join(DATA_DIR, 'cli-token');
  fs.writeFileSync(file, apiToken + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
writeCliToken();

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sameSecret = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// ---- live sync (SSE) ----
const streams = new Map(); // board id -> Set of responses

function emit(boardId, type, payload, clientId) {
  const set = streams.get(boardId);
  if (!set?.size) return;
  const msg = `event: ${type}\ndata: ${JSON.stringify({ ...payload, board: boardId, clientId: clientId ?? null })}\n\n`;
  for (const res of set) res.write(msg);
}

function groupBy(list, key) {
  const m = new Map();
  for (const item of list) {
    const k = key(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, 25_000).unref();

// ---- app ----
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser(SESSION_SECRET));

const COOKIE = 'zb_session';
const clientId = (req) => req.get('x-client-id') || null;

function authed(req) {
  const h = req.get('authorization');
  if (h?.startsWith('Bearer ')) return sameSecret(h.slice(7).trim(), apiToken);
  return req.signedCookies?.[COOKIE] === 'v1';
}

app.post('/api/login', async (req, res) => {
  if (!sameSecret(req.body?.password ?? '', APP_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 400));
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.cookie(COOKIE, 'v1', { signed: true, httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 400 * 24 * 3600 * 1000 });
  res.json({ ok: true });
});

app.use(['/api', '/files'], (req, res, next) => {
  if (authed(req)) return next();
  res.status(401).json({ error: 'Not logged in' });
});

// Successful writes mark the data dirty for the Google Drive backup (uploaded once edits stop).
const NOT_DATA = /^\/(logout|token|backup|drive|link-preview)/;
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !NOT_DATA.test(req.path)) {
    res.on('finish', () => {
      if (res.statusCode < 400) drive.markDirty();
    });
  }
  next();
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ ok: true }));

app.get('/api/token', (req, res) => res.json({ token: apiToken }));
app.post('/api/token/rotate', (req, res) => {
  apiToken = crypto.randomBytes(32).toString('base64url');
  store.setMeta('api_token', apiToken);
  writeCliToken();
  res.json({ token: apiToken });
});

// ---- boards ----
app.get('/api/boards', (req, res) => res.json({ boards: store.listBoards() }));

app.get('/api/boards/:id', (req, res) => res.json(store.boardPayload(req.params.id, req.query.files === '1')));

app.patch('/api/boards/:id', (req, res) => {
  const board = store.patchBoard(req.params.id, req.body ?? {});
  const msg = { board, breadcrumbs: store.breadcrumbs(board.id) };
  emit(board.id, 'board', msg, clientId(req));
  if (board.parent_id) emit(board.parent_id, 'board', msg, clientId(req));
  res.json({ board });
});

// ---- cards ----
app.post('/api/boards/:id/cards', (req, res) => {
  const body = req.body;
  const single = !Array.isArray(body?.cards) && !Array.isArray(body);
  const list = Array.isArray(body) ? body : single ? [body] : body.cards;
  const cards = store.createCards(req.params.id, list);
  emit(req.params.id, 'cards', { cards }, clientId(req));
  res.status(201).json(single ? { card: cards[0], cards } : { cards });
});

app.patch('/api/cards', (req, res) => {
  const list = Array.isArray(req.body) ? req.body : req.body?.cards;
  const { changes, arrowsMoved, arrowsDeleted } = store.patchCards(list);
  const cid = clientId(req);
  const left = changes.filter((c) => c.before.board_id !== c.after.board_id);
  for (const [board, items] of groupBy(left, (c) => c.before.board_id)) {
    emit(board, 'delete', { ids: items.map((c) => c.after.id) }, cid);
  }
  for (const [board, items] of groupBy(changes, (c) => c.after.board_id)) {
    emit(board, 'cards', { cards: items.map((c) => c.after) }, cid);
  }
  for (const c of left) {
    if (c.after.type === 'board' && c.after.child) {
      const child = store.getBoard(c.after.child.id);
      emit(child.id, 'board', { board: child, breadcrumbs: store.breadcrumbs(child.id) }, cid);
    }
  }
  for (const [board, items] of groupBy(arrowsMoved, (m) => m.from)) emit(board, 'arrows', { arrows: [], deleted: items.map((m) => m.arrow.id) }, cid);
  for (const [board, items] of groupBy(arrowsMoved, (m) => m.arrow.board_id)) emit(board, 'arrows', { arrows: items.map((m) => m.arrow), deleted: [] }, cid);
  for (const [board, items] of groupBy(arrowsDeleted, (a) => a.board_id)) emit(board, 'arrows', { arrows: [], deleted: items.map((a) => a.id) }, cid);
  res.json({ cards: changes.map((c) => c.after) });
});

app.post('/api/cards/delete', (req, res) => {
  const ids = Array.isArray(req.body) ? req.body : req.body?.ids;
  const { snapshot, removed, removedArrows } = store.deleteCards(ids);
  const cid = clientId(req);
  for (const [board, items] of groupBy(removed, (c) => c.board_id)) emit(board, 'delete', { ids: items.map((c) => c.id) }, cid);
  for (const [board, items] of groupBy(removedArrows, (a) => a.board_id)) emit(board, 'arrows', { arrows: [], deleted: items.map((a) => a.id) }, cid);
  res.json({ snapshot });
});

app.post('/api/restore', (req, res) => {
  const { cards, arrows } = store.restore(req.body?.snapshot ?? req.body);
  const cid = clientId(req);
  for (const [board, items] of groupBy(cards, (c) => c.board_id)) emit(board, 'cards', { cards: items }, cid);
  for (const [board, items] of groupBy(arrows, (a) => a.board_id)) emit(board, 'arrows', { arrows: items, deleted: [] }, cid);
  res.json({ cards, arrows });
});

// ---- arrows ----
app.post('/api/boards/:id/arrows', (req, res) => {
  const arrow = store.createArrow(req.params.id, req.body);
  emit(arrow.board_id, 'arrows', { arrows: [arrow], deleted: [] }, clientId(req));
  res.status(201).json({ arrow });
});

app.patch('/api/arrows/:id', (req, res) => {
  const arrow = store.patchArrow(req.params.id, req.body ?? {});
  emit(arrow.board_id, 'arrows', { arrows: [arrow], deleted: [] }, clientId(req));
  res.json({ arrow });
});

app.delete('/api/arrows/:id', (req, res) => {
  const arrow = store.deleteArrow(req.params.id);
  emit(arrow.board_id, 'arrows', { arrows: [], deleted: [arrow.id] }, clientId(req));
  res.json({ ok: true });
});

// ---- files ----
const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
};

function safeExt(name, mime) {
  const ext = path.extname(name || '').toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : MIME_EXT[mime] || '.bin';
}

const upload = multer({ dest: DIRS.tmp, limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });

const thumbPath = (id) => path.join(DIRS.thumbs, id + '.webp');
const miniPath = (id) => path.join(DIRS.minis, id + '.webp');
const originalPath = (f) => path.join(DIRS.files, f.id + f.ext);
const displayPath = (f) => path.join(DIRS.files, f.id + (f.display_ext || f.ext));

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];

// Display copy (HEIC only) and the upright 800 px thumbnail. Originals are never touched.
async function makeDerivatives(row, isHeic) {
  const out = {};
  let src = originalPath(row);
  if (isHeic) {
    // Browsers can't show HEIC; keep the original and add a JPEG copy for display.
    src = path.join(DIRS.files, row.id + '.jpg');
    await sharp(originalPath(row)).rotate().jpeg({ quality: 90 }).toFile(src);
    out.display_ext = '.jpg';
    out.mime = 'image/heic';
  }
  const meta = await sharp(src).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  out.width = turned ? meta.height : meta.width;
  out.height = turned ? meta.width : meta.height;
  await sharp(src).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(thumbPath(row.id));
  return out;
}

// f: { path, originalname, mimetype, size }; the temp file at f.path is moved into files/.
async function storeUpload(f, { utf8Name = false } = {}) {
  const id = newId();
  const name = utf8Name ? f.originalname : Buffer.from(f.originalname, 'latin1').toString('utf8');
  const ext = safeExt(name, f.mimetype);
  const dest = path.join(DIRS.files, id + ext);
  fs.renameSync(f.path, dest);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  const row = { id, name, mime: f.mimetype, ext, size: f.size, width: null, height: null, sha256: hash, display_ext: null, created_at: Date.now() };

  const isHeic = /^\.(heic|heif)$/.test(ext) || /heic|heif/.test(f.mimetype);
  const isImage = isHeic || f.mimetype.startsWith('image/') || IMAGE_EXTS.includes(ext);
  if (isImage) {
    try {
      Object.assign(row, await makeDerivatives(row, isHeic));
    } catch (e) {
      for (const p of [dest, path.join(DIRS.files, id + '.jpg'), thumbPath(id)]) fs.rmSync(p, { force: true });
      if (isHeic) {
        throw new HttpError(
          415,
          `Can't read the HEIC photo "${name}": this server's image library can't decode HEIC. ` +
            'Set the phone camera to "Most Compatible" (JPEG), or convert the photo to JPEG, and upload it again.'
        );
      }
      throw new HttpError(415, `Can't read the image "${name}": ${e.message}`);
    }
  }
  store.insertFile(row);
  return row;
}

app.post('/api/upload', upload.array('file', 50), async (req, res) => {
  const files = [];
  try {
    for (const f of req.files ?? []) files.push(await storeUpload(f));
  } finally {
    for (const f of req.files ?? []) fs.rmSync(f.path, { force: true });
  }
  if (!files.length) throw new HttpError(400, 'No file sent (use the form field "file")');
  res.status(201).json({ file: files[0], files });
});

// ---- remote fetches (link previews, images dragged from other sites) ----
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 ZBoard';

function httpUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol === 'http:' || u.protocol === 'https:') return u;
  } catch {}
  throw new HttpError(400, 'Not a valid http(s) link');
}

async function fetchCapped(url, maxBytes, accept) {
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': UA, accept } });
  } catch (e) {
    throw new HttpError(502, `Couldn't reach ${new URL(url).host}: ${e.cause?.code || e.message}`);
  }
  if (!res.ok) throw new HttpError(502, `${new URL(url).host} answered ${res.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) {
      await res.body.cancel?.().catch(() => {});
      throw new HttpError(413, `Download is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    chunks.push(chunk);
  }
  return { buf: Buffer.concat(chunks), type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(), finalUrl: res.url || url };
}

async function storeRemoteImage(url) {
  const { buf, type, finalUrl } = await fetchCapped(url, MAX_UPLOAD_MB * 1024 * 1024, 'image/avif,image/webp,image/*,*/*;q=0.8');
  if (type && !type.startsWith('image/') && type !== 'application/octet-stream') throw new HttpError(415, `That link is not an image (${type})`);
  const tmp = path.join(DIRS.tmp, 'dl-' + newId());
  fs.writeFileSync(tmp, buf);
  const base = decodeURIComponent(path.basename(new URL(finalUrl).pathname)) || 'image';
  try {
    return await storeUpload({ path: tmp, originalname: base.slice(0, 200), mimetype: type || 'application/octet-stream', size: buf.length }, { utf8Name: true });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m
  );

function parseMeta(html) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1].toLowerCase()] = m[2] ?? m[3];
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content && !(key in meta)) meta[key] = decodeEntities(attrs.content).trim();
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) meta['<title>'] = decodeEntities(title).replace(/\s+/g, ' ').trim();
  return meta;
}

app.get('/api/link-preview', async (req, res) => {
  const url = httpUrl(req.query.url);
  const { buf, type, finalUrl } = await fetchCapped(url.href, 3 * 1024 * 1024, 'text/html,application/xhtml+xml,*/*;q=0.5');
  const out = { url: url.href, title: null, description: null, site: new URL(finalUrl).hostname.replace(/^www\./, ''), image: null };
  if (type.startsWith('image/')) {
    out.image = (await storeRemoteImage(url.href)).id;
    out.title = path.basename(url.pathname) || out.site;
    return res.json(out);
  }
  const meta = parseMeta(buf.toString('utf8'));
  out.title = meta['og:title'] || meta['twitter:title'] || meta['<title>'] || out.site;
  out.description = meta['og:description'] || meta['twitter:description'] || meta.description || null;
  out.site = meta['og:site_name'] || out.site;
  const img = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'];
  if (img) {
    try {
      out.image = (await storeRemoteImage(new URL(img, finalUrl).href)).id;
    } catch {
      // A preview without a picture is still useful.
    }
  }
  res.json(out);
});

app.post('/api/upload-url', async (req, res) => {
  const file = await storeRemoteImage(httpUrl(req.body?.url).href);
  res.status(201).json({ file, files: [file] });
});

function fileOr404(id) {
  const f = isId(id) && store.getFile(id);
  if (!f) throw new HttpError(404, 'File not found');
  return f;
}

const IMMUTABLE = { 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' };

app.get('/api/files/:id/info', (req, res) => res.json({ file: fileOr404(req.params.id) }));

app.get('/files/:id', (req, res) => {
  const f = fileOr404(req.params.id);
  const original = req.query.original === '1' || !f.display_ext;
  res.type(original ? f.ext : f.display_ext);
  res.sendFile(original ? originalPath(f) : displayPath(f), {
    headers: {
      ...IMMUTABLE,
      'Content-Security-Policy': 'sandbox',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name || f.id + f.ext)}`,
    },
  });
});

app.get('/files/:id/thumb', (req, res) => {
  const f = fileOr404(req.params.id);
  if (!fs.existsSync(thumbPath(f.id))) throw new HttpError(404, 'No thumbnail for this file');
  res.sendFile(thumbPath(f.id), { headers: IMMUTABLE });
});

const miniJobs = new Map();
app.get('/files/:id/mini', async (req, res) => {
  const f = fileOr404(req.params.id);
  const out = miniPath(f.id);
  if (!fs.existsSync(out)) {
    if (!fs.existsSync(thumbPath(f.id))) throw new HttpError(404, 'No thumbnail for this file');
    if (!miniJobs.has(f.id)) {
      const job = sharp(thumbPath(f.id))
        .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 70 })
        .toBuffer()
        .then((buf) => {
          const tmp = path.join(DIRS.tmp, `mini-${f.id}`);
          fs.writeFileSync(tmp, buf);
          fs.renameSync(tmp, out);
        })
        .finally(() => miniJobs.delete(f.id));
      miniJobs.set(f.id, job);
    }
    await miniJobs.get(f.id);
  }
  res.sendFile(out, { headers: IMMUTABLE });
});

// ---- search and tags ----
app.get('/api/search', (req, res) => {
  if (req.query.tag) return res.json({ results: store.byTag(String(req.query.tag)) });
  res.json({ results: store.search(String(req.query.q || '')) });
});
app.get('/api/tags', (req, res) => res.json({ tags: store.listTags() }));

// ---- stats, backups, export ----
const dirSize = (dir) => {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) if (f.isFile()) n += fs.statSync(path.join(dir, f.name)).size;
  return n;
};
app.get('/api/stats', (req, res) => {
  const dbBytes = ['', '-wal'].reduce((n, s) => n + (fs.existsSync(DB_FILE + s) ? fs.statSync(DB_FILE + s).size : 0), 0);
  res.json({ ...store.stats(), db_bytes: dbBytes, thumbs_bytes: dirSize(DIRS.thumbs) + dirSize(DIRS.minis), data_dir: DATA_DIR });
});

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const local = createLocalBackups({ getStore: () => store, dataDir: DATA_DIR, backupDir: BACKUP_DIR, keep: BACKUP_KEEP, log });

app.get('/api/backup', (req, res) =>
  res.json({ status: local.status(), dir: BACKUP_DIR, cron: BACKUP_CRON, keep: BACKUP_KEEP, snapshots: local.list().slice(0, BACKUP_KEEP) })
);
app.post('/api/backup', async (req, res) => res.json({ status: await local.run() }));

const slug = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);

app.get('/api/export/:boardId', (req, res) => {
  const tree = store.exportTree(req.params.boardId);
  const root = tree.boards[0];
  res.attachment(`zboard-${slug(root.title) || 'board'}-${new Date().toISOString().slice(0, 10)}.zip`);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('warning', (e) => log('export warning: ' + e.message));
  zip.on('error', (e) => {
    log('export failed: ' + e.message);
    res.destroy(e);
  });
  zip.pipe(res);
  const doc = { format: 'zboard-export', version: 1, exported_at: new Date().toISOString(), root: root.id, ...tree };
  zip.append(JSON.stringify(doc, null, 2), { name: 'board.json' });
  for (const f of tree.files) {
    if (fs.existsSync(originalPath(f))) zip.file(originalPath(f), { name: `files/${f.id}${f.ext}` });
  }
  zip.finalize();
});

// ---- Google Drive ----
const KEEP_ON_RESTORE = ['session_secret', 'api_token', 'drive_refresh_token', 'drive_folders', 'drive_salt', 'drive_state'];

// Swap in a restored database, keeping this server's secrets and Drive connection.
async function replaceDatabase(tmp) {
  const incoming = createStore(tmp);
  for (const k of KEEP_ON_RESTORE) incoming.setMeta(k, store.getMeta(k) ?? '');
  incoming.close();
  store.close();
  for (const s of ['-wal', '-shm']) fs.rmSync(DB_FILE + s, { force: true });
  fs.renameSync(tmp, DB_FILE);
  for (const s of ['-wal', '-shm']) fs.rmSync(tmp + s, { force: true });
  store = createStore(DB_FILE);
  for (const f of store.allFiles()) {
    const image = IMAGE_EXTS.includes(f.ext) || f.display_ext;
    if (!image || fs.existsSync(thumbPath(f.id)) || !fs.existsSync(originalPath(f))) continue;
    await makeDerivatives(f, Boolean(f.display_ext)).catch((e) => log(`thumbnail for ${f.id} failed: ${e.message}`));
  }
  for (const [board] of streams) emit(board, 'reload', {}, null);
}

const drive = createDrive({
  getStore: () => store,
  dataDir: DATA_DIR,
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  passphrase: process.env.GOOGLE_BACKUP_PASSPHRASE || '',
  debounceMs: Number(process.env.DRIVE_DEBOUNCE_MS) || 90_000,
  log,
  onRestore: replaceDatabase,
});

app.get('/api/drive', (req, res) => res.json(drive.status()));
app.post('/api/drive/connect', async (req, res) => res.json({ pending: await drive.connect() }));
app.post('/api/drive/disconnect', async (req, res) => res.json(await drive.disconnect()));
app.post('/api/drive/sync', async (req, res) => res.json(await drive.sync('manual')));
app.post('/api/drive/restore', async (req, res) => res.json(await drive.restore()));

if (BACKUP_CRON && BACKUP_CRON !== 'off') {
  if (!cron.validate(BACKUP_CRON)) {
    console.error(`BACKUP_CRON "${BACKUP_CRON}" is not a valid cron expression (use "off" to disable).`);
    process.exit(1);
  }
  cron.schedule(BACKUP_CRON, async () => {
    await local.run().catch(() => {});
    if (drive.status().connected) await drive.sync('nightly').catch(() => {});
  });
}

// ---- events ----
app.get('/api/events', (req, res) => {
  const board = String(req.query.board || 'root');
  if (!store.getBoard(board)) throw new HttpError(404, 'Board not found');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n: connected\n\n');
  if (!streams.has(board)) streams.set(board, new Set());
  streams.get(board).add(res);
  req.on('close', () => {
    const set = streams.get(board);
    set?.delete(res);
    if (set && !set.size) streams.delete(board);
  });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---- web app (only if built before start-up) ----
const WEB_DIST = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  app.use(
    express.static(WEB_DIST, {
      index: false,
      setHeaders(res, file) {
        const hashed = file.includes(`${path.sep}assets${path.sep}`);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    })
  );
  app.get(/^\/(?!api\/|files\/).*/, (req, res) => res.sendFile(path.join(WEB_DIST, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
} else {
  console.log('web/dist not found: serving the API only (run "npm run build" in web/ and restart).');
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${MAX_UPLOAD_MB} MB` : err.message;
    return res.status(status).json({ error: msg });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error: ' + err.message });
});

const server = app.listen(PORT);
server.on('listening', () => console.log(`ZBoard listening on http://localhost:${PORT} (data: ${DATA_DIR})`));
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is another ZBoard (or another app) running? Stop it first.`);
  else console.error('Server failed to start:', e.message);
  process.exit(1);
});

function shutdown() {
  server.close();
  for (const set of streams.values()) for (const res of set) res.end();
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
