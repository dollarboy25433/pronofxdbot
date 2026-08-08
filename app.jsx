import { useEffect, useRef, useState } from 'react';
import {
  Play, LayoutGrid, Wrench, LineChart as ChartIcon, Users, Gift,
  Brain, Copy as CopyIcon, User, X, RotateCcw, TrendingUp, TrendingDown,
  GraduationCap, CandlestickChart, Calculator, BookOpen, Radio, Activity,
  RefreshCw, AlertTriangle,
} from 'lucide-react';
import { createChart, LineSeries, ColorType, CrosshairMode, LineStyle, createSeriesMarkers } from 'lightweight-charts';
import ClassesTab from './tabs/classes.jsx';
import TradingViewTab from './tabs/tradingview.jsx';
import RiskCalculatorTab from './tabs/risk.jsx';
import TutorialsTab from './tabs/tutorials.jsx';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const SESSION_KEY = 'deriv_session_id';

const BRAND = 'PulseTrader';

const TABS = [
  { id: 'campaigns', label: 'Campaigns', icon: Play },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'builder', label: 'Bot Builder', icon: Wrench },
  { id: 'charts', label: 'Charts', icon: ChartIcon },
  { id: 'circles', label: 'PCircles', icon: Users },
  { id: 'freebots', label: 'Free Bots', icon: Gift },
  { id: 'aihub', label: 'AI Hub', icon: Brain },
  { id: 'copytrading', label: 'Copytrading', icon: CopyIcon },
  { id: 'manual', label: 'Manual Trader', icon: User },
  { id: 'classes', label: 'Classes', icon: GraduationCap },
  { id: 'tradingview', label: 'Trading View', icon: CandlestickChart },
  { id: 'riskcalc', label: 'Risk Calculator', icon: Calculator },
  { id: 'tutorials', label: 'Tutorials', icon: BookOpen },
];

const PROMOS = [
  {
    id: 1,
    tag: 'LIMITED OFFER',
    tagColor: 'var(--accent-red)',
    title: 'Trend Runner V2',
    copy: 'A trend-following strategy template, backtested on historical data. Free to clone and tune.',
    img: 'https://picsum.photos/seed/trendrunner/640/420',
  },
  {
    id: 2,
    tag: 'AI EXCLUSIVE',
    tagColor: 'var(--accent-indigo)',
    title: 'Sentiment Pulse',
    copy: 'Combines volatility index feeds with a lightweight sentiment score to flag entries. Community-rated.',
    img: 'https://picsum.photos/seed/sentimentpulse/640/420',
  },
  {
    id: 3,
    tag: 'COMMUNITY PICK',
    tagColor: 'var(--accent-teal)',
    title: 'Grid Scalper Lite',
    copy: 'A simple grid strategy for ranging markets. Open-source logic, editable in Bot Builder.',
    img: 'https://picsum.photos/seed/gridscalper/640/420',
  },
];

const FREE_BOTS = [
  { id: 1, name: 'Even/Odd Ladder', desc: 'Digit-parity ladder strategy for synthetic indices.', img: 'https://picsum.photos/seed/ladderbot/300/300' },
  { id: 2, name: 'Rebound Hunter', desc: 'Waits for a pullback threshold before entering.', img: 'https://picsum.photos/seed/reboundbot/300/300' },
  { id: 3, name: 'Break & Retest', desc: 'Classic breakout-then-retest entry logic.', img: 'https://picsum.photos/seed/breakoutbot/300/300' },
  { id: 4, name: 'Martingale Guard', desc: 'Capped martingale with a hard stop-loss.', img: 'https://picsum.photos/seed/martingale/300/300' },
];

