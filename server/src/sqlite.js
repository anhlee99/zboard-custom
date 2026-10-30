// Wrapper giving node:sqlite a better-sqlite3-style API.
// node:sqlite rejects unknown named parameters and `undefined` values;
// this wrapper drops the former and turns the latter into null.
import { DatabaseSync } from 'node:sqlite';

const NAMED = /[:@$]([A-Za-z_]\w*)/g;

function normalise(sql, args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) && !ArrayBuffer.isView(args[0])) {
    const wanted = new Set([...sql.matchAll(NAMED)].map((m) => m[1]));
    const out = {};
    for (const [k, v] of Object.entries(args[0])) {
      const bare = k.replace(/^[:@$]/, '');
      if (wanted.has(bare)) out[bare] = v === undefined ? null : v;
    }
    return [out];
  }
  return args.flat().map((v) => (v === undefined ? null : v));
}

export function openDatabase(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const cache = new Map();

  function prepare(sql) {
    let st = cache.get(sql);
    if (!st) {
      st = raw.prepare(sql);
      cache.set(sql, st);
    }
    return {
      run: (...a) => {
        const r = st.run(...normalise(sql, a));
        return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
      },
      get: (...a) => st.get(...normalise(sql, a)),
      all: (...a) => st.all(...normalise(sql, a)),
    };
  }

  let depth = 0;
  function transaction(fn) {
    return (...args) => {
      const outer = depth === 0;
      if (outer) raw.exec('BEGIN IMMEDIATE');
      else raw.exec(`SAVEPOINT sp${depth}`);
      depth++;
      try {
        const r = fn(...args);
        depth--;
        if (outer) raw.exec('COMMIT');
        else raw.exec(`RELEASE sp${depth}`);
        return r;
      } catch (e) {
        depth--;
        if (outer) raw.exec('ROLLBACK');
        else raw.exec(`ROLLBACK TO sp${depth}; RELEASE sp${depth}`);
        throw e;
      }
    };
  }

  return {
    raw,
    prepare,
    transaction,
    exec: (sql) => raw.exec(sql),
    close: () => raw.close(),
  };
}
