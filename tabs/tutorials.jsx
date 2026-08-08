import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Search, ChevronRight, ChevronLeft, Clock, Bookmark, BookmarkCheck,
  CheckCircle2, Circle, Filter, ArrowUp, BarChart3,
} from 'lucide-react';

const STORE_KEY = 'pulsetrader_tutorials_v1';

const CATEGORIES = ['All', 'Platform', 'Bots', 'Strategies', 'Risk', 'API'];

const DIFF_COLOR = {
  Beginner: 'var(--accent-teal)',
  Intermediate: 'var(--accent-indigo)',
  Advanced: 'var(--accent-red)',
};

const TUTORIALS = [
  {
    id: 'connect-oauth',
    title: 'Connecting this app to your Deriv account',
    category: 'Platform',
    difficulty: 'Beginner',
    minutes: 8,
    updated: '2026-07',
    tags: ['oauth', 'account', 'login'],
    sections: [
      { h: 'How the connection works', blocks: ['This app uses OAuth 2 to connect to your Deriv account. You never give this app your Deriv password — instead you are redirected to Deriv, approve the app there, and Deriv hands the app a short-lived token. The backend keeps that token server-side and only exposes your account numbers and currencies to the browser.', 'The whole handshake looks like this: (1) click Log in, (2) approve on Deriv, (3) Deriv redirects back with a session id, (4) the app fetches your account list and balance through its own API.'] },
      { h: 'Step by step', steps: ['Open the app and click Log in (top-right of the nav bar).', 'You are taken to Deriv\u2019s OAuth page. Choose the account you want to connect.', 'Approve the app. You will be sent back to PulseTrader automatically.', 'The Dashboard tab now lists your accounts and shows the live balance.'] },
      { h: 'Troubleshooting', blocks: ['If the login page does not load, the backend may be offline — start it and try again. If you log out, the session and its token are discarded; the next login is a fresh handshake.', 'Never paste a Deriv API token into the URL bar. Tokens are credentials — treat them like passwords.'] },
    ],
  },
  {
    id: 'first-bot',
    title: 'Your first bot: a moving-average crossover',
    category: 'Bots',
    difficulty: 'Intermediate',
    minutes: 15,
    updated: '2026-07',
    tags: ['ma', 'strategy', 'sma', 'ema', 'entry'],
    sections: [
      { h: 'The strategy', blocks: ['A moving-average crossover buys when a fast average crosses above a slow average, and sells when it crosses below. It is simple, fully mechanical, and a perfect first bot because there is no human discretion left to second-guess.', 'On synthetic indices this works best when applied to a timeframe that suits the market\u2019s speed: a slow pair (Volatility 10/25) on 5-minute candles, for example.'] },
      { h: 'Encoding the rule', steps: ['Define your entry: fast EMA crosses above slow EMA on your chosen timeframe.', 'Define your exit: either the opposite cross or a fixed contract duration.', 'Define your stake: fixed and risk-based (see the Risk Management class), never doubled after losses.', 'Define your restart: what the bot does immediately after a loss — a cooldown is usually wiser than instant revenge trades.'] },
      { h: 'Why simple works', blocks: ['Simple rules are easier to backtest honestly, easier to audit when something goes wrong, and far harder to overfit than a strategy with a dozen tuned parameters. If the crossover logic cannot hold up in a backtest, adding filters is not the fix — the edge is not there.'] },
    ],
  },
  {
    id: 'backtesting',
    title: 'Backtesting: separating skill from luck',
    category: 'Strategies',
    difficulty: 'Intermediate',
    minutes: 14,
    updated: '2026-06',
    tags: ['backtest', 'sample size', 'overfitting', 'strategy'],
    sections: [
      { h: 'What a backtest is', blocks: ['A backtest replays historical data and asks what your strategy would have done at every point. It converts a strategy from a story into a number you can actually evaluate: win rate, average risk/reward, maximum drawdown, total trades.'] },
      { h: 'The three classic lies', steps: ['Overfitting: hand-tuning 15 parameters until a chart looks perfect. Test out-of-sample — tune on one period, verify on a totally different one.', 'Tiny samples: a 10-trade "90% win rate" is noise. Aim for at least 200\u2013500 trades before a win-rate difference means anything statistically.', 'Ignoring costs: every contract carries an implied cost in its payout percentage. Model the real payout, not an idealized one.'] },
      { h: 'Reading the result', blocks: ['Judge a backtest by the worst-case drawdown and the profit factor, not the headline return. A strategy with a 5% win rate but 1:10 risk/reward can be fine; a strategy with a 70% win rate and 1:0.5 risk/reward can be slowly bleeding.'] },
    ],
  },
  {
    id: 'volatility-vs-forex',
    title: 'Volatility indices vs forex: what changes',
    category: 'Strategies',
    difficulty: 'Beginner',
    minutes: 10,
    updated: '2026-05',
    tags: ['synthetic', 'forex', 'indices'],
    sections: [
      { h: 'The core differences', blocks: ['Volatility indices are algorithm-generated synthetic markets; forex trades real currencies through the global banking system. The practical differences are huge for a trader: synthetic indices trade 24/7, have no gaps, and are not affected by central-bank news.', 'Forex has spreads, brokers, pips and market hours; a weekend or a headline can gap price through your stop before you can react.'] },
      { h: 'What stays the same', blocks: ['The market still goes up and down, trends and ranges still form, and your risk rules apply identically. Do not treat synthetic markets as "easier money" — they are simply a different environment where the price-generation model means noise behaves differently.'] },
      { h: 'Choosing for a bot', blocks: ['For around-the-clock automated trading, synthetic indices remove the "market is closed" failure mode entirely. If your strategy needs news or fundamentals, you are trading the wrong instrument entirely.'] },
    ],
  },
  {
    id: 'stop-loss',
    title: 'Setting stop-losses that survive',
    category: 'Risk',
    difficulty: 'Beginner',
    minutes: 9,
    updated: '2026-07',
    tags: ['stop', 'risk', 'sizing'],
    sections: [
      { h: 'A stop is a decision you make in advance', blocks: ['A stop-loss converts a hopeful position into a known risk. The price is decided before you enter, and the discipline is the hard part: if the stop is hit, the trade idea failed, full stop.'] },
      { h: 'Where to put it', steps: ['Place stops beyond a meaningful level — below a swing low, above a swing high, or beyond a structural zone — not at a random round number.', 'Set the distance so that normal noise does not trigger it. If a stop gets hit constantly, it is too tight, even if the win rate looks "good".', 'Size the position to that stop distance (entry minus stop), not the other way around. The Risk Calculator does this in one screen.'] },
      { h: 'The sizing trap', blocks: ['If you pick the position size first and squeeze the stop to fit, you have hidden your risk inside a guaranteed-loser stop. Always let the stop define the size.'] },
    ],
  },
  {
    id: 'martingale-math',
    title: 'The martingale math (and why it fails)',
    category: 'Risk',
    difficulty: 'Intermediate',
    minutes: 12,
    updated: '2026-06',
    tags: ['martingale', 'streaks', 'risk of ruin', 'math'],
    sections: [
      { h: 'The appeal', blocks: ['Double your stake after every loss and a single win recovers everything. The win rate of the system appears to approach 100% — you only "lose" when you cannot afford the next stake.'] },
      { h: 'The arithmetic', blocks: ['After n consecutive losses the required stake is base \u00d7 2\u207f and the total committed is base \u00d7 (2\u207f \u2212 1). With a $1 base and 2\u00d7 doubling, ten straight losses require $1,023 of capital to chase a $1 profit.', 'The chance of that streak on a 50/50 market is 1 in 1,024 — rare, not impossible, and it is guaranteed to arrive eventually over thousands of trades. When it does, you lose 31\u00d7 your base stake on an 8-step capped ladder for the privilege of winning 1 unit every other time.'] },
      { h: 'The honest conclusion', blocks: ['Martingale does not create edge; it reshapes the loss distribution into rare, account-destroying events. If a strategy needs martingale to look profitable, the strategy itself is not profitable. Use the Martingale calculator in the Risk Calculator tab to see your own numbers.'] },
    ],
  },
  {
    id: 'candles',
    title: 'Reading candlestick patterns',
    category: 'Strategies',
    difficulty: 'Beginner',
    minutes: 11,
    updated: '2026-05',
    tags: ['candles', 'patterns', 'chart'],
    sections: [
      { h: 'Anatomy of a candle', blocks: ['A candle shows four prices for a period: open, high, low and close. The body runs from open to close; the wicks (shadows) reach to the high and low. A green (rising) candle closed higher than it opened; a red (falling) candle closed lower.'] },
      { h: 'Patterns that matter', steps: ['Long wicks: strong rejection of a level (a long lower wick = buyers stepped in).', 'Engulfing: a candle that fully swallows the previous one — momentum shifting.', 'Doji: open and close nearly equal — indecision, often the end of a move.', 'Higher highs + higher lows: an uptrend in progress.'] },
      { h: 'The honest caveat', blocks: ['Patterns are context, not guarantees. A doji in the middle of a range means nothing; a doji at a tested resistance with a shrinking RSI is a real warning. Combine candles with structure and momentum rather than trading them in isolation.'] },
    ],
  },
  {
    id: 'paper-trading',
    title: 'Paper trading before real money',
    category: 'Bots',
    difficulty: 'Beginner',
    minutes: 8,
    updated: '2026-07',
    tags: ['demo', 'paper', 'practice'],
    sections: [
      { h: 'Why demo first', blocks: ['A virtual-money account is funded with funds that cannot be withdrawn, which makes it the safest possible environment to validate a bot. The market data, ticks and payouts behave like the real thing; only the money is fake.'] },
      { h: 'How to run a meaningful demo', steps: ['Log in and pick a virtual account in the Dashboard.', 'Run your strategy for at least a few hundred contracts — enough trades that the statistics mean something.', 'Log every contract: symbol, direction, stake, duration, result, and what the market was doing.', 'Judge by consistency over time, never by one lucky day.'] },
      { h: 'Going live', blocks: ['Start at minimum stake and scale up gradually, only after consistent demo results. If the bot cannot hold its edge in demo, real money will not fix it — it will just make the lesson more expensive.'] },
    ],
  },
  {
    id: 'risk-of-ruin',
    title: 'Risk of ruin: why losing streaks end accounts',
    category: 'Risk',
    difficulty: 'Advanced',
    minutes: 13,
    updated: '2026-06',
    tags: ['risk of ruin', 'streaks', 'probability'],
    sections: [
      { h: 'The definition', blocks: ['Risk of ruin is the probability that a losing streak draws your account down to a point where you can no longer trade — either the balance hits zero or the required stake exceeds your capital. It is a function of three things: your win rate, your risk per trade, and your stake multiplier.'] },
      { h: 'The math of streaks', blocks: ['For a strategy with win probability p and a fixed 1% risk per trade, the chance of 8 straight losses is (1 \u2212 p)\u2078. At p = 55% that is (0.45)\u2078 \u2248 0.17% per 8-trade window — but you take hundreds of windows per year, so those windows arrive.', 'The deeper insight: the more you increase stakes to "recover" a drawdown, the fewer losing trades it takes to ruin you. Ruin is not about the next trade; it is about the compounding of many small losses.'] },
      { h: 'What reduces ruin', steps: ['Lower your risk per trade: 1% instead of 5% increases the number of consecutive losses your account can survive several-fold.', 'Keep stakes fixed or risk-based — proportional stakes reduce ruin automatically as the account shrinks.', 'Accept that losing streaks are normal and build your stake plan around them instead of pretending they will not happen.'] },
    ],
  },
  {
    id: 'session-journal',
    title: 'Keep a trade journal that actually helps',
    category: 'Bots',
    difficulty: 'Beginner',
    minutes: 7,
    updated: '2026-05',
    tags: ['journal', 'discipline', 'review'],
    sections: [
      { h: 'Why journal at all', blocks: ['Every losing streak has a pattern. A journal turns vague regret into data you can inspect: which symbol, which timeframe, what the market was doing, what you were thinking. Without records, you are guessing at your own mistakes.'] },
      { h: 'What to record', steps: ['The setup: symbol, direction, stake, duration, entry logic.', 'The context: trend, range, news, volatility regime.', 'The result: win/loss, actual R (risk units won or lost).', 'The note: one line on what you would do differently.'] },
      { h: 'Review rhythm', blocks: ['Review weekly, not per-trade. Look for the two trades most like each other and the two least like each other — the patterns that separate your good trades from your bad ones. Over time this single habit outperforms most strategy tweaks.'] },
    ],
  },
  {
    id: 'symbol-selection',
    title: 'Picking the right symbol for your strategy',
    category: 'Strategies',
    difficulty: 'Intermediate',
    minutes: 10,
    updated: '2026-07',
    tags: ['symbol', 'selection', 'timeframe'],
    sections: [
      { h: 'Match cadence, not hope', blocks: ['Every strategy has a natural cadence. Trend-following needs clean, slower moves — Volatility 10/25 on 5m+ candles. Fast scalps need fast ticks — the 1-second indices. Spike strategies suit Boom/Crash, but only if your risk plan survives the wrong-side spikes.'] },
      { h: 'A practical test', steps: ['Open the Trading View chart for the candidate symbol and your intended timeframe.', 'Ask: is the signal visible with the naked eye, in hindsight, over the last 100 candles?', 'If yes, encode it and backtest. If no, no amount of tuning will fix it.'] },
      { h: 'The wrong fit', blocks: ['Running a slow trend strategy on Volatility 100 with 1-minute contracts is the classic way to turn a decent idea into a loss. The market was not wrong — the fit was.'] },
    ],
  },
  {
    id: 'api-webhooks',
    title: 'Getting live data from the Deriv WebSocket API',
    category: 'API',
    difficulty: 'Advanced',
    minutes: 12,
    updated: '2026-07',
    tags: ['api', 'websocket', 'ticks', 'candles'],
    sections: [
      { h: 'The endpoint', blocks: ['Deriv exposes a WebSocket gateway at wss://ws.derivws.com/websockets/v3?app_id=YOUR_APP_ID. Every message is JSON: you send a request with a type, and Deriv replies with a message of the same type containing the data.'] },
      { h: 'Reading candles', blocks: ['Send { ticks_history: "R_100", granularity: 60, count: 300, style: "candles", end: "latest", adjust_start_time: 1 }. The reply contains a candles array; each candle\u2019s epoch is the end time of that candle, aligned to the granularity boundary. This app fetches exactly this through /api/candles.'] },
      { h: 'Subscribing to live ticks', steps: ['Send { ticks: "R_100", subscribe: 1 }.', 'Receive { msg_type: "tick", tick: { epoch, quote, id } } messages in real time.', 'To build a live candle, bucket each tick by floor(epoch / granularity) + 1 and update the last candle\u2019s high/low/close.', 'Unsubscribe with { forget: tickId } when done, and handle reconnects by resubscribing.'] },
      { h: 'Errors and reconnect', blocks: ['Every error message has an error.code and error.message — the most common is InvalidSymbol when the app_id does not have access to that symbol. Always implement reconnect with backoff; connections drop routinely and a robust bot must survive it.'] },
    ],
  },
];

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || { bookmarks: [], read: [] };
  } catch {
    return { bookmarks: [], read: [] };
  }
}

