import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
const when = (t) => (t ? new Date(t).toLocaleString() : 'never');

// Pictures go up one by one, then the database snapshot. Measured in bytes, so big files count for more.
function DriveProgress({ p }) {
  let label = 'Getting ready…';
  let frac = 0;
  if (p?.phase === 'files' && p.total) {
    frac = p.total_bytes ? p.bytes / p.total_bytes : p.done / p.total;
    label = `Uploading pictures ${p.done} of ${p.total} · ${formatBytes(p.bytes)} of ${formatBytes(p.total_bytes)}`;
  } else if (p?.phase === 'snapshot') {
    frac = 1;
    label = p.total ? `Pictures done (${p.total}) · uploading the database snapshot…` : 'Uploading the database snapshot…';
  }
  return (
    <div className="drive-progress">
      <div className="progress" role="progressbar" aria-label="Backup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
        <div className={p ? 'progress-fill' : 'progress-fill indeterminate'} style={p ? { width: `${Math.max(2, frac * 100)}%` } : undefined} />
      </div>
      <div className="muted">{label}</div>
    </div>
  );
}

function DriveSection() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const refresh = useCallback(() => api('GET', '/api/drive').then(setS).catch((e) => setError(e.message)), []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  // Poll while signing in or uploading (every second while uploading, for the progress bar).
  useEffect(() => {
    const uploading = s?.running || busy === 'sync';
    const active = (s?.pending && !s.pending.error) || uploading;
    if (!active) return;
    const t = setInterval(refresh, uploading ? 1000 : 2500);
    return () => clearInterval(t);
  }, [s, busy, refresh]);

  async function act(name, fn) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
      refresh();
    }
  }

  if (!s) return <section className="menu-section"><h4>Google Drive</h4><div className="muted">Loading…</div></section>;
  return (
    <section className="menu-section">
      <h4>Google Drive</h4>
      {!s.configured ? (
        <div className="muted">Not set up. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env (see README).</div>
      ) : s.pending && !s.pending.error ? (
        <div className="drive-code">
          <div>
            Open <a href={s.pending.verification_url} target="_blank" rel="noreferrer">{s.pending.verification_url}</a> and enter:
          </div>
          <div className="code">{s.pending.user_code}</div>
          <div className="muted">Waiting for you to approve…</div>
        </div>
      ) : s.connected ? (
        <>
          <dl className="kv">
            <dt>Last backup</dt>
            <dd>{when(s.last_sync)}</dd>
            <dt>Files copied</dt>
            <dd>{s.files_copied}</dd>
            {s.encrypted && (
              <>
                <dt>Encryption</dt>
                <dd>Passphrase</dd>
              </>
            )}
            {s.last_error && (
              <>
                <dt>Last error</dt>
                <dd className="error-text">{s.last_error}</dd>
              </>
            )}
          </dl>
          {s.running && <DriveProgress p={s.progress} />}
          <div className="menu-buttons">
            <button disabled={!!busy || s.running} onClick={() => act('sync', () => api('POST', '/api/drive/sync'))}>
              {busy === 'sync' || s.running ? 'Backing up…' : 'Back up now'}
            </button>
            <button
              disabled={!!busy}
              onClick={() => window.confirm('Replace everything on this server with the newest Google Drive backup?') && act('restore', () => api('POST', '/api/drive/restore'))}
            >
              {busy === 'restore' ? 'Restoring…' : 'Restore'}
            </button>
            <button disabled={!!busy} onClick={() => act('disconnect', () => api('POST', '/api/drive/disconnect'))}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          {s.pending?.error && <div className="error-text">{s.pending.error}</div>}
          <div className="menu-buttons">
            <button disabled={!!busy} onClick={() => act('connect', () => api('POST', '/api/drive/connect'))}>
              Connect Google Drive
            </button>
          </div>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
    </section>
  );
}

// Copy that also works on plain-http LAN addresses, where navigator.clipboard is missing.
function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const t = document.createElement('textarea');
  t.value = text;
  document.body.append(t);
  t.select();
  document.execCommand('copy');
  t.remove();
  return Promise.resolve();
}

