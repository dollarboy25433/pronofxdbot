import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const TOKEN_KEY = 'pronofx_admin_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
  let body = {};
  try { body = await res.json(); } catch { /* no body */ }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new CustomEvent('admin:unauthorized'));
    throw new Error(body.error || 'Unauthorized');
  }
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function fmtMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}

function Loading() {
  return <div className="muted pad">Loading…</div>;
}

function ErrorNote({ message }) {
  return <div className="error-note">Error: {message}</div>;
}

function Table({ headers, children }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Login failed');
      localStorage.setItem(TOKEN_KEY, body.token);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">P</div>
        <h1>PronoFX Dbot</h1>
        <p className="login-sub">Admin console</p>
        <input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <div className="error-note">{error}</div>}
        <button className="primary-btn" type="submit" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

function Overview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    api('/api/admin/stats').then(setData).catch((e) => setError(e.message));
    api('/api/admin/activities?limit=10').then((d) => setRecent(d.activities)).catch(() => {});
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  const cards = [
    { label: 'Users', value: data.users, sub: `${data.activeLast7d} active (7d)` },
    { label: 'Activities', value: data.activities },
    { label: 'Circles', value: data.circles },
    { label: 'Bots', value: data.bots },
    { label: 'Copy strategies', value: data.strategies },
    { label: 'Trades', value: data.trades, sub: `${data.tradesLast7d} (7d) · net ${fmtMoney(data.netLast7d)}` },
  ];

  return (
    <section>
      <h2>Overview</h2>
      <div className="stat-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="stat-value">{c.value}</div>
            <div className="stat-label">{c.label}</div>
            {c.sub && <div className="stat-sub">{c.sub}</div>}
          </div>
        ))}
      </div>
      <h3>Recent activity</h3>
      <Table headers={['Time', 'Login ID', 'Type', 'Detail']}>
        {recent.map((a) => (
          <tr key={a.id}>
            <td className="muted">{fmtDate(a.created_at)}</td>
            <td>{a.loginid}</td>
            <td><span className="badge">{a.type}</span></td>
            <td className="muted">{JSON.stringify(a.detail)}</td>
          </tr>
        ))}
        {recent.length === 0 && (
          <tr><td className="muted" colSpan={4}>No activity yet.</td></tr>
        )}
      </Table>
    </section>
  );
}

