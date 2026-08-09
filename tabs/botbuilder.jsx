import { useEffect, useRef, useState } from 'react';
import {
  Play, Square, Repeat, RotateCcw, Coffee, Filter, Download, Upload, Share2,
  Trash2, ArrowUp, ArrowDown, Copy, GripVertical, AlertTriangle, CheckCircle2,
  Radio, TrendingUp, TrendingDown, Zap, GripVertical as Grip, X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const uid = () => Math.random().toString(36).slice(2, 10);

const MARKET_LABELS = {
  synthetic_index: 'Synthetic Indices',
  forex: 'Forex',
  cryptocurrency: 'Crypto',
  commodities: 'Commodities',
};

const CONTRACT_TYPES = ['RISE', 'FALL', 'CALL', 'PUT', 'ASIAU', 'ASIAD'];
const CONTRACT_LABELS = { RISE: 'Rise', FALL: 'Fall', CALL: 'Call', PUT: 'Put', ASIAU: 'Asia Up', ASIAD: 'Asia Down' };
const UNIT_LABELS = { t: 'ticks', s: 'sec', m: 'min', h: 'hrs', d: 'days' };
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };

const CONDITION_TYPES = [
  { id: 'always', label: 'Always (no filter)' },
  { id: 'price_above', label: 'Spot is above' },
  { id: 'price_below', label: 'Spot is below' },
  { id: 'last_digit', label: 'Last digit equals' },
];

const BLOCK_DEFS = {
  start: { category: 'market', label: 'Start', color: '#4c6ef5', icon: Play, default: {} },
  buy: { category: 'trade', label: 'Buy Contract', color: '#00d0a0', icon: TrendingUp, default: { symbol: 'R_75', market: 'synthetic_index', contract_type: 'RISE', amount: 1, duration: 5, duration_unit: 't' } },
  condition: { category: 'logic', label: 'Purchase Condition', color: '#ffb224', icon: Filter, default: { type: 'always', value: 0 } },
  trade_again: { category: 'market', label: 'Trade Again', color: '#4c6ef5', icon: Repeat, default: { when: 'both' } },
  repeat: { category: 'logic', label: 'Repeat', color: '#c084fc', icon: RotateCcw, default: { times: 5 } },
  take_break: { category: 'market', label: 'Take a Break', color: '#ff9f43', icon: Coffee, default: { seconds: 10 } },
  stop: { category: 'market', label: 'Stop', color: '#ff444f', icon: Square, default: {} },
};

const CATEGORIES = [
  { id: 'trade', label: 'Trade' },
  { id: 'logic', label: 'Logic' },
  { id: 'market', label: 'Market' },
];

const defaultBlocks = () => [
  { id: uid(), type: 'start', settings: {} },
  { id: uid(), type: 'buy', settings: { ...BLOCK_DEFS.buy.default } },
  { id: uid(), type: 'trade_again', settings: { when: 'both' } },
];

function normalizeBlocks(blocks) {
  const clean = (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b && BLOCK_DEFS[b.type])
    .map((b) => ({ id: uid(), type: b.type, settings: { ...BLOCK_DEFS[b.type].default, ...(b.settings || {}) } }));
  const hasStart = clean.some((b) => b.type === 'start');
  return [hasStart ? clean.find((b) => b.type === 'start') : { id: uid(), type: 'start', settings: {} },
    ...clean.filter((b) => b.type !== 'start')];
}

function marketFromSymbol(symbol) {
  if (/^(R_\d+|1HZ\d*V|VRTC|BOOM|CRASH|Step|STP|RDB|jump)/.test(symbol)) return 'synthetic_index';
  if (/^XAU|^XAG/.test(symbol)) return 'commodities';
  if (/^(BTC|ETH|LTC|SOL|ADA|DOT|MATIC)USD/.test(symbol)) return 'cryptocurrency';
  return 'forex';
}

const UNIT_MAP = { t: 't', tick: 't', ticks: 't', s: 's', sec: 's', second: 's', m: 'm', min: 'm', minute: 'm', h: 'h', hr: 'h', hour: 'h', d: 'd', day: 'd', days: 'd' };

const LABEL_MAP = {
  rise: 'RISE', higher: 'RISE', call: 'CALL', fall: 'FALL', lower: 'FALL', put: 'PUT',
  'asia up': 'ASIAU', 'asia down': 'ASIAD',
};

