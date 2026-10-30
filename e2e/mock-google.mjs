// Minimal stand-in for Google's device sign-in and the Drive v3 calls ZBoard uses.
// Run: node e2e/mock-google.mjs  (port MOCK_PORT, default 4555); point the server at it with
// GOOGLE_OAUTH_BASE=http://localhost:4555 GOOGLE_API_BASE=http://localhost:4555
import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT) || 4555;
const BASE = `http://localhost:${PORT}`;
let files = new Map();
let sessions = new Map();
let polls = 0;
let tokens = 0;
const id = () => crypto.randomBytes(8).toString('hex');

const read = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

function matches(f, q) {
  for (const clause of q.split(' and ').map((s) => s.trim())) {
    let m;
    const un = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if ((m = clause.match(/^name = '(.*)'$/))) {
      if (f.name !== un(m[1])) return false;
    } else if ((m = clause.match(/^mimeType = '(.*)'$/))) {
      if (f.mimeType !== m[1]) return false;
    } else if ((m = clause.match(/^'(.*)' in parents$/))) {
      if (!f.parents.includes(un(m[1]))) return false;
    } else if (clause === 'trashed = false') {
      if (f.trashed) return false;
    } else throw new Error('unsupported q clause: ' + clause);
  }
  return true;
}

const create = (meta, data = Buffer.alloc(0)) => {
  const f = { id: id(), name: meta.name, mimeType: meta.mimeType || 'application/octet-stream', parents: meta.parents || [], createdTime: new Date(Date.now() + files.size).toISOString(), data, trashed: false };
  files.set(f.id, f);
  return f;
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, BASE);
    const p = url.pathname;
    const body = await read(req);
    try {
      if (p === '/__state') {
        const all = [...files.values()];
        const folder = (name) => all.find((f) => f.name === name && f.mimeType.endsWith('folder'));
        const inFolder = (name) => all.filter((f) => folder(name) && f.parents.includes(folder(name).id));
        return json(res, 200, {
          folders: all.filter((f) => f.mimeType.endsWith('folder')).map((f) => f.name),
          files: inFolder('files').map((f) => ({ name: f.name, size: f.data.length })),
          snapshots: inFolder('snapshots').map((f) => ({ name: f.name, size: f.data.length, head: f.data.subarray(0, 4).toString('latin1') })),
          polls,
          tokens,
        });
      }
      if (p === '/__reset') {
        files = new Map();
        sessions = new Map();
        polls = 0;
        return json(res, 200, { ok: true });
      }
      if (p === '/device/code' && req.method === 'POST') {
        polls = 0;
        return json(res, 200, { device_code: 'device-' + id(), user_code: 'ZBRD-TEST', verification_url: 'https://www.google.com/device', expires_in: 600, interval: 1 });
      }
      if (p === '/token' && req.method === 'POST') {
        const form = new URLSearchParams(body.toString());
        if (form.get('grant_type') === 'refresh_token') return json(res, 200, { access_token: 'at-' + ++tokens, expires_in: 3600 });
        if (++polls < 2) return json(res, 428, { error: 'authorization_pending' });
        return json(res, 200, { access_token: 'at-' + ++tokens, expires_in: 3600, refresh_token: 'refresh-' + id() });
      }
      if (p === '/revoke') return json(res, 200, {});
      if (p.startsWith('/upload-session/') && req.method === 'PUT') {
        const meta = sessions.get(p.split('/').pop());
        if (!meta) return json(res, 404, { error: 'no session' });
        return json(res, 200, { id: create(meta, body).id });
      }
      if (!/^Bearer at-/.test(req.headers.authorization || '')) return json(res, 401, { error: 'unauthenticated' });
      if (p === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'resumable') {
        const sid = id();
        sessions.set(sid, JSON.parse(body.toString()));
        res.writeHead(200, { location: `${BASE}/upload-session/${sid}` });
        return res.end();
      }
      if (p === '/drive/v3/files' && req.method === 'GET') {
        let list = [...files.values()].filter((f) => matches(f, url.searchParams.get('q') || 'trashed = false'));
        const order = url.searchParams.get('orderBy') || '';
        if (order.startsWith('createdTime')) list.sort((a, b) => a.createdTime.localeCompare(b.createdTime) * (order.endsWith('desc') ? -1 : 1));
        return json(res, 200, { files: list.map((f) => ({ id: f.id, name: f.name, createdTime: f.createdTime, size: String(f.data.length) })) });
      }
      if (p === '/drive/v3/files' && req.method === 'POST') return json(res, 200, { id: create(JSON.parse(body.toString())).id });
      const m = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
      if (m && files.has(m[1])) {
        if (req.method === 'DELETE') {
          files.delete(m[1]);
          res.writeHead(204);
          return res.end();
        }
        if (req.method === 'GET' && url.searchParams.get('alt') === 'media') {
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          return res.end(files.get(m[1]).data);
        }
      }
      json(res, 404, { error: 'not found: ' + req.method + ' ' + p });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
  })
  .listen(PORT, () => console.log('mock google on ' + BASE));