function UsersView() {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = (q = search) => {
    setLoading(true);
    api(`/api/admin/users?search=${encodeURIComponent(q)}`)
      .then((d) => { setUsers(d.users); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const remove = async (loginid) => {
    if (!window.confirm(`Delete user ${loginid} and all their data (circles, bots, strategies, history)?`)) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(loginid)}`, { method: 'DELETE' });
      load(search);
    } catch (e) { setError(e.message); }
  };

  return (
    <section>
      <div className="row">
        <h2>Users</h2>
        <input className="search" placeholder="Search login id…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} />
        <button className="ghost-btn" onClick={() => load()}>Search</button>
      </div>
      {error && <ErrorNote message={error} />}
      {loading ? <Loading /> : (
        <Table headers={['Login ID', 'Currency', 'Last seen', 'Joined', 'Activities', 'Trades', '']}>
          {users.map((u) => (
            <tr key={u.loginid}>
              <td className="mono">{u.loginid}</td>
              <td>{u.currency || '—'}</td>
              <td className="muted">{fmtDate(u.last_seen_at)}</td>
              <td className="muted">{fmtDate(u.created_at)}</td>
              <td>{u.activity_count}</td>
              <td>{u.trade_count}</td>
              <td><button className="danger-btn" onClick={() => remove(u.loginid)}>Delete</button></td>
            </tr>
          ))}
          {users.length === 0 && <tr><td className="muted" colSpan={7}>No users.</td></tr>}
        </Table>
      )}
    </section>
  );
}

function ActivitiesView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/admin/activities?limit=300')
      .then((d) => { setItems(d.activities); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section>
      <h2>Activities</h2>
      {error && <ErrorNote message={error} />}
      {loading ? <Loading /> : (
        <Table headers={['ID', 'Time', 'Login ID', 'Type', 'Detail']}>
          {items.map((a) => (
            <tr key={a.id}>
              <td className="mono muted">{a.id}</td>
              <td className="muted">{fmtDate(a.created_at)}</td>
              <td className="mono">{a.loginid}</td>
              <td><span className="badge">{a.type}</span></td>
              <td className="muted">{JSON.stringify(a.detail)}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td className="muted" colSpan={5}>No activity.</td></tr>}
        </Table>
      )}
    </section>
  );
}

function CirclesView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    api('/api/admin/circles')
      .then((d) => { setItems(d.circles); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    if (!window.confirm(`Delete circle #${id}?`)) return;
    try {
      await api(`/api/admin/circles/${id}`, { method: 'DELETE' });
      load();
    } catch (e) { setError(e.message); }
  };

  return (
    <section>
      <h2>Circles</h2>
      {error && <ErrorNote message={error} />}
      {loading ? <Loading /> : (
        <Table headers={['ID', 'Name', 'Description', 'Owner', 'Members', 'Created', '']}>
          {items.map((c) => (
            <tr key={c.id}>
              <td className="mono muted">{c.id}</td>
              <td>{c.name}</td>
              <td className="muted">{c.description || '—'}</td>
              <td className="mono">{c.owner_loginid || '—'}</td>
              <td>{c.members}</td>
              <td className="muted">{fmtDate(c.created_at)}</td>
              <td><button className="danger-btn" onClick={() => remove(c.id)}>Delete</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td className="muted" colSpan={7}>No circles.</td></tr>}
        </Table>
      )}
    </section>
  );
}

function BotsView() {
  const [items, setItems] = useState([]);
  const [xml, setXml] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    api('/api/admin/bots')
      .then((d) => { setItems(d.bots); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const viewXml = async (id) => {
    try {
      const d = await api(`/api/admin/bots/${id}/xml`);
      setXml(d.xml);
    } catch (e) { setError(e.message); }
  };

  const remove = async (id) => {
    if (!window.confirm(`Delete bot #${id}?`)) return;
    try {
      await api(`/api/admin/bots/${id}`, { method: 'DELETE' });
      load();
    } catch (e) { setError(e.message); }
  };

  return (
    <section>
      <h2>Bots</h2>
      {error && <ErrorNote message={error} />}
      {loading ? <Loading /> : (
        <Table headers={['ID', 'Name', 'Kind', 'Owner', 'Uses', 'Created', 'XML', '']}>
          {items.map((b) => (
            <tr key={b.id}>
              <td className="mono muted">{b.id}</td>
              <td>{b.name}</td>
              <td><span className="badge">{b.kind}</span></td>
              <td className="mono">{b.owner_loginid || '—'}</td>
              <td>{b.uses}</td>
              <td className="muted">{fmtDate(b.created_at)}</td>
              <td><button className="ghost-btn" onClick={() => viewXml(b.id)}>View</button></td>
              <td><button className="danger-btn" onClick={() => remove(b.id)}>Delete</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td className="muted" colSpan={8}>No bots.</td></tr>}
        </Table>
      )}
      {xml && (
        <div className="modal-backdrop" onClick={() => setXml(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>Bot XML</span>
              <button className="ghost-btn" onClick={() => setXml(null)}>Close</button>
            </div>
            <pre className="xml-view">{xml}</pre>
          </div>
        </div>
      )}
    </section>
  );
}

function StrategiesView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    api('/api/admin/copy/strategies')
      .then((d) => { setItems(d.strategies); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    if (!window.confirm(`Delete copy strategy #${id}?`)) return;
    try {
      await api(`/api/admin/copy/strategies/${id}`, { method: 'DELETE' });
      load();
    } catch (e) { setError(e.message); }
  };

  return (
    <section>
      <h2>Copy Strategies</h2>
      {error && <ErrorNote message={error} />}
      {loading ? <Loading /> : (
        <Table headers={['ID', 'Name', 'Description', 'Owner', 'Followers', 'Status', 'Created', '']}>
          {items.map((s) => (
            <tr key={s.id}>
              <td className="mono muted">{s.id}</td>
              <td>{s.name}</td>
              <td className="muted">{s.description || '—'}</td>
              <td className="mono">{s.owner_loginid || '—'}</td>
              <td>{s.followers}</td>
              <td><span className="badge">{s.status}</span></td>
              <td className="muted">{fmtDate(s.created_at)}</td>
              <td><button className="danger-btn" onClick={() => remove(s.id)}>Delete</button></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td className="muted" colSpan={8}>No strategies.</td></tr>}
        </Table>
      )}
    </section>
  );
}

function TradesView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api(`/api/admin/trades?days=${days}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <section>
      <div className="row">
        <h2>Trades</h2>
        <select className="search" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      {error && <ErrorNote message={error} />}
      {loading ? <Loading /> : data && (
        <>
          <h3>Daily summary</h3>
          <Table headers={['Day', 'Total', 'Wins', 'Losses', 'Net']}>
            {data.days.map((d) => (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td>{d.total}</td>
                <td>{d.wins}</td>
                <td>{d.losses}</td>
                <td className={d.net >= 0 ? 'pos' : 'neg'}>{d.net >= 0 ? '+' : ''}{fmtMoney(d.net)}</td>
              </tr>
            ))}
            {data.days.length === 0 && <tr><td className="muted" colSpan={5}>No trades in this window.</td></tr>}
          </Table>
          <h3>Recent trades</h3>
          <Table headers={['ID', 'Time', 'Login ID', 'Symbol', 'Type', 'Stake', 'Profit', 'Status', 'Source']}>
            {data.recent.map((t) => (
              <tr key={t.id}>
                <td className="mono muted">{t.id}</td>
                <td className="muted">{fmtDate(t.trade_time)}</td>
                <td className="mono">{t.loginid}</td>
                <td>{t.symbol}</td>
                <td>{t.contract_type}</td>
                <td>{fmtMoney(t.stake)}</td>
                <td className={Number(t.profit) >= 0 ? 'pos' : 'neg'}>{fmtMoney(t.profit)}</td>
                <td><span className={`badge ${t.status === 'won' ? 'pos' : 'neg'}`}>{t.status}</span></td>
                <td>{t.source}</td>
              </tr>
            ))}
            {data.recent.length === 0 && <tr><td className="muted" colSpan={9}>No trades recorded.</td></tr>}
          </Table>
        </>
      )}
    </section>
  );
}

const NAV = [
  ['overview', 'Overview'],
  ['users', 'Users'],
  ['activities', 'Activities'],
  ['circles', 'Circles'],
  ['bots', 'Bots'],
  ['strategies', 'Copy Strategies'],
  ['trades', 'Trades'],
];

export default function App() {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem(TOKEN_KEY));
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    const onUnauth = () => setAuthed(false);
    window.addEventListener('admin:unauthorized', onUnauth);
    return () => window.removeEventListener('admin:unauthorized', onUnauth);
  }, []);

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setAuthed(false);
  };

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  return (
    <div className="admin-app">
      <header className="topbar">
        <div className="brand">PronoFX Dbot <span className="brand-badge">Admin</span></div>
        <nav className="nav">
          {NAV.map(([id, label]) => (
            <button key={id} className={tab === id ? 'nav-btn active' : 'nav-btn'} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <button className="logout-btn" onClick={logout}>Log out</button>
      </header>
      <main className="content">
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <UsersView />}
        {tab === 'activities' && <ActivitiesView />}
        {tab === 'circles' && <CirclesView />}
        {tab === 'bots' && <BotsView />}
        {tab === 'strategies' && <StrategiesView />}
        {tab === 'trades' && <TradesView />}
      </main>
    </div>
  );
}