// --- Best-effort import of a Deriv DBot .xml strategy file ---
function importXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid XML file');
  const blocks = [];
  const deepNode = (el, name) => {
    const all = el.querySelectorAll(`node[name="${name}"]`);
    if (all.length === 0) return null;
    return all[all.length - 1].textContent.trim();
  };
  const blockEls = Array.from(doc.getElementsByTagName('block'));
  for (const el of blockEls) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const isPurchase = type.includes('purchase') || type.includes('trade_definition') || type.includes('buy_contract') || type.includes('contract_spec');
    if (isPurchase) {
      const symbol = deepNode(el, 'symbol') || deepNode(el, 'symbol_value') || 'R_75';
      let ctRaw = deepNode(el, 'contract_type') || deepNode(el, 'purchase_choice') || deepNode(el, 'choice') || '';
      let ct = ctRaw.toUpperCase();
      if (!CONTRACT_TYPES.includes(ct)) ct = LABEL_MAP[ctRaw.trim().toLowerCase()] || 'RISE';
      const amount = Number(deepNode(el, 'amount') || deepNode(el, 'purchase_amount')) || 1;
      const durVal = Number(deepNode(el, 'duration_value') || deepNode(el, 'duration')) || 5;
      const durRaw = (deepNode(el, 'duration_type') || deepNode(el, 'duration_unit') || 't').toLowerCase();
      const durUnit = UNIT_MAP[durRaw] || 't';
      blocks.push({ id: uid(), type: 'buy', settings: { symbol, market: marketFromSymbol(symbol), contract_type: ct, amount, duration: durVal, duration_unit: durUnit } });
    } else if (type.includes('trade_again') || type.includes('restart')) {
      blocks.push({ id: uid(), type: 'trade_again', settings: { when: 'both' } });
    } else if (type.includes('take_break') || type.includes('pause')) {
      const secs = Number(deepNode(el, 'duration_value') || deepNode(el, 'duration')) || 10;
      blocks.push({ id: uid(), type: 'take_break', settings: { seconds: secs } });
    } else if (type === 'stop' || type.includes('stop')) {
      blocks.push({ id: uid(), type: 'stop', settings: {} });
    }
  }
  return blocks;
}

