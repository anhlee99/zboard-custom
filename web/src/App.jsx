import { useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';
import Board from './Board.jsx';
import { Icon } from './icons.jsx';

// #/b/<board id>?focus=<card id>
function parseHash() {
  const m = location.hash.match(/^#\/b\/([^?]+)(?:\?(.*))?$/);
  const params = new URLSearchParams(m?.[2] || '');
  return { board: m ? decodeURIComponent(m[1]) : 'root', focus: params.get('focus') };
}

function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/login', { password });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <form onSubmit={submit} className="login-box">
        <div className="login-logo">ZBoard</div>
        <input type="password" autoFocus placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
        <button type="submit" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState('checking');
  const [route, setRoute] = useState(parseHash);
  const [info, setInfo] = useState({ board: null, breadcrumbs: [] });

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth('out'));
    api('GET', '/api/me')
      .then(() => setAuth('in'))
      .catch(() => setAuth('out'));
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = info.board && info.board.id !== 'root' ? `${info.board.title} · ZBoard` : 'ZBoard';
  }, [info.board]);

  if (auth === 'checking') return <div className="splash">ZBoard</div>;
  if (auth === 'out') return <Login onDone={() => setAuth('in')} />;

  const crumbs = info.breadcrumbs;
  async function logout() {
    await api('POST', '/api/logout').catch(() => {});
    setAuth('out');
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="logo" href="#/b/root" data-tip="Home" data-drop-board={route.board !== 'root' ? 'root' : undefined}>
          ZBoard
        </a>
        <nav className="crumbs">
          {crumbs.map((b, i) => (
            <span key={b.id} className="crumb-wrap">
              {i > 0 && <span className="crumb-sep">/</span>}
              <a href={`#/b/${b.id}`} className={i === crumbs.length - 1 ? 'crumb current' : 'crumb'} data-drop-board={i < crumbs.length - 1 ? b.id : undefined}>
                {b.title || 'Untitled'}
              </a>
            </span>
          ))}
        </nav>
        <div className="topbar-right">
          <button className="icon-btn" onClick={logout} data-tip="Log out" aria-label="Log out">
            <Icon name="logout" />
          </button>
        </div>
      </header>
      <Board key={route.board} boardId={route.board} focus={route.focus} onInfo={setInfo} />
    </div>
  );
}
