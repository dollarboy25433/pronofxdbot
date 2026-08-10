import { useEffect, useRef, useState, useMemo } from 'react';
import {
  Play, LayoutGrid, Wrench, LineChart as ChartIcon, Users, Gift,
  Brain, Copy as CopyIcon, User, X, RotateCcw, TrendingUp, TrendingDown,
  GraduationCap, Calculator, BookOpen, Radio, Activity,
  RefreshCw, AlertTriangle, Moon, Sun, Monitor, Wallet,
} from 'lucide-react';
import { createChart, AreaSeries, CandlestickSeries, ColorType, CrosshairMode, LineStyle, createSeriesMarkers } from 'lightweight-charts';
import ClassesTab from './tabs/classes.jsx';
import BotBuilderTab from './tabs/botbuilder.jsx';
import RiskCalculatorTab from './tabs/risk.jsx';
import TutorialsTab from './tabs/tutorials.jsx';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const WS_BASE = API_BASE.replace(/^http/, 'ws');
const SESSION_KEY = 'deriv_session_id';

// Read a fetch failure's details from the server's { error, code, details }
// body so the UI shows WHY a request failed, not just the HTTP status.
async function readApiError(r) {
  try {
    const body = await r.json();
    if (body && body.error) {
      return `${body.error}${body.code ? ` (${body.code})` : ''}`;
    }
  } catch { /* not json */ }
  return `HTTP ${r.status}`;
}