const COPYTRADERS = [
  { id: 1, name: 'a.kimani', roi: 18.4, followers: 312, img: 'https://picsum.photos/seed/trader1/100/100' },
  { id: 2, name: 'v.novak', roi: 11.2, followers: 198, img: 'https://picsum.photos/seed/trader2/100/100' },
  { id: 3, name: 's.osei', roi: -4.6, followers: 87, img: 'https://picsum.photos/seed/trader3/100/100' },
  { id: 4, name: 'l.tanaka', roi: 26.9, followers: 540, img: 'https://picsum.photos/seed/trader4/100/100' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('campaigns');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState('summary');

  // --- OAuth / session state (same flow as before) ---
  const [sessionId, setSessionId] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [balance, setBalance] = useState(null);
  const [authError, setAuthError] = useState(null);

  // --- Bot run state ---
  const [botRunning, setBotRunning] = useState(false);
  const [openContracts, setOpenContracts] = useState([]);
  const [trades, setTrades] = useState([]);
  const intervalRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlSession = params.get('session');
    const urlError = params.get('error');

    if (urlError) {
      setAuthError(urlError);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    if (urlSession) {
      localStorage.setItem(SESSION_KEY, urlSession);
      setSessionId(urlSession);
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) setSessionId(stored);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`${API_BASE}/api/accounts?session=${sessionId}`)
      .then((r) => { if (!r.ok) throw new Error('Session expired'); return r.json(); })
      .then((data) => {
        setAccounts(data.accounts);
        if (data.accounts.length > 0) setSelectedAccount(data.accounts[0].account);
      })
      .catch(() => {
        localStorage.removeItem(SESSION_KEY);
        setSessionId(null);
      });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !selectedAccount) return;
    fetch(`${API_BASE}/api/balance?session=${sessionId}&account=${selectedAccount}`)
      .then((r) => { if (!r.ok) throw new Error('balance fetch failed'); return r.json(); })
      .then(setBalance)
      .catch(() => setBalance(null));
  }, [sessionId, selectedAccount]);

  async function handleLogin(mode = 'login') {
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login-url?mode=${mode}`);
      const data = await res.json();
      if (!res.ok || !data.url) {
        setAuthError(data.error || 'Could not build the login URL.');
        return;
      }
      window.location.href = data.url;
    } catch {
      setAuthError('Could not reach the login server. Is the backend running?');
    }
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    setSessionId(null);
    setAccounts([]);
    setSelectedAccount(null);
    setBalance(null);
  }

  // Run toggles LIVE monitoring of open contracts on the selected account.
  // The ledger (stats below) is fed by real contract results from the
  // Manual Trader tab — no simulated numbers.
  async function fetchOpenContracts() {
    if (!sessionId || !selectedAccount) return;
    try {
      const res = await fetch(`${API_BASE}/api/contract/open?session=${sessionId}&account=${selectedAccount}`);
      if (!res.ok) return;
      const data = await res.json();
      setOpenContracts(data.contracts || []);
    } catch { /* keep last known list */ }
  }

  function toggleBot() {
    if (botRunning) {
      clearInterval(intervalRef.current);
      setBotRunning(false);
      return;
    }
    setBotRunning(true);
    fetchOpenContracts();
    intervalRef.current = setInterval(fetchOpenContracts, 3000);
  }

  function resetStats() {
    clearInterval(intervalRef.current);
    setBotRunning(false);
    setOpenContracts([]);
    setTrades([]);
  }

  useEffect(() => () => clearInterval(intervalRef.current), []);

  const stats = trades.reduce((acc, t) => {
    acc.totalStake += t.stake;
    if (t.won) { acc.won += 1; acc.totalPayout += t.stake + t.profit; }
    else { acc.lost += 1; }
    acc.runs += 1;
    return acc;
  }, { totalStake: 0, totalPayout: 0, runs: 0, won: 0, lost: 0 });
  const profitLoss = +(stats.totalPayout - stats.totalStake).toFixed(2);
  const currency = accounts.find((a) => a.account === selectedAccount)?.currency || 'USD';

  return (
    <div className="app">
      <GlobalStyle />

      <TopNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        loggedIn={!!sessionId}
        onLogin={handleLogin}
        onLogout={handleLogout}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      {authError && <div className="auth-error">{authError}</div>}

      <div className="body">
        <main className="main">
          {activeTab === 'campaigns' && <CampaignsTab />}
          {activeTab === 'dashboard' && (
            <DashboardTab
              loggedIn={!!sessionId}
              accounts={accounts}
              selectedAccount={selectedAccount}
              setSelectedAccount={setSelectedAccount}
              balance={balance}
              onLogin={handleLogin}
            />
          )}
          {activeTab === 'builder' && <BotBuilderTab />}
          {activeTab === 'charts' && <ChartsTab />}
          {activeTab === 'circles' && <CirclesTab />}
          {activeTab === 'freebots' && <FreeBotsTab />}
          {activeTab === 'aihub' && <AIHubTab />}
          {activeTab === 'copytrading' && <CopytradingTab />}
          {activeTab === 'manual' && (
            <ManualTraderTab
              sessionId={sessionId}
              accounts={accounts}
              selectedAccount={selectedAccount}
              setSelectedAccount={setSelectedAccount}
              balance={balance}
              onBalanceUpdate={setBalance}
              currency={currency}
              onTradeSettled={(trade) => setTrades((prev) => [...prev, trade])}
            />
          )}
          {activeTab === 'classes' && <ClassesTab />}
          {activeTab === 'tradingview' && <TradingViewTab />}
          {activeTab === 'riskcalc' && <RiskCalculatorTab />}
          {activeTab === 'tutorials' && <TutorialsTab />}
        </main>

        {sidebarOpen && (
          <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
        )}
        {sidebarOpen && (
          <BotSidebar
            sidebarTab={sidebarTab}
            setSidebarTab={setSidebarTab}
            botRunning={botRunning}
            toggleBot={toggleBot}
            resetStats={resetStats}
            stats={stats}
            profitLoss={profitLoss}
            currency={currency}
            openContracts={openContracts}
            trades={trades}
            onClose={() => setSidebarOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------- Top nav ----------------

function TopNav({ activeTab, setActiveTab, loggedIn, onLogin, onLogout, sidebarOpen, setSidebarOpen }) {
  return (
    <header className="topnav">
      <div className="topnav-row">
        <div className="brand">
          <div className="brand-mark">P</div>
          <span className="brand-name">{BRAND}</span>
          <span className="brand-badge">v2</span>
        </div>

        <div className="topnav-actions">
          {!loggedIn ? (
            <>
              <button className="btn-ghost" onClick={() => onLogin('login')}>Log in</button>
              <button className="btn-primary" onClick={() => onLogin('register')}>Sign up</button>
            </>
          ) : (
            <button className="btn-ghost" onClick={onLogout}>Log out</button>
          )}
          <button
            className="btn-icon"
            title={sidebarOpen ? 'Hide bot panel' : 'Show bot panel'}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Wrench size={16} />
          </button>
        </div>
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              className={`tab ${active ? 'tab-active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}

// ---------------- Campaigns ----------------

function CampaignsTab() {
  return (
    <div className="section">
      <div className="section-head">
        <div className="pill-row">
          <span className="pill pill-active">Promotions</span>
          <span className="pill">Book a Live Session</span>
        </div>
      </div>

      <div className="promo-row">
        {PROMOS.map((p) => (
          <div className="promo-card" key={p.id}>
            <div className="promo-img" style={{ backgroundImage: `url(${p.img})` }}>
              <span className="promo-tag" style={{ background: p.tagColor }}>{p.tag}</span>
            </div>
            <div className="promo-body">
              <h3>{p.title}</h3>
              <p>{p.copy}</p>
              <button className="btn-outline">View strategy</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Dashboard ----------------

function DashboardTab({ loggedIn, accounts, selectedAccount, setSelectedAccount, balance, onLogin }) {
  return (
    <div className="section">
      <h2 className="section-title">Dashboard</h2>

      {!loggedIn ? (
        <div className="card empty-card">
          <p>Log in with your Deriv account to see your balance and account activity here.</p>
          <button className="btn-primary" onClick={() => onLogin('login')}>Login with Deriv</button>
        </div>
      ) : (
        <div className="dash-grid">
          <div className="card">
            <div className="card-label">Account</div>
            <select
              className="select"
              value={selectedAccount || ''}
              onChange={(e) => setSelectedAccount(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.account} value={a.account}>{a.account} ({a.currency})</option>
              ))}
            </select>
          </div>

          <div className="card balance-card">
            <div className="card-label">Balance</div>
            <div className="balance-value">
              {balance ? `${balance.balance} ${balance.currency}` : '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Bot Builder ----------------

function BotBuilderTab() {
  const blocks = ['Start', 'Purchase condition', 'Trade parameters', 'Restart / stop'];
  return (
    <div className="section">
      <h2 className="section-title">Bot Builder</h2>
      <p className="section-sub">Drag blocks to define your strategy logic. This is a starter canvas — wire it up to your own block library.</p>
      <div className="builder-canvas">
        {blocks.map((b, i) => (
          <div className="builder-block" key={b}>
            <span className="builder-index">{i + 1}</span>
            {b}
          </div>
        ))}
        <button className="builder-add">+ Add block</button>
      </div>
    </div>
  );
}

// ---------------- Charts (live feed) ----------------

const CHART_GRANS = [
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 900, label: '15m' },
  { value: 3600, label: '1h' },
];

function ChartsTab() {
  const [symbols, setSymbols] = useState([]);
  const [symbol, setSymbol] = useState(null);
  const [granularity, setGranularity] = useState(60);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [refreshKey, setRefreshKey] = useState(0);

  const activeSymbol = symbols.find((s) => s.symbol === symbol) || null;
  const decimals = activeSymbol?.decimals ?? 2;

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/symbols`)
      .then((r) => { if (!r.ok) throw new Error(`Symbols request failed (${r.status})`); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        setSymbols(data.symbols || []);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (symbol || symbols.length === 0) return;
    const preferred = symbols.find((s) => s.symbol === 'R_100') || symbols.find((s) => s.symbol === 'R_75') || symbols[0];
    setSymbol(preferred.symbol);
  }, [symbols, symbol]);

  // candle history -> line points
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPoints([]);
    fetch(`${API_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&granularity=${granularity}&count=400`)
      .then((r) => { if (!r.ok) throw new Error(`Candle request failed (${r.status})`); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        const candles = data.candles || [];
        setPoints(candles.map((c) => ({ t: Math.floor(c.t / 1000), price: c.c })));
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, granularity, refreshKey]);

  // live ticks append to the same line
  useEffect(() => {
    if (!symbol) return;
    let ws = null;
    let closed = false;
    let retry = 0;
    let retryTimer = null;

    const connect = () => {
      if (closed) return;
      setWsStatus('connecting');
      try {
        ws = new WebSocket(`${WS_BASE}/ws?symbol=${encodeURIComponent(symbol)}`);
      } catch {
        setWsStatus('offline');
        retryTimer = setTimeout(connect, 3000);
        return;
      }
      ws.onopen = () => { retry = 0; setWsStatus('live'); };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.msg_type === 'market_status') {
            setMarketStatus(msg);
            return;
          }
          if (msg.msg_type !== 'tick' || !msg.tick) return;
          const { epoch, quote } = msg.tick;
          setPoints((prev) => {
            if (prev.length && prev[prev.length - 1].t >= epoch) return prev;
            const next = [...prev, { t: epoch, price: quote }];
            return next.length > 800 ? next.slice(next.length - 800) : next;
          });
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => {
        if (closed) return;
        setWsStatus('offline');
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry, 15000));
        retry += 1;
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      try { if (ws) ws.close(); } catch { /* noop */ }
    };
  }, [symbol]);

  const marketNotice = marketStatus
    ? (marketStatus.marketClosed
      ? `Market is closed for ${marketStatus.symbol}.`
      : marketStatus.unavailable
        ? `${marketStatus.symbol} is not available on this account/app (${marketStatus.code}).`
        : (marketStatus.message || marketStatus.code))
    : null;

  const last = points.length ? points[points.length - 1].price : null;
  const first = points.length ? points[0].price : null;
  const up = last != null && first != null && last >= first;
  const statusLabel = wsStatus === 'live' ? 'Live' : wsStatus === 'connecting' ? 'Connecting' : 'Offline';
  const statusClass = wsStatus === 'live' ? 'tv-live' : wsStatus === 'connecting' ? 'tv-connecting' : 'tv-offline';

  return (
    <div className="section">
      <div className="chart-head">
        <h2 className="section-title">Live Market Feed</h2>
        {last != null && first != null && (
          <span className={`chart-delta ${up ? 'up' : 'down'}`}>
            {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {(last - first) >= 0 ? '+' : ''}{(last - first).toFixed(decimals)}
          </span>
        )}
        <span className={`tv-status ${statusClass}`}><Radio size={13} /> {statusLabel}</span>
      </div>

      <div className="chart-toolbar">
        <select
          className="select chart-symbol-select"
          value={symbol || ''}
          onChange={(e) => setSymbol(e.target.value)}
          disabled={symbols.length === 0}
        >
          {symbol === null && <option value="">Select a symbol…</option>}
          {symbols.map((s) => (
            <option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</option>
          ))}
        </select>
        <div className="tv-gran">
          {CHART_GRANS.map((g) => (
            <button
              key={g.value}
              className={`tv-gran-btn ${granularity === g.value ? 'tv-gran-active' : ''}`}
              onClick={() => setGranularity(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <button className="btn-outline btn-small" title="Refresh" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="chart-card">
        {marketNotice && (
          <div className="tv-banner tv-banner-error" style={{ margin: 12 }}>
            <AlertTriangle size={14} />
            <span>{marketNotice}</span>
          </div>
        )}
        {loading && points.length === 0 && <div className="tv-empty">Loading feed…</div>}
        {error && (
          <div className="tv-banner tv-banner-error" style={{ margin: 12 }}>
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        )}
        <div className="chart-canvas">
          <LineFeedChart
            points={points}
            decimals={decimals}
            lastPrice={last ?? undefined}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------- Circles (copy-community) ----------------

function CirclesTab() {
  const circles = [
    { name: 'Synthetic Index Circle', members: 214, img: 'https://picsum.photos/seed/circle1/200/200' },
    { name: 'Forex Swing Circle', members: 132, img: 'https://picsum.photos/seed/circle2/200/200' },
    { name: 'Scalpers Only', members: 89, img: 'https://picsum.photos/seed/circle3/200/200' },
  ];
  return (
    <div className="section">
      <h2 className="section-title">PCircles</h2>
      <p className="section-sub">Join a community circle to share and discuss strategies.</p>
      <div className="circle-row">
        {circles.map((c) => (
          <div className="circle-card" key={c.name}>
            <img src={c.img} alt="" className="circle-img" />
            <div>
              <div className="circle-name">{c.name}</div>
              <div className="circle-members">{c.members} members</div>
            </div>
            <button className="btn-outline">Join</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Free bots ----------------

function FreeBotsTab() {
  return (
    <div className="section">
      <h2 className="section-title">Free Bots</h2>
      <div className="bot-grid">
        {FREE_BOTS.map((b) => (
          <div className="bot-card" key={b.id}>
            <img src={b.img} alt="" className="bot-img" />
            <h3>{b.name}</h3>
            <p>{b.desc}</p>
            <button className="btn-outline">Use bot</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- AI Hub ----------------

function AIHubTab() {
  return (
    <div className="section">
      <h2 className="section-title">AI Hub</h2>
      <div className="aihub-grid">
        <div className="aihub-card">
          <img src="https://picsum.photos/seed/aihub1/500/300" alt="" className="aihub-img" />
          <h3>Sentiment scoring</h3>
          <p>Blends recent price action with a lightweight sentiment score to flag possible entries. Treat as one signal among several, not a guarantee.</p>
        </div>
        <div className="aihub-card">
          <img src="https://picsum.photos/seed/aihub2/500/300" alt="" className="aihub-img" />
          <h3>Anomaly alerts</h3>
          <p>Flags unusual volatility spikes on your watched symbols so you can review before trading.</p>
        </div>
      </div>
    </div>
  );
}

// ---------------- Copytrading ----------------

function CopytradingTab() {
  return (
    <div className="section">
      <h2 className="section-title">Copytrading</h2>
      <div className="table-card">
        <div className="table-row table-head">
          <span>Trader</span><span>30d ROI</span><span>Followers</span><span></span>
        </div>
        {COPYTRADERS.map((t) => (
          <div className="table-row" key={t.id}>
            <span className="trader-cell">
              <img src={t.img} alt="" className="trader-avatar" />
              {t.name}
            </span>
            <span className={t.roi >= 0 ? 'roi-up' : 'roi-down'}>{t.roi >= 0 ? '+' : ''}{t.roi}%</span>
            <span>{t.followers}</span>
            <button className="btn-outline btn-small">Copy</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Manual trader ----------------
// Places REAL contracts on your Deriv account: proposal -> buy -> live
// proposal_open_contract stream (entry spot, current spot, sell price,
// expiry) -> sell now / settle. The chart marks the current price, the
// entry point, the remaining time (timer lapse) and the market type.

const MT_MARKET_LABELS = {
  synthetic_index: 'Synthetic Indices',
  derived: 'Derived',
  forex: 'Forex',
  cryptocurrency: 'Crypto',
  commodities: 'Commodities',
};
const MT_TYPES = ['RISE', 'FALL', 'CALL', 'PUT', 'ASIAU', 'ASIAD'];
const MT_TYPE_LABELS = { RISE: 'Rise', FALL: 'Fall', CALL: 'Call', PUT: 'Put', ASIAU: 'Asia Up', ASIAD: 'Asia Down' };
const MT_UNIT_LABELS = { t: 'ticks', s: 'sec', m: 'min', h: 'hrs', d: 'days' };
const MT_UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };

function formatRemaining(ms) {
  if (ms == null) return '—';
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function ManualTraderTab({ sessionId, accounts, selectedAccount, setSelectedAccount, balance, onBalanceUpdate, currency, onTradeSettled }) {
  const [symbols, setSymbols] = useState([]);
  const [symbolsError, setSymbolsError] = useState(null);
  const [symbol, setSymbol] = useState(null);

  const [contractTypes, setContractTypes] = useState([]);
  const [contractType, setContractType] = useState(null);

  const [duration, setDuration] = useState(5);
  const [durationUnit, setDurationUnit] = useState('t');
  const [stake, setStake] = useState(10);

  const [proposal, setProposal] = useState(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState(null);

  const [contract, setContract] = useState(null); // latest proposal_open_contract
  const [contractMeta, setContractMeta] = useState(null); // buy response + proposal meta
  const [busy, setBusy] = useState(false);
  const [selling, setSelling] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [result, setResult] = useState(null);

  const [lastTick, setLastTick] = useState(null);
  const [ticks, setTicks] = useState([]);
  const [wsStatus, setWsStatus] = useState('idle');
  const [marketStatus, setMarketStatus] = useState(null);
  const [now, setNow] = useState(Date.now());

  const wsRef = useRef(null);
  const settleRef = useRef(null);
  const contractMetaRef = useRef(null);
  const contractIdRef = useRef(null);

  useEffect(() => { contractMetaRef.current = contractMeta; }, [contractMeta]);
  useEffect(() => { contractIdRef.current = contractMeta?.contract_id ?? null; }, [contractMeta]);

  const activeSymbol = symbols.find((s) => s.symbol === symbol) || null;
  const decimals = activeSymbol?.decimals ?? 2;

  // --- symbol catalog (live from Deriv) ---
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/symbols`)
      .then((r) => { if (!r.ok) throw new Error(`Symbols request failed (${r.status})`); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        setSymbols(data.symbols || []);
        setSymbolsError(null);
      })
      .catch((e) => { if (!cancelled) setSymbolsError(e.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (symbol || symbols.length === 0) return;
    const preferred = symbols.find((s) => s.symbol === 'R_75') || symbols.find((s) => s.symbol === 'R_100') || symbols[0];
    setSymbol(preferred.symbol);
  }, [symbols, symbol]);

  // --- available contract types for the symbol on this account ---
  useEffect(() => {
    if (!symbol || !sessionId || !selectedAccount) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/contracts_for?session=${encodeURIComponent(sessionId)}&account=${encodeURIComponent(selectedAccount)}&symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('contracts_for failed'))))
      .then((data) => {
        if (cancelled) return;
        const avail = (data.contracts_for && data.contracts_for.available) || [];
        const supported = avail
          .filter((a) => MT_TYPES.includes(a.contract_type))
          .map((a) => ({
            type: a.contract_type,
            label: MT_TYPE_LABELS[a.contract_type] || a.display_name,
            units: (a.duration_units || []).filter((u) => MT_UNIT_LABELS[u]),
            min: a.duration_min ?? 1,
            max: a.duration_max ?? 9999,
          }));
        setContractTypes(supported);
        setContractType((prev) => (supported.some((s) => s.type === prev) ? prev : (supported[0] ? supported[0].type : null)));
      })
      .catch(() => { if (!cancelled) setContractTypes([]); });
    return () => { cancelled = true; };
  }, [symbol, sessionId, selectedAccount]);

  // keep duration/unit valid for the selected contract type
  useEffect(() => {
    const ct = contractTypes.find((c) => c.type === contractType);
    if (!ct) return;
    setDurationUnit((prev) => (ct.units.includes(prev) ? prev : (ct.units[0] || 'm')));
    setDuration((d) => Math.max(ct.min, Math.min(ct.max, Number(d) || ct.min)));
  }, [contractType, contractTypes]);

  // --- live symbol ticks + contract updates over one socket ---
  const applyTick = (tick) => {
    if (tick.symbol !== symbol) return;
    setLastTick(tick);
    setTicks((prev) => {
      if (prev.length && prev[prev.length - 1].t >= tick.epoch) return prev;
      const next = [...prev, { t: tick.epoch, price: tick.quote }];
      return next.length > 600 ? next.slice(next.length - 600) : next;
    });
  };

  const applyContract = (poc) => {
    if (poc.entry_spot != null && poc.entry_tick_time != null) {
      setTicks((prev) => {
        if (prev.length === 0) return [{ t: poc.entry_tick_time, price: poc.entry_spot }];
        const last = prev[prev.length - 1];
        if (last.t < poc.entry_tick_time && last.price !== poc.entry_spot) {
          return [...prev, { t: poc.entry_tick_time, price: poc.entry_spot }];
        }
        return prev;
      });
    }
    if (poc.is_sold || poc.status === 'sold') {
      if (settleRef.current === poc.contract_id) return;
      settleRef.current = poc.contract_id;
      const meta = contractMetaRef.current || {};
      const profit = poc.profit ?? 0;
      setResult({ won: profit >= 0, profit, soldEarly: false });
      setContract(null);
      setContractMeta(null);
      onTradeSettled({ id: poc.contract_id, symbol, direction: meta.contract_type, stake: meta.price ?? 0, profit, won: profit >= 0, ts: Date.now() });
      refreshBalance();
      return;
    }
    setContract(poc);
  };

  async function refreshBalance() {
    if (!sessionId || !selectedAccount) return;
    try {
      const res = await fetch(`${API_BASE}/api/balance?session=${sessionId}&account=${selectedAccount}`);
      if (res.ok) onBalanceUpdate(await res.json());
    } catch { /* keep last known balance */ }
  }

  useEffect(() => {
    if (!symbol || !sessionId || !selectedAccount) return;
    let closed = false;
    let retry = 0;
    let retryTimer = null;

    const connect = () => {
      if (closed) return;
      setWsStatus('connecting');
      try {
        const ws = new WebSocket(`${WS_BASE}/ws?symbol=${encodeURIComponent(symbol)}&session=${encodeURIComponent(sessionId)}&account=${encodeURIComponent(selectedAccount)}`);
        wsRef.current = ws;
        ws.onopen = () => {
          retry = 0;
          setWsStatus('live');
          if (contractIdRef.current) {
            ws.send(JSON.stringify({ action: 'subscribe', contract: contractIdRef.current }));
          }
        };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.msg_type === 'market_status') {
              setMarketStatus(msg);
              return;
            }
            if (msg.msg_type === 'tick' && msg.tick) applyTick(msg.tick);
            if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) applyContract(msg.proposal_open_contract);
          } catch { /* ignore malformed frames */ }
        };
        ws.onclose = () => {
          wsRef.current = null;
          if (closed) return;
          setWsStatus('offline');
          retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry, 15000));
          retry += 1;
        };
        ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
      } catch {
        setWsStatus('offline');
        retryTimer = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      try { if (wsRef.current) wsRef.current.close(); } catch { /* noop */ }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, sessionId, selectedAccount]);

  // subscribe/unsubscribe the open-contract stream on the same socket
  useEffect(() => {
    const ws = wsRef.current;
    const contractId = contractMeta?.contract_id;
    if (!ws || !contractId) return;
    ws.send(JSON.stringify({ action: 'subscribe', contract: contractId }));
    return () => {
      try {
        if (wsRef.current && wsRef.current.readyState === 1) {
          wsRef.current.send(JSON.stringify({ action: 'unsubscribe', contract: contractId }));
        }
      } catch { /* noop */ }
    };
  }, [contractMeta?.contract_id]);

  // --- countdown clock for the timer lapse ---
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // --- proposal (price quote) for the current selection ---
  useEffect(() => {
    if (!sessionId || !selectedAccount || !symbol || !contractType || contractMeta) return;
    let cancelled = false;
    setProposalLoading(true);
    setProposalError(null);
    const t = setTimeout(() => {
      fetch(`${API_BASE}/api/contract/proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: sessionId,
          account: selectedAccount,
          symbol,
          contract_type: contractType,
          amount: stake,
          basis: 'stake',
          duration,
          duration_unit: durationUnit,
          currency,
        }),
      })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || 'Proposal failed');
          if (!cancelled) { setProposal(data.proposal); setProposalError(null); }
        })
        .catch((e) => { if (!cancelled) { setProposal(null); setProposalError(e.message); } })
        .finally(() => { if (!cancelled) setProposalLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [sessionId, selectedAccount, symbol, contractType, stake, duration, durationUnit, currency, contractMeta]);

  // --- buy a real contract ---
  async function handleBuy() {
    if (!proposal || busy || contractMeta) return;
    setBusy(true);
    setActionError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/contract/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionId, account: selectedAccount, proposal_id: proposal.id, price: proposal.ask_price }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Buy failed');
      const buy = data.buy;
      settleRef.current = null;
      setContractMeta({
        ...buy,
        contract_type: contractType,
        symbol,
        duration,
        duration_unit: durationUnit,
        date_expiry: proposal.date_expiry,
        tick_count: proposal.tick_count,
        payout: proposal.payout,
        longcode: proposal.longcode,
      });
      setContract(null);
      setTicks([]);
      setLastTick(null);
      refreshBalance();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // --- sell an open contract early ---
  async function handleSell() {
    if (!contract || !contract.is_valid_to_sell || selling) return;
    setSelling(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/api/contract/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionId, account: selectedAccount, contract_id: contract.contract_id, price: contract.sell_price }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sell failed');
      const sold = data.sell;
      const buyPrice = contractMeta?.price ?? 0;
      const profit = (sold.sold_for ?? contract.sell_price) - buyPrice;
      settleRef.current = contract.contract_id;
      setResult({ won: profit >= 0, profit, soldEarly: true, soldFor: sold.sold_for });
      setContract(null);
      setContractMeta(null);
      onTradeSettled({ id: contract.contract_id, symbol, direction: contractMeta?.contract_type, stake: buyPrice, profit, won: profit >= 0, ts: Date.now() });
      refreshBalance();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setSelling(false);
    }
  }

  const isTickContract = (contractMeta?.duration_unit ?? durationUnit) === 't';
  const contractEndMs = (() => {
    const expiry = contract?.date_expiry ?? contractMeta?.date_expiry;
    if (expiry) return expiry * 1000;
    if (contractMeta?.purchase_time && !isTickContract) {
      const secs = MT_UNIT_SECONDS[contractMeta.duration_unit] || MT_UNIT_SECONDS.m;
      return (contractMeta.purchase_time + contractMeta.duration * secs) * 1000;
    }
    return null;
  })();
  const remainingMs = contractEndMs ? Math.max(0, contractEndMs - now) : null;
  const totalTicks = contractMeta?.tick_count;
  const currentTick = contract?.current_tick;
  const remainingTicks = (totalTicks != null && currentTick != null) ? Math.max(0, totalTicks - currentTick) : null;

  const lastPrice = lastTick?.quote ?? contract?.current_spot ?? proposal?.spot ?? null;
  const entryPoint = contract?.entry_spot != null
    ? { price: contract.entry_spot, time: contract.entry_tick_time }
    : (contractMeta?.entry_spot != null ? { price: contractMeta.entry_spot, time: contractMeta.entry_tick_time } : null);
  const profitEstimate = proposal ? proposal.payout - proposal.ask_price : null;

  const wsLabel = wsStatus === 'live' ? 'Live' : wsStatus === 'connecting' ? 'Connecting' : 'Offline';
  const wsClass = wsStatus === 'live' ? 'tv-live' : wsStatus === 'connecting' ? 'tv-connecting' : 'tv-offline';

  const marketNotice = marketStatus
    ? (marketStatus.marketClosed
      ? `Market is closed for ${marketStatus.symbol}. You can still open contracts once it reopens.`
      : marketStatus.unavailable
        ? `${marketStatus.symbol} is not available on this account/app (${marketStatus.code}).`
        : (marketStatus.message || marketStatus.code))
    : null;

  if (!sessionId) {
    return (
      <div className="section">
        <h2 className="section-title">Manual Trader</h2>
        <div className="card empty-card">
          <p>Log in with your Deriv account to place real contracts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="mt-head">
        <h2 className="section-title">Manual Trader</h2>
        <span className={`tv-status ${wsClass}`}><Radio size={13} /> {wsLabel}</span>
        <span className="mt-balance">
          Balance: <b>{balance ? `${balance.balance} ${balance.currency}` : '—'}</b>
        </span>
      </div>

      <div className="mt-grid">
        <div className="card mt-form">
          <label className="card-label">Account</label>
          <select className="select" value={selectedAccount || ''} onChange={(e) => setSelectedAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.account} value={a.account}>{a.account} ({a.currency})</option>
            ))}
          </select>

          <label className="card-label">Symbol</label>
          <select className="select" value={symbol || ''} onChange={(e) => { setSymbol(e.target.value); setContract(null); setContractMeta(null); setResult(null); }} disabled={symbols.length === 0}>
            {symbol === null && <option value="">Loading symbols…</option>}
            {Object.entries(
              symbols.reduce((groups, s) => {
                const key = s.market || 'other';
                (groups[key] = groups[key] || []).push(s);
                return groups;
              }, {})
            ).map(([market, list]) => (
              <optgroup key={market} label={MT_MARKET_LABELS[market] || market}>
                {list.map((s) => (
                  <option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {symbolsError && <p className="mt-hint">Symbol list unavailable: {symbolsError}</p>}
          {marketNotice && (
            <div className="mt-error"><AlertTriangle size={13} /> {marketNotice}</div>
          )}

          <div className="mt-market-type">
            <div className="mt-market-row"><span>Market</span><b>{activeSymbol ? (MT_MARKET_LABELS[activeSymbol.market] || activeSymbol.market) : '—'}</b></div>
            <div className="mt-market-row"><span>Contract</span><b>{contractType ? MT_TYPE_LABELS[contractType] : '—'}</b></div>
            <div className="mt-market-row"><span>Duration</span><b>{duration}{MT_UNIT_LABELS[durationUnit] ? ` ${MT_UNIT_LABELS[durationUnit]}` : ''}</b></div>
          </div>

          <label className="card-label">Contract type</label>
          <div className="mt-types">
            {contractTypes.map((ct) => (
              <button
                key={ct.type}
                className={`mt-type-btn ${contractType === ct.type ? 'mt-type-active' : ''}`}
                onClick={() => { setContractType(ct.type); setResult(null); }}
              >
                {ct.label}
              </button>
            ))}
            {contractTypes.length === 0 && <span className="mt-hint">No tradable contract types returned for this symbol.</span>}
          </div>

          <label className="card-label">Duration</label>
          <div className="mt-duration">
            <input
              className="select mt-duration-input"
              type="number"
              min="1"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
            <div className="mt-units">
              {(contractTypes.find((c) => c.type === contractType)?.units || ['t', 'm', 'h']).map((u) => (
                <button
                  key={u}
                  className={`mt-unit-btn ${durationUnit === u ? 'mt-unit-active' : ''}`}
                  onClick={() => setDurationUnit(u)}
                >
                  {MT_UNIT_LABELS[u]}
                </button>
              ))}
            </div>
          </div>

          <label className="card-label">Stake ({currency})</label>
          <input
            className="select"
            type="number"
            min="1"
            step="0.01"
            value={stake}
            onChange={(e) => setStake(Number(e.target.value))}
          />

          <div className="mt-quote">
            <div className="mt-quote-row"><span>Spot</span><b>{lastPrice == null ? '—' : lastPrice.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
            <div className="mt-quote-row"><span>Stake</span><b>{proposal ? proposal.ask_price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</b></div>
            <div className="mt-quote-row"><span>Payout</span><b>{proposal ? proposal.payout.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</b></div>
            <div className="mt-quote-row">
              <span>Profit if won</span>
              <b className={profitEstimate != null && profitEstimate >= 0 ? 'roi-up' : 'roi-down'}>
                {proposalLoading ? '…' : (profitEstimate == null ? '—' : `${profitEstimate >= 0 ? '+' : ''}${profitEstimate.toFixed(2)}`)}
              </b>
            </div>
          </div>

          {(proposalError || actionError) && (
            <div className="mt-error"><AlertTriangle size={13} /> {proposalError || actionError}</div>
          )}

          <button className="btn-buy mt-buy" onClick={handleBuy} disabled={!proposal || busy || !!contractMeta}>
            {busy ? 'Buying…' : `Buy ${contractType ? MT_TYPE_LABELS[contractType] : 'contract'}`}
          </button>

          {contractMeta && (
            <div className="mt-open">
              <div className="card-label">Open contract</div>
              <div className="mt-open-row"><span>Entry</span><b>{contract?.entry_spot == null ? '—' : contract.entry_spot.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
              <div className="mt-open-row"><span>Current</span><b>{contract?.current_spot == null ? '—' : contract.current_spot.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
              <div className="mt-open-row"><span>Sell now at</span><b>{contract?.sell_price == null ? '—' : contract.sell_price.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
              <button className="btn-sell mt-sell" onClick={handleSell} disabled={!contract?.is_valid_to_sell || selling}>
                {selling ? 'Selling…' : 'Sell now'}
              </button>
              {!contract?.is_valid_to_sell && <p className="mt-hint">Contract can&apos;t be sold yet.</p>}
            </div>
          )}

          {result && (
            <div className={`mt-result ${result.won ? 'mt-result-won' : 'mt-result-lost'}`}>
              <b>{result.soldEarly ? (result.won ? 'Closed at a profit' : 'Closed at a loss') : (result.won ? 'Contract won' : 'Contract lost')}</b>
              <span>{result.profit >= 0 ? '+' : ''}{result.profit.toFixed(2)} {currency}</span>
            </div>
          )}
        </div>

        <div className="card mt-chart-card">
          <div className="mt-chart-top">
            <span className="mt-type-badge">
              {symbol || '—'} · {contractType ? MT_TYPE_LABELS[contractType] : '—'} · {duration} {MT_UNIT_LABELS[durationUnit]}
            </span>
            {contractMeta && isTickContract && (
              <span className="mt-timer">⏱ {remainingTicks == null ? '—' : `${remainingTicks} ticks left`}</span>
            )}
            {contractMeta && !isTickContract && (
              <span className="mt-timer">⏱ {formatRemaining(remainingMs)} left</span>
            )}
          </div>

          {contractMeta ? (
            <LineFeedChart
              points={ticks}
              decimals={decimals}
              entryPoint={entryPoint}
              lastPrice={lastPrice}
              direction={contractType}
            />
          ) : (
            <div className="tv-empty mt-empty-chart">
              <Activity size={18} />
              <span>Live spot feed ready — buy a contract to start the trade chart.</span>
            </div>
          )}

          <div className="mt-strip">
            <div className="mt-strip-cell">
              <span>Current price</span>
              <b>{lastPrice == null ? '—' : lastPrice.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b>
            </div>
            <div className="mt-strip-cell">
              <span>Entry point</span>
              <b>{contract?.entry_spot == null ? '—' : contract.entry_spot.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b>
            </div>
            <div className="mt-strip-cell">
              <span>Market type</span>
              <b>{activeSymbol ? (MT_MARKET_LABELS[activeSymbol.market] || activeSymbol.market) : '—'}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Live line chart (lightweight-charts v5). Marks the current price as a
// dotted price line and the entry point as a dashed price line + arrow.
// ---------------------------------------------------------------------

function LineFeedChart({ points, decimals, entryPoint, lastPrice, direction }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const entryLineRef = useRef(null);
  const currentLineRef = useRef(null);
  const markersRef = useRef(null);
  const appliedLen = useRef(0);

  const toPoint = (p) => ({ time: p.t, value: p.price });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#14181d' },
        textColor: '#8b93a1',
        fontSize: 11,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: '#1d2229' }, horzLines: { color: '#1d2229' } },
      timeScale: { timeVisible: true, secondsVisible: true, borderColor: '#23282f', rightOffset: 3 },
      rightPriceScale: { borderColor: '#23282f' },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(242,243,245,0.3)', labelBackgroundColor: '#23282f' },
        horzLine: { color: 'rgba(242,243,245,0.3)', labelBackgroundColor: '#23282f' },
      },
    });

    const series = chart.addSeries(LineSeries, {
      color: '#4c6ef5',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: decimals, minMove: 1 / Math.pow(10, decimals) },
    });
    markersRef.current = createSeriesMarkers(series, []);

    chartRef.current = chart;
    seriesRef.current = series;
    appliedLen.current = 0;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      entryLineRef.current = null;
      currentLineRef.current = null;
      markersRef.current = null;
      appliedLen.current = 0;
    };
  }, [decimals]);

  // push live points incrementally (full reset when a new trade starts)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (points.length === 0) {
      series.setData([]);
      appliedLen.current = 0;
      return;
    }
    const prev = appliedLen.current;
    if (prev === 0 || prev > points.length || points.length > prev + 1) {
      series.setData(points.map(toPoint));
    } else if (prev < points.length) {
      series.update(toPoint(points[points.length - 1]));
    }
    appliedLen.current = points.length;
    chartRef.current?.timeScale().scrollToRealTime();
  }, [points]);

  // entry price line + arrow marker
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (entryLineRef.current) {
      try { series.removePriceLine(entryLineRef.current); } catch { /* noop */ }
      entryLineRef.current = null;
    }
    markersRef.current?.setMarkers([]);
    if (entryPoint && typeof entryPoint.price === 'number') {
      entryLineRef.current = series.createPriceLine({
        price: entryPoint.price,
        color: '#ffb224',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'Entry',
        axisLabelVisible: true,
      });
      if (entryPoint.time) {
        const up = direction === 'RISE' || direction === 'CALL' || direction === 'ASIAU' || direction === 'UPORDOWN';
        markersRef.current?.setMarkers([{
          time: entryPoint.time,
          position: up ? 'belowBar' : 'aboveBar',
          color: up ? '#00d0a0' : '#ff444f',
          shape: up ? 'arrowUp' : 'arrowDown',
          text: 'Entry',
        }]);
      }
    }
  }, [entryPoint, direction]);

  // dotted current-price line
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || lastPrice == null) return;
    if (currentLineRef.current) {
      currentLineRef.current.applyOptions({ price: lastPrice });
    } else {
      currentLineRef.current = series.createPriceLine({
        price: lastPrice,
        color: '#4c6ef5',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        title: 'Current',
        axisLabelVisible: true,
      });
    }
  }, [lastPrice]);

  return <div className="mt-chart-canvas" ref={containerRef} />;
}

// ---------------- Bot sidebar (Run panel) ----------------

function BotSidebar({ sidebarTab, setSidebarTab, botRunning, toggleBot, resetStats, stats, profitLoss, currency, openContracts, trades, onClose }) {
  const recentTrades = [...trades].reverse().slice(0, 12);
  return (
    <aside className="sidebar">
      <div className="sidebar-topbar">
        <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        <button className={`run-btn ${botRunning ? 'run-btn-active' : ''}`} onClick={toggleBot}>
          <Play size={14} fill={botRunning ? 'currentColor' : 'none'} />
          {botRunning ? 'Stop' : 'Run'}
        </button>
        <span className="run-status">{botRunning ? 'Monitoring open contracts' : 'Bot is idle'}</span>
      </div>

      <div className="sidebar-tabs">
        {['summary', 'transactions', 'journal'].map((t) => (
          <button
            key={t}
            className={`sidebar-tab ${sidebarTab === t ? 'sidebar-tab-active' : ''}`}
            onClick={() => setSidebarTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="sidebar-body">
        {sidebarTab === 'summary' && (
          <>
            {stats.runs === 0 ? (
              <div className="sidebar-empty">
                <p>Real contract results from the <strong>Manual Trader</strong> tab are tracked here.<br />Hit <strong>Run</strong> to watch your open contracts live.</p>
              </div>
            ) : (
              <div className="sidebar-empty">
                <p>{stats.runs} real contract{stats.runs === 1 ? '' : 's'} settled this session.</p>
                <p style={{ marginTop: 8 }}>{openContracts.length} open right now.</p>
              </div>
            )}
          </>
        )}
        {sidebarTab === 'transactions' && (
          <div className="sidebar-ledger">
            {recentTrades.length === 0 ? (
              <div className="sidebar-empty"><p>No settled contracts yet. Buy one in Manual Trader.</p></div>
            ) : (
              recentTrades.map((t) => (
                <div className="ledger-row" key={`${t.id}-${t.ts}`}>
                  <span className="ledger-dir">{t.direction || '—'}</span>
                  <span className="ledger-sym">{t.symbol}</span>
                  <span className={t.won ? 'roi-up' : 'roi-down'}>
                    {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)} {currency}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {sidebarTab === 'journal' && (
          <div className="sidebar-ledger">
            {openContracts.length === 0 ? (
              <div className="sidebar-empty">
                <p>{botRunning ? 'No open contracts on this account right now.' : 'Open contracts will appear here while running.'}</p>
              </div>
            ) : (
              openContracts.map((c) => (
                <div className="ledger-row" key={c.contract_id}>
                  <span className="ledger-dir">Open</span>
                  <span className="ledger-sym" title={c.longcode}>{c.contract_id}</span>
                  <span>{c.currency}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="stats-grid">
        <Stat label="Total stake" value={`${stats.totalStake.toFixed(2)} ${currency}`} />
        <Stat label="Total payout" value={`${stats.totalPayout.toFixed(2)} ${currency}`} />
        <Stat label="No. of runs" value={stats.runs} />
        <Stat label="Contracts lost" value={stats.lost} />
        <Stat label="Contracts won" value={stats.won} />
        <Stat label="Total profit/loss" value={`${profitLoss.toFixed(2)} ${currency}`} highlight={profitLoss >= 0 ? 'up' : 'down'} />
      </div>

      <button className="reset-btn" onClick={resetStats}>
        <RotateCcw size={14} /> Reset
      </button>
    </aside>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${highlight === 'up' ? 'roi-up' : highlight === 'down' ? 'roi-down' : ''}`}>{value}</div>
    </div>
  );
}

// ---------------- Global styles ----------------

function GlobalStyle() {
  return (
    <style>{`
      :root {
        --bg: #0b0e11;
        --panel: #14181d;
        --panel-2: #181d24;
        --border: #23282f;
        --text: #f2f3f5;
        --text-muted: #8b93a1;
        --accent-red: #ff444f;
        --accent-teal: #00d0a0;
        --accent-indigo: #4c6ef5;
      }
      * { box-sizing: border-box; }
      .app { background: var(--bg); color: var(--text); min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

      .auth-error { background: #3a1a1a; color: #ff8080; padding: 10px 20px; font-size: 13px; }

      .topnav { border-bottom: 1px solid var(--border); background: var(--panel); position: sticky; top: 0; z-index: 10; }
      .topnav-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; }
      .brand { display: flex; align-items: center; gap: 8px; }
      .brand-mark { width: 30px; height: 30px; border-radius: 8px; background: var(--accent-red); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 15px; }
      .brand-name { font-weight: 700; font-size: 17px; letter-spacing: -0.02em; }
      .brand-badge { font-size: 10px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
      .topnav-actions { display: flex; align-items: center; gap: 10px; }

      .tabs { display: flex; gap: 4px; padding: 0 14px 10px; overflow-x: auto; }
      .tab { display: flex; align-items: center; gap: 6px; background: transparent; border: none; color: var(--text-muted); padding: 8px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
      .tab:hover { background: var(--panel-2); color: var(--text); }
      .tab-active { background: rgba(255,68,79,0.12); color: var(--accent-red); }

      .btn-primary { background: var(--accent-red); color: #fff; border: none; border-radius: 8px; padding: 8px 16px; font-weight: 600; font-size: 13px; cursor: pointer; }
      .btn-ghost { background: transparent; color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 16px; font-weight: 600; font-size: 13px; cursor: pointer; }
      .btn-outline { background: transparent; color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
      .btn-outline:hover { border-color: var(--accent-red); color: var(--accent-red); }
      .btn-small { padding: 5px 10px; font-size: 12px; }
      .btn-icon { background: var(--panel-2); border: 1px solid var(--border); color: var(--text-muted); border-radius: 8px; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer; }

      .body { display: flex; align-items: flex-start; }
      .main { flex: 1; min-width: 0; padding: 24px; }
      .section-title { font-size: 20px; margin: 0 0 4px; }
      .section-sub { color: var(--text-muted); font-size: 13px; margin: 0 0 16px; }

      .pill-row { display: flex; gap: 8px; margin-bottom: 18px; }
      .pill { padding: 8px 16px; border-radius: 999px; background: var(--panel-2); color: var(--text-muted); font-size: 13px; font-weight: 600; cursor: pointer; }
      .pill-active { background: rgba(255,68,79,0.12); color: var(--accent-red); }

      .promo-row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px; }
      .promo-card { flex: 0 0 300px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
      .promo-img { height: 160px; background-size: cover; background-position: center; position: relative; }
      .promo-tag { position: absolute; top: 12px; left: 12px; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; }
      .promo-body { padding: 16px; }
      .promo-body h3 { margin: 0 0 6px; font-size: 15px; }
      .promo-body p { margin: 0 0 12px; font-size: 13px; color: var(--text-muted); line-height: 1.5; }

      .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
      .card-label { font-size: 12px; color: var(--text-muted); margin-bottom: 8px; font-weight: 600; }
      .empty-card { display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
      .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 560px; }
      .balance-card .balance-value { font-size: 26px; font-weight: 700; }
      .select { width: 100%; padding: 10px; border-radius: 8px; background: var(--panel-2); color: var(--text); border: 1px solid var(--border); font-size: 13px; }

      .builder-canvas { display: flex; flex-direction: column; gap: 10px; max-width: 420px; }
      .builder-block { display: flex; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; font-size: 13px; }
      .builder-index { width: 22px; height: 22px; border-radius: 6px; background: var(--panel-2); display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted); }
      .builder-add { border: 1px dashed var(--border); background: transparent; color: var(--text-muted); border-radius: 10px; padding: 12px; font-size: 13px; cursor: pointer; }
      .builder-add:hover { color: var(--accent-red); border-color: var(--accent-red); }

      .chart-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .chart-delta { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; padding: 3px 8px; border-radius: 6px; }
      .chart-delta.up { color: var(--accent-teal); background: rgba(0,208,160,0.1); }
      .chart-delta.down { color: var(--accent-red); background: rgba(255,68,79,0.1); }
      .chart-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }

      .circle-row { display: flex; flex-direction: column; gap: 10px; max-width: 460px; }
      .circle-card { display: flex; align-items: center; gap: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; }
      .circle-img { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; }
      .circle-name { font-size: 14px; font-weight: 600; }
      .circle-members { font-size: 12px; color: var(--text-muted); }
      .circle-card button { margin-left: auto; }

      .bot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; max-width: 700px; }
      .bot-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
      .bot-img { width: 100%; height: 110px; object-fit: cover; border-radius: 8px; margin-bottom: 10px; }
      .bot-card h3 { margin: 0 0 6px; font-size: 14px; }
      .bot-card p { margin: 0 0 10px; font-size: 12px; color: var(--text-muted); line-height: 1.4; }

      .aihub-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; max-width: 700px; }
      .aihub-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
      .aihub-img { width: 100%; height: 140px; object-fit: cover; }
      .aihub-card h3 { margin: 14px 14px 6px; font-size: 14px; }
      .aihub-card p { margin: 0 14px 14px; font-size: 12px; color: var(--text-muted); line-height: 1.5; }

      .table-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; max-width: 560px; }
      .table-row { display: grid; grid-template-columns: 2fr 1fr 1fr 0.8fr; align-items: center; gap: 8px; padding: 12px 16px; font-size: 13px; border-bottom: 1px solid var(--border); }
      .table-row:last-child { border-bottom: none; }
      .table-head { color: var(--text-muted); font-size: 11px; text-transform: uppercase; font-weight: 700; }
      .trader-cell { display: flex; align-items: center; gap: 8px; }
      .trader-avatar { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; }
      .roi-up { color: var(--accent-teal); font-weight: 700; }
      .roi-down { color: var(--accent-red); font-weight: 700; }

      .manual-grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; max-width: 720px; }
      .manual-buttons { display: flex; gap: 10px; margin-top: 18px; }
      .btn-buy, .btn-sell { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; border: none; border-radius: 8px; padding: 12px; font-weight: 700; font-size: 13px; cursor: pointer; }
      .btn-buy { background: rgba(0,208,160,0.12); color: var(--accent-teal); }
      .btn-sell { background: rgba(255,68,79,0.12); color: var(--accent-red); }
      .manual-note { font-size: 11px; color: var(--text-muted); margin-top: 14px; line-height: 1.4; }
      .log-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); }

      .mt-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
      .mt-balance { margin-left: auto; font-size: 13px; color: var(--text-muted); }
      .mt-balance b { color: var(--text); font-size: 14px; }
      .mt-grid { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 16px; align-items: start; }
      .mt-form { display: flex; flex-direction: column; gap: 10px; }
      .mt-market-type { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
      .mt-market-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
      .mt-market-row span { color: var(--text-muted); }
      .mt-market-row b { font-size: 12px; }
      .mt-types { display: flex; gap: 6px; flex-wrap: wrap; }
      .mt-type-btn { background: var(--panel-2); border: 1px solid var(--border); color: var(--text-muted); border-radius: 8px; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
      .mt-type-active { background: rgba(255,68,79,0.12); border-color: var(--accent-red); color: var(--accent-red); }
      .mt-duration { display: flex; gap: 8px; }
      .mt-duration-input { flex: 0 0 96px; }
      .mt-units { display: flex; gap: 4px; flex-wrap: wrap; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 3px; }
      .mt-unit-btn { background: transparent; border: none; color: var(--text-muted); padding: 6px 9px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
      .mt-unit-active { background: var(--panel); color: var(--text); }
      .mt-quote { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
      .mt-quote-row { display: flex; justify-content: space-between; font-size: 12px; }
      .mt-quote-row span { color: var(--text-muted); }
      .mt-quote-row b { font-family: 'SFMono-Regular', Consolas, monospace; }
      .mt-error { display: flex; align-items: center; gap: 6px; background: rgba(255,68,79,0.1); color: #ff9aa0; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
      .mt-hint { font-size: 11px; color: var(--text-muted); margin: 0; line-height: 1.4; }
      .mt-buy { flex: none; width: 100%; margin-top: 4px; }
      .mt-sell { flex: none; width: 100%; }
      .mt-open { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border); background: var(--panel-2); border-radius: 10px; padding: 12px; }
      .mt-open-row { display: flex; justify-content: space-between; font-size: 12px; }
      .mt-open-row span { color: var(--text-muted); }
      .mt-open-row b { font-family: 'SFMono-Regular', Consolas, monospace; }
      .mt-result { display: flex; justify-content: space-between; align-items: center; border-radius: 10px; padding: 10px 12px; font-size: 13px; }
      .mt-result-won { background: rgba(0,208,160,0.12); color: var(--accent-teal); }
      .mt-result-lost { background: rgba(255,68,79,0.12); color: var(--accent-red); }

      .mt-chart-card { min-height: 420px; display: flex; flex-direction: column; gap: 10px; }
      .mt-chart-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .mt-type-badge { font-size: 12px; font-weight: 700; color: var(--text); background: var(--panel-2); border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; }
      .mt-timer { font-size: 13px; font-weight: 700; color: var(--accent-indigo); font-family: 'SFMono-Regular', Consolas, monospace; }
      .mt-chart-canvas { width: 100%; height: 320px; }
      .mt-empty-chart { min-height: 320px; }
      .mt-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .mt-strip-cell { background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
      .mt-strip-cell span { font-size: 11px; color: var(--text-muted); font-weight: 600; }
      .mt-strip-cell b { font-size: 14px; font-family: 'SFMono-Regular', Consolas, monospace; }

      .chart-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
      .chart-symbol-select { width: 320px; max-width: 100%; }
      .chart-canvas { position: relative; }

      .sidebar-ledger { width: 100%; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; max-height: 280px; }
      .ledger-row { display: grid; grid-template-columns: 60px minmax(0, 1fr) auto; gap: 8px; align-items: center; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
      .ledger-dir { font-weight: 700; color: var(--text-muted); text-transform: uppercase; font-size: 10px; }
      .ledger-sym { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .sidebar { width: 300px; flex-shrink: 0; background: var(--panel); border-left: 1px solid var(--border); min-height: calc(100vh - 97px); padding: 14px; display: flex; flex-direction: column; gap: 14px; }
      .sidebar-scrim { display: none; }
      .sidebar-topbar { display: flex; align-items: center; gap: 10px; }
      .run-btn { display: flex; align-items: center; gap: 6px; background: var(--accent-teal); color: #04211a; border: none; border-radius: 8px; padding: 8px 16px; font-weight: 700; font-size: 13px; cursor: pointer; }
      .run-btn-active { background: var(--accent-red); color: #fff; }
      .run-status { font-size: 12px; color: var(--text-muted); font-weight: 600; }

      .sidebar-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); }
      .sidebar-tab { background: transparent; border: none; color: var(--text-muted); padding: 8px 10px; font-size: 13px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; }
      .sidebar-tab-active { color: var(--text); border-bottom-color: var(--accent-red); }

      .sidebar-body { flex: 1; display: flex; align-items: center; justify-content: center; text-align: center; }
      .sidebar-empty p { color: var(--text-muted); font-size: 13px; line-height: 1.6; }

      .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .stat-label { font-size: 11px; color: var(--text-muted); margin-bottom: 2px; }
      .stat-value { font-size: 14px; font-weight: 700; }

      .reset-btn { display: flex; align-items: center; justify-content: center; gap: 6px; background: var(--panel-2); border: 1px solid var(--border); color: var(--text-muted); border-radius: 8px; padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
      .reset-btn:hover { color: var(--text); }

      .tabs { scrollbar-width: none; -webkit-overflow-scrolling: touch; }
      .tabs::-webkit-scrollbar { display: none; }

      @media (max-width: 1024px) {
        .main { padding: 20px; }
      }

      @media (max-width: 900px) {
        .body { flex-direction: column; }
        .sidebar {
          position: fixed; top: 0; right: 0; bottom: 0;
          width: min(320px, 88vw); min-height: 0; height: 100dvh;
          border-left: 1px solid var(--border); border-top: none;
          box-shadow: -12px 0 40px rgba(0,0,0,0.5); z-index: 110;
          overflow-y: auto; overscroll-behavior: contain;
        }
        .sidebar-scrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 105; }
        .manual-grid, .dash-grid { grid-template-columns: 1fr; }
        .mt-grid { grid-template-columns: 1fr; }
        .table-card { overflow-x: auto; }
        .table-row { grid-template-columns: minmax(160px, 2fr) 1fr 1fr 0.8fr; min-width: 480px; }
      }

      @media (max-width: 640px) {
        .topnav-row { padding: 10px 14px; }
        .brand-mark { width: 26px; height: 26px; font-size: 13px; }
        .brand-name { font-size: 15px; }
        .brand-badge { display: none; }
        .main { padding: 14px; }
        .section-title { font-size: 18px; }
        .tabs { padding: 0 10px 8px; }
        .tab { padding: 7px 10px; font-size: 12px; }
        .promo-card { flex-basis: 260px; }
        .promo-img { height: 130px; }
        .builder-canvas { max-width: 100%; }
        .bot-grid { grid-template-columns: 1fr; }
        .aihub-grid { grid-template-columns: 1fr; }
        .stats-grid { grid-template-columns: 1fr 1fr; }
      }

      @media (max-width: 420px) {
        .topnav-actions .btn-primary, .topnav-actions .btn-ghost { padding: 7px 11px; }
        .stats-grid { grid-template-columns: 1fr; }
        .log-row { grid-template-columns: 1fr; gap: 4px; }
        .mt-strip { grid-template-columns: 1fr; }
        .mt-chart-canvas { height: 260px; }
      }
    `}</style>
  );
}