function CopyField({ label, value }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy-field">
      <label>{label}</label>
      <div className="copy-row">
        <input readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} />
        <button
          onClick={() =>
            copyText(value).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            })
          }
        >
          {done ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function ExtensionSection() {
  const [token, setToken] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !token) api('GET', '/api/token').then((r) => setToken(r.token)).catch(() => {});
  }, [open, token]);
  async function rotate() {
    if (!window.confirm('Make a new token? The browser extension and the CLI stop working until you give them the new one.')) return;
    const r = await api('POST', '/api/token/rotate');
    setToken(r.token);
  }
  return (
    <section className="menu-section">
      <h4>Browser extension</h4>
      {!open ? (
        <div className="menu-buttons">
          <button onClick={() => setOpen(true)}>Set up ZBoard Clipper</button>
        </div>
      ) : (
        <>
          <ol className="steps">
            <li>
              <a href="/api/extension.zip" download>
                Download the extension
              </a>{' '}
              and unzip it.
            </li>
            <li>Open edge://extensions (or chrome://extensions), turn on Developer mode, choose “Load unpacked” and pick the unzipped folder.</li>
            <li>Click the ZBoard Clipper icon and paste these:</li>
          </ol>
          <CopyField label="Server address" value={location.origin} />
          <CopyField label="Token" value={token || '…'} />
          <div className="menu-buttons">
            <button onClick={rotate}>New token</button>
          </div>
        </>
      )}
    </section>
  );
}

export default function Menu({ boardId, boardTitle, onClose, onLogout }) {
  const [stats, setStats] = useState(null);
  const [backup, setBackup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api('GET', '/api/stats').then(setStats).catch(() => {});
    api('GET', '/api/backup').then(setBackup).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function backupNow() {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/backup');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      load();
    }
  }

  const st = backup?.status;
  return (
    <div className="overlay clear" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="menu-panel scrolls" role="dialog" aria-label="Menu">
        <section className="menu-section">
          <h4>Stats</h4>
          {stats ? (
            <dl className="kv">
              <dt>Boards</dt>
              <dd>{stats.boards}</dd>
              <dt>Cards</dt>
              <dd>{stats.cards}</dd>
              <dt>Images & files</dt>
              <dd>{stats.files}</dd>
              <dt>Stored</dt>
              <dd>{formatBytes(stats.stored_bytes)}</dd>
              <dt>Database</dt>
              <dd>{formatBytes(stats.db_bytes)}</dd>
            </dl>
          ) : (
            <div className="muted">Loading…</div>
          )}
        </section>

        <section className="menu-section">
          <h4>Backups</h4>
          {backup && (
            <dl className="kv">
              <dt>Last backup</dt>
              <dd className={st && !st.ok ? 'error-text' : ''}>{st ? (st.ok ? when(st.at) : `Failed: ${st.error}`) : 'never'}</dd>
              <dt>Schedule</dt>
              <dd>{backup.cron === 'off' ? 'off' : backup.cron}</dd>
              <dt>Snapshots</dt>
              <dd>
                {backup.snapshots.length} (keeps {backup.keep})
              </dd>
              <dt>Folder</dt>
              <dd className="path">{backup.dir}</dd>
            </dl>
          )}
          <div className="menu-buttons">
            <button onClick={backupNow} disabled={busy}>
              {busy ? 'Backing up…' : 'Back up now'}
            </button>
          </div>
          {error && <div className="error-text">{error}</div>}
        </section>

        <DriveSection />

        <ExtensionSection />

        <section className="menu-section">
          <h4>Export</h4>
          <div className="menu-buttons">
            {boardId !== 'root' && (
              <a className="button" href={`/api/export/${boardId}`} download>
                Export “{boardTitle || 'this board'}”
              </a>
            )}
            <a className="button" href="/api/export/root" download>
              Export everything
            </a>
          </div>
        </section>

        <section className="menu-section">
          <div className="menu-buttons">
            <button onClick={onLogout}>Log out</button>
          </div>
        </section>
      </div>
    </div>
  );
}