const BRAND = 'PronoFX Dbot';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'builder', label: 'Bot Builder', icon: Wrench },
  { id: 'charts', label: 'Charts', icon: ChartIcon },
  { id: 'circles', label: 'PCircles', icon: Users },
  { id: 'freebots', label: 'Free Bots', icon: Gift },
  { id: 'aihub', label: 'AI Hub', icon: Brain },
  { id: 'copytrading', label: 'Copytrading', icon: CopyIcon },
  { id: 'manual', label: 'Manual Trader', icon: User },
  { id: 'classes', label: 'Classes', icon: GraduationCap },
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

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('summary');
  const [authModal, setAuthModal] = useState(false);
  const [cashierModal, setCashierModal] = useState(null); // { mode: 'deposit' | 'withdraw' }

  // --- Theme ('dark' | 'light' | 'system') ---
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  }, [theme]);

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
  const [pendingBotXml, setPendingBotXml] = useState(null);
  const intervalRef = useRef(null);
  const [balanceKey, setBalanceKey] = useState(0);

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
  }, [sessionId, selectedAccount, balanceKey]);

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

  // Open the run-bot panel. Logged-in users get the big modal; guests get the
  // log in / sign up modal instead (they can't run the bot unauthenticated).
  function openBotPanel() {
    if (!sessionId) { setAuthModal(true); return; }
    setSidebarOpen((v) => !v);
  }

  // The Run/Stop button inside the panel is also gated so a stale guest session
  // can never start monitoring.
  function handleRunBot() {
    if (!sessionId) { setAuthModal(true); return; }
    toggleBot();
  }

  // Open the Deriv cashier (deposit/withdraw). Guests are sent to the auth modal.
  function openCashier(mode) {
    if (!sessionId) { setAuthModal(true); return; }
    setCashierModal({ mode: mode === 'withdraw' ? 'withdraw' : 'deposit' });
  }

  function resetStats() {
    clearInterval(intervalRef.current);
    setBotRunning(false);
    setOpenContracts([]);
    setTrades([]);
  }

  function handleUseBot(xml) {
    setPendingBotXml(xml);
    setActiveTab('builder');
  }

  async function logActivity(type, detail) {
    if (!sessionId || !selectedAccount) return;
    try {
      await fetch(`${API_BASE}/api/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionId, account: selectedAccount, type, detail: detail || {} }),
      });
    } catch { /* activity logging is best-effort */ }
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
        onOpenBotPanel={openBotPanel}
        onOpenCashier={openCashier}
        theme={theme}
        setTheme={setTheme}
      />

      {authError && <div className="auth-error">{authError}</div>}

      <div className="body">
        <main className="main">
          {activeTab === 'dashboard' && (
            <DashboardTab
              loggedIn={!!sessionId}
              sessionId={sessionId}
              accounts={accounts}
              selectedAccount={selectedAccount}
              setSelectedAccount={setSelectedAccount}
              balance={balance}
              onLogin={handleLogin}
              onOpenCashier={openCashier}
            />
          )}
          {activeTab === 'builder' && (
            <BotBuilderTab
              sessionId={sessionId}
              accounts={accounts}
              selectedAccount={selectedAccount}
              setSelectedAccount={setSelectedAccount}
              currency={currency}
              balance={balance}
              onBalanceUpdate={setBalance}
              onTradeSettled={(trade) => setTrades((prev) => [...prev, trade])}
              onRequireAuth={() => setAuthModal(true)}
              initialXml={pendingBotXml}
              onActivity={(type, detail) => logActivity(type, detail)}
            />
          )}
          {activeTab === 'charts' && (
            <ChartsTab theme={theme} />
          )}
          {activeTab === 'circles' && (
            <CirclesTab
              sessionId={sessionId}
              selectedAccount={selectedAccount}
              onRequireAuth={() => setAuthModal(true)}
              onActivity={(type, detail) => logActivity(type, detail)}
            />
          )}
          {activeTab === 'freebots' && (
            <FreeBotsTab
              sessionId={sessionId}
              selectedAccount={selectedAccount}
              onRequireAuth={() => setAuthModal(true)}
              onUseBot={handleUseBot}
              onActivity={(type, detail) => logActivity(type, detail)}
            />
          )}
          {activeTab === 'aihub' && <AIHubTab onActivity={(type, detail) => logActivity(type, detail)} />}
          {activeTab === 'copytrading' && (
            <CopytradingTab
              sessionId={sessionId}
              selectedAccount={selectedAccount}
              accounts={accounts}
              currency={currency}
              onRequireAuth={() => setAuthModal(true)}
              onUseBot={handleUseBot}
              onActivity={(type, detail) => logActivity(type, detail)}
            />
          )}
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
              theme={theme}
            />
          )}
          {activeTab === 'classes' && <ClassesTab />}
          {activeTab === 'riskcalc' && <RiskCalculatorTab />}
          {activeTab === 'tutorials' && <TutorialsTab />}
        </main>

        {sidebarOpen && (
          <BotSidebar
            sidebarTab={sidebarTab}
            setSidebarTab={setSidebarTab}
            botRunning={botRunning}
            toggleBot={handleRunBot}
            resetStats={resetStats}
            stats={stats}
            profitLoss={profitLoss}
            currency={currency}
            openContracts={openContracts}
            trades={trades}
            onClose={() => setSidebarOpen(false)}
          />
        )}
        {authModal && (
          <AuthModal
            onClose={() => setAuthModal(false)}
            onLogin={() => handleLogin('login')}
            onRegister={() => handleLogin('register')}
          />
        )}
        {cashierModal && sessionId && (
          <CashierModal
            mode={cashierModal.mode}
            sessionId={sessionId}
            accounts={accounts}
            selectedAccount={selectedAccount}
            setSelectedAccount={setSelectedAccount}
            theme={theme}
            onClose={() => setCashierModal(null)}
            onBalanceRefresh={() => setBalanceKey((k) => k + 1)}
          />
        )}

        <button className="bot-fab" onClick={openBotPanel} title="Run bot">
          <Play size={22} fill="currentColor" />
        </button>
      </div>

      <Footer />
    </div>
  );
}

// ---------------- Footer ----------------

const SOCIAL_LINKS = [
  { name: 'Telegram', url: 'https://t.me/pronofxdbot', color: '#229ED9', path: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z' },
  { name: 'WhatsApp', url: 'https://wa.me/254700000000', color: '#25D366', path: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z' },
  { name: 'Facebook', url: 'https://facebook.com/pronofxdbot', color: '#1877F2', path: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
  { name: 'YouTube', url: 'https://youtube.com/@pronofxdbot', color: '#FF0000', path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
  { name: 'TikTok', url: 'https://tiktok.com/@pronofxdbot', color: '#69C9D0', path: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z' },
];

// Typing animation: reveals `text` one character at a time over `period` ms,
// then holds for `hold` ms, resets and loops endlessly. A substring can be
// emphasized as it types.
function TypingText({ text, bold, period = 5000, hold = 2000 }) {
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState('typing'); // 'typing' | 'holding'

  useEffect(() => {
    if (phase !== 'typing') return;
    const charMs = period / Math.max(text.length, 1);
    const t = setInterval(() => {
      setCount((c) => (c >= text.length ? c : c + 1));
    }, charMs);
    return () => clearInterval(t);
  }, [phase, text, period]);

  useEffect(() => {
    if (phase === 'typing' && count >= text.length) setPhase('holding');
  }, [count, phase, text.length]);

  useEffect(() => {
    if (phase !== 'holding') return;
    const t = setTimeout(() => {
      setCount(0);
      setPhase('typing');
    }, hold);
    return () => clearTimeout(t);
  }, [phase, hold]);

  let rendered;
  if (bold) {
    const shown = text.slice(0, count);
    const fullIdx = shown.indexOf(bold);
    if (fullIdx !== -1) {
      rendered = (
        <>
          {shown.slice(0, fullIdx)}
          <strong>{shown.slice(fullIdx)}</strong>
        </>
      );
    } else {
      let partialLen = 0;
      for (let i = 1; i <= bold.length; i++) {
        if (shown.endsWith(bold.slice(0, i))) partialLen = i;
      }
      if (partialLen > 0) {
        const start = shown.length - partialLen;
        rendered = (
          <>
            {shown.slice(0, start)}
            <strong>{shown.slice(start)}</strong>
          </>
        );
      } else {
        rendered = shown;
      }
    }
  } else {
    rendered = text.slice(0, count);
  }

  return (
    <span className="typing-text" aria-label={text}>
      {rendered}
      <span className="typing-caret" aria-hidden="true" />
    </span>
  );
}

function Footer() {
  const [modal, setModal] = useState(null); // 'about' | 'disclaimer'
  return (
    <>
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="brand-mark footer-mark">P</div>
            <div>
              <div className="footer-brand-name">{BRAND}</div>
              <div className="footer-tagline">Automated trading, community-driven.</div>
            </div>
          </div>

          <div className="footer-links">
            <span className="footer-links-label">Company</span>
            <button className="footer-link" onClick={() => setModal('about')}>About</button>
            <button className="footer-link" onClick={() => setModal('disclaimer')}>Disclaimer</button>
          </div>

          <div className="footer-socials">
            <span className="footer-links-label">Follow us</span>
            <div className="footer-socials-row">
              {SOCIAL_LINKS.map((s) => (
                <a
                  key={s.name}
                  className="footer-social"
                  style={{ '--brand': s.color }}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.name}
                  aria-label={s.name}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d={s.path} />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <TypingText text="Powered by McOKOTH TECHNOLOGIES" bold="McOKOTH TECHNOLOGIES" period={5000} hold={2000} />
          <span className="footer-copy">© 2026 ALL RIGHTS RESERVED</span>
        </div>
      </footer>

      {modal && (
        <div className="footer-modal-overlay" onClick={() => setModal(null)}>
          <div className="footer-modal" onClick={(e) => e.stopPropagation()}>
            <button className="footer-modal-close" onClick={() => setModal(null)} aria-label="Close">
              <X size={16} />
            </button>
            <h3 className="footer-modal-title">{modal === 'about' ? 'About PronoFX Dbot' : 'Disclaimer'}</h3>
            {modal === 'about' ? (
              <div className="footer-modal-body">
                <p>PronoFX Dbot is an automated trading workspace for Deriv synthetic indices, forex and crypto. Build strategies with visual blocks, share them with the community, follow copy-traders and use AI-powered insights to inform your decisions.</p>
                <p>Built and maintained by McOKOTH TECHNOLOGIES. Trading carries risk — never trade more than you can afford to lose.</p>
              </div>
            ) : (
              <div className="footer-modal-body">
                <p>Forex, CFD and binary-options trading involves substantial risk of loss and is not suitable for every investor. Past performance is not indicative of future results. PronoFX Dbot provides tools and education only; nothing on this platform is financial advice or a solicitation to trade.</p>
                <p>Bot strategies, AI outputs and community content are informational. You are solely responsible for your own trading decisions and account.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------- Top nav ----------------

const THEME_OPTIONS = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'system', label: 'System', icon: Monitor },
];

function TopNav({ activeTab, setActiveTab, loggedIn, onLogin, onLogout, onOpenBotPanel, onOpenCashier, theme, setTheme }) {
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (themeRef.current && !themeRef.current.contains(e.target)) setThemeOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const currentTheme = THEME_OPTIONS.find((o) => o.id === theme) || THEME_OPTIONS[0];
  const ThemeIcon = currentTheme.icon;

  return (
    <header className="topnav">
      <div className="topnav-row">
        <div className="brand">
          <div className="brand-mark">P</div>
          <span className="brand-name">{BRAND}</span>
          <span className="brand-badge">v1</span>
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
          <div className="theme-wrap" ref={themeRef}>
            <button
              className="btn-icon"
              title="Theme"
              aria-label="Theme"
              onClick={() => setThemeOpen((v) => !v)}
            >
              <ThemeIcon size={16} />
            </button>
            {themeOpen && (
              <div className="theme-menu" role="menu">
                {THEME_OPTIONS.map((o) => {
                  const Icon = o.icon;
                  return (
                    <button
                      key={o.id}
                      role="menuitem"
                      className={`theme-opt ${theme === o.id ? 'theme-opt-active' : ''}`}
                      onClick={() => { setTheme(o.id); setThemeOpen(false); }}
                    >
                      <Icon size={15} /> {o.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            className="btn-icon"
            title="Wallet — deposit & withdraw"
            onClick={() => onOpenCashier && onOpenCashier('deposit')}
          >
            <Wallet size={16} />
          </button>
          <button
            className="btn-icon"
            title="Run bot"
            onClick={onOpenBotPanel}
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
              <span className="tab-label">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}

// ---------------- Campaigns ----------------

function CampaignsTab() {
  const [view, setView] = useState('promotions');
  const [sent, setSent] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSent(true);
  };

  return (
    <div className="section">
      <div className="section-head">
        <div className="pill-row">
          <button
            className={`pill ${view === 'promotions' ? 'pill-active' : ''}`}
            onClick={() => { setView('promotions'); setSent(false); }}
          >
            Promotions
          </button>
          <button
            className={`pill ${view === 'booking' ? 'pill-active' : ''}`}
            onClick={() => { setView('booking'); setSent(false); }}
          >
            Book a Live Session
          </button>
        </div>
      </div>

      {view === 'promotions' && (
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
      )}

      {view === 'booking' && (
        <div className="booking-card">
          <h3 className="booking-title">Book a Live Session</h3>
          <p className="booking-sub">Reserve a one-on-one session with a strategy coach. We'll confirm your slot by email.</p>

          {sent ? (
            <div className="booking-done">
              <div className="booking-done-mark">✓</div>
              <p><strong>Request received!</strong></p>
              <p>Your session request has been sent. Check your email for confirmation within 24 hours.</p>
              <button className="btn-ghost" onClick={() => setSent(false)}>Book another session</button>
            </div>
          ) : (
            <form className="booking-form" onSubmit={handleSubmit}>
              <label className="booking-field">
                <span>Full name</span>
                <input className="booking-input" type="text" placeholder="e.g. Jane Mwangi" required />
              </label>
              <label className="booking-field">
                <span>Email address</span>
                <input className="booking-input" type="email" placeholder="you@example.com" required />
              </label>
              <label className="booking-field">
                <span>Deriv account (optional)</span>
                <input className="booking-input" type="text" placeholder="e.g. CR12345678" />
              </label>
              <div className="booking-row">
                <label className="booking-field">
                  <span>Preferred date</span>
                  <input className="booking-input" type="date" required />
                </label>
                <label className="booking-field">
                  <span>Preferred time</span>
                  <input className="booking-input" type="time" required />
                </label>
              </div>
              <label className="booking-field">
                <span>Session type</span>
                <select className="select">
                  <option>Strategy review</option>
                  <option>Bot building help</option>
                  <option>Risk management basics</option>
                  <option>Getting started walkthrough</option>
                </select>
              </label>
              <button className="btn-primary booking-submit" type="submit">Request session</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Dashboard ----------------

const ACTIVITY_LABELS = {
  login: 'Logged in',
  deposit: 'Opened the Deriv cashier (deposit)',
  withdraw: 'Opened the Deriv cashier (withdraw)',
  bot_run: 'Ran a bot',
  bot_share: 'Shared a bot',
  bot_upload_free: 'Uploaded a free bot',
  bot_use: 'Used a community bot',
  circle_create: 'Created a PCircle',
  circle_join: 'Joined a PCircle',
  circle_leave: 'Left a PCircle',
  copy_strategy_create: 'Published a copy-trading strategy',
  copy_follow: 'Started following a strategy',
  copy_unfollow: 'Stopped following a strategy',
};

function DashboardTab({ loggedIn, sessionId, accounts, selectedAccount, setSelectedAccount, balance, onLogin, onOpenCashier }) {
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    if (!loggedIn || !selectedAccount) { setActivity([]); return; }
    let cancelled = false;
    fetch(`${API_BASE}/api/activity?session=${encodeURIComponent(sessionId)}&account=${encodeURIComponent(selectedAccount)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('activity failed'))))
      .then((data) => { if (!cancelled) setActivity(data.activities || []); })
      .catch(() => { if (!cancelled) setActivity([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, selectedAccount]);

  return (
    <div className="section">
      <h2 className="section-title">Dashboard</h2>

      {!loggedIn ? (
        <div className="card empty-card">
          <p>Log in with your Deriv account to see your balance and account activity here.</p>
          <button className="btn-primary" onClick={() => onLogin('login')}>Login with Deriv</button>
        </div>
      ) : (
        <>
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
              <div className="balance-actions">
                <button className="btn-outline btn-small" onClick={() => onOpenCashier && onOpenCashier('deposit')}>
                  Deposit
                </button>
                <button className="btn-outline btn-small" onClick={() => onOpenCashier && onOpenCashier('withdraw')}>
                  Withdraw
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-label">Recent activity</div>
            {activity.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '10px 0 0' }}>
                No activity yet — run a bot, share one, join a PCircle or publish a copy strategy and it will show up here.
              </p>
            ) : (
              <div className="activity-list">
                {activity.map((a, i) => (
                  <div className="activity-row" key={i}>
                    <span className={`activity-dot activity-dot-${a.type}`} />
                    <span className="activity-msg">{ACTIVITY_LABELS[a.type] || a.type}</span>
                    <span className="activity-time">{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 28 }}>
        <CampaignsTab />
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

function ChartsTab({ theme }) {
  const [symbols, setSymbols] = useState([]);
  const [symbol, setSymbol] = useState(null);
  const [granularity, setGranularity] = useState(60);
  const [chartType, setChartType] = useState('area');
  const [points, setPoints] = useState([]);
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [refreshKey, setRefreshKey] = useState(0);

  const wsRef = useRef(null);

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
    setCandles([]);
    fetch(`${API_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&granularity=${granularity}&count=400`)
      .then(async (r) => { if (!r.ok) throw new Error(await readApiError(r)); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        const history = data.candles || [];
        setCandles(history);
        setPoints(history.map((c) => ({ t: Math.floor(c.t / 1000), price: c.c })));
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
      const url = `${WS_BASE}/ws?symbol=${encodeURIComponent(symbol)}`;
      try {
        ws = new WebSocket(url);
      } catch {
        setWsStatus('offline');
        retryTimer = setTimeout(connect, 3000);
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setWsStatus('live');
      };
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
          setCandles((prev) => {
            if (!prev.length) return prev;
            const bucket = Math.floor(epoch / granularity) * granularity * 1000;
            const last = prev[prev.length - 1];
            if (bucket < last.t) return prev;
            if (bucket === last.t) {
              const updated = { ...last, h: Math.max(last.h, quote), l: Math.min(last.l, quote), c: quote };
              return [...prev.slice(0, -1), updated];
            }
            const next = [...prev, { t: bucket, o: quote, h: quote, l: quote, c: quote }];
            return next.length > 400 ? next.slice(-400) : next;
          });
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
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      try { if (ws) ws.close(); } catch { /* noop */ }
      wsRef.current = null;
    };
  }, [symbol, granularity]);

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
        <div className="tv-gran chart-type-toggle" role="group" aria-label="Chart type">
          <button
            className={`tv-gran-btn ${chartType === 'area' ? 'tv-gran-active' : ''}`}
            onClick={() => setChartType('area')}
          >
            Area
          </button>
          <button
            className={`tv-gran-btn ${chartType === 'candlestick' ? 'tv-gran-active' : ''}`}
            onClick={() => setChartType('candlestick')}
          >
            Candlestick
          </button>
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
            candles={candles}
            chartType={chartType}
            decimals={decimals}
            theme={theme}
          />
        </div>
      </div>
    </div>
  );
}

// Banner image upload helper for community cards (circles, bots, strategies).
// The image is uploaded to the server (Cloudinary) and the resulting URL is
// stored, so create/update payloads stay small instead of shipping base64.
function BannerPicker({ banner, onChange, session, account }) {
  const ref = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  function uploadBanner(data) {
    setUploading(true);
    setUploadError(null);
    if (!session || !account) {
      onChange(data);
      setUploading(false);
      return;
    }
    fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, account, data }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (d.url) onChange(d.url);
        else setUploadError(d.error || 'Upload failed.');
      })
      .catch((e) => setUploadError(e.message))
      .finally(() => setUploading(false));
  }

  function pick(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 800 * 1024) { e.target.value = ''; setUploadError('Image must be under 800 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => uploadBanner(String(reader.result || ''));
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div className="banner-picker">
      {banner ? <img src={banner} alt="" className="banner-preview" /> : <div className="banner-preview banner-preview-empty">No banner</div>}
      <div className="banner-actions">
        <button type="button" className="btn-outline btn-small" onClick={() => ref.current && ref.current.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : (banner ? 'Change banner' : '+ Upload banner')}
        </button>
        {banner && <button type="button" className="btn-outline btn-small" onClick={() => onChange('')}>Remove</button>}
      </div>
      <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} />
      {uploadError && <div className="mt-error">{uploadError}</div>}
    </div>
  );
}

// ---------------- Circles (copy-community) ----------------

function CirclesTab({ sessionId, selectedAccount, onRequireAuth, onActivity }) {
  const [circles, setCircles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [banner, setBanner] = useState('');
  const [membersByCircle, setMembersByCircle] = useState({});
  const [expanded, setExpanded] = useState(new Set());
  const [membersBusy, setMembersBusy] = useState(false);

  function toggleMembers(circle) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(circle.id)) next.delete(circle.id);
      else {
        next.add(circle.id);
        if (!membersByCircle[circle.id]) {
          setMembersBusy(true);
          fetch(`${API_BASE}/api/circles/${circle.id}/members`)
            .then((r) => (r.ok ? r.json() : Promise.reject()))
            .then((data) => setMembersByCircle((m) => ({ ...m, [circle.id]: data.members || [] })))
            .catch(() => setMembersByCircle((m) => ({ ...m, [circle.id]: [] })))
            .finally(() => setMembersBusy(false));
        }
      }
      return next;
    });
  }

  const load = (showBusy = false) => {
    if (showBusy) setBusy(true);
    const params = sessionId && selectedAccount
      ? `?session=${encodeURIComponent(sessionId)}&account=${encodeURIComponent(selectedAccount)}`
      : '';
    fetch(`${API_BASE}/api/circles${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.circles) setCircles(data.circles);
        else setError(data.error || 'Could not load circles.');
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId, selectedAccount]);

  function requireAuth() { onRequireAuth && onRequireAuth(); }

  function handleJoin(circle, join) {
    if (!sessionId || !selectedAccount) return requireAuth();
    fetch(`${API_BASE}/api/circles/${circle.id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, account: selectedAccount, joined: join }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setCircles((prev) => prev.map((c) => (c.id === circle.id
            ? { ...c, joined: join, members: Math.max(0, c.members + (join ? 1 : -1)) }
            : c)));
          if (onActivity) onActivity(join ? 'circle_join' : 'circle_leave', { circle_id: circle.id });
        } else setError(data.error);
      })
      .catch((e) => setError(e.message));
  }

  function handleCreate(e) {
    e.preventDefault();
    if (!sessionId || !selectedAccount) return requireAuth();
    if (!name.trim()) return;
    fetch(`${API_BASE}/api/circles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, account: selectedAccount, name: name.trim(), description, banner }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.circle) {
          setCircles((prev) => [{ ...data.circle, members: 1, joined: true }, ...prev]);
          setName(''); setDescription(''); setBanner(''); setShowForm(false);
          if (onActivity) onActivity('circle_create', { circle_id: data.circle.id, name: data.circle.name });
        } else setError(data.error);
      })
      .catch((e) => setError(e.message));
  }

  return (
    <div className="section">
      <h2 className="section-title">PCircles</h2>
      <p className="section-sub">Join a community circle, share strategies and find copy-trading partners.</p>

      <div className="community-actions">
        <button className="btn-outline btn-small" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Create a circle'}
        </button>
      </div>

      {showForm && (
        <form className="booking-card community-form" onSubmit={handleCreate}>
          <div className="booking-field">
            <span>Circle name</span>
            <input className="booking-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Volatility Scalpers" required />
          </div>
          <div className="booking-field">
            <span>Description (optional)</span>
            <input className="booking-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this circle about?" />
          </div>
          <div className="booking-field">
            <span>Banner image</span>
            <BannerPicker banner={banner} onChange={setBanner} session={sessionId} account={selectedAccount} />
          </div>
          <button className="btn-primary booking-submit" type="submit">Create circle</button>
        </form>
      )}

      {error && <div className="mt-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="circle-row">
        {busy && circles.length === 0 && <p className="mt-hint">Loading circles…</p>}
        {!busy && circles.length === 0 && !error && (
          <p className="mt-hint">No circles yet — be the first to create one.</p>
        )}
        {circles.map((c) => {
          const isOpen = expanded.has(c.id);
          const members = membersByCircle[c.id];
          return (
            <div className="circle-card" key={c.id}>
              <div className="circle-avatar">{c.name.slice(0, 1).toUpperCase()}</div>
              <div className="circle-main">
                <div className="circle-name">{c.name} {c.joined && <span className="circle-owned">member</span>}</div>
                <div className="circle-members">{c.members} member{c.members === 1 ? '' : 's'}</div>
                {c.description && <div className="circle-desc">{c.description}</div>}
                {c.banner && <img src={c.banner} alt="" className="card-banner" />}
                {isOpen && (
                  <div className="circle-members-panel">
                    <div className="circle-members-title">Members {membersBusy ? '…' : ''}</div>
                    {members === undefined && <div className="mt-hint">Loading members…</div>}
                    {members && members.length === 0 && <div className="mt-hint">No members yet.</div>}
                    {members && members.map((m) => (
                      <div className="circle-member" key={m.loginid}>
                        <span className="member-avatar">{m.loginid.slice(0, 2).toUpperCase()}</span>
                        <span className="member-login">{m.loginid}</span>
                        <span className={m.role === 'owner' ? 'circle-owned' : 'member-role'}>{m.role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="circle-actions">
                <button className="btn-outline btn-small" onClick={() => toggleMembers(c)}>
                  {isOpen ? 'Hide members' : 'Members'}
                </button>
                <button className="btn-outline" onClick={() => handleJoin(c, !c.joined)}>
                  {c.joined ? 'Leave' : 'Join'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- Free bots ----------------

function FreeBotsTab({ sessionId, selectedAccount, onRequireAuth, onUseBot, onActivity }) {
  const [bots, setBots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [banner, setBanner] = useState('');
  const [xml, setXml] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const load = (showBusy = false) => {
    if (showBusy) setBusy(true);
    const params = sessionId && selectedAccount
      ? `?session=${encodeURIComponent(sessionId)}&account=${encodeURIComponent(selectedAccount)}&kind=free`
      : '?kind=free';
    fetch(`${API_BASE}/api/bots${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.bots) setBots(data.bots);
        else setError(data.error || 'Could not load free bots.');
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId, selectedAccount]);

  function requireAuth() { onRequireAuth && onRequireAuth(); }

  function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setXml(String(reader.result || ''));
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleUpload(e) {
    e.preventDefault();
    if (!sessionId || !selectedAccount) return requireAuth();
    if (!name.trim() || !xml.trim()) return;
    setUploading(true);
    setError(null);
    fetch(`${API_BASE}/api/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, account: selectedAccount, name: name.trim(), description, banner, xml, kind: 'free' }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Upload failed');
        setBots((prev) => [{ ...data.bot, uses: 0, description, banner, owned: true }, ...prev]);
        setName(''); setDescription(''); setBanner(''); setXml(''); setShowForm(false);
        if (onActivity) onActivity('bot_upload_free', { bot_id: data.bot.id, name: data.bot.name });
      })
      .catch((e) => setError(e.message))
      .finally(() => setUploading(false));
  }

  function handleUse(bot) {
    if (onUseBot) {
      fetch(`${API_BASE}/api/bots/${bot.id}/xml`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load bot'))))
        .then((data) => {
          if (sessionId && selectedAccount) {
            fetch(`${API_BASE}/api/bots/${bot.id}/use`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session: sessionId, account: selectedAccount }),
            }).catch(() => { /* non-fatal */ });
            if (onActivity) onActivity('bot_use', { bot_id: bot.id });
          }
          onUseBot(data.xml);
        })
        .catch((e) => setError(e.message));
    }
  }

  function handleDelete(bot) {
    if (!sessionId || !selectedAccount || !bot.owned) return;
    fetch(`${API_BASE}/api/bots/${bot.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, account: selectedAccount }),
    })
      .then((r) => r.json())
      .then((data) => { if (data.ok) setBots((prev) => prev.filter((b) => b.id !== bot.id)); })
      .catch((e) => setError(e.message));
  }

  return (
    <div className="section">
      <h2 className="section-title">Free Bots</h2>
      <p className="section-sub">Ready-made strategies uploaded by the community. Click "Run" to open one in the Bot Builder and run it live.</p>

      <div className="community-actions">
        <button className="btn-outline btn-small" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Upload your bot'}
        </button>
      </div>

      {showForm && (
        <form className="booking-card community-form" onSubmit={handleUpload}>
          <div className="booking-field">
            <span>Bot name</span>
            <input className="booking-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Volatility Rebound" required />
          </div>
          <div className="booking-field">
            <span>Description (optional)</span>
            <input className="booking-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does it do?" />
          </div>
          <div className="booking-field">
            <span>Banner image</span>
            <BannerPicker banner={banner} onChange={setBanner} session={sessionId} account={selectedAccount} />
          </div>
          <div className="booking-field">
            <span>Strategy content (export it from the Bot Builder with "Export", or paste a Deriv DBot .xml file)</span>
            <textarea className="booking-input bb-xml-input" rows={4} value={xml} onChange={(e) => setXml(e.target.value)} placeholder='{"app":"pronofxdbot","blocks":[…] }' />
            <button type="button" className="btn-outline btn-small" style={{ alignSelf: 'flex-start' }} onClick={() => fileRef.current && fileRef.current.click()}>
              Choose .xml file…
            </button>
            <input ref={fileRef} type="file" accept=".xml,.json" style={{ display: 'none' }} onChange={handleFile} />
          </div>
          {error && <div className="mt-error">{error}</div>}
          <button className="btn-primary booking-submit" type="submit" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload bot'}
          </button>
        </form>
      )}

      <div className="bot-grid">
        {busy && bots.length === 0 && <p className="mt-hint">Loading bots…</p>}
        {!busy && bots.length === 0 && !error && (
          <p className="mt-hint">No free bots yet — upload the first one from your Bot Builder!</p>
        )}
        {bots.map((b) => (
          <div className="bot-card" key={b.id}>
            {b.banner ? <img src={b.banner} alt="" className="card-banner" /> : <div className="bot-avatar">{b.name.slice(0, 1).toUpperCase()}</div>}
            <h3>{b.name} {b.owned && <span className="circle-owned">yours</span>}</h3>
            <p>{b.description || 'A community-uploaded strategy.'}</p>
            <div className="bot-meta">{b.uses} use{b.uses === 1 ? '' : 's'}</div>
            <div className="bot-actions">
              <button className="btn-primary btn-small" onClick={() => handleUse(b)}>Run</button>
              {b.owned && <button className="btn-outline btn-small" onClick={() => handleDelete(b)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- AI Hub ----------------

function AIHubTab({ onActivity }) {
  const [status, setStatus] = useState({ configured: false, model: '' });
  const [mode, setMode] = useState('chat'); // chat | sentiment | anomaly
  const [chat, setChat] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [symbols, setSymbols] = useState([]);
  const [symbol, setSymbol] = useState('R_75');
  const [timeframe, setTimeframe] = useState('60');
  const [count, setCount] = useState(120);
  const [verdict, setVerdict] = useState(null);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [liveTicks, setLiveTicks] = useState([]);
  const [liveStatus, setLiveStatus] = useState('offline');

  useEffect(() => {
    fetch(`${API_BASE}/api/ai/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setStatus(s || { configured: false, model: '' }))
      .catch(() => {});
    fetch(`${API_BASE}/api/symbols`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSymbols(d.symbols || []))
      .catch(() => {});
  }, []);

  // Live tick feed for the selected symbol — analysis prompts overlay REST
  // candle history with the freshest live ticks so decisions use real data.
  useEffect(() => {
    let ws = null;
    let closed = false;
    let retryTimer = null;
    let retry = 0;
    setLiveTicks([]);
    setLiveStatus('connecting');

    const connect = () => {
      if (closed) return;
      setLiveStatus('connecting');
      let socket;
      try {
        socket = new WebSocket(`${WS_BASE}/ws?symbol=${encodeURIComponent(symbol)}`);
      } catch {
        setLiveStatus('offline');
        retryTimer = setTimeout(connect, 3000);
        return;
      }
      ws = socket;
      socket.onopen = () => { retry = 0; setLiveStatus('live'); };
      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.msg_type !== 'tick' || !msg.tick) return;
          const { epoch, quote } = msg.tick;
          setLiveTicks((prev) => {
            if (prev.length && prev[prev.length - 1].t >= epoch) return prev;
            const next = [...prev, { t: epoch, price: quote }];
            return next.length > 600 ? next.slice(next.length - 600) : next;
          });
        } catch { /* ignore malformed frames */ }
      };
      socket.onclose = () => {
        if (closed) return;
        setLiveStatus('offline');
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry, 15000));
        retry += 1;
      };
      socket.onerror = () => { try { socket.close(); } catch { /* noop */ } };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      try { if (ws) ws.close(); } catch { /* noop */ }
    };
  }, [symbol]);

  function callAI(prompt, context, temperature) {
    return fetch(`${API_BASE}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, context, temperature }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'AI request failed');
        return d.text;
      });
  }

  function sendChat(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setChat((c) => [...c, { role: 'user', text }]);
    setBusy(true);
    setError(null);
    callAI(text)
      .then((reply) => {
        setChat((c) => [...c, { role: 'assistant', text: reply }]);
        if (onActivity) onActivity('ai_chat', {});
      })
      .catch((e2) => setError(e2.message))
      .finally(() => setBusy(false));
  }

  async function analyze(kind) {
    if (verdictBusy) return;
    setVerdictBusy(true);
    setError(null);
    setVerdict(null);
    try {
      const cd = await fetch(`${API_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&granularity=${timeframe}&count=${count}`)
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await readApiError(r)))));
      const history = cd.candles || [];

      // Overlay the live tick feed (aggregated to the chosen timeframe) on
      // top of the history so the freshest price action is included.
      const liveCandles = aggregateCandles(liveTicks, Number(timeframe));
      const lastHist = history.length ? history[history.length - 1].t : 0;
      const liveNew = liveCandles.filter((c) => c.t > lastHist);
      const candles = [...history, ...liveNew];

      if (candles.length < 20) throw new Error('Not enough candle data for this symbol.');
      const last = candles[candles.length - 1].c;
      const lows = candles.map((c) => c.l);
      const highs = candles.map((c) => c.h);
      const low = Math.min(...lows);
      const high = Math.max(...highs);
      const range = (((high - low) / (low || 1)) * 100).toFixed(2);
      const recent = candles.slice(-40).map((c) => `${new Date(c.t).toLocaleString()}  O${c.o} H${c.h} L${c.l} C${c.c}`).join('\n');
      const liveNote = liveNew.length
        ? ` and the last ${liveNew.length} candle(s) come from the live tick feed`
        : (liveStatus === 'live' ? ' (live feed connected, no new candle yet)' : ' (live feed offline — history only)');
      const prompt = kind === 'sentiment'
        ? `Symbol ${symbol}, last ${candles.length} candles (granularity ${timeframe}s)${liveNote}. Last close ~${last}, 40-candle range ${range}%.\nCandles:\n${recent}\n\nGive a short sentiment read: bullish / bearish / neutral with 2-3 reasons and a suggested bias for a short binary option contract.`
        : `Symbol ${symbol}, last ${candles.length} candles (granularity ${timeframe}s)${liveNote}. Last close ~${last}, 40-candle range ${range}%.\nCandles:\n${recent}\n\nFlag any anomalies: unusual volatility spikes, sudden gaps, or regime changes. List each one on its own line with a severity (low / med / high). If none stand out, say so clearly.`;
      const context = kind === 'sentiment'
        ? 'You are a market analyst for Deriv synthetic indices. Be objective, note uncertainty, never promise profits.'
        : 'You are a volatility analyst for binary options trading on Deriv synthetic indices. Be precise and data-driven.';
      const text = await callAI(prompt, context, kind === 'sentiment' ? 0.5 : 0.4);
      setVerdict({ kind, text });
      if (onActivity) onActivity(kind === 'sentiment' ? 'ai_sentiment' : 'ai_anomaly', { symbol });
    } catch (e2) {
      setError(e2.message);
    } finally {
      setVerdictBusy(false);
    }
  }

  const modeBtn = (id, label) => (
    <button className={`btn-outline btn-small ${mode === id ? 'btn-active' : ''}`} onClick={() => setMode(id)}>{label}</button>
  );

  return (
    <div className="section">
      <h2 className="section-title">AI Hub</h2>
      <p className="section-sub">Gemini-powered assistant, sentiment scoring and anomaly alerts for your watched symbols.</p>

      {!status.configured && (
        <div className="mt-error">AI is not enabled yet — add <code>GEMINI_API_KEY</code> to your server environment (.env) and restart.</div>
      )}

      <div className="community-actions">
        {modeBtn('chat', 'Assistant')}
        {modeBtn('sentiment', 'Sentiment scoring')}
        {modeBtn('anomaly', 'Anomaly alerts')}
      </div>

      {mode === 'chat' && (
        <div className="booking-card community-form">
          <div className="aihub-chat">
            {chat.length === 0 && <div className="mt-hint">Ask anything — strategy logic, market behaviour, risk sizing, or how to build a bot block.</div>}
            {chat.map((m, i) => (
              <div key={i} className={`aihub-msg aihub-${m.role}`}>
                <div className="aihub-msg-label">{m.role === 'user' ? 'You' : status.model}</div>
                <div className="aihub-msg-text">{m.text}</div>
              </div>
            ))}
            {busy && <div className="mt-hint">Thinking…</div>}
          </div>
          <form className="booking-row" style={{ gap: 8 }} onSubmit={sendChat}>
            <input className="booking-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the AI assistant…" disabled={busy} />
            <button className="btn-primary booking-submit" type="submit" disabled={busy || !input.trim()}>Send</button>
          </form>
        </div>
      )}

      {(mode === 'sentiment' || mode === 'anomaly') && (
        <div className="booking-card community-form">
          <div className="booking-row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <span className="mt-hint">Analysis overlays REST candle history with the live tick feed for {symbol}.</span>
            <span className={`tv-status ${liveStatus === 'live' ? 'tv-live' : liveStatus === 'connecting' ? 'tv-connecting' : 'tv-offline'}`}>
              <Radio size={13} /> {liveStatus === 'live' ? 'Live' : liveStatus === 'connecting' ? 'Connecting' : 'Offline'}
            </span>
          </div>
          <div className="booking-row">
            <div className="booking-field">
              <span>Symbol</span>
              <select className="select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {symbols.length === 0 && <option value="R_75">R_75</option>}
                {symbols.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
              </select>
            </div>
            <div className="booking-field">
              <span>Candle size</span>
              <select className="select" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
                <option value="60">1 min</option>
                <option value="300">5 min</option>
                <option value="900">15 min</option>
                <option value="3600">1 hour</option>
              </select>
            </div>
            <div className="booking-field">
              <span>Candles</span>
              <input className="booking-input" type="number" min="20" max="500" value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>
          </div>
          <button className="btn-primary booking-submit" type="button" disabled={verdictBusy} onClick={() => analyze(mode)}>
            {verdictBusy ? 'Analyzing…' : mode === 'sentiment' ? 'Score sentiment' : 'Scan for anomalies'}
          </button>
          {error && <div className="mt-error">{error}</div>}
          {verdict && (
            <div className="aihub-msg aihub-assistant">
              <div className="aihub-msg-label">{status.model}</div>
              <div className="aihub-msg-text">{verdict.text}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- Copytrading ----------------

const COPY_TYPE_LABELS = { RISE: 'Rise', FALL: 'Fall', CALL: 'Call', PUT: 'Put', ASIAU: 'Asia Up', ASIAD: 'Asia Down' };
const COPY_UNIT_LABELS = { t: 'ticks', s: 'sec', m: 'min', h: 'hrs', d: 'days' };

function CopytradingTab({ sessionId, selectedAccount, accounts, currency, onRequireAuth, onUseBot, onActivity }) {
  const [strategies, setStrategies] = useState([]);
  const [follows, setFollows] = useState(new Set());
  const [symbols, setSymbols] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [banner, setBanner] = useState('');
  const [symbol, setSymbol] = useState('R_75');
  const [contractType, setContractType] = useState('RISE');
  const [stake, setStake] = useState(1);
  const [duration, setDuration] = useState(5);
  const [durationUnit, setDurationUnit] = useState('t');
  const [tradeAgain, setTradeAgain] = useState('both');
  const [uploading, setUploading] = useState(false);

  const loadStrategies = (showBusy = false) => {
    if (showBusy) setBusy(true);
    const params = sessionId && selectedAccount
      ? `?session=${encodeURIComponent(sessionId)}&account=${encodeURIComponent(selectedAccount)}`
      : '';
    fetch(`${API_BASE}/api/copy/strategies${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.strategies) setStrategies(data.strategies);
        else setError(data.error || 'Could not load strategies.');
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const loadFollows = () => {
    if (!sessionId || !selectedAccount) { setFollows(new Set()); return; }
    fetch(`${API_BASE}/api/copy/follows?session=${encodeURIComponent(sessionId)}&account=${encodeURIComponent(selectedAccount)}`)
      .then((r) => (r.ok ? r.json() : { follows: [] }))
      .then((data) => setFollows(new Set(data.follows || [])))
      .catch(() => setFollows(new Set()));
  };

  useEffect(() => { loadStrategies(true); loadFollows(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sessionId, selectedAccount]);
  useEffect(() => {
    fetch(`${API_BASE}/api/symbols`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setSymbols(data.symbols || []))
      .catch(() => setSymbols([]));
  }, []);

  function requireAuth() { onRequireAuth && onRequireAuth(); }

  function handleFollow(s, following) {
    if (!sessionId || !selectedAccount) return requireAuth();
    fetch(`${API_BASE}/api/copy/strategies/${s.id}/follow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, account: selectedAccount, following }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setFollows((prev) => {
            const next = new Set(prev);
            if (following) next.add(s.id); else next.delete(s.id);
            return next;
          });
          setStrategies((prev) => prev.map((x) => (x.id === s.id
            ? { ...x, followers: Math.max(0, x.followers + (following ? 1 : -1)) }
            : x)));
          if (onActivity) onActivity(following ? 'copy_follow' : 'copy_unfollow', { strategy_id: s.id });
        } else setError(data.error);
      })
      .catch((e) => setError(e.message));
  }

  function handleCopy(s) {
    const p = s.params || {};
    if (!p.symbol) { setError('This strategy has no trade parameters yet.'); return; }
    const blocks = [
      { type: 'start', settings: {} },
      {
        type: 'buy',
        settings: {
          symbol: p.symbol,
          market: p.market || 'synthetic_index',
          contract_type: p.contract_type || 'RISE',
          amount: Number(p.amount) || 1,
          duration: Number(p.duration) || 5,
          duration_unit: p.duration_unit || 't',
        },
      },
      { type: 'trade_again', settings: { when: p.trade_again || 'both' } },
    ];
    if (onUseBot) onUseBot(JSON.stringify({ app: 'pronofxdbot', version: 1, blocks }));
  }

  function handlePublish(e) {
    e.preventDefault();
    if (!sessionId || !selectedAccount) return requireAuth();
    if (!name.trim()) return;
    setUploading(true);
    setError(null);
    const params = {
      symbol,
      contract_type: contractType,
      amount: Number(stake),
      basis: 'stake',
      duration: Number(duration),
      duration_unit: durationUnit,
      trade_again: tradeAgain,
      currency: currency || 'USD',
    };
    fetch(`${API_BASE}/api/copy/strategies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, account: selectedAccount, name: name.trim(), description, banner, params }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Publish failed');
        setStrategies((prev) => [{ ...data.strategy, followers: 0, owned: true }, ...prev]);
        setName(''); setDescription(''); setBanner(''); setShowForm(false);
        if (onActivity) onActivity('copy_strategy_create', { strategy_id: data.strategy.id, name: data.strategy.name });
      })
      .catch((e) => setError(e.message))
      .finally(() => setUploading(false));
  }

  function handleDelete(s) {
    if (!sessionId || !selectedAccount) return requireAuth();
    if (!window.confirm(`Delete strategy "${s.name}"?`)) return;
    fetch(`${API_BASE}/api/copy/strategies/${s.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, account: selectedAccount }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setStrategies((prev) => prev.filter((x) => x.id !== s.id));
          if (onActivity) onActivity('copy_strategy_delete', { strategy_id: s.id });
        } else setError(data.error);
      })
      .catch((e) => setError(e.message));
  }

  function describeParams(p) {
    if (!p || !p.symbol) return null;
    const parts = [
      `${p.symbol}`,
      COPY_TYPE_LABELS[p.contract_type] || p.contract_type,
      `${p.amount} ${p.currency || 'USD'}`,
      `${p.duration} ${COPY_UNIT_LABELS[p.duration_unit] || p.duration_unit}`,
    ];
    return parts.join(' · ');
  }

  const symbolOpts = symbols.reduce((groups, s) => {
    const key = s.market === 'synthetic_index' ? 'Synthetic Indices' : s.market === 'forex' ? 'Forex' : s.market === 'cryptocurrency' ? 'Crypto' : 'Other';
    (groups[key] = groups[key] || []).push(s);
    return groups;
  }, {});

  return (
    <div className="section">
      <h2 className="section-title">Copytrading</h2>
      <p className="section-sub">Publish a strategy for others to copy, or follow a strategy and run it on your own account with one click.</p>

      <div className="community-actions">
        <button className="btn-outline btn-small" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Publish a strategy'}
        </button>
      </div>

      {showForm && (
        <form className="booking-card community-form" onSubmit={handlePublish}>
          <div className="booking-field">
            <span>Strategy name</span>
            <input className="booking-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Volatility 75 Rise Runner" required />
          </div>
          <div className="booking-field">
            <span>Description (optional)</span>
            <input className="booking-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Rules, timeframe, risk notes…" />
          </div>
          <div className="booking-field">
            <span>Banner image</span>
            <BannerPicker banner={banner} onChange={setBanner} session={sessionId} account={selectedAccount} />
          </div>
          <div className="booking-row">
            <div className="booking-field">
              <span>Symbol</span>
              <select className="select" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                {symbols.length === 0 && <option value="R_75">R_75</option>}
                {Object.entries(symbolOpts).map(([market, list]) => (
                  <optgroup key={market} label={market}>
                    {list.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="booking-field">
              <span>Contract type</span>
              <select className="select" value={contractType} onChange={(e) => setContractType(e.target.value)}>
                {Object.entries(COPY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="booking-row">
            <div className="booking-field">
              <span>Stake ({currency || 'USD'})</span>
              <input className="booking-input" type="number" min="0.01" step="0.01" value={stake} onChange={(e) => setStake(Number(e.target.value))} />
            </div>
            <div className="booking-field">
              <span>Duration</span>
              <div className="booking-row" style={{ gap: 8 }}>
                <input className="booking-input" type="number" min="1" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                <select className="select" value={durationUnit} onChange={(e) => setDurationUnit(e.target.value)}>
                  {Object.entries(COPY_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="booking-field">
            <span>Restart behaviour</span>
            <select className="select" value={tradeAgain} onChange={(e) => setTradeAgain(e.target.value)}>
              <option value="both">After every trade</option>
              <option value="win">Only after a win</option>
              <option value="loss">Only after a loss</option>
            </select>
          </div>
          {error && <div className="mt-error">{error}</div>}
          <button className="btn-primary booking-submit" type="submit" disabled={uploading}>
            {uploading ? 'Publishing…' : 'Publish strategy'}
          </button>
        </form>
      )}

      <div className="table-card">
        <div className="table-row table-head">
          <span>Strategy</span><span>Followers</span><span>Status</span><span></span>
        </div>
        {busy && strategies.length === 0 && <div className="table-row"><span className="mt-hint">Loading strategies…</span></div>}
        {!busy && strategies.length === 0 && !error && (
          <div className="table-row"><span className="mt-hint">No strategies yet — publish the first one!</span></div>
        )}
        {strategies.map((s) => {
          const following = follows.has(s.id);
          const desc = describeParams(s.params);
          return (
            <div className="table-row" key={s.id}>
              <span className="trader-cell">
                {s.banner ? <img src={s.banner} alt="" className="table-banner" /> : <span className="trader-avatar">{s.name.slice(0, 1).toUpperCase()}</span>}
                <span>
                  {s.name} {s.owned && <span className="circle-owned">yours</span>}
                  {desc && <div className="circle-desc">{desc}</div>}
                </span>
              </span>
              <span>{s.followers}</span>
              <span className={s.status === 'active' ? 'roi-up' : 'roi-down'}>{s.status}</span>
              <span className="community-actions">
                <button className={`btn-primary btn-small ${following ? 'btn-active' : ''}`} onClick={() => handleFollow(s, !following)}>
                  {following ? 'Following' : 'Follow'}
                </button>
                <button className="btn-outline btn-small" onClick={() => handleCopy(s)}>Copy</button>
                {s.owned && <button className="btn-outline btn-small" onClick={() => handleDelete(s)}>Delete</button>}
              </span>
            </div>
          );
        })}
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

// Deriv's trade-type taxonomy (contract_category from `contracts_for`),
// shown grouped exactly like Deriv's platform trade-type selector.
const MT_CATEGORY_ORDER = [
  'risefall', 'callput', 'highlow', 'digits', 'matchdiff', 'asians',
  'touch', 'endsinout', 'ticks', 'runs', 'reset', 'multipliers',
  'turbos', 'vanilla', 'accumulators',
];
const MT_CATEGORY_NAMES = {
  risefall: 'Rise/Fall', callput: 'Up/Down', highlow: 'Highs/Lows',
  digits: 'Digits', matchdiff: 'Matches/Differs', asians: 'Asians',
  touch: 'Touches/No Touches', endsinout: 'Ends In/Out', ticks: 'Ticks',
  runs: 'Runs', reset: 'Reset', multipliers: 'Multipliers',
  turbos: 'Turbos', vanilla: 'Vanilla', accumulators: 'Accumulators',
};

// Trade types that only need a duration + stake (+ optional barrier) to
// price through `proposal`. Exotic types (multipliers/turbos/vanilla/
// accumulators) are shown but greyed out — they need extra parameters.
const MT_ENABLED_CATEGORIES = new Set([
  'risefall', 'callput', 'highlow', 'digits', 'matchdiff', 'asians',
  'touch', 'endsinout', 'ticks', 'runs',
]);

// Digit trades predict the last digit, passed to `proposal` via `barrier`.
const MT_DIGIT_CATEGORIES = new Set(['digits', 'matchdiff']);

const MT_TYPE_NAMES = {
  RISE: 'Rise', FALL: 'Fall',
  CALLE: 'Rise (Allow Equals)', PUTE: 'Fall (Allow Equals)',
  CALL: 'Higher', PUT: 'Lower',
  HIGHER: 'High', LOWER: 'Low',
  ASIANU: 'Asia Up', ASIAND: 'Asia Down',
  DIGITMATCH: 'Matches', DIGITDIFF: 'Differs',
  DIGITEVEN: 'Even', DIGITODD: 'Odd',
  DIGITOVER: 'Over', DIGITUNDER: 'Under',
  ONETOUCH: 'Touch', NOTOUCH: 'No Touch',
  EXPIRYRANGE: 'Ends In', EXPIRYRANGEE: 'Ends Out',
  EXPIRYMISS: 'Ends In', EXPIRYMISSE: 'Ends Out',
  TICKHIGH: 'High', TICKLOW: 'Low',
  RUNHIGH: 'High', RUNLOW: 'Low',
  MULTUP: 'Up', MULTDOWN: 'Down',
  ACCU: 'Accumulator',
  RESETCALL: 'Reset Call', RESETPUT: 'Reset Put',
  VANILLALONGCALL: 'Vanilla Call', VANILLALONGPUT: 'Vanilla Put',
  TURBOSLONG: 'Turbo Long', TURBOSSHORT: 'Turbo Short',
};
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

// Curated "market type" selector for the Manual Trader — mirrors the
// selector used in trading apps (Deriv DTrader / Pocket Option style).
// Each entry maps to the buy (up/green) and sell (down/red) contract types.
const MT_MENU = [
  { id: 'risefall', label: 'Rise / Fall', up: 'RISE', down: 'FALL' },
  { id: 'callput', label: 'Call / Put', up: 'CALL', down: 'PUT' },
  { id: 'highlow', label: 'Higher / Lower', up: 'HIGHER', down: 'LOWER' },
  { id: 'matchdiff', label: 'Matches / Differs', up: 'DIGITMATCH', down: 'DIGITDIFF' },
  { id: 'evenodd', label: 'Even / Odd', up: 'DIGITEVEN', down: 'DIGITODD' },
  { id: 'accumulators', label: 'Accumulators', up: 'ACCU', down: 'ACCU' },
];

function ManualTraderTab({ sessionId, accounts, selectedAccount, setSelectedAccount, balance, onBalanceUpdate, currency, onTradeSettled, theme }) {
  const [symbols, setSymbols] = useState([]);
  const [symbolsError, setSymbolsError] = useState(null);
  const [symbol, setSymbol] = useState(null);

  const [contractCategories, setContractCategories] = useState([]);
  const [menu, setMenu] = useState('risefall');

  const [duration, setDuration] = useState(5);
  const [durationUnit, setDurationUnit] = useState('t');
  const [stake, setStake] = useState(10);
  const [basis, setBasis] = useState('stake'); // 'stake' | 'payout'
  const [barrier, setBarrier] = useState('+5.0');
  const [digit, setDigit] = useState(5);

  const [proposals, setProposals] = useState({ up: null, down: null });
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
  const currentMenu = MT_MENU.find((m) => m.id === menu) || MT_MENU[0];
  const typeLabel = (id) => MT_TYPE_NAMES[id] || id;

  // Types actually returned by Deriv for this symbol on this account.
  const availableTypes = useMemo(() => {
    const s = new Set();
    for (const c of contractCategories) for (const t of c.types) s.add(t.contract_type);
    return s;
  }, [contractCategories]);
  const menuAvailable = (m) => availableTypes.size === 0 || availableTypes.has(m.up) || availableTypes.has(m.down);

  // Duration units/min/max come from the selected menu's contract type.
  const activeTypeInfo = (() => {
    let t = null;
    for (const c of contractCategories) for (const x of c.types) if (x.contract_type === currentMenu.up) { t = x; break; }
    if (!t) for (const c of contractCategories) for (const x of c.types) if (x.contract_type === currentMenu.down) { t = x; break; }
    return t;
  })();
  const unitOptions = activeTypeInfo?.units?.length ? activeTypeInfo.units : ['t', 'm', 'h'];

  const upLabel = menu === 'matchdiff' ? `Matches ${digit}` : menu === 'evenodd' ? 'Even' : menu === 'accumulators' ? 'Up' : typeLabel(currentMenu.up);
  const downLabel = menu === 'matchdiff' ? `Differs ${digit}` : menu === 'evenodd' ? 'Odd' : menu === 'accumulators' ? 'Down' : typeLabel(currentMenu.down);

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
        const grouped = new Map();
        for (const a of avail) {
          const key = a.contract_category || 'other';
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(a);
        }
        const buildTypes = (list) => list.map((a) => ({
          contract_type: a.contract_type,
          label: MT_TYPE_NAMES[a.contract_type] || a.contract_display || a.contract_type,
          barriers: a.barriers ?? 0,
          units: (a.duration_units || []).filter((u) => MT_UNIT_LABELS[u]),
          min: a.duration_min ?? 1,
          max: a.duration_max ?? 9999,
        }));
        const cats = MT_CATEGORY_ORDER
          .filter((c) => grouped.has(c))
          .map((c) => ({
            category: c,
            label: MT_CATEGORY_NAMES[c] || grouped.get(c)[0].contract_category_display || c,
            types: buildTypes(grouped.get(c)),
          }))
          .concat(
            [...grouped.entries()]
              .filter(([c]) => !MT_CATEGORY_ORDER.includes(c))
              .map(([c, list]) => ({
                category: c,
                label: list[0].contract_category_display || c,
                types: buildTypes(list),
              }))
          );
        setContractCategories(cats);
      })
      .catch(() => { if (!cancelled) setContractCategories([]); });
    return () => { cancelled = true; };
  }, [symbol, sessionId, selectedAccount]);

  // keep the selected market type valid for this symbol
  useEffect(() => {
    setMenu((prev) => {
      if (MT_MENU.some((m) => m.id === prev && menuAvailable(m))) return prev;
      const first = MT_MENU.find((m) => menuAvailable(m));
      return first ? first.id : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractCategories, symbol]);

  // clamp duration/unit to the selected contract type
  useEffect(() => {
    if (!activeTypeInfo) return;
    setDurationUnit((prev) => (activeTypeInfo.units.includes(prev) ? prev : (activeTypeInfo.units[0] || 'm')));
    setDuration((d) => Math.max(activeTypeInfo.min, Math.min(activeTypeInfo.max, Number(d) || activeTypeInfo.min)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, activeTypeInfo]);

  // defaults + reset result whenever the market type changes
  useEffect(() => {
    if (menu === 'highlow' && !barrier) setBarrier('+5.0');
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

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

  // Extra parameters each market type needs for its proposal.
  const sideParams = (side) => {
    const p = { contract_type: side === 'up' ? currentMenu.up : currentMenu.down };
    if (menu === 'matchdiff') p.barrier = String(digit);
    if (menu === 'highlow') {
      let b = String(barrier || '+5.0').trim();
      if (!/^[+-]/.test(b)) b = `+${b}`;
      if (side === 'down') b = b[0] === '-' ? b.slice(1) : `-${b}`;
      p.barrier = b;
    }
    if (menu === 'accumulators') p.prediction = side === 'up' ? '1' : '-1';
    return p;
  };

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
          ws.send(JSON.stringify({ action: 'subscribe', balance: true }));
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
            if (msg.msg_type === 'balance' && msg.balance) onBalanceUpdate(msg.balance);
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

  // --- proposals (price quotes) for both buy and sell sides ---
  useEffect(() => {
    if (!sessionId || !selectedAccount || !symbol || !menu || contractMeta) { setProposals({ up: null, down: null }); return; }
    let cancelled = false;
    setProposalLoading(true);
    setProposalError(null);
    const t = setTimeout(() => {
      const fetchSide = (side) => {
        const params = sideParams(side);
        return fetch(`${API_BASE}/api/contract/proposal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: sessionId, account: selectedAccount, symbol, amount: stake, basis, duration, duration_unit: durationUnit, currency, ...params }),
        })
          .then(async (r) => {
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Proposal failed');
            return d.proposal;
          })
          .catch((e) => { if (!cancelled) setProposalError(e.message); return null; });
      };
      Promise.all([fetchSide('up'), fetchSide('down')]).then(([u, d]) => {
        if (!cancelled) setProposals({ up: u, down: d });
      }).finally(() => { if (!cancelled) setProposalLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, selectedAccount, symbol, menu, duration, durationUnit, stake, basis, currency, barrier, digit, contractMeta]);

  // --- buy a real contract for the chosen side (green up / red down) ---
  async function handleBuy(side) {
    const p = proposals[side];
    if (!p || busy || contractMeta) return;
    setBusy(true);
    setActionError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/contract/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionId, account: selectedAccount, proposal_id: p.id, price: p.ask_price }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Buy failed');
      const buy = data.buy;
      settleRef.current = null;
      setContractMeta({
        ...buy,
        contract_type: p.contract_type,
        symbol,
        duration,
        duration_unit: durationUnit,
        date_expiry: p.date_expiry,
        tick_count: p.tick_count,
        payout: p.payout,
        longcode: p.longcode,
      });
      setContract(null);
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

  const lastPrice = lastTick?.quote ?? contract?.current_spot ?? proposals.up?.spot ?? proposals.down?.spot ?? null;
  const entryPoint = contract?.entry_spot != null
    ? { price: contract.entry_spot, time: contract.entry_tick_time }
    : (contractMeta?.entry_spot != null ? { price: contractMeta.entry_spot, time: contractMeta.entry_tick_time } : null);

  // 1-second candles from the live tick feed for the trade chart
  const candles = useMemo(() => aggregateCandles(ticks, 1), [ticks]);

  // Last-digit stats from live ticks (used by the digits / even-odd pads).
  const digitStats = useMemo(() => {
    const counts = new Array(10).fill(0);
    let total = 0;
    for (const t of ticks) {
      if (t == null || t.price == null) continue;
      const s = t.price.toFixed(decimals);
      const d = Number(s[s.length - 1]);
      if (Number.isInteger(d) && d >= 0 && d <= 9) { counts[d] += 1; total += 1; }
    }
    return { counts, total, pct: counts.map((c) => (total ? (c / total) * 100 : 10)) };
  }, [ticks, decimals]);
  const currentDigit = lastPrice == null ? null : Number(lastPrice.toFixed(decimals).slice(-1));
  const evenPct = digitStats.pct.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
  const oddPct = 100 - evenPct;

  // Absolute barrier price from the proposal, drawn on the chart.
  const proposalBarrier = (() => {
    const p = proposals.up || proposals.down;
    if (p && p.barrier != null) { const n = Number(p.barrier); if (Number.isFinite(n)) return n; }
    return null;
  })();

  const wsLabel = wsStatus === 'live' ? 'Live' : wsStatus === 'connecting' ? 'Connecting' : 'Offline';
  const wsClass = wsStatus === 'live' ? 'tv-live' : wsStatus === 'connecting' ? 'tv-connecting' : 'tv-offline';

  const marketNotice = marketStatus
    ? (marketStatus.marketClosed
      ? `Market is closed for ${marketStatus.symbol}. You can still open contracts once it reopens.`
      : marketStatus.unavailable
        ? `${marketStatus.symbol} is not available on this account/app (${marketStatus.code}).`
        : (marketStatus.message || marketStatus.code))
    : null;

  const onSymbolChange = (e) => {
    setSymbol(e.target.value);
    setContract(null);
    setContractMeta(null);
    setResult(null);
    setTicks([]);
    setLastTick(null);
  };

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
    <div className="section mt-app">
      <div className="mt-topbar">
        <h2 className="section-title">Manual Trader</h2>
        <div className="mt-top-controls">
          <select className="select mt-account-select" value={selectedAccount || ''} onChange={(e) => setSelectedAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.account} value={a.account}>{a.account} ({a.currency})</option>
            ))}
          </select>
          <select className="select mt-symbol-select" value={symbol || ''} onChange={onSymbolChange} disabled={symbols.length === 0}>
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
          <span className={`tv-status ${wsClass}`}><Radio size={13} /> {wsLabel}</span>
          <span className="mt-balance">Balance: <b>{balance ? `${balance.balance} ${balance.currency}` : '—'}</b></span>
        </div>
      </div>

      {symbolsError && <p className="mt-hint">Symbol list unavailable: {symbolsError}</p>}
      {marketNotice && (
        <div className="mt-error"><AlertTriangle size={13} /> {marketNotice}</div>
      )}

      <div className="mt-params">
        <div className="mt-param">
          <span className="mt-param-label">Market type</span>
          <select className="select mt-menu-select" value={menu} onChange={(e) => { setMenu(e.target.value); setResult(null); }}>
            {MT_MENU.map((m) => (
              <option key={m.id} value={m.id} disabled={!menuAvailable(m)}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="mt-param">
          <span className="mt-param-label">Duration</span>
          <div className="mt-duration">
            <input className="select mt-duration-input" type="number" min="1" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            <div className="mt-units">
              {unitOptions.map((u) => (
                <button key={u} className={`mt-unit-btn ${durationUnit === u ? 'mt-unit-active' : ''}`} onClick={() => setDurationUnit(u)}>
                  {MT_UNIT_LABELS[u]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-param">
          <span className="mt-param-label">{basis === 'payout' ? `Payout (${currency})` : `Stake (${currency})`}</span>
          <div className="mt-stake-row">
            <input className="select mt-stake-input" type="number" min="1" step="0.01" value={stake} onChange={(e) => setStake(Number(e.target.value))} />
            <div className="mt-units">
              {['stake', 'payout'].map((b) => (
                <button key={b} className={`mt-unit-btn ${basis === b ? 'mt-unit-active' : ''}`} onClick={() => setBasis(b)}>
                  {b === 'stake' ? 'Stake' : 'Payout'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {menu === 'highlow' && (
          <div className="mt-param">
            <span className="mt-param-label">Barrier</span>
            <input className="select mt-barrier-input" type="text" value={barrier} onChange={(e) => setBarrier(e.target.value)} placeholder="+5.0" />
          </div>
        )}
      </div>

      <div className="card mt-chart-card">
        <div className="mt-chart-top">
          <span className="mt-type-badge">
            {symbol || '—'} · {currentMenu.label} · {duration} {MT_UNIT_LABELS[durationUnit]}{contractMeta ? ` · ${typeLabel(contractMeta.contract_type)}` : ''}
          </span>
          {contractMeta && isTickContract && (
            <span className="mt-timer">⏱ {remainingTicks == null ? '—' : `${remainingTicks} ticks left`}</span>
          )}
          {contractMeta && !isTickContract && (
            <span className="mt-timer">⏱ {formatRemaining(remainingMs)} left</span>
          )}
        </div>

        {candles.length === 0 ? (
          <div className="tv-empty mt-empty-chart">
            <Activity size={18} />
            <span>Live 1s candles — waiting for ticks…</span>
          </div>
        ) : (
          <CandleFeedChart
            candles={candles}
            decimals={decimals}
            entryPoint={entryPoint}
            lastPrice={lastPrice}
            direction={contractMeta?.contract_type ?? currentMenu.up}
            barrierLine={menu === 'highlow' ? proposalBarrier : null}
            theme={theme}
          />
        )}

        <div className="mt-strip">
          <div className="mt-strip-cell">
            <span>Current price</span>
            <b>{lastPrice == null ? '—' : lastPrice.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b>
          </div>
          <div className="mt-strip-cell">
            <span>Entry point</span>
            <b>{entryPoint?.price == null ? '—' : entryPoint.price.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b>
          </div>
          <div className="mt-strip-cell">
            <span>Market type</span>
            <b>{activeSymbol ? (MT_MARKET_LABELS[activeSymbol.market] || activeSymbol.market) : '—'}</b>
          </div>
        </div>
      </div>

      {(menu === 'matchdiff' || menu === 'evenodd') && (
        <div className="card mt-digitpad">
          <div className="mt-digitpad-head">
            <span className="card-label">{menu === 'matchdiff' ? 'Pick the last digit' : 'Last digit distribution'}</span>
            <span className="mt-hint">{currentDigit == null ? 'waiting for a tick…' : `current last digit: ${currentDigit}`}</span>
          </div>
          <div className="mt-digitpad-row">
            {Array.from({ length: 10 }, (_, d) => {
              const hit = currentDigit === d;
              const active = menu === 'matchdiff' && digit === d;
              const inner = (
                <>
                  <span className="mt-pad-num">{d}</span>
                  <span className="mt-pad-pct">{digitStats.pct[d].toFixed(0)}%</span>
                </>
              );
              return menu === 'matchdiff' ? (
                <button key={d} className={`mt-pad-digit ${active ? 'mt-pad-active' : ''} ${hit ? 'mt-pad-hit' : ''}`} onClick={() => setDigit(d)}>
                  {inner}
                </button>
              ) : (
                <div key={d} className={`mt-pad-digit ${hit ? 'mt-pad-hit' : ''}`}>{inner}</div>
              );
            })}
          </div>
          {menu === 'evenodd' && (
            <div className="mt-evenodd-bar">
              <div className="mt-evenodd-track">
                <div className="mt-evenodd-fill" style={{ width: `${evenPct}%` }} />
              </div>
              <div className="mt-evenodd-labels">
                <span>Even {evenPct.toFixed(0)}%</span>
                <span>Odd {oddPct.toFixed(0)}%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {contractMeta && (
        <div className="card mt-open-card">
          <div className="card-label">Open contract · {typeLabel(contractMeta.contract_type)}</div>
          <div className="mt-open-grid">
            <div className="mt-open-cell"><span>Entry</span><b>{contract?.entry_spot == null ? '—' : contract.entry_spot.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
            <div className="mt-open-cell"><span>Current</span><b>{contract?.current_spot == null ? '—' : contract.current_spot.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
            <div className="mt-open-cell"><span>Sell now at</span><b>{contract?.sell_price == null ? '—' : contract.sell_price.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
            <div className="mt-open-cell"><span>Potential payout</span><b>{contractMeta.payout != null ? contractMeta.payout.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'} {currency}</b></div>
          </div>
        </div>
      )}

      <div className="mt-bottom-actions">
        {contractMeta ? (
          <div className="mt-open-inline">
            <div className="mt-open-cell"><span>Entry</span><b>{contract?.entry_spot == null ? '—' : contract.entry_spot.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
            <div className="mt-open-cell"><span>Current</span><b>{contract?.current_spot == null ? '—' : contract.current_spot.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
            <div className="mt-open-cell"><span>Sell at</span><b>{contract?.sell_price == null ? '—' : contract.sell_price.toLocaleString(undefined, { maximumFractionDigits: decimals })}</b></div>
            <button className="mt-sell-btn" onClick={handleSell} disabled={!contract?.is_valid_to_sell || selling}>
              {selling ? 'Selling…' : 'Sell now'}
            </button>
            {!contract?.is_valid_to_sell && <span className="mt-hint">Not sellable yet</span>}
          </div>
        ) : (
          <>
            <button className="mt-side-btn mt-side-down" onClick={() => handleBuy('down')} disabled={!proposals.down || busy || proposalLoading}>
              <span className="mt-side-label">{downLabel}</span>
              <span className="mt-side-payout">{proposalLoading ? 'Pricing…' : (proposals.down ? `Payout ${proposals.down.payout.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}` : 'No price')}</span>
            </button>
            <button className="mt-side-btn mt-side-up" onClick={() => handleBuy('up')} disabled={!proposals.up || busy || proposalLoading}>
              <span className="mt-side-label">{upLabel}</span>
              <span className="mt-side-payout">{proposalLoading ? 'Pricing…' : (proposals.up ? `Payout ${proposals.up.payout.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}` : 'No price')}</span>
            </button>
          </>
        )}
      </div>

      {result && (
        <div className={`mt-result ${result.won ? 'mt-result-won' : 'mt-result-lost'}`}>
          <b>{result.soldEarly ? (result.won ? 'Closed at a profit' : 'Closed at a loss') : (result.won ? 'Contract won' : 'Contract lost')}</b>
          <span>{result.profit >= 0 ? '+' : ''}{result.profit.toFixed(2)} {currency}</span>
        </div>
      )}

      {(proposalError || actionError) && (
        <div className="mt-error"><AlertTriangle size={13} /> {proposalError || actionError}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Live line chart (lightweight-charts v5). Marks the current price as a
// dotted price line and the entry point as a dashed price line + arrow.
// ---------------------------------------------------------------------

function LineFeedChart({ points, candles, chartType, decimals, entryPoint, lastPrice, direction, theme }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const entryLineRef = useRef(null);
  const currentLineRef = useRef(null);
  const markersRef = useRef(null);
  const appliedLen = useRef(0);

  const toPoint = (p) => ({ time: p.t, value: p.price });
  const toBar = (c) => ({ time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c });

  const systemLight = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const isLight = theme === 'light' || (theme === 'system' && systemLight);
  const colors = isLight
    ? { bg: '#ffffff', text: '#5c6672', grid: '#eef0f3', border: '#dfe3e8', crosshair: 'rgba(22,24,29,0.25)', labelBg: '#eef0f3' }
    : { bg: '#14181d', text: '#8b93a1', grid: '#1d2229', border: '#23282f', crosshair: 'rgba(242,243,245,0.3)', labelBg: '#23282f' };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: colors.bg },
        textColor: colors.text,
        fontSize: 11,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      timeScale: { timeVisible: true, secondsVisible: true, borderColor: colors.border, rightOffset: 3 },
      rightPriceScale: { borderColor: colors.border },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
        horzLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
      },
    });

    const series = chart.addSeries(chartType === 'candlestick' ? CandlestickSeries : AreaSeries, chartType === 'candlestick'
      ? {
        upColor: '#00d0a0',
        downColor: '#ff444f',
        borderVisible: false,
        wickUpColor: '#00d0a0',
        wickDownColor: '#ff444f',
        priceFormat: { type: 'price', precision: decimals, minMove: 1 / Math.pow(10, decimals) },
      }
      : {
        lineColor: '#4c6ef5',
        topColor: 'rgba(76,110,245,0.35)',
        bottomColor: 'rgba(76,110,245,0.02)',
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
  }, [chartType, decimals, colors.bg, colors.text, colors.grid, colors.border, colors.crosshair, colors.labelBg]);

  // Push live data incrementally, rebuilding only when history or mode changes.
  useEffect(() => {
    const series = seriesRef.current;
    const data = chartType === 'candlestick' ? candles : points;
    if (!series) return;
    if (data.length === 0) {
      series.setData([]);
      appliedLen.current = 0;
      return;
    }
    const prev = appliedLen.current;
    const toItem = chartType === 'candlestick' ? toBar : toPoint;
    if (prev === 0 || prev > data.length || data.length > prev + 1) {
      series.setData(data.map(toItem));
    } else {
      // Either a new bar/point was appended, or the current bar/point updated in place.
      series.update(toItem(data[data.length - 1]));
    }
    appliedLen.current = data.length;
    chartRef.current?.timeScale().scrollToRealTime();
  }, [points, candles, chartType]);

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
        const up = direction === 'RISE' || direction === 'CALL' || direction === 'HIGHER' || direction === 'DIGITEVEN' || direction === 'DIGITMATCH' || direction === 'ASIAU' || direction === 'UPORDOWN';
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

  // barrier price line (Highs/Lows trades) — dashed indigo marker
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (barrierLineRef.current) {
      try { series.removePriceLine(barrierLineRef.current); } catch { /* noop */ }
      barrierLineRef.current = null;
    }
    if (barrierLine != null && Number.isFinite(barrierLine)) {
      barrierLineRef.current = series.createPriceLine({
        price: barrierLine,
        color: '#4c6ef5',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'Barrier',
        axisLabelVisible: true,
      });
    }
  }, [barrierLine]);

  return <div className="mt-chart-canvas" ref={containerRef} />;
}

// ---------------------------------------------------------------------
// Aggregate the live tick feed into OHLC candles (seconds). Used for the
// Manual Trader's 1s trade chart; the bucket time is the candle's OPEN
// time so it lines up with the contract's entry_tick_time marker.
// ---------------------------------------------------------------------

function aggregateCandles(ticks, granSec) {
  const map = new Map();
  for (const t of ticks) {
    if (t == null || t.t == null || t.price == null) continue;
    const bucket = Math.floor(t.t / granSec) * granSec;
    let c = map.get(bucket);
    if (!c) {
      map.set(bucket, { t: bucket * 1000, o: t.price, h: t.price, l: t.price, c: t.price });
    } else {
      if (t.price > c.h) c.h = t.price;
      if (t.price < c.l) c.l = t.price;
      c.c = t.price;
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------
// Live candlestick chart for the Manual Trader (lightweight-charts v5).
// Mirrors Deriv's DTrader chart: live candles for the symbol, a dashed
// entry line + arrow where the contract opened, and a dotted current
// price line. Updates incrementally without rebuilding the chart.
// ---------------------------------------------------------------------

function CandleFeedChart({ candles, decimals, entryPoint, lastPrice, direction, barrierLine, theme }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const entryLineRef = useRef(null);
  const currentLineRef = useRef(null);
  const barrierLineRef = useRef(null);
  const markersRef = useRef(null);
  const appliedLen = useRef(0);

  const toBar = (c) => ({ time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c });

  const systemLight = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const isLight = theme === 'light' || (theme === 'system' && systemLight);
  const colors = isLight
    ? { bg: '#ffffff', text: '#5c6672', grid: '#eef0f3', border: '#dfe3e8', crosshair: 'rgba(22,24,29,0.25)', labelBg: '#eef0f3' }
    : { bg: '#14181d', text: '#8b93a1', grid: '#1d2229', border: '#23282f', crosshair: 'rgba(242,243,245,0.3)', labelBg: '#23282f' };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: colors.bg },
        textColor: colors.text,
        fontSize: 11,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      timeScale: { timeVisible: true, secondsVisible: true, borderColor: colors.border, rightOffset: 3 },
      rightPriceScale: { borderColor: colors.border },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
        horzLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00d0a0',
      downColor: '#ff444f',
      borderVisible: false,
      wickUpColor: '#00d0a0',
      wickDownColor: '#ff444f',
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
      barrierLineRef.current = null;
      markersRef.current = null;
      appliedLen.current = 0;
    };
  }, [decimals, colors.bg, colors.text, colors.grid, colors.border, colors.crosshair, colors.labelBg]);

  // push live candles incrementally (full reset when a new set arrives)
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (candles.length === 0) {
      series.setData([]);
      appliedLen.current = 0;
      return;
    }
    const prev = appliedLen.current;
    if (prev === 0 || prev > candles.length || candles.length > prev + 1) {
      series.setData(candles.map(toBar));
    } else {
      // Either a new candle was appended, or the forming candle moved in
      // place (more ticks landed in the current second) — update the last bar.
      series.update(toBar(candles[candles.length - 1]));
    }
    appliedLen.current = candles.length;
    chartRef.current?.timeScale().scrollToRealTime();
  }, [candles]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const up = direction === 'RISE' || direction === 'CALL' || direction === 'HIGHER' || direction === 'DIGITEVEN' || direction === 'DIGITMATCH' || direction === 'ASIAU' || direction === 'UPORDOWN';
        markersRef.current?.setMarkers([{
          time: entryPoint.time,
          position: up ? 'belowBar' : 'aboveBar',
          color: up ? '#00d0a0' : '#ff444f',
          shape: up ? 'arrowUp' : 'arrowDown',
          text: 'Entry',
        }]);
      }
    }
  }, [entryPoint, direction]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [lastPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="mt-chart-canvas" ref={containerRef} />;
}

// ---------------- Bot runner (big modal) ----------------

function BotSidebar({ sidebarTab, setSidebarTab, botRunning, toggleBot, resetStats, stats, profitLoss, currency, openContracts, trades, onClose }) {
  const recentTrades = [...trades].reverse().slice(0, 12);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bot-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sidebar-topbar">
          <div className="modal-title">Bot Runner</div>
          <div className="modal-tools">
            <span className="run-status">{botRunning ? 'Monitoring open contracts' : 'Bot is idle'}</span>
            <button className={`run-btn ${botRunning ? 'run-btn-active' : ''}`} onClick={toggleBot}>
              <Play size={14} fill={botRunning ? 'currentColor' : 'none'} />
              {botRunning ? 'Stop' : 'Run'}
            </button>
            <button className="btn-icon" onClick={onClose}><X size={16} /></button>
          </div>
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
      </div>
    </div>
  );
}

// ---------------- Log in / Sign up modal (gated bot run) ----------------

function AuthModal({ onClose, onLogin, onRegister }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="auth-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="btn-icon auth-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <div className="brand-mark auth-mark">P</div>
        <h3>Connect your Deriv account</h3>
        <p>You need to be logged in to run the bot. Link your Deriv account to start monitoring open contracts and trading live.</p>
        <div className="auth-actions">
          <button className="btn-primary" onClick={onLogin}>Log in</button>
          <button className="btn-ghost" onClick={onRegister}>Sign up</button>
        </div>
        <span className="auth-note">Secure OAuth sign-in via Deriv. We never store your password.</span>
      </div>
    </div>
  );
}

// ---------------- Deposit / Withdraw (Deriv cashier) modal ----------------

function CashierModal({ mode, sessionId, accounts, selectedAccount, setSelectedAccount, theme, onClose, onBalanceRefresh }) {
  const [activeMode, setActiveMode] = useState(mode);
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [needCode, setNeedCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const dark = theme !== 'light';

  function loadCashier(nextMode, verificationCode) {
    if (!sessionId || !selectedAccount) return;
    setLoading(true);
    setError(null);
    setUrl(null);
    setNeedCode(false);
    setCodeSent(false);
    fetch(`${API_BASE}/api/cashier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: sessionId,
        account: selectedAccount,
        action: nextMode,
        verification_code: verificationCode,
      }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          if (data.needVerification) { setNeedCode(true); return; }
          throw new Error(data.error || 'Could not open the Deriv cashier.');
        }
        if (!data.url) throw new Error('Deriv did not return a cashier page for this account.');
        setUrl(data.url);
        setIframeKey((k) => k + 1);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadCashier(activeMode); }, [selectedAccount, activeMode]);

  function switchMode(m) {
    if (m === activeMode) return;
    setActiveMode(m);
    setCode('');
    setCodeSent(false);
    loadCashier(m);
  }

  function handleSendCode() {
    if (!sessionId) return;
    setSendingCode(true);
    setError(null);
    fetch(`${API_BASE}/api/cashier/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: sessionId, account: selectedAccount, type: 'withdraw' }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Could not send the verification code.');
        setCodeSent(true);
      })
      .catch((e) => setError(e.message))
      .finally(() => setSendingCode(false));
  }

  function handleSubmitCode(e) {
    e.preventDefault();
    if (!code.trim()) return;
    loadCashier('withdraw', code.trim());
  }

  function close() {
    onClose();
    if (onBalanceRefresh) onBalanceRefresh();
  }

  const iframeUrl = url
    ? `${url}${url.includes('?') ? '&' : '?'}DarkMode=${dark ? 'on' : 'off'}`
    : null;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="cashier-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="cashier-head">
          <div className="cashier-title">
            <Wallet size={16} />
            <span>Cashier</span>
          </div>
          <div className="cashier-head-right">
            <select
              className="select cashier-account"
              value={selectedAccount || ''}
              onChange={(e) => setSelectedAccount(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.account} value={a.account}>{a.account} ({a.currency})</option>
              ))}
            </select>
            <button className="btn-icon" onClick={close} aria-label="Close"><X size={16} /></button>
          </div>
        </div>

        <div className="pill-row cashier-tabs">
          <button className={`pill ${activeMode === 'deposit' ? 'pill-active' : ''}`} onClick={() => switchMode('deposit')}>
            Deposit
          </button>
          <button className={`pill ${activeMode === 'withdraw' ? 'pill-active' : ''}`} onClick={() => switchMode('withdraw')}>
            Withdraw
          </button>
        </div>

        {loading && (
          <div className="cashier-state">
            <RefreshCw size={22} className="cashier-spin" />
            <p>Opening the Deriv cashier…</p>
          </div>
        )}

        {!loading && error && !needCode && (
          <div className="cashier-state">
            <div className="mt-error" style={{ marginBottom: 12 }}>
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
            <button className="btn-outline btn-small" onClick={() => loadCashier(activeMode)}>Try again</button>
            <p className="mt-hint" style={{ marginTop: 12 }}>
              You can also fund or withdraw directly on Deriv:&nbsp;
              <a href="https://app.deriv.com/cashier/deposit" target="_blank" rel="noopener noreferrer">Deposit</a>
              {' · '}
              <a href="https://app.deriv.com/cashier/withdrawal" target="_blank" rel="noopener noreferrer">Withdraw</a>
            </p>
          </div>
        )}

        {!loading && needCode && (
          <div className="cashier-state">
            <div className="booking-done-mark" style={{ width: 40, height: 40, fontSize: 18 }}>✉</div>
            <p className="cashier-verify-text">
              <strong>Verify your withdrawal</strong>
            </p>
            <p className="cashier-verify-text">
              Deriv will email a one-time verification code to the address linked to your account.
            </p>
            {!codeSent ? (
              <button className="btn-primary" onClick={handleSendCode} disabled={sendingCode}>
                {sendingCode ? 'Sending…' : 'Send verification code'}
              </button>
            ) : (
              <form className="cashier-code-form" onSubmit={handleSubmitCode}>
                <input
                  className="booking-input cashier-code-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="Enter the code from your email"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
                <button className="btn-primary" type="submit">Verify & continue</button>
                <button className="btn-ghost" type="button" onClick={handleSendCode}>Resend code</button>
              </form>
            )}
          </div>
        )}

        {!loading && iframeUrl && (
          <>
            <div className="cashier-frame-wrap">
              <iframe
                key={iframeKey}
                src={iframeUrl}
                title="Deriv cashier"
                className="cashier-frame"
                allow="payment"
              />
            </div>
            <div className="cashier-actions">
              <a className="btn-outline btn-small" href={iframeUrl} target="_blank" rel="noopener noreferrer">
                Open in new tab
              </a>
              <button className="btn-outline btn-small" onClick={() => loadCashier(activeMode)}>
                <RefreshCw size={13} /> Reload
              </button>
            </div>
          </>
        )}

        <p className="cashier-note">
          Payments run entirely on Deriv's official cashier — your funds go straight to your selected Deriv account.
        </p>
      </div>
    </div>
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
      :root[data-theme="light"] {
        --bg: #f4f5f7;
        --panel: #ffffff;
        --panel-2: #eef0f3;
        --border: #dfe3e8;
        --text: #16181d;
        --text-muted: #5c6672;
      }
      @media (prefers-color-scheme: light) {
        :root[data-theme="system"] {
          --bg: #f4f5f7;
          --panel: #ffffff;
          --panel-2: #eef0f3;
          --border: #dfe3e8;
          --text: #16181d;
          --text-muted: #5c6672;
        }
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

      .theme-wrap { position: relative; }
      .theme-menu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 40; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 4px; display: flex; flex-direction: column; gap: 2px; min-width: 140px; box-shadow: 0 12px 32px rgba(0,0,0,0.35); }
      .theme-opt { display: flex; align-items: center; gap: 8px; background: transparent; border: none; color: var(--text-muted); padding: 8px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; }
      .theme-opt:hover { background: var(--panel-2); color: var(--text); }
      .theme-opt-active { color: var(--accent-red); background: rgba(255,68,79,0.1); }

      .tabs { display: flex; gap: 4px; padding: 0 14px 10px; overflow-x: auto; }
      .tab { display: flex; align-items: center; gap: 6px; background: transparent; border: none; color: var(--text-muted); padding: 8px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
      .tab-label { display: inline; }
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

      .pill-row { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
      .pill { padding: 8px 16px; border-radius: 999px; background: var(--panel-2); color: var(--text-muted); font-size: 13px; font-weight: 600; cursor: pointer; border: none; font-family: inherit; }
      .pill-active { background: rgba(255,68,79,0.12); color: var(--accent-red); }

      .promo-row { display: flex; gap: 16px; overflow-x: auto; padding-bottom: 8px; }
      .promo-card { flex: 0 0 300px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
      .promo-img { height: 160px; background-size: cover; background-position: center; position: relative; }
      .promo-tag { position: absolute; top: 12px; left: 12px; color: #fff; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; }
      .promo-body { padding: 16px; }
      .promo-body h3 { margin: 0 0 6px; font-size: 15px; }
      .promo-body p { margin: 0 0 12px; font-size: 13px; color: var(--text-muted); line-height: 1.5; }

      .booking-card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 22px; max-width: 560px; }
      .booking-title { margin: 0 0 4px; font-size: 18px; }
      .booking-sub { margin: 0 0 18px; font-size: 13px; color: var(--text-muted); line-height: 1.6; }
      .booking-form { display: flex; flex-direction: column; gap: 14px; }
      .booking-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .booking-field { display: flex; flex-direction: column; gap: 6px; }
      .booking-field > span { font-size: 12px; color: var(--text-muted); font-weight: 600; }
      .booking-input { padding: 10px; border-radius: 8px; background: var(--panel-2); color: var(--text); border: 1px solid var(--border); font-size: 13px; font-family: inherit; }
      .booking-input:focus { outline: none; border-color: var(--accent-red); }
      .booking-submit { padding: 12px; }
      .booking-done { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; padding: 10px 0; }
      .booking-done-mark { width: 48px; height: 48px; border-radius: 50%; background: rgba(0,208,160,0.12); color: var(--accent-teal); display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; }
      .booking-done p { margin: 0; font-size: 13px; color: var(--text-muted); line-height: 1.6; }
      .booking-done button { margin-top: 6px; }

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

      .chart-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
      .chart-head .tv-status { margin-left: auto; }
      .chart-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; }
      .chart-delta { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; padding: 3px 8px; border-radius: 6px; }
      .chart-delta.up { color: var(--accent-teal); background: rgba(0,208,160,0.1); }
      .chart-delta.down { color: var(--accent-red); background: rgba(255,68,79,0.1); }
      .chart-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }

      .tv-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 4px 11px; white-space: nowrap; }
      .tv-status svg { animation: tv-pulse 1.6s ease-in-out infinite; }
      .tv-live { color: var(--accent-teal); background: rgba(0,208,160,0.12); border: 1px solid rgba(0,208,160,0.35); }
      .tv-connecting { color: #ffb224; background: rgba(255,178,36,0.12); border: 1px solid rgba(255,178,36,0.4); }
      .tv-offline { color: var(--accent-red); background: rgba(255,68,79,0.12); border: 1px solid rgba(255,68,79,0.35); }
      @keyframes tv-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      .tv-gran { display: inline-flex; align-items: center; gap: 4px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 9px; padding: 3px; }
      .tv-gran-btn { background: transparent; border: none; color: var(--text-muted); padding: 6px 11px; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.15s ease, color 0.15s ease; }
      .tv-gran-btn:hover { color: var(--text); }
      .tv-gran-active { background: var(--panel); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
      .tv-banner { display: flex; align-items: center; gap: 8px; font-size: 13px; border-radius: 8px; padding: 8px 12px; }
      .tv-banner-error { background: rgba(255,68,79,0.1); color: #ff9aa0; }
      .tv-empty { padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px; }

      .circle-row { display: flex; flex-direction: column; gap: 10px; max-width: 460px; }
      .circle-card { display: flex; align-items: center; gap: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; }
      .circle-img { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; }
      .circle-name { font-size: 14px; font-weight: 600; }
      .circle-members { font-size: 12px; color: var(--text-muted); }
      .circle-main { flex: 1; min-width: 0; }
      .circle-actions { display: flex; flex-direction: column; gap: 6px; margin-left: auto; }
      .circle-card .circle-actions button { margin-left: 0; }
      .circle-members-panel { margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px; }
      .circle-members-title { font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }
      .circle-member { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
      .member-avatar { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; background: var(--accent-indigo); flex-shrink: 0; }
      .member-login { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .member-role { font-size: 10px; color: var(--text-muted); }

      .banner-picker { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .banner-preview { width: 120px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); }
      .banner-preview-empty { display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted); background: var(--panel); }
      .banner-actions { display: flex; gap: 6px; flex-wrap: wrap; }
      .card-banner { width: 100%; height: 110px; object-fit: cover; border-radius: 8px; margin-top: 8px; }
      .table-banner { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }

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

      .aihub-chat { display: flex; flex-direction: column; gap: 10px; max-height: 380px; overflow-y: auto; margin-bottom: 12px; }
      .aihub-msg { padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
      .aihub-msg-label { font-size: 11px; font-weight: 600; opacity: 0.65; margin-bottom: 4px; }
      .aihub-msg-text { font-size: 13px; }
      .aihub-user { background: var(--accent-blue-dim, rgba(76, 110, 245, 0.14)); border: 1px solid var(--border); align-self: flex-end; max-width: 85%; }
      .aihub-assistant { background: var(--panel); border: 1px solid var(--border); align-self: flex-start; max-width: 100%; }

      .table-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; max-width: 560px; }
      .table-row { display: grid; grid-template-columns: 2fr 1fr 1fr 0.8fr; align-items: center; gap: 8px; padding: 12px 16px; font-size: 13px; border-bottom: 1px solid var(--border); }
      .table-row:last-child { border-bottom: none; }
      .table-head { color: var(--text-muted); font-size: 11px; text-transform: uppercase; font-weight: 700; }
      .trader-cell { display: flex; align-items: center; gap: 8px; }
      .trader-avatar { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; }
      .community-actions { margin-bottom: 14px; }
      .community-form { max-width: 560px; margin-bottom: 18px; display: flex; flex-direction: column; gap: 12px; }
      .community-form .booking-field > span { margin-bottom: 2px; }
      .circle-avatar { width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; color: #fff; background: var(--accent-indigo); flex-shrink: 0; }
      .circle-owned { font-size: 10px; font-weight: 700; color: var(--accent-teal); background: rgba(0,208,160,0.12); border-radius: 999px; padding: 2px 7px; margin-left: 4px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.03em; }
      .circle-desc { font-size: 11px; color: var(--text-muted); margin-top: 2px; line-height: 1.4; }
      .bot-avatar { width: 100%; height: 90px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 30px; color: #fff; background: linear-gradient(135deg, var(--accent-indigo), var(--accent-red)); margin-bottom: 10px; }
      .bot-meta { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; }
      .bot-actions { display: flex; gap: 6px; flex-wrap: wrap; }
      .btn-active { background: rgba(0,208,160,0.12); border-color: var(--accent-teal); color: var(--accent-teal); }
      .bb-xml-input { font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12px; resize: vertical; }
      .activity-list { display: flex; flex-direction: column; margin-top: 6px; }
      .activity-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
      .activity-row:last-child { border-bottom: none; }
      .activity-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--accent-teal); }
      .activity-dot-circle_create, .activity-dot-circle_join, .activity-dot-circle_leave { background: var(--accent-indigo); }
      .activity-dot-bot_share, .activity-dot-bot_upload_free { background: var(--accent-red); }
      .activity-dot-bot_use, .activity-dot-bot_run { background: var(--accent-teal); }
      .activity-dot-copy_strategy_create, .activity-dot-copy_follow, .activity-dot-copy_unfollow { background: #e9c148; }
      .activity-msg { flex: 1; color: var(--text); }
      .activity-time { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
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
      .mt-categories { display: flex; gap: 6px; flex-wrap: wrap; }
      .mt-cat-btn { background: var(--panel-2); border: 1px solid var(--border); color: var(--text-muted); border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
      .mt-cat-active { background: var(--panel); border-color: var(--accent-indigo); color: var(--text); }
      .mt-cat-disabled { opacity: 0.45; cursor: not-allowed; text-decoration: line-through; }
      .mt-digits { display: flex; gap: 5px; flex-wrap: wrap; }
      .mt-digit-btn { flex: 0 0 38px; background: var(--panel-2); border: 1px solid var(--border); color: var(--text-muted); border-radius: 8px; padding: 8px 0; font-size: 13px; font-weight: 700; cursor: pointer; }
      .mt-digit-active { background: rgba(255,68,79,0.12); border-color: var(--accent-red); color: var(--accent-red); }
      .mt-buy { display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .mt-buy-label { font-weight: 700; }
      .mt-buy-sub { font-size: 11px; opacity: 0.85; }
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

      /* Rebuilt Manual Trader (trading-app style) */
      .mt-app { display: flex; flex-direction: column; gap: 12px; max-width: 860px; }
      .mt-topbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .mt-topbar .section-title { margin: 0; }
      .mt-top-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto; }
      .mt-account-select { width: auto; min-width: 150px; padding: 8px 10px; }
      .mt-symbol-select { width: 270px; max-width: 100%; padding: 8px 10px; }
      .mt-params { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
      .mt-param { display: flex; flex-direction: column; gap: 5px; }
      .mt-param-label { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
      .mt-menu-select { min-width: 190px; }
      .mt-duration-input { width: 72px; }
      .mt-stake-row { display: flex; align-items: center; gap: 6px; }
      .mt-stake-input { width: 96px; }
      .mt-barrier-input { width: 110px; }
      .mt-chart-card { min-height: 380px; }
      .mt-digitpad { display: flex; flex-direction: column; gap: 10px; padding: 14px; }
      .mt-digitpad-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
      .mt-digitpad-row { display: flex; gap: 8px; justify-content: space-between; overflow-x: auto; padding-bottom: 2px; }
      .mt-pad-digit { display: flex; flex-direction: column; align-items: center; gap: 3px; flex: 1 0 44px; min-width: 44px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 999px; padding: 10px 4px; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease; }
      .mt-pad-digit:hover { transform: translateY(-2px); }
      .mt-pad-num { font-size: 20px; font-weight: 800; line-height: 1; }
      .mt-pad-pct { font-size: 10px; color: var(--text-muted); font-weight: 600; }
      .mt-pad-active { border-color: var(--accent-indigo); background: rgba(76,110,245,0.14); box-shadow: 0 0 0 2px rgba(76,110,245,0.25); }
      .mt-pad-hit { animation: mt-digit-flash 1s ease-in-out infinite; border-color: var(--accent-teal); }
      .mt-pad-hit .mt-pad-num { color: var(--accent-teal); }
      @keyframes mt-digit-flash { 0%, 100% { box-shadow: 0 0 0 0 rgba(0,208,160,0.55); transform: scale(1); } 50% { box-shadow: 0 0 0 7px rgba(0,208,160,0); transform: scale(1.14); } }
      .mt-evenodd-bar { display: flex; flex-direction: column; gap: 4px; }
      .mt-evenodd-track { height: 10px; border-radius: 999px; background: var(--panel-2); border: 1px solid var(--border); overflow: hidden; }
      .mt-evenodd-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--accent-teal), var(--accent-indigo)); transition: width 0.4s ease; }
      .mt-evenodd-labels { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; }
      .mt-open-card { display: flex; flex-direction: column; gap: 10px; }
      .mt-open-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
      .mt-open-cell { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--text-muted); }
      .mt-open-cell b { font-size: 14px; color: var(--text); font-family: 'SFMono-Regular', Consolas, monospace; }
      .mt-bottom-actions { position: sticky; bottom: 0; z-index: 40; display: flex; gap: 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 10px; box-shadow: 0 -6px 24px rgba(0,0,0,0.12); }
      .mt-side-btn { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: none; border-radius: 12px; padding: 14px 10px; font-weight: 800; font-size: 15px; cursor: pointer; transition: transform 0.12s ease, filter 0.12s ease; }
      .mt-side-btn:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.05); }
      .mt-side-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      .mt-side-up { background: linear-gradient(180deg, #00e6b0, #00b894); color: #03241a; }
      .mt-side-down { background: linear-gradient(180deg, #ff5a63, #e8414c); color: #2b0507; }
      .mt-side-label { font-size: 16px; line-height: 1.1; }
      .mt-side-payout { font-size: 12px; opacity: 0.85; font-weight: 600; }
      .mt-open-inline { flex: 1; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 2px 6px; }
      .mt-sell-btn { margin-left: auto; background: var(--accent-red); color: #fff; border: none; border-radius: 10px; padding: 12px 22px; font-weight: 800; font-size: 14px; cursor: pointer; }
      .mt-sell-btn:hover:not(:disabled) { filter: brightness(1.1); }
      .mt-sell-btn:disabled { opacity: 0.55; cursor: not-allowed; }
      @media (max-width: 640px) {
        .mt-top-controls { margin-left: 0; width: 100%; }
        .mt-symbol-select { flex: 1 1 100%; }
        .mt-params { align-items: stretch; }
        .mt-param { flex: 1 1 45%; }
        .mt-menu-select, .mt-barrier-input { width: 100%; }
        .mt-bottom-actions { flex-direction: column-reverse; }
        .mt-side-btn { padding: 16px 10px; }
      }

      .chart-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
      .chart-symbol-select { width: 320px; max-width: 100%; }
      .chart-canvas { position: relative; }

      .sidebar-ledger { width: 100%; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; max-height: 280px; }
      .ledger-row { display: grid; grid-template-columns: 60px minmax(0, 1fr) auto; gap: 8px; align-items: center; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; }
      .ledger-dir { font-weight: 700; color: var(--text-muted); text-transform: uppercase; font-size: 10px; }
      .ledger-sym { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .sidebar { display: contents; }
      .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 120; display: flex; align-items: center; justify-content: center; padding: 16px; }
      .bot-modal { width: min(640px, 94vw); max-height: 92dvh; overflow-y: auto; overscroll-behavior: contain; background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 18px; display: flex; flex-direction: column; gap: 14px; box-shadow: 0 24px 80px rgba(0,0,0,0.55); }
      .sidebar-topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .modal-title { font-size: 16px; font-weight: 800; }
      .modal-tools { display: flex; align-items: center; gap: 10px; }
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

      .bot-fab { position: fixed; right: 16px; bottom: 16px; z-index: 100; width: 54px; height: 54px; border-radius: 50%; background: var(--accent-red); color: #fff; border: none; display: none; align-items: center; justify-content: center; box-shadow: 0 8px 26px rgba(255,68,79,0.45); cursor: pointer; }
      .bot-fab:hover { transform: translateY(-2px); }

      .auth-modal { width: min(400px, 92vw); background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 28px 22px 22px; position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; box-shadow: 0 24px 80px rgba(0,0,0,0.55); }
      .auth-close { position: absolute; top: 12px; right: 12px; }
      .auth-mark { width: 44px; height: 44px; border-radius: 12px; font-size: 20px; }
      .auth-modal h3 { margin: 14px 0 6px; font-size: 18px; }
      .auth-modal p { margin: 0 0 18px; font-size: 13px; color: var(--text-muted); line-height: 1.6; }
      .auth-actions { display: flex; gap: 10px; width: 100%; }
      .auth-actions .btn-primary, .auth-actions .btn-ghost { flex: 1; padding: 12px; }
      .auth-note { font-size: 11px; color: var(--text-muted); margin-top: 14px; line-height: 1.5; }

      .cashier-modal { width: min(680px, 96vw); max-height: 92dvh; overflow-y: auto; overscroll-behavior: contain; background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 18px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 24px 80px rgba(0,0,0,0.55); }
      .cashier-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .cashier-title { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 800; }
      .cashier-head-right { display: flex; align-items: center; gap: 8px; }
      .cashier-account { width: auto; min-width: 150px; padding: 7px 10px; }
      .cashier-tabs { margin: 0; }
      .cashier-state { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; padding: 40px 16px; min-height: 360px; }
      .cashier-state .mt-error { align-self: stretch; text-align: left; }
      .cashier-state a { color: var(--accent-teal); text-decoration: none; font-weight: 600; }
      .cashier-state a:hover { text-decoration: underline; }
      .cashier-verify-text { margin: 0; font-size: 13px; color: var(--text-muted); line-height: 1.6; }
      .cashier-verify-text strong { color: var(--text); font-size: 15px; }
      .cashier-code-form { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 320px; }
      .cashier-code-input { text-align: center; font-size: 18px; letter-spacing: 0.3em; }
      .cashier-frame-wrap { flex: 1; min-height: 520px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
      .cashier-frame { width: 100%; height: 100%; min-height: 520px; border: none; display: block; }
      .cashier-actions { display: flex; gap: 8px; align-items: center; }
      .cashier-actions .btn-outline { display: inline-flex; align-items: center; gap: 6px; }
      .cashier-note { font-size: 11px; color: var(--text-muted); margin: 0; line-height: 1.5; text-align: center; }
      .cashier-spin { animation: cashier-rotate 1s linear infinite; color: var(--text-muted); }
      @keyframes cashier-rotate { to { transform: rotate(360deg); } }
      .balance-actions { display: flex; gap: 8px; margin-top: 12px; }

      .tabs { scrollbar-width: none; -webkit-overflow-scrolling: touch; }
      .tabs::-webkit-scrollbar { display: none; }

      .footer { border-top: 1px solid var(--border); background: linear-gradient(180deg, var(--bg), var(--panel)); margin-top: 40px; }
      .footer-inner { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 24px; max-width: 1000px; margin: 0 auto; padding: 32px 24px 20px; }
      .footer-brand { display: flex; align-items: center; gap: 12px; }
      .footer-mark { width: 38px; height: 38px; border-radius: 10px; font-size: 18px; background: linear-gradient(135deg, var(--accent-red), var(--accent-indigo)); box-shadow: 0 4px 14px rgba(255, 68, 79, 0.25); }
      .footer-brand-name { font-weight: 800; font-size: 16px; letter-spacing: -0.02em; }
      .footer-tagline { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
      .footer-links, .footer-socials { display: flex; flex-direction: column; gap: 8px; }
      .footer-links-label { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted); }
      .footer-link { background: none; border: none; color: var(--text-muted); font-size: 13px; padding: 2px 0; text-align: left; cursor: pointer; transition: color 0.15s ease; }
      .footer-link:hover { color: var(--accent-red); }
      .footer-socials-row { display: flex; gap: 10px; }
      .footer-social { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--text-muted); border: 1px solid var(--border); background: var(--panel); transition: transform 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
      .footer-social:hover { color: var(--brand); border-color: var(--brand); transform: translateY(-2px); box-shadow: 0 6px 18px color-mix(in srgb, var(--brand) 30%, transparent); }
      .footer-bottom { display: flex; flex-direction: column; align-items: center; gap: 6px; border-top: 1px solid var(--border); max-width: 1000px; margin: 0 auto; padding: 16px 24px; font-size: 12px; color: var(--text-muted); text-align: center; }
      .footer-copy { letter-spacing: 0.06em; }
      .typing-text { font-variant-numeric: tabular-nums; }
      .typing-text strong { color: var(--text); font-weight: 700; letter-spacing: 0.02em; }
      .typing-caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: text-bottom; background: var(--accent-red); animation: caret-blink 0.9s steps(1) infinite; }
      @keyframes caret-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
      .footer-co { color: var(--text); font-weight: 700; letter-spacing: 0.02em; }
      .footer-copy { letter-spacing: 0.06em; }
      .footer-modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
      .footer-modal { position: relative; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; max-width: 460px; width: 100%; padding: 24px; }
      .footer-modal-close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 6px; }
      .footer-modal-close:hover { color: var(--text); background: var(--panel-2); }
      .footer-modal-title { margin: 0 0 12px; font-size: 18px; }
      .footer-modal-body { font-size: 13px; color: var(--text-muted); line-height: 1.6; }
      .footer-modal-body p { margin: 0 0 12px; }
      .footer-modal-body p:last-child { margin-bottom: 0; }

      @media (max-width: 1024px) {
        .main { padding: 20px; }
      }

      @media (max-width: 900px) {
        .body { flex-direction: column; }
        .manual-grid, .dash-grid { grid-template-columns: 1fr; }
        .mt-grid { grid-template-columns: 1fr; }
        .table-card { overflow-x: auto; }
        .table-row { grid-template-columns: minmax(160px, 2fr) 1fr 1fr 0.8fr; min-width: 480px; }
      }

      @media (max-width: 760px) {
        .tab { padding: 8px; gap: 0; }
        .tab-label { display: none; }
        .tabs { gap: 2px; }
        .chart-head { flex-wrap: wrap; }
        .chart-head .tv-status { margin-left: auto; }
        .bot-fab { display: flex; }
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
        .promo-row { display: grid; grid-template-columns: 1fr; overflow: visible; gap: 14px; }
        .promo-card { flex-basis: auto; width: 100%; }
        .builder-canvas { max-width: 100%; }
        .bot-grid { grid-template-columns: 1fr; }
        .aihub-grid { grid-template-columns: 1fr; }
        .stats-grid { grid-template-columns: 1fr 1fr; }
        .bot-modal { padding: 14px; }
        .run-status { display: none; }
        .modal-tools { gap: 8px; }
        .bot-fab { width: 48px; height: 48px; right: 14px; bottom: 14px; }
        .footer-inner { flex-direction: column; gap: 18px; }
        .footer-bottom { flex-direction: column; align-items: center; text-align: center; }
      }

      @media (max-width: 420px) {
        .topnav-actions .btn-primary, .topnav-actions .btn-ghost { padding: 7px 11px; }
        .stats-grid { grid-template-columns: 1fr; }
        .log-row { grid-template-columns: 1fr; gap: 4px; }
        .mt-strip { grid-template-columns: 1fr; }
        .mt-chart-canvas { height: 260px; }
        .booking-row { grid-template-columns: 1fr; }
        .booking-card { padding: 16px; }
      }
    `}</style>
  );
}
