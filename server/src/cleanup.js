// Unused pictures. ZBoard never deletes a picture when its card goes (undo and older backups may still
// need it). Two ways remove it for good, everywhere (Google Drive first, so a Drive copy is never left
// behind, then the local backup copy, the original and its previews, then the database rows):
//
// - The scheduled check (CLEANUP_CRON, monthly by default; also at start-up when a run was missed):
//   once nothing has used it for `afterDays` (files.unused_since, kept up to date by every check) AND
//   every backup still kept, local and Drive, was made after it became unused.
// - "Clean up now" in the Menu: reads every kept backup (Drive ones are downloaded and decrypted) and,
//   after you confirm, removes the unused pictures none of them mentions, without waiting.
//
// Either way a backup you can still restore never misses a picture.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HttpError } from './db.js';

const DAY = 24 * 3600 * 1000;

// The ids among `ids` that a ZBoard database mentions in any card, saved item or board (the same rule
// the live database uses for "in use").
function mentionedIn(file, ids) {
  const db = new DatabaseSync(file, { readOnly: true });
  const hits = new Set();
  const walk = (v) => {
    if (typeof v === 'string') ids.has(v) && hits.add(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  try {
    for (const t of ['cards', 'clips', 'boards']) for (const r of db.prepare(`SELECT data FROM ${t}`).all()) walk(JSON.parse(r.data || '{}'));
  } finally {
    db.close();
  }
  return hits;
}

export function createCleanup({ getStore, afterDays, localSnapshots, localDir, tmpDir, drive, pathsOf, log }) {
  let running = null; // one check or removal at a time (Google Drive actions are paused meanwhile)
  let job = null; // a "Clean up now" removal running in the background: { phase, removed, total, freed }
  const state = () => JSON.parse(getStore().getMeta('cleanup_state') || '{}');
  const exclusive = (fn) => {
    if (running) throw new HttpError(409, 'A cleanup is already running. Try again in a moment.');
    running = fn().finally(() => (running = null));
    return running;
  };
  const busy = () => Boolean(running);

  function status() {
    const s = state();
    const u = getStore().unusedSummary();
    return {
      after_days: afterDays,
      unused: { count: u.count, bytes: u.bytes, oldest: u.oldest },
      last_run: s.last_run ?? null,
      last_removed: s.last_removed ?? 0,
      last_freed: s.last_freed ?? 0,
      last_waiting: s.last_waiting ?? 0,
      last_error: s.last_error ?? null,
      last_reason: s.last_reason ?? null, // 'scheduled', 'catch-up', 'manual' or 'clean up now'
      oldest_backup: s.oldest_backup ?? null, // pictures unused since before this wait for it to rotate out
      running: Boolean(running),
      job: running && job ? { phase: job.phase, removed: job.removed, total: job.total, freed: job.freed } : null,
    };
  }

  // Disconnecting forgets which pictures are on Drive, so their copies there couldn't be removed:
  // remove nothing until Drive is connected again (or its keys are taken out of .env).
  function assertDriveReady() {
    if (drive.status().configured && !drive.connected()) {
      throw new HttpError(409, 'Google Drive is set up but not connected, so nothing can be removed (its copies there would stay behind). Connect it again in Menu → Google Drive.');
    }
  }

  // Google Drive copy first, then every local copy, then the rows. Counts into `out` as it goes, so a
  // Drive failure part-way (which stops the run) still reports what was removed.
  async function remove(files, out) {
    for (const f of files) {
      if (f.drive_id) await drive.removeFile(f.drive_id);
      for (const p of pathsOf(f)) fs.rmSync(p, { force: true });
      getStore().forgetFile(f.id);
      out.removed++;
      out.freed += f.size || 0;
    }
  }

  function record(reason, now, { removed = 0, freed = 0, waiting = 0, error = null, oldest_backup = null }) {
    const s = { last_run: now, last_reason: reason, last_removed: removed, last_freed: freed, last_waiting: waiting, last_error: error, oldest_backup };
    getStore().setMeta('cleanup_state', JSON.stringify(s));
    log(`Cleanup (${reason}): removed ${removed} unused file(s), ${waiting} waiting${error ? ' · ' + error : ''}`);
  }

  // ---- scheduled check: by age and backup dates ----
  async function oldestBackupAt() {
    let oldest = Infinity;
    for (const s of localSnapshots()) oldest = Math.min(oldest, s.at);
    if (drive.connected()) {
      const d = await drive.oldestSnapshotAt();
      if (d != null) oldest = Math.min(oldest, d);
    }
    return oldest;
  }

  async function sweep(reason) {
    const now = Date.now();
    const unused = getStore().sweepUnused(now);
    const out = { removed: 0, freed: 0 };
    try {
      assertDriveReady();
      await drive.idle(); // let a backup that is uploading finish first
      const oldest = await oldestBackupAt();
      out.oldest_backup = Number.isFinite(oldest) ? oldest : null;
      await remove(
        unused.filter((f) => now - f.unused_since >= afterDays * DAY && f.unused_since < oldest),
        out
      );
    } catch (e) {
      out.error = e.message;
    }
    out.waiting = unused.length - out.removed;
    record(reason, now, out);
  }

  const run = (reason = 'manual') => exclusive(() => sweep(reason)).then(status);

  // ---- "Clean up now": by what the kept backups actually contain ----
  // Unused pictures that no kept backup mentions, plus how many a backup still holds on to.
  async function findRemovable() {
    assertDriveReady();
    await drive.idle(); // its snapshot list must not change while we read it
    const unused = getStore().sweepUnused(Date.now());
    const ids = new Set(unused.map((f) => f.id));
    const inBackups = new Set();
    const local = localSnapshots();
    for (const s of local) for (const id of mentionedIn(path.join(localDir, s.name), ids)) inBackups.add(id);
    let driveChecked = 0;
    if (drive.connected()) {
      for (const snap of await drive.keptSnapshots()) {
        const tmp = path.join(tmpDir, `cleanup-check-${snap.id}.db`);
        fs.writeFileSync(tmp, await drive.readSnapshot(snap.id));
        try {
          for (const id of mentionedIn(tmp, ids)) inBackups.add(id);
        } finally {
          for (const s of ['', '-wal', '-shm']) fs.rmSync(tmp + s, { force: true });
        }
        driveChecked++;
      }
    }
    return { removable: unused.filter((f) => !inBackups.has(f.id)), keptByBackup: inBackups.size, checked: { local: local.length, drive: driveChecked } };
  }

  const check = () =>
    exclusive(async () => {
      const { removable, keptByBackup, checked } = await findRemovable();
      return {
        count: removable.length,
        bytes: removable.reduce((n, f) => n + (f.size || 0), 0),
        files: removable.map((f) => ({ id: f.id, name: f.name, size: f.size, unused_since: f.unused_since })),
        kept_by_backup: keptByBackup,
        checked,
        drive: drive.connected(),
      };
    });

  // Starts removing the confirmed ids that are still removable (checked again, in case something
  // changed) and returns at once: the removal runs in the background, its progress is in status().job
  // and its result in last_* once done. Google Drive actions are paused until it finishes.
  function startRemove(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : []);
    if (!wanted.size) throw new HttpError(400, 'Nothing selected to remove');
    job = { phase: 'checking', removed: 0, total: wanted.size, freed: 0 };
    const out = job;
    exclusive(async () => {
      const now = Date.now();
      try {
        const list = (await findRemovable()).removable.filter((f) => wanted.has(f.id));
        Object.assign(out, { phase: 'removing', total: list.length });
        await remove(list, out);
      } catch (e) {
        out.error = e.message;
      }
      out.waiting = getStore().unusedSummary().count;
      record('clean up now', now, out);
    }).catch(() => {});
    return status();
  }

  // At start-up: catch up on a monthly run that was missed while ZBoard was off.
  const due = (everyDays) => {
    const last = state().last_run;
    return !last || Date.now() - last > everyDays * DAY;
  };

  return { status, run, check, startRemove, busy, due };
}
