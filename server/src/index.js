// ZBoard server: one Express process serving the API, files and live sync.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import sharp from 'sharp';
import { createStore, HttpError, isId, newId } from './db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 50;
const APP_PASSWORD = process.env.APP_PASSWORD;

if (!APP_PASSWORD) {
  console.error('APP_PASSWORD is not set. Copy .env.example to .env and set a password.');
  process.exit(1);
}

const DIRS = Object.fromEntries(['files', 'thumbs', 'minis', 'tmp'].map((d) => [d, path.join(DATA_DIR, d)]));
for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });
for (const f of fs.readdirSync(DIRS.tmp)) fs.rmSync(path.join(DIRS.tmp, f), { force: true });

const store = createStore(path.join(DATA_DIR, 'zboard.db'));

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

async function storeUpload(f) {
  const id = newId();
  const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
  const ext = safeExt(name, f.mimetype);
  const dest = path.join(DIRS.files, id + ext);
  fs.renameSync(f.path, dest);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  const row = { id, name, mime: f.mimetype, ext, size: f.size, width: null, height: null, sha256: hash, display_ext: null, created_at: Date.now() };

  const isHeic = /^\.(heic|heif)$/.test(ext) || /heic|heif/.test(f.mimetype);
  const isImage = isHeic || f.mimetype.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext);
  if (isImage) {
    try {
      let src = dest;
      if (isHeic) {
        // Browsers can't show HEIC; keep the original and add a JPEG copy for display.
        src = path.join(DIRS.files, id + '.jpg');
        await sharp(dest).rotate().jpeg({ quality: 90 }).toFile(src);
        row.display_ext = '.jpg';
        row.mime = 'image/heic';
      }
      const meta = await sharp(src).metadata();
      const turned = (meta.orientation ?? 1) >= 5;
      row.width = turned ? meta.height : meta.width;
      row.height = turned ? meta.width : meta.height;
      await sharp(src).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(thumbPath(id));
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
