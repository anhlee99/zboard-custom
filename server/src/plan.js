// The full backup: every `every_days` days (set in Menu → Backup & Restore, default 1), a database
// snapshot and the new originals go to the local backup folder first, then that same snapshot and any
// new originals go to Google Drive. ZBoard checks at start-up and every hour whether one is due, so a
// backup missed while the PC was off happens as soon as ZBoard runs again. (Between full backups,
// Google Drive still gets a small snapshot a minute or two after edits stop; see createDrive.)
import path from 'node:path';
import fs from 'node:fs';
import { HttpError } from './db.js';

const DEFAULT_DAYS = 1;
export const MAX_DAYS = 30;

export function createBackupPlan({ getStore, local, drive, log, dayMs = 24 * 3600 * 1000, checkMs = 3600 * 1000 }) {
  let running = null;
  const state = () => JSON.parse(getStore().getMeta('backup_plan') || '{}');
  const save = (patch) => getStore().setMeta('backup_plan', JSON.stringify({ ...state(), ...patch }));
  const everyDays = () => state().every_days || DEFAULT_DAYS;
  // The last time the local part succeeded (older installs: the last local backup).
  const lastOk = () => state().last_ok_at ?? (local.status()?.ok ? local.status().at : null);

  function status() {
    const s = state();
    const ok = lastOk();
    return {
      every_days: everyDays(),
      last: s.last ?? null, // { at, local: { ok, snapshot, files_copied, error }, drive: { ok, snapshot, files_copied, error, skipped } }
      last_ok_at: ok,
      next_due: ok ? ok + everyDays() * dayMs : null, // null: due now
      running: Boolean(running),
    };
  }

  function setEveryDays(n) {
    const d = Number(n);
    if (!Number.isInteger(d) || d < 1 || d > MAX_DAYS) throw new HttpError(400, `Back up every 1 to ${MAX_DAYS} days`);
    save({ every_days: d });
    return status();
  }

  const due = () => {
    const ok = lastOk();
    return !ok || Date.now() - ok >= everyDays() * dayMs;
  };

  // Local first, then Google Drive with the same snapshot. Each part's result is kept; a failing local
  // part doesn't stop the Drive part.
  function run(reason = 'manual') {
    if (running) return running;
    running = (async () => {
      const out = { at: Date.now(), reason, local: null, drive: null };
      let snapshotFile = null;
      try {
        const st = await local.run();
        out.local = { ok: true, snapshot: st.snapshot, files_copied: st.files_copied };
        snapshotFile = path.join(local.dir, 'db', st.snapshot);
      } catch (e) {
        out.local = { ok: false, error: e.message };
      }
      if (drive.connected()) {
        if (drive.status().paused) out.drive = { ok: false, skipped: 'paused while unused files are removed; it goes up with the next backup' };
        else {
          try {
            await drive.idle(); // a backup after edits may be uploading
            const s = await drive.sync(reason === 'manual' ? 'manual' : 'scheduled', { snapshotFile: snapshotFile && fs.existsSync(snapshotFile) ? snapshotFile : null });
            out.drive = s.last_error ? { ok: false, error: s.last_error } : { ok: true, snapshot: s.last_snapshot, files_copied: s.last_copied };
          } catch (e) {
            out.drive = { ok: false, error: e.message };
          }
        }
      }
      save({ last: out, ...(out.local.ok ? { last_ok_at: out.at } : {}) });
      log(`Full backup (${reason}): this PC ${out.local.ok ? 'ok' : 'failed'}${out.drive ? `, Google Drive ${out.drive.ok ? 'ok' : out.drive.skipped ? 'postponed' : 'failed'}` : ''}`);
      return out;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  // Check now (a minute after start-up, out of the way) and then every hour.
  function start() {
    const check = () => due() && run('scheduled').catch(() => {});
    setTimeout(check, Math.min(60_000, checkMs)).unref();
    setInterval(check, checkMs).unref();
  }

  return { status, setEveryDays, run, start };
}
