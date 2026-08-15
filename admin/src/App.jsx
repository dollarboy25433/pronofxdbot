import { useEffect, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const WS_BASE = API_BASE.replace(/^http/, 'ws');
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

function fmtDateLocal(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

function Table({ headers, children, scroll }) {
  return (
    <div className={`table-wrap${scroll ? ' scroll' : ''}`}>
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
      <Table headers={['Time', 'Login ID', 'Type', 'Detail']} scroll>
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
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const load = (q = search) => {
    setLoading(true);
    setError(null);
    api(`/api/admin/activities?limit=500&search=${encodeURIComponent(q)}`)
      .then((d) => { setItems(d.activities); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const submitSearch = (e) => { e.preventDefault(); setSearch(searchInput); load(searchInput); };
  const clearSearch = () => { setSearch(''); setSearchInput(''); load(''); };

  return (
    <section>
      <div className="row">
        <h2>Activities</h2>
        <form className="row" style={{ margin: 0 }} onSubmit={submitSearch}>
          <input
            className="search"
            placeholder="Search by date or client ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button className="ghost-btn" type="submit">Search</button>
          {search && <button type="button" className="ghost-btn" onClick={clearSearch}>Clear</button>}
        </form>
      </div>
      {search && <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 10 }}>{items.length} result{items.length === 1 ? '' : 's'} for “{search}”.</p>}
      {error && <ErrorNote message={error} />}
      {loading ? <Loading /> : (
        <Table headers={['ID', 'Time', 'Login ID', 'Type', 'Detail']} scroll>
          {items.map((a) => (
            <tr key={a.id}>
              <td className="mono muted">{a.id}</td>
              <td className="muted">{fmtDate(a.created_at)}</td>
              <td className="mono">{a.loginid}</td>
              <td><span className="badge">{a.type}</span></td>
              <td className="muted">{JSON.stringify(a.detail)}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td className="muted" colSpan={5}>No activity matches your search.</td></tr>}
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
          <Table headers={['Day', 'Total', 'Wins', 'Losses', 'Net']} scroll>
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
          <Table headers={['ID', 'Time', 'Login ID', 'Symbol', 'Type', 'Stake', 'Profit', 'Status', 'Source']} scroll>
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

function PromotionsView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | promo object
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api('/api/admin/promotions')
      .then((d) => { setItems(d.promotions); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const startNew = () => {
    setEditing('new');
    setForm({ tag: 'LIMITED OFFER', tag_color: '#ff444f', title: '', copy: '', image: '', link: '', active: true, sort: 0 });
  };

  const startEdit = (p) => {
    setEditing(p);
    setForm({ ...p });
  };

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const uploadImage = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Banner image is too large (max 5 MB).'); return; }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('Could not read the file'));
      r.readAsDataURL(file);
    });
    setUploadBusy(true);
    setError(null);
    try {
      const d = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ data: dataUrl }) });
      setForm((f) => ({ ...f, image: d.url }));
    } catch (err) { setError(err.message); } finally { setUploadBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, active: !!form.active, sort: Number(form.sort) || 0 };
      if (editing === 'new') await api('/api/admin/promotions', { method: 'POST', body: JSON.stringify(body) });
      else await api(`/api/admin/promotions/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setEditing(null);
      load();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const toggleActive = async (p) => {
    try {
      await api(`/api/admin/promotions/${p.id}`, { method: 'PUT', body: JSON.stringify({ ...p, active: !p.active }) });
      load();
    } catch (err) { setError(err.message); }
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete promotion "${p.title}"?`)) return;
    try {
      await api(`/api/admin/promotions/${p.id}`, { method: 'DELETE' });
      load();
    } catch (err) { setError(err.message); }
  };

  const cancelEdit = () => setEditing(null);

  return (
    <section>
      <div className="row">
        <h2>Promotions</h2>
        <button className="primary-btn" onClick={startNew}>+ Add promotion</button>
      </div>
      {error && <ErrorNote message={error} />}
      {loading ? <Loading /> : (
        <Table headers={['ID', 'Tag', 'Title', 'Image', 'Active', 'Sort', 'Created', '']}>
          {items.map((p) => (
            <tr key={p.id}>
              <td className="mono muted">{p.id}</td>
              <td>
                <span className="badge" style={{ background: p.tag_color || 'var(--panel-2)', color: '#fff' }}>{p.tag}</span>
              </td>
              <td>
                <div>{p.title}</div>
                {p.copy && <div className="muted" style={{ fontSize: 12 }}>{p.copy.slice(0, 80)}{p.copy.length > 80 ? '…' : ''}</div>}
              </td>
              <td>{p.image ? <img src={p.image} alt="" className="thumb" /> : '—'}</td>
              <td>
                <button className={p.active ? 'ghost-btn' : 'danger-btn'} onClick={() => toggleActive(p)}>
                  {p.active ? 'Active' : 'Hidden'}
                </button>
              </td>
              <td>{p.sort}</td>
              <td className="muted">{fmtDate(p.created_at)}</td>
              <td>
                <span className="row-actions">
                  <button className="ghost-btn" onClick={() => startEdit(p)}>Edit</button>
                  <button className="danger-btn" onClick={() => remove(p)}>Delete</button>
                </span>
              </td>
            </tr>
          ))}
          {items.length === 0 && <tr><td className="muted" colSpan={8}>No promotions yet.</td></tr>}
        </Table>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={cancelEdit}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>{editing === 'new' ? 'New promotion' : `Edit promotion #${editing.id}`}</span>
              <button className="ghost-btn" onClick={cancelEdit}>Close</button>
            </div>
            <form className="form" onSubmit={save}>
              <div className="form-grid">
                <label>Tag
                  <input value={form.tag || ''} onChange={set('tag')} placeholder="e.g. LIMITED OFFER" />
                </label>
                <label>Tag color
                  <input type="color" value={form.tag_color || '#ff444f'} onChange={set('tag_color')} />
                </label>
                <label className="span-2">Title *
                  <input value={form.title || ''} onChange={set('title')} required placeholder="Promotion title" />
                </label>
                <label className="span-2">Copy
                  <textarea rows={3} value={form.copy || ''} onChange={set('copy')} placeholder="Short description shown to users" />
                </label>
                <label className="span-2">Banner image
                  <input type="file" accept="image/*" onChange={(e) => uploadImage(e.target.files && e.target.files[0])} />
                  <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>PNG/JPG, max 5 MB. {uploadBusy ? 'Uploading…' : form.image ? 'Uploaded — you can pick a new file to replace it.' : 'No image selected yet.'}</span>
                  {form.image && (
                    <img src={form.image} alt="Banner preview" style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8, border: '1px solid var(--border)', marginTop: 6 }} />
                  )}
                </label>
                <label className="span-2">…or paste an image URL
                  <input value={form.image || ''} onChange={set('image')} placeholder="https://…/banner.png" />
                </label>
                <label className="span-2">Link
                  <input value={form.link || ''} onChange={set('link')} placeholder="https://…/strategy" />
                </label>
                <label>Sort
                  <input type="number" value={form.sort || 0} onChange={set('sort')} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={!!form.active} onChange={set('active')} /> Visible to users
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={cancelEdit}>Cancel</button>
                <button className="primary-btn" type="submit" disabled={saving || uploadBusy}>
                  {saving ? 'Saving…' : editing === 'new' ? 'Add promotion' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function LiveView() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [bookings, setBookings] = useState(null); // { session, rows }
  const [broadcast, setBroadcast] = useState(null); // session being broadcast

  const load = () => {
    setLoading(true);
    api('/api/admin/live/sessions')
      .then((d) => { setSessions(d.sessions); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const startNew = () => {
    const now = new Date();
    now.setHours(now.getHours() + 1);
    setEditing('new');
    setForm({ title: '', description: '', scheduled_at: fmtDateLocal(now.toISOString()), duration_min: 60, paid: false, price_kes: 0 });
  };

  const startEdit = (s) => {
    setEditing(s);
    setForm({ title: s.title, description: s.description || '', scheduled_at: fmtDateLocal(s.scheduled_at), duration_min: s.duration_min, paid: (s.price_kes || 0) > 0, price_kes: s.price_kes || 0 });
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: form.title,
        description: form.description,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        duration_min: Number(form.duration_min) || 60,
        price_kes: form.paid ? Math.max(0, Number(form.price_kes) || 0) : 0,
      };
      if (editing === 'new') await api('/api/admin/live/sessions', { method: 'POST', body: JSON.stringify(body) });
      else await api(`/api/admin/live/sessions/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      setEditing(null);
      load();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const setStatus = async (s, status) => {
    if (status === 'live' && !window.confirm(`Start "${s.title}" live now? Viewers can join once you share your screen.`)) return;
    if (status === 'ended' && !window.confirm(`End "${s.title}"? Viewers will be disconnected.`)) return;
    try {
      await api(`/api/admin/live/sessions/${s.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      load();
    } catch (err) { setError(err.message); }
  };

  const showBookings = async (s) => {
    try {
      const d = await api(`/api/admin/live/bookings?session_id=${s.id}`);
      setBookings({ session: s, rows: d.bookings });
    } catch (err) { setError(err.message); }
  };

  const remove = async (s) => {
    if (!window.confirm(`Delete live session "${s.title}" and its ${s.bookings} booking(s)?`)) return;
    try {
      await api(`/api/admin/live/sessions/${s.id}`, { method: 'DELETE' });
      load();
    } catch (err) { setError(err.message); }
  };

  if (broadcast) {
    return <BroadcastStudio session={broadcast} onExit={() => { setBroadcast(null); load(); }} />;
  }

  const badge = (s) => <span className={`badge st-${s.status}`}>{s.status}</span>;

  return (
    <section>
      <div className="row">
        <h2>Live Sessions</h2>
        <button className="primary-btn" onClick={startNew}>+ New session</button>
      </div>
      {error && <ErrorNote message={error} />}
      {loading ? <Loading /> : (
        <Table headers={['ID', 'Title', 'Scheduled', 'Duration', 'Price', 'Status', 'Bookings', 'Joined', 'Actions', '']}>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td className="mono muted">{s.id}</td>
              <td>
                <div>{s.title}</div>
                {s.description && <div className="muted" style={{ fontSize: 12 }}>{s.description.slice(0, 60)}</div>}
              </td>
              <td className="muted">{fmtDate(s.scheduled_at)}</td>
              <td>{s.duration_min} min</td>
              <td>
                {(s.price_kes || 0) > 0
                  ? <span className="badge">KES {Number(s.price_kes).toLocaleString()}</span>
                  : <span className="badge">Free</span>}
              </td>
              <td>{badge(s)}</td>
              <td>{s.bookings}</td>
              <td>{s.joined}</td>
              <td>
                <span className="row-actions">
                  {s.status !== 'live' && <button className="ghost-btn" onClick={() => setStatus(s, 'live')}>Go live</button>}
                  {s.status === 'live' && <button className="primary-btn" onClick={() => setBroadcast(s)}>Broadcast</button>}
                  {s.status === 'live' && <button className="ghost-btn" onClick={() => setStatus(s, 'ended')}>End</button>}
                  {s.status !== 'live' && <button className="ghost-btn" onClick={() => setStatus(s, 'cancelled')}>Cancel</button>}
                  <button className="ghost-btn" onClick={() => showBookings(s)}>Bookings</button>
                </span>
              </td>
              <td>
                <span className="row-actions">
                  {s.status !== 'live' && <button className="ghost-btn" onClick={() => startEdit(s)}>Edit</button>}
                  <button className="danger-btn" onClick={() => remove(s)}>Delete</button>
                </span>
              </td>
            </tr>
          ))}
          {sessions.length === 0 && <tr><td className="muted" colSpan={10}>No live sessions yet.</td></tr>}
        </Table>
      )}

      {bookings && (
        <div className="modal-backdrop" onClick={() => setBookings(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>Bookings — {bookings.session.title} ({bookings.rows.length})</span>
              <button className="ghost-btn" onClick={() => setBookings(null)}>Close</button>
            </div>
            <Table headers={['Ticket', 'Name', 'Email', 'Account', 'Login ID', 'Status', 'Booked']}>
              {bookings.rows.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.ticket}</td>
                  <td>{b.full_name}</td>
                  <td>{b.email}</td>
                  <td className="mono">{b.account || '—'}</td>
                  <td className="mono">{b.loginid || '—'}</td>
                  <td><span className="badge">{b.status}</span></td>
                  <td className="muted">{fmtDate(b.created_at)}</td>
                </tr>
              ))}
              {bookings.rows.length === 0 && <tr><td className="muted" colSpan={7}>No bookings yet.</td></tr>}
            </Table>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>{editing === 'new' ? 'New live session' : `Edit session #${editing.id}`}</span>
              <button className="ghost-btn" onClick={() => setEditing(null)}>Close</button>
            </div>
            <form className="form" onSubmit={save}>
              <div className="form-grid">
                <label className="span-2">Title *
                  <input value={form.title || ''} onChange={set('title')} required placeholder="e.g. Trend Runner deep dive" />
                </label>
                <label className="span-2">Description
                  <textarea rows={3} value={form.description || ''} onChange={set('description')} placeholder="What will this session cover?" />
                </label>
                <label>Scheduled
                  <input type="datetime-local" value={form.scheduled_at || ''} onChange={set('scheduled_at')} />
                </label>
                <label>Duration (min)
                  <input type="number" value={form.duration_min || 60} onChange={set('duration_min')} />
                </label>
                <label className="span-2">Booking price
                  <div className="row" style={{ margin: 0 }}>
                    <label className="check" style={{ gap: 6 }}>
                      <input type="radio" name="paid" checked={!form.paid} onChange={() => setForm((f) => ({ ...f, paid: false, price_kes: 0 }))} /> Free
                    </label>
                    <label className="check" style={{ gap: 6 }}>
                      <input type="radio" name="paid" checked={!!form.paid} onChange={() => setForm((f) => ({ ...f, paid: true }))} /> Charge (Paystack)
                    </label>
                  </div>
                  {form.paid && (
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <span style={{ fontWeight: 600, color: 'var(--muted)', fontSize: 12 }}>Amount (KES)</span>
                      <input type="number" min={1} value={form.price_kes || ''} onChange={set('price_kes')} placeholder="e.g. 500" required={form.paid} />
                    </label>
                  )}
                  {form.paid && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>Users pay this amount via Paystack before receiving their ticket. Requires PAYSTACK_SECRET_KEY on the server.</span>}
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setEditing(null)}>Cancel</button>
                <button className="primary-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save session'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

// Host side of a screen-share broadcast. Captures the admin's screen with
// getDisplayMedia and publishes it to viewers over WebRTC (signaling via the
// server's /ws/live socket). Media itself is peer-to-peer.
function BroadcastStudio({ session, onExit }) {
  const previewRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const outboxRef = useRef([]);
  const runningRef = useRef(false);
  const [phase, setPhase] = useState('idle'); // idle | starting | live | ended
  const [viewers, setViewers] = useState(0);
  const [error, setError] = useState(null);

  const send = (msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else outboxRef.current.push(msg);
  };

  const flush = () => {
    while (outboxRef.current.length) send(outboxRef.current.shift());
  };

  const stopBroadcast = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (pcRef.current) { try { pcRef.current.close(); } catch { /* noop */ } pcRef.current = null; }
    if (wsRef.current) { try { wsRef.current.close(); } catch { /* noop */ } wsRef.current = null; }
    outboxRef.current = [];
    runningRef.current = false;
    setPhase('ended');
    setViewers(0);
  };

  const startShare = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    setPhase('starting');
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true });
      } catch {
        setError('Screen share was cancelled, or this browser does not support screen sharing.');
        setPhase('idle');
        runningRef.current = false;
        return;
      }
      streamRef.current = stream;
      stream.getTracks().forEach((t) => t.addEventListener('ended', stopBroadcast));
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.play().catch(() => {});
      }

      const ice = await api('/api/live/ice').then((d) => d.iceServers || []).catch(() => []);
      const pc = new RTCPeerConnection({ iceServers: ice });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      pc.onicecandidate = (ev) => { if (ev.candidate) send({ type: 'candidate', candidate: ev.candidate }); };

      const ws = new WebSocket(`${WS_BASE}/ws/live?room=live-${session.id}&token=${getToken()}`);
      wsRef.current = ws;
      ws.onopen = async () => {
        flush();
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send({ type: 'offer', sdp: pc.localDescription });
        } catch (e) { setError(`Could not create offer: ${e.message}`); }
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'answer' && pcRef.current) {
          pcRef.current.setRemoteDescription(msg.sdp).catch(() => {});
        } else if (msg.type === 'candidate' && pcRef.current && msg.candidate) {
          pcRef.current.addIceCandidate(msg.candidate).catch(() => {});
        } else if (msg.type === 'viewers') {
          setViewers(msg.count);
        } else if (msg.type === 'viewer_joined' && pcRef.current) {
          (async () => {
            try {
              const offer = await pcRef.current.createOffer();
              await pcRef.current.setLocalDescription(offer);
              send({ type: 'offer', sdp: pcRef.current.localDescription });
            } catch { /* renegotiation is best-effort */ }
          })();
        }
      };
      ws.onclose = () => {
        if (runningRef.current) { setPhase('ended'); setViewers(0); }
      };
      ws.onerror = () => { if (runningRef.current) setError('Signaling connection failed.'); };

      setPhase('live');
    } catch (e) {
      setError(e.message || 'Failed to start broadcast.');
      setPhase('idle');
      runningRef.current = false;
    }
  };

  useEffect(() => {
    startShare();
    return () => {
      runningRef.current = false;
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (pcRef.current) { try { pcRef.current.close(); } catch { /* noop */ } }
      if (wsRef.current) { try { wsRef.current.close(); } catch { /* noop */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section>
      <div className="row">
        <h2>Broadcasting — {session.title}</h2>
        <button className="ghost-btn" onClick={() => { stopBroadcast(); onExit(); }}>Back to sessions</button>
      </div>
      <div className="broadcast">
        <div className="broadcast-stage">
          <video ref={previewRef} muted playsInline autoPlay className={phase === 'live' ? 'broadcast-video' : 'broadcast-video dim'} />
          {phase === 'idle' && (
            <div className="broadcast-empty">
              <p>Ready to broadcast your screen.</p>
              <button className="primary-btn" onClick={() => startShare()}>Share screen</button>
              <p className="muted" style={{ fontSize: 12 }}>Viewers with a booked ticket for this session can join instantly.</p>
            </div>
          )}
          {phase === 'starting' && <div className="broadcast-empty">Starting screen share…</div>}
          {phase === 'ended' && <div className="broadcast-empty">Broadcast stopped.</div>}
        </div>
        <div className="broadcast-side">
          <div className="broadcast-status">
            <span className={`badge ${phase === 'live' ? 'st-live' : 'st-scheduled'}`}>
              {phase === 'live' ? 'ON AIR' : phase === 'starting' ? 'STARTING' : phase === 'ended' ? 'STOPPED' : 'IDLE'}
            </span>
            <span className="muted">Viewers: {viewers}</span>
          </div>
          {error && <ErrorNote message={error} />}
          {phase === 'live' && <button className="primary-btn" onClick={stopBroadcast}>Stop broadcast</button>}
          {phase === 'live' && (
            <p className="muted" style={{ fontSize: 12 }}>
              You are sharing your screen with {viewers} viewer{viewers === 1 ? '' : 's'}. Everything on your screen is visible to them.
            </p>
          )}
        </div>
      </div>
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
  ['promotions', 'Promotions'],
  ['live', 'Live'],
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
        {tab === 'promotions' && <PromotionsView />}
        {tab === 'live' && <LiveView />}
      </main>
    </div>
  );
}