export default function BotBuilderTab({ sessionId, accounts, selectedAccount, setSelectedAccount, currency, balance, onBalanceUpdate, onTradeSettled, onRequireAuth, initialXml, onActivity }) {
  const [blocks, setBlocks] = useState(defaultBlocks);
  const [selectedId, setSelectedId] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);

  const [symbols, setSymbols] = useState([]);
  const [symbolsError, setSymbolsError] = useState(null);
  const [contractTypes, setContractTypes] = useState([]);

  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ runs: 0, won: 0, lost: 0, totalStake: 0, totalPayout: 0, profitLoss: 0 });

  const fileRef = useRef(null);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const blocksRef = useRef(blocks);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  const loadedXmlRef = useRef(null);
  useEffect(() => {
    if (initialXml && initialXml !== loadedXmlRef.current) {
      loadedXmlRef.current = initialXml;
      importStrategy(initialXml, 'shared bot');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialXml]);

  const selected = blocks.find((b) => b.id === selectedId) || null;

  // --- symbol catalog ---
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/symbols`)
      .then((r) => { if (!r.ok) throw new Error(`Symbols request failed (${r.status})`); return r.json(); })
      .then((data) => { if (!cancelled) setSymbols(data.symbols || []); })
      .catch((e) => { if (!cancelled) setSymbolsError(e.message); });
    return () => { cancelled = true; };
  }, []);

  // --- contract types for the selected symbol (login required) ---
  useEffect(() => {
    if (!sessionId || !selectedAccount) { setContractTypes([]); return; }
    const buy = blocksRef.current.find((b) => b.type === 'buy');
    if (!buy) return;
    const symbol = buy.settings.symbol;
    if (!symbol) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/contracts_for?session=${encodeURIComponent(sessionId)}&account=${encodeURIComponent(selectedAccount)}&symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('contracts_for failed'))))
      .then((data) => {
        if (cancelled) return;
        const avail = (data.contracts_for && data.contracts_for.available) || [];
        const supported = avail
          .filter((a) => CONTRACT_TYPES.includes(a.contract_type))
          .map((a) => ({ type: a.contract_type, units: (a.duration_units || []).filter((u) => UNIT_LABELS[u]), min: a.duration_min ?? 1, max: a.duration_max ?? 9999 }));
        setContractTypes(supported);
      })
      .catch(() => { if (!cancelled) setContractTypes([]); });
    return () => { cancelled = true; };
  }, [sessionId, selectedAccount, selectedId]);

  // --- helpers ---
  const addLog = (type, msg) => setLogs((prev) => [...prev.slice(-200), { type, msg, at: new Date().toLocaleTimeString() }]);
  const sleep = (ms) => new Promise((resolve) => {
    const started = Date.now();
    const t = setInterval(() => {
      if (stopRef.current || Date.now() - started >= ms) { clearInterval(t); resolve(); }
    }, 200);
  });
  const api = async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };
  const fetchBalance = async () => {
    const d = await api(`/api/balance?session=${sessionId}&account=${selectedAccount}`);
    return Number(d.balance);
  };
  const fetchSpot = async (symbol) => {
    const d = await api(`/api/candles?symbol=${encodeURIComponent(symbol)}&granularity=60&count=1`);
    const c = d.candles && d.candles[0];
    return c ? c.c : null;
  };

  const updateBlock = (id, settings) => setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, settings: { ...b.settings, ...settings } } : b)));
  const removeBlock = (id) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  };
  const duplicateBlock = (id) => {
    const src = blocks.find((b) => b.id === id);
    if (!src || src.type === 'start') return;
    const idx = blocks.indexOf(src);
    setBlocks((prev) => [...prev.slice(0, idx + 1), { ...src, id: uid() }, ...prev.slice(idx + 1)]);
  };
  const addBlock = (type) => {
    const stopIdx = blocks.findIndex((b) => b.type === 'stop');
    const block = { id: uid(), type, settings: { ...BLOCK_DEFS[type].default } };
    setBlocks((prev) => {
      const si = prev.findIndex((b) => b.type === 'stop');
      const at = si >= 0 ? si : prev.length;
      return [...prev.slice(0, at), block, ...prev.slice(at)];
    });
    setSelectedId(block.id);
  };
  const moveBlock = (from, to) => {
    if (from === to || from < 1 || to < 1) return;
    setBlocks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const reorder = (from, to) => {
    if (from === to || from < 1 || to < 1) return;
    setBlocks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      const toIdx = to > from ? to - 1 : to;
      next.splice(toIdx >= 1 ? toIdx : 1, 0, moved);
      return next;
    });
  };

  // --- import / export ---
  const exportBot = () => {
    const payload = { app: 'pronofxdbot', version: 1, blocks: blocks.map((b) => ({ type: b.type, settings: b.settings })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pulse-trader-bot.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importStrategy = (text, label) => {
    try {
      let imported = null;
      if (text.trim().startsWith('{')) {
        const parsed = JSON.parse(text);
        imported = normalizeBlocks(parsed.blocks || (Array.isArray(parsed) ? parsed : []));
      } else {
        imported = normalizeBlocks(importXml(text));
      }
      if (imported.length <= 1) throw new Error('No supported blocks found in this file');
      setBlocks(imported);
      setSelectedId(null);
      addLog('success', `Loaded ${imported.length - 1} block${imported.length - 1 === 1 ? '' : 's'}${label ? ` — ${label}` : ''}`);
    } catch (err) {
      addLog('error', `Import failed: ${err.message}`);
    }
  };

  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importStrategy(String(reader.result || ''), file.name);
    reader.readAsText(file);
    e.target.value = '';
  };

  const shareBot = async () => {
    if (!sessionId || !selectedAccount) { if (onRequireAuth) onRequireAuth(); return; }
    const payload = { app: 'pronofxdbot', version: 1, blocks: blocksRef.current.map((b) => ({ type: b.type, settings: b.settings })) };
    try {
      const res = await fetch(`${API_BASE}/api/bots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: sessionId, account: selectedAccount, name: 'Shared bot', description: 'Shared from the Bot Builder', xml: JSON.stringify(payload), kind: 'shared' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Share failed');
      addLog('success', 'Strategy shared to the community.');
    } catch (err) {
      addLog('error', `Share failed: ${err.message}`);
    }
  };

  // --- run engine ---
  const buyAndWait = async (buy) => {
    const { symbol, contract_type, amount, duration, duration_unit } = buy.settings;
    addLog('info', `Buying ${CONTRACT_LABELS[contract_type] || contract_type} ${symbol} — ${amount} ${currency}, ${duration} ${UNIT_LABELS[duration_unit] || ''}`);
    const bal0 = await fetchBalance();
    const proposalRes = await api('/api/contract/proposal', {
      session: sessionId, account: selectedAccount, symbol,
      contract_type, amount, basis: 'stake', duration, duration_unit, currency,
    });
    const proposal = proposalRes.proposal;
    if (!proposal || !proposal.id) throw new Error('No valid price quote returned');
    addLog('info', `Quote: ${proposal.ask_price} ${currency}`);
    const bought = await api('/api/contract/buy', {
      session: sessionId, account: selectedAccount, proposal_id: proposal.id, price: proposal.ask_price,
    });
    const buyRes = bought.buy;
    addLog('success', `Contract ${buyRes.contract_id} opened.`);
    onBalanceUpdate ? null : null;
    refreshBalance();
    const seconds = (UNIT_SECONDS[duration_unit] || 60) * duration;
    const deadline = Date.now() + Math.min(Math.max(seconds * 2000, 20000), 300000);
    while (!stopRef.current) {
      await sleep(1000);
      const open = await api(`/api/contract/open?session=${sessionId}&account=${selectedAccount}`);
      const stillOpen = (open.contracts || []).some((c) => c.contract_id === buyRes.contract_id);
      if (!stillOpen) break;
      if (Date.now() > deadline) { addLog('warn', 'Timed out waiting for settlement.'); stopRef.current = true; }
    }
    if (stopRef.current) return null;
    const bal1 = await fetchBalance();
    const profit = Math.round((bal1 - bal0 + Number.EPSILON) * 100) / 100;
    const won = profit > 0;
    addLog(won ? 'success' : 'error', `Settled — ${won ? 'WIN' : 'LOSS'} ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${currency}`);
    return { won, profit, trade: { id: buyRes.contract_id, symbol, direction: contract_type, stake: amount, profit, won, ts: Date.now() } };
  };

  const refreshBalance = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/balance?session=${sessionId}&account=${selectedAccount}`);
      if (res.ok) onBalanceUpdate(await res.json());
    } catch { /* keep last known */ }
  };

  const runBot = async () => {
    if (runningRef.current) return;
    if (!sessionId || !selectedAccount) { if (onRequireAuth) onRequireAuth(); return; }
    const strategy = blocksRef.current;
    const buys = strategy.filter((b) => b.type === 'buy');
    if (buys.length === 0) { addLog('error', 'Add a Buy Contract block first.'); return; }

    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setLogs([]);
    setStats({ runs: 0, won: 0, lost: 0, totalStake: 0, totalPayout: 0, profitLoss: 0 });
    addLog('info', 'Bot started.');
    if (onActivity) onActivity('bot_run', { blocks: buys.length });
    try {
      const repeat = strategy.find((b) => b.type === 'repeat');
      const tradeAgain = strategy.find((b) => b.type === 'trade_again');
      const stopBlock = strategy.find((b) => b.type === 'stop');
      const breakBlock = strategy.find((b) => b.type === 'take_break');
      const conditions = strategy.filter((b) => b.type === 'condition');
      const maxPasses = repeat ? (Number(repeat.settings.times) || 1) : (tradeAgain ? Infinity : 1);
      let pass = 0;

      while ((maxPasses === Infinity || pass < maxPasses) && !stopRef.current) {
        pass++;
        addLog('info', `— Cycle ${pass}${maxPasses === Infinity ? '' : ` / ${maxPasses}`} —`);

        for (const cond of conditions) {
          const s = cond.settings;
          if (s.type === 'always') continue;
          const price = await fetchSpot(buys[0].settings.symbol);
          if (price == null) throw new Error('Could not fetch spot price for the purchase condition.');
          let ok = false;
          if (s.type === 'price_above') ok = price > Number(s.value);
          if (s.type === 'price_below') ok = price < Number(s.value);
          if (s.type === 'last_digit') {
            const digits = Number(price).toFixed(2).split('.')[1] || '';
            ok = Number(digits.slice(-1)) === Number(s.value);
          }
          if (!ok) { addLog('error', `Purchase condition not met (spot ${price}). Stopping.`); throw new Error('Condition not met'); }
        }

        const res = await buyAndWait(buys[0]);
        if (!res) break;
        setStats((st) => ({ ...st, runs: st.runs + 1, won: st.won + (res.won ? 1 : 0), lost: st.lost + (res.won ? 0 : 1), totalStake: st.totalStake + res.trade.stake, totalPayout: st.totalPayout + (res.won ? res.trade.stake + res.trade.profit : 0), profitLoss: st.profitLoss + res.trade.profit }));
        if (onTradeSettled) onTradeSettled(res.trade);

        if (tradeAgain) {
          if (tradeAgain.settings.when === 'win' && !res.won) { addLog('info', 'Trade Again set to win only — stopping after loss.'); break; }
          if (tradeAgain.settings.when === 'loss' && res.won) { addLog('info', 'Trade Again set to loss only — stopping after win.'); break; }
        }
        if (breakBlock && !stopRef.current) {
          addLog('info', `Taking a break — ${breakBlock.settings.seconds}s`);
          await sleep(Number(breakBlock.settings.seconds) * 1000);
        }
        if (stopBlock) { addLog('info', 'Stop block reached.'); break; }
      }
      if (stopRef.current) addLog('warn', 'Bot stopped by user.');
      else addLog('success', 'Bot finished.');
    } catch (e) {
      addLog('error', e.message);
    } finally {
      runningRef.current = false;
      setRunning(false);
      refreshBalance();
    }
  };

  const stopBot = () => { stopRef.current = true; };

  const symbolOpts = (() => {
    const groups = {};
    for (const s of symbols) {
      const key = s.market || 'other';
      (groups[key] = groups[key] || []).push(s);
    }
    return groups;
  })();

  return (
    <div className="section bb">
      <div className="bb-head">
        <div>
          <h2 className="section-title">Bot Builder</h2>
          <p className="section-sub">Build a strategy from blocks, import a Deriv DBot strategy, then run it live on your account.</p>
        </div>
        <div className="bb-actions">
          <button className="btn-ghost btn-small" onClick={() => fileRef.current && fileRef.current.click()}><Upload size={13} /> Import</button>
          <input ref={fileRef} type="file" accept=".json,.xml" style={{ display: 'none' }} onChange={handleImportFile} />
          <button className="btn-ghost btn-small" onClick={exportBot}><Download size={13} /> Export</button>
          <button className="btn-ghost btn-small" onClick={shareBot} disabled={!sessionId}><Share2 size={13} /> Share</button>
          {running ? (
            <button className="btn-primary btn-small bb-run-stop" onClick={stopBot}><Square size={13} /> Stop</button>
          ) : (
            <button className="btn-primary btn-small bb-run" onClick={runBot}><Play size={13} /> Run</button>
          )}
        </div>
      </div>

      {!sessionId && (
        <div className="bb-login-hint">
          <AlertTriangle size={14} /> You need to be logged in to run a bot. Build and import work without logging in.
          <button className="btn-primary btn-small" onClick={() => onRequireAuth && onRequireAuth()}>Log in</button>
        </div>
      )}

      <div className="bb-grid">
        {/* Palette */}
        <aside className="bb-palette">
          <div className="bb-palette-title">Blocks</div>
          {CATEGORIES.map((cat) => (
            <div key={cat.id} className="bb-cat">
              <div className="bb-cat-title">{cat.label}</div>
              {Object.entries(BLOCK_DEFS).filter(([, d]) => d.category === cat.id).map(([type, d]) => {
                const Icon = d.icon;
                return (
                  <button key={type} className="bb-pal-item" onClick={() => addBlock(type)}>
                    <Icon size={14} style={{ color: d.color }} /> {d.label}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Canvas */}
        <main className="bb-canvas">
          {blocks.map((b, i) => {
            const d = BLOCK_DEFS[b.type];
            const Icon = d.icon;
            const active = b.id === selectedId;
            return (
              <div
                key={b.id}
                className={`bb-block ${active ? 'bb-block-active' : ''}`}
                draggable={i > 0}
                onDragStart={() => i > 0 && setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); reorder(dragIdx, i); setDragIdx(null); }}
                onClick={() => setSelectedId(b.id)}
              >
                <span className="bb-block-order">{i === 0 ? '' : i}</span>
                {i > 0 && <GripVertical size={14} className="bb-grip" />}
                <Icon size={15} className="bb-block-icon" style={{ color: d.color }} />
                <span className="bb-block-label">{d.label}</span>
                <span className="bb-block-summary">{summary(b)}</span>
                <div className="bb-block-actions" onClick={(e) => e.stopPropagation()}>
                  {i > 0 && <button className="bb-mini" title="Move up" onClick={() => moveBlock(i, i - 1)}><ArrowUp size={12} /></button>}
                  {i > 0 && i < blocks.length - 1 && <button className="bb-mini" title="Move down" onClick={() => moveBlock(i, i + 1)}><ArrowDown size={12} /></button>}
                  {i > 0 && <button className="bb-mini" title="Duplicate" onClick={() => duplicateBlock(b.id)}><Copy size={12} /></button>}
                  {i > 0 && <button className="bb-mini bb-mini-danger" title="Delete" onClick={() => removeBlock(b.id)}><Trash2 size={12} /></button>}
                </div>
              </div>
            );
          })}
          {blocks.length <= 1 && (
            <div className="bb-empty">Click blocks in the palette to add them to your strategy.</div>
          )}
        </main>

        {/* Inspector */}
        <aside className="bb-inspector">
          {selected ? (
            <BlockInspector
              block={selected}
              symbols={symbols}
              symbolOpts={symbolOpts}
              symbolsError={symbolsError}
              contractTypes={contractTypes}
              updateBlock={updateBlock}
            />
          ) : (
            <div className="bb-inspector-empty">Select a block on the canvas to edit its settings.</div>
          )}
        </aside>
      </div>

      {/* Stats + logs */}
      <div className="bb-bottom">
        <div className="bb-stats">
          <div className="bb-stat"><span>Runs</span><b>{stats.runs}</b></div>
          <div className="bb-stat"><span>Won</span><b className="roi-up">{stats.won}</b></div>
          <div className="bb-stat"><span>Lost</span><b className="roi-down">{stats.lost}</b></div>
          <div className="bb-stat"><span>Total stake</span><b>{stats.totalStake.toFixed(2)} {currency}</b></div>
          <div className="bb-stat"><span>P/L</span><b className={stats.profitLoss >= 0 ? 'roi-up' : 'roi-down'}>{stats.profitLoss >= 0 ? '+' : ''}{stats.profitLoss.toFixed(2)} {currency}</b></div>
        </div>
        <div className="bb-log">
          {logs.length === 0 ? (
            <div className="bb-log-empty">Run the bot to see a live log here.</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} className={`bb-log-row bb-log-${l.type}`}>
                {l.type === 'success' ? <CheckCircle2 size={12} /> : l.type === 'error' ? <AlertTriangle size={12} /> : <Zap size={12} />}
                <span className="bb-log-time">{l.at}</span> {l.msg}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bb-hint">
        <Radio size={12} /> Logged in: {sessionId ? 'yes' : 'no'} · Account: {selectedAccount || '—'}
      </div>
    </div>
  );
}

function summary(b) {
  const s = b.settings;
  switch (b.type) {
    case 'buy': return `${s.symbol} · ${CONTRACT_LABELS[s.contract_type] || s.contract_type} · ${s.amount} ${s.duration}${UNIT_LABELS[s.duration_unit] || ''}`;
    case 'condition': {
      const t = CONDITION_TYPES.find((c) => c.id === s.type);
      return t ? `${t.label}${s.type !== 'always' ? ' ' + s.value : ''}` : '';
    }
    case 'trade_again': return `on ${s.when}`;
    case 'repeat': return `${s.times} times`;
    case 'take_break': return `${s.seconds}s`;
    default: return '';
  }
}

function BlockInspector({ block, symbols, symbolOpts, symbolsError, contractTypes, updateBlock }) {
  const s = block.settings;
  const set = (k, v) => updateBlock(block.id, { [k]: v });
  const availableUnits = (contractTypes.find((c) => c.type === s.contract_type)?.units) || ['t', 's', 'm', 'h', 'd'];

  if (block.type === 'buy') {
    return (
      <div className="bb-inspector-body">
        <div className="bb-inspector-title">Buy Contract</div>
        <label className="bb-field"><span>Symbol</span>
          <select className="select" value={s.symbol} onChange={(e) => set('symbol', e.target.value)}>
            {symbols.length === 0 && <option>{symbolsError ? 'Symbols unavailable' : 'Loading symbols…'}</option>}
            {Object.entries(symbolOpts).map(([market, list]) => (
              <optgroup key={market} label={MARKET_LABELS[market] || market}>
                {list.map((sym) => <option key={sym.symbol} value={sym.symbol}>{sym.symbol} — {sym.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="bb-field"><span>Contract type</span>
          <select className="select" value={s.contract_type} onChange={(e) => set('contract_type', e.target.value)}>
            {(contractTypes.length ? contractTypes.map((c) => c.type) : CONTRACT_TYPES).map((ct) => (
              <option key={ct} value={ct}>{CONTRACT_LABELS[ct] || ct}</option>
            ))}
          </select>
        </label>
        <label className="bb-field"><span>Stake ({symbols.find((x) => x.symbol === s.symbol)?.market === 'cryptocurrency' ? 'USD' : 'USD'})</span>
          <input className="bb-input" type="number" min="0.01" step="0.01" value={s.amount} onChange={(e) => set('amount', Number(e.target.value))} />
        </label>
        <div className="bb-row2">
          <label className="bb-field"><span>Duration</span>
            <input className="bb-input" type="number" min="1" value={s.duration} onChange={(e) => set('duration', Number(e.target.value))} />
          </label>
          <label className="bb-field"><span>Unit</span>
            <select className="select" value={s.duration_unit} onChange={(e) => set('duration_unit', e.target.value)}>
              {availableUnits.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
            </select>
          </label>
        </div>
      </div>
    );
  }

  if (block.type === 'condition') {
    return (
      <div className="bb-inspector-body">
        <div className="bb-inspector-title">Purchase Condition</div>
        <label className="bb-field"><span>Condition</span>
          <select className="select" value={s.type} onChange={(e) => set('type', e.target.value)}>
            {CONDITION_TYPES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {s.type !== 'always' && (
          <label className="bb-field"><span>{s.type === 'last_digit' ? 'Digit (0–9)' : 'Value'}</span>
            <input className="bb-input" type="number" value={s.value} onChange={(e) => set('value', Number(e.target.value))} />
          </label>
        )}
      </div>
    );
  }

  if (block.type === 'trade_again') {
    return (
      <div className="bb-inspector-body">
        <div className="bb-inspector-title">Trade Again</div>
        <label className="bb-field"><span>Restart after</span>
          <select className="select" value={s.when} onChange={(e) => set('when', e.target.value)}>
            <option value="both">Win or loss</option>
            <option value="win">Win only</option>
            <option value="loss">Loss only</option>
          </select>
        </label>
      </div>
    );
  }

  if (block.type === 'repeat') {
    return (
      <div className="bb-inspector-body">
        <div className="bb-inspector-title">Repeat</div>
        <label className="bb-field"><span>Number of cycles</span>
          <input className="bb-input" type="number" min="1" value={s.times} onChange={(e) => set('times', Number(e.target.value))} />
        </label>
      </div>
    );
  }

  if (block.type === 'take_break') {
    return (
      <div className="bb-inspector-body">
        <div className="bb-inspector-title">Take a Break</div>
        <label className="bb-field"><span>Seconds</span>
          <input className="bb-input" type="number" min="0" value={s.seconds} onChange={(e) => set('seconds', Number(e.target.value))} />
        </label>
      </div>
    );
  }

  return (
    <div className="bb-inspector-body">
      <div className="bb-inspector-title">{BLOCK_DEFS[block.type].label}</div>
      <p className="bb-inspector-note">This block has no settings.</p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Component styles
// ---------------------------------------------------------------------

const BB_CSS = `
.bb-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.bb-actions { display: flex; gap: 8px; align-items: center; }
.bb-run { background: var(--accent-teal); color: #04211a; }
.bb-run-stop { background: var(--accent-red); }
.bb-login-hint { display: flex; align-items: center; gap: 8px; background: rgba(255,178,36,0.1); color: #ffb224; border-radius: 10px; padding: 10px 12px; font-size: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.bb-login-hint .btn-primary { margin-left: auto; }

.bb-grid { display: grid; grid-template-columns: 200px minmax(0, 1fr) 260px; gap: 14px; align-items: start; }

.bb-palette { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.bb-palette-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
.bb-cat { display: flex; flex-direction: column; gap: 4px; }
.bb-cat-title { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.bb-pal-item { display: flex; align-items: center; gap: 8px; background: var(--panel-2); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 8px 10px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left; }
.bb-pal-item:hover { border-color: var(--accent-red); }

.bb-canvas { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 220px; }
.bb-block { display: flex; align-items: center; gap: 8px; background: var(--panel-2); border: 1px solid var(--border); border-left-width: 3px; border-radius: 10px; padding: 10px 12px; cursor: pointer; }
.bb-block:hover { border-color: var(--accent-indigo); }
.bb-block-active { border-color: var(--accent-red); border-left-color: var(--accent-red); background: rgba(255,68,79,0.06); }
.bb-block-order { width: 18px; font-size: 11px; color: var(--text-muted); font-weight: 700; flex-shrink: 0; text-align: center; }
.bb-grip { color: var(--text-muted); flex-shrink: 0; cursor: grab; }
.bb-block-icon { flex-shrink: 0; }
.bb-block-label { font-size: 13px; font-weight: 700; flex-shrink: 0; }
.bb-block-summary { font-size: 12px; color: var(--text-muted); margin-left: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bb-block-actions { display: flex; gap: 4px; margin-left: auto; opacity: 0.45; }
.bb-block:hover .bb-block-actions { opacity: 1; }
.bb-mini { background: transparent; border: none; color: var(--text-muted); width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.bb-mini:hover { background: var(--panel); color: var(--text); }
.bb-mini-danger:hover { color: var(--accent-red); }
.bb-empty { color: var(--text-muted); font-size: 13px; text-align: center; padding: 40px 10px; }

.bb-inspector { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; min-height: 220px; }
.bb-inspector-empty { color: var(--text-muted); font-size: 12px; text-align: center; padding: 40px 10px; }
.bb-inspector-title { font-size: 14px; font-weight: 800; margin-bottom: 12px; }
.bb-inspector-note { font-size: 12px; color: var(--text-muted); }
.bb-inspector-body { display: flex; flex-direction: column; gap: 12px; }
.bb-field { display: flex; flex-direction: column; gap: 5px; }
.bb-field > span { font-size: 11px; color: var(--text-muted); font-weight: 700; }
.bb-input { padding: 10px; border-radius: 8px; background: var(--panel-2); color: var(--text); border: 1px solid var(--border); font-size: 13px; font-family: inherit; }
.bb-input:focus { outline: none; border-color: var(--accent-red); }
.bb-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.bb-bottom { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; margin-top: 14px; align-items: start; }
.bb-stats { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.bb-stat { display: flex; flex-direction: column; gap: 2px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.bb-stat span { font-size: 10px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.bb-stat b { font-size: 13px; }
.bb-log { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.bb-log-empty { color: var(--text-muted); text-align: center; padding: 30px 10px; }
.bb-log-row { display: flex; align-items: flex-start; gap: 6px; line-height: 1.5; }
.bb-log-row svg { flex-shrink: 0; margin-top: 2px; color: var(--text-muted); }
.bb-log-time { color: var(--text-muted); font-family: 'SFMono-Regular', Consolas, monospace; font-size: 11px; flex-shrink: 0; }
.bb-log-success { color: var(--accent-teal); }
.bb-log-success svg { color: var(--accent-teal); }
.bb-log-error { color: #ff9aa0; }
.bb-log-error svg { color: var(--accent-red); }
.bb-log-info { color: var(--text); }
.bb-log-warn { color: #ffb224; }
.bb-log-warn svg { color: #ffb224; }
.bb-hint { font-size: 11px; color: var(--text-muted); margin-top: 10px; display: flex; align-items: center; gap: 6px; }

@media (max-width: 1100px) {
  .bb-grid { grid-template-columns: 170px minmax(0, 1fr); }
  .bb-inspector { grid-column: 1 / -1; }
  .bb-bottom { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .bb-grid { grid-template-columns: 1fr; }
  .bb-palette { flex-direction: row; flex-wrap: wrap; gap: 6px; padding: 10px; }
  .bb-palette-title, .bb-cat { flex-basis: auto; }
  .bb-cat { flex-direction: row; flex-wrap: wrap; gap: 6px; }
  .bb-cat-title { display: none; }
  .bb-pal-item { padding: 7px 10px; }
  .bb-canvas, .bb-inspector { min-height: 0; }
  .bb-block { flex-wrap: wrap; }
  .bb-block-summary { width: 100%; margin: 0; }
  .bb-actions { width: 100%; }
}
@media (max-width: 480px) {
  .bb-stats { grid-template-columns: 1fr 1fr; }
}
`;

const _injectBb = () => {
  if (typeof document === 'undefined' || document.getElementById('bb-css')) return;
  const style = document.createElement('style');
  style.id = 'bb-css';
  style.textContent = BB_CSS;
  document.head.appendChild(style);
};
_injectBb();
