// Demo build: stands in for server/src/sqlite.js. Gives SQLite compiled to WebAssembly the same small
// API db.js expects (prepare().run/get/all, transaction, exec), so the real server data layer runs
// unchanged inside the browser. Call useSqlite() before createStore().
let sqlite3 = null;
let initial = null; // bytes of a saved database to start from, or null for a new one
let current = null;

export function useSqlite(module, bytes) {
  sqlite3 = module;
  initial = bytes || null;
}

// The whole database as bytes, to save in the browser's storage.
export const exportBytes = () => sqlite3.capi.sqlite3_js_db_export(current.pointer);

const NAMED = /([:@$])([A-Za-z_]\w*)/g;

function bindFor(sql, args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !ArrayBuffer.isView(args[0])) {
    const out = {};
    for (const [, prefix, name] of sql.matchAll(NAMED)) {
      const v = args[0][name] ?? args[0][prefix + name];
      out[prefix + name] = v === undefined ? null : v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  const flat = args.flat().map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  return flat.length ? flat : undefined;
}

function openBytes(bytes) {
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  if (bytes?.length) {
    const p = sqlite3.wasm.allocFromTypedArray(bytes);
    const F = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', p, bytes.length, bytes.length, F);
    db.checkRc(rc);
  }
  return db;
}

export function openDatabase() {
  if (!sqlite3) throw new Error('useSqlite() first');
  const raw = openBytes(initial);
  current = raw;
  raw.exec('PRAGMA foreign_keys = ON;');
  const rows = (sql, a) => raw.exec({ sql, bind: bindFor(sql, a), rowMode: 'object', returnValue: 'resultRows' }).map((r) => ({ ...r }));

  function prepare(sql) {
    return {
      run: (...a) => {
        raw.exec({ sql, bind: bindFor(sql, a) });
        return { changes: raw.changes(), lastInsertRowid: Number(sqlite3.capi.sqlite3_last_insert_rowid(raw.pointer)) };
      },
      get: (...a) => rows(sql, a)[0],
      all: (...a) => rows(sql, a),
    };
  }

  let depth = 0;
  function transaction(fn) {
    return (...args) => {
      const outer = depth === 0;
      raw.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT sp${depth}`);
      depth++;
      try {
        const r = fn(...args);
        depth--;
        raw.exec(outer ? 'COMMIT' : `RELEASE sp${depth}`);
        return r;
      } catch (e) {
        depth--;
        raw.exec(outer ? 'ROLLBACK' : `ROLLBACK TO sp${depth}; RELEASE sp${depth}`);
        throw e;
      }
    };
  }

  return { raw, prepare, transaction, exec: (sql) => raw.exec(sql), close: () => raw.close() };
}