function saveStore(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch { /* storage unavailable */ }
}

export default function TutorialsTab() {
  const [store, setStore] = useState(() => loadStore());
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => { saveStore(store); }, [store]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TUTORIALS.filter((t) => {
      if (category !== 'All' && t.category !== category) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q)) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }, [category, search]);

  const open = openId ? TUTORIALS.find((t) => t.id === openId) : null;

  if (open) {
    return (
      <TutorialReader
        tutorial={open}
        store={store}
        setStore={setStore}
        onBack={() => setOpenId(null)}
        onNext={() => {
          const i = TUTORIALS.findIndex((t) => t.id === open.id);
          const next = TUTORIALS[i + 1] || TUTORIALS[0];
          setOpenId(next.id);
        }}
      />
    );
  }

  const readCount = store.read.length;
  const bookmarkCount = store.bookmarks.length;

  return (
    <div className="section">
      <h2 className="section-title">Tutorials</h2>
      <p className="section-sub">{TUTORIALS.length} practical guides · {readCount} read · {bookmarkCount} bookmarked</p>

      <div className="tu-toolbar">
        <div className="tu-search">
          <Search size={15} />
          <input
            className="tu-search-input"
            placeholder="Search tutorials, tags, topics…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="tu-cats">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`tu-cat ${category === c ? 'tu-cat-active' : ''}`}
              onClick={() => setCategory(c)}
            >
              {c === 'All' && <Filter size={12} />}
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="tu-empty">
          <Search size={22} />
          <p>No tutorials match "{search}". Try a different term.</p>
        </div>
      ) : (
        <div className="tu-list">
          {filtered.map((t) => {
            const isRead = store.read.includes(t.id);
            const isBookmarked = store.bookmarks.includes(t.id);
            return (
              <button key={t.id} className="tu-row" onClick={() => setOpenId(t.id)}>
                <span className="tu-row-icon">
                  {isRead ? <CheckCircle2 size={18} className="roi-up" /> : <BookOpen size={18} className="tu-muted" />}
                </span>
                <span className="tu-row-main">
                  <span className="tu-row-title">{t.title}</span>
                  <span className="tu-row-meta">
                    <span className="tu-tag">{t.category}</span>
                    <span style={{ color: DIFF_COLOR[t.difficulty] }}>{t.difficulty}</span>
                    <span><Clock size={11} /> {t.minutes} min</span>
                  </span>
                </span>
                <span className="tu-row-side">
                  {isBookmarked && <BookmarkCheck size={14} className="roi-up" />}
                  <ChevronRight size={15} className="tu-muted" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TutorialReader({ tutorial, store, setStore, onBack, onNext }) {
  const bodyRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const isRead = store.read.includes(tutorial.id);
  const isBookmarked = store.bookmarks.includes(tutorial.id);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      const total = el.scrollHeight - el.clientHeight;
      if (total <= 0) return;
      const pct = Math.min(100, Math.max(0, (el.scrollTop / total) * 100));
      setProgress(pct);
      if (pct > 95 && !isRead) {
        setStore((s) => ({ ...s, read: [...new Set([...s.read, tutorial.id])] }));
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [tutorial.id, isRead, setStore]);

  const toggleBookmark = () => {
    setStore((s) => ({
      ...s,
      bookmarks: s.bookmarks.includes(tutorial.id)
        ? s.bookmarks.filter((id) => id !== tutorial.id)
        : [...s.bookmarks, tutorial.id],
    }));
  };

  const toggleRead = () => {
    setStore((s) => ({
      ...s,
      read: s.read.includes(tutorial.id) ? s.read.filter((id) => id !== tutorial.id) : [...s.read, tutorial.id],
    }));
  };

  return (
    <div className="section tu-reader">
      <button className="btn-ghost btn-small cls-back" onClick={onBack}><ChevronLeft size={14} /> All tutorials</button>

      <div className="tu-reader-head">
        <div className="tu-reader-kicker">{tutorial.category} · <span style={{ color: DIFF_COLOR[tutorial.difficulty] }}>{tutorial.difficulty}</span></div>
        <h2 className="section-title">{tutorial.title}</h2>
        <div className="tu-reader-meta">
          <span><Clock size={13} /> {tutorial.minutes} min read</span>
          <span>Updated {tutorial.updated}</span>
          <span className="roi-up">{isRead ? 'Read' : 'Not read'}</span>
        </div>
      </div>

      <div className="tu-progress"><div className="tu-progress-fill" style={{ width: `${progress}%` }} /></div>

      <div className="tu-reader-body" ref={bodyRef}>
        {tutorial.sections.map((s, i) => (
          <div className="tu-section" key={i}>
            <h3 className="tu-section-h"><span className="tu-section-num">{i + 1}</span>{s.h}</h3>
            {s.blocks && s.blocks.map((b, j) => <p className="tu-section-p" key={j}>{b}</p>)}
            {s.steps && (
              <ol className="tu-steps">
                {s.steps.map((st, j) => <li key={j}>{st}</li>)}
              </ol>
            )}
          </div>
        ))}
        <div className="tu-end">End of guide. <button className="btn-outline btn-small" onClick={onNext}>Next tutorial <ChevronRight size={13} /></button></div>
      </div>

      <div className="tu-actions">
        <button className="btn-outline" onClick={toggleBookmark}>
          {isBookmarked ? <BookmarkCheck size={14} className="roi-up" /> : <Bookmark size={14} />}
          {isBookmarked ? 'Bookmarked' : 'Bookmark'}
        </button>
        <button className={isRead ? 'btn-outline' : 'btn-primary'} onClick={toggleRead}>
          {isRead ? <Circle size={14} /> : <CheckCircle2 size={14} />}
          {isRead ? 'Mark as unread' : 'Mark as read'}
        </button>
        <button className="btn-outline" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <ArrowUp size={14} /> Top
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Component styles
// ---------------------------------------------------------------------

const TU_CSS = `
.tu-toolbar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.tu-search { display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 0 12px; max-width: 420px; color: var(--text-muted); }
.tu-search-input { flex: 1; background: transparent; border: none; outline: none; color: var(--text); padding: 11px 0; font-size: 13px; }
.tu-cats { display: flex; gap: 6px; flex-wrap: wrap; }
.tu-cat { display: inline-flex; align-items: center; gap: 5px; background: var(--panel); border: 1px solid var(--border); color: var(--text-muted); border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
.tu-cat-active { background: rgba(255,68,79,0.12); border-color: rgba(255,68,79,0.4); color: var(--accent-red); }

.tu-list { display: flex; flex-direction: column; gap: 8px; max-width: 760px; }
.tu-row { display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 12px; width: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; cursor: pointer; color: var(--text); text-align: left; }
.tu-row:hover { border-color: var(--accent-red); }
.tu-row-icon { display: flex; align-items: center; }
.tu-muted { color: var(--text-muted); }
.tu-row-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tu-row-title { font-size: 14px; font-weight: 600; }
.tu-row-meta { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-muted); }
.tu-row-meta span { display: inline-flex; align-items: center; gap: 3px; }
.tu-tag { color: var(--text); font-weight: 700; }
.tu-row-side { display: flex; align-items: center; gap: 8px; }
.tu-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 0; color: var(--text-muted); }

.tu-reader { max-width: 820px; }
.tu-reader-head { margin-bottom: 14px; }
.tu-reader-kicker { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent-red); margin-bottom: 6px; }
.tu-reader-meta { display: flex; gap: 14px; font-size: 12px; color: var(--text-muted); }
.tu-reader-meta span { display: inline-flex; align-items: center; gap: 4px; }
.tu-progress { height: 4px; border-radius: 999px; background: var(--panel-2); overflow: hidden; margin-bottom: 18px; }
.tu-progress-fill { height: 100%; background: var(--accent-red); border-radius: 999px; transition: width 0.1s linear; }
.tu-reader-body { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 24px; max-height: 640px; overflow-y: auto; }
.tu-section { margin-bottom: 26px; }
.tu-section-h { display: flex; align-items: center; gap: 10px; font-size: 16px; margin: 0 0 10px; }
.tu-section-num { width: 22px; height: 22px; border-radius: 6px; background: rgba(255,68,79,0.12); color: var(--accent-red); font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tu-section-p { margin: 0 0 12px; font-size: 14px; line-height: 1.75; color: var(--text); }
.tu-steps { margin: 0 0 12px; padding-left: 22px; display: flex; flex-direction: column; gap: 8px; }
.tu-steps li { font-size: 14px; line-height: 1.6; }
.tu-end { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text-muted); padding-top: 8px; border-top: 1px solid var(--border); }
.tu-actions { display: flex; gap: 10px; margin-top: 16px; }
.tu-actions button { display: inline-flex; align-items: center; gap: 6px; }

@media (max-width: 600px) {
  .tu-search { max-width: 100%; }
  .tu-row { grid-template-columns: 24px 1fr auto; gap: 8px; padding: 12px; }
  .tu-row-meta { flex-wrap: wrap; }
  .tu-reader-body { padding: 16px; }
  .tu-reader-meta { flex-wrap: wrap; gap: 8px 14px; }
  .tu-actions { flex-wrap: wrap; }
}
`;

const _injectTu = () => {
  if (typeof document === 'undefined' || document.getElementById('tu-css')) return;
  const style = document.createElement('style');
  style.id = 'tu-css';
  style.textContent = TU_CSS;
  document.head.appendChild(style);
};
_injectTu();
