import { useEffect, useRef, useState } from 'react';
import {
  Activity, RefreshCw, Radio, AlertTriangle, TrendingUp, TrendingDown,
} from 'lucide-react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle } from 'lightweight-charts';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

const GRANULARITIES = [
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 900, label: '15m' },
  { value: 3600, label: '1h' },
  { value: 86400, label: '1d' },
];

const MAX_CANDLES = 400;

const MARKET_LABELS = {
  synthetic_index: 'Synthetic Indices',
  forex: 'Forex',
  cryptocurrency: 'Crypto',
  commodities: 'Commodities',
};

export default function TradingViewTab({ theme }) {
  const [symbols, setSymbols] = useState([]);
  const [symbolsError, setSymbolsError] = useState(null);
  const [symbol, setSymbol] = useState(null);
  const [granularity, setGranularity] = useState(60);
  const [candles, setCandles] = useState([]);
  const [candlesLoading, setCandlesLoading] = useState(true);
  const [candlesError, setCandlesError] = useState(null);
  const [lastTick, setLastTick] = useState(null);
  const [ticks, setTicks] = useState([]);
  const [tickCount, setTickCount] = useState(0);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [marketStatus, setMarketStatus] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const granRef = useRef(granularity);
  granRef.current = granularity;

  // --- symbol catalog ---
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

  // --- pick default symbol once catalog is loaded ---
  useEffect(() => {
    if (symbol || symbols.length === 0) return;
    const preferred = symbols.find((s) => s.symbol === 'R_100') || symbols[0];
    setSymbol(preferred.symbol);
  }, [symbols, symbol]);

  const activeSymbol = symbols.find((s) => s.symbol === symbol) || null;

  // --- candle history ---
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setCandlesLoading(true);
    setCandlesError(null);
    setLastTick(null);
    setTickCount(0);
    setTicks([]);

    fetch(`${API_BASE}/api/candles?symbol=${encodeURIComponent(symbol)}&granularity=${granularity}&count=${MAX_CANDLES}`)
      .then((r) => { if (!r.ok) throw new Error(`Candle request failed (${r.status})`); return r.json(); })
      .then((data) => { if (!cancelled) setCandles(data.candles || []); })
      .catch((e) => { if (!cancelled) setCandlesError(e.message); })
      .finally(() => { if (!cancelled) setCandlesLoading(false); });

    return () => { cancelled = true; };
  }, [symbol, granularity, refreshKey]);

  // --- live tick WebSocket (reconnects with backoff) ---
  useEffect(() => {
    if (!symbol) return;
    let ws = null;
    let closed = false;
    let retry = 0;
    let retryTimer = null;

    const applyTick = (tick) => {
      const gran = granRef.current;
      const { epoch, quote } = tick;
      if (typeof quote !== 'number') return;

      const bucketEndSec = (Math.floor(epoch / gran) + 1) * gran;
      const bucketMs = bucketEndSec * 1000;

      setCandles((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (bucketMs > last.t) {
          const next = [...prev, { t: bucketMs, o: quote, h: quote, l: quote, c: quote, v: 1 }];
          return next.length > MAX_CANDLES ? next.slice(next.length - MAX_CANDLES) : next;
        }
        if (bucketMs < last.t) return prev;
        const updated = { ...last, h: Math.max(last.h, quote), l: Math.min(last.l, quote), c: quote, v: last.v + 1 };
        return [...prev.slice(0, -1), updated];
      });

      setLastTick(tick);
      setTickCount((n) => n + 1);
      setTicks((prev) => {
        const row = { epoch, quote };
        if (prev.length && prev[prev.length - 1].quote === quote && prev[prev.length - 1].epoch - epoch < 2) {
          return prev;
        }
        return [...prev.slice(-19), row];
      });
    };

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
          if (msg.msg_type === 'tick' && msg.tick) applyTick(msg.tick);
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

  const decimals = activeSymbol?.decimals ?? 2;
  const lastClose = candles.length ? candles[candles.length - 1].c : null;
  const firstOpen = candles.length ? candles[0].o : null;
  const change = lastClose != null && firstOpen != null ? lastClose - firstOpen : null;
  const changePct = change != null && firstOpen ? (change / firstOpen) * 100 : null;
  const high = candles.reduce((m, c) => Math.max(m, c.h), -Infinity);
  const low = candles.reduce((m, c) => Math.min(m, c.l), Infinity);

  const fmt = (n) => (n == null ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  const statusLabel = wsStatus === 'live' ? 'Live' : wsStatus === 'connecting' ? 'Connecting' : 'Offline';
  const statusClass = wsStatus === 'live' ? 'tv-live' : wsStatus === 'connecting' ? 'tv-connecting' : 'tv-offline';

  const marketNotice = marketStatus
    ? (marketStatus.marketClosed
      ? `Market is closed for ${marketStatus.symbol}.`
      : marketStatus.unavailable
        ? `${marketStatus.symbol} is not available on this account/app (${marketStatus.code}).`
        : (marketStatus.message || marketStatus.code))
    : null;

  return (
    <div className="section">
      <h2 className="section-title">Trading View</h2>
      <p className="section-sub">Live candlesticks streamed from the Deriv WebSocket API for the symbol you select.</p>

      {symbolsError && (
        <div className="tv-banner tv-banner-error">
          <AlertTriangle size={14} />
          <span>Could not load the symbol list — is the backend running? ({symbolsError})</span>
        </div>
      )}

      <div className="tv-toolbar">
        <select
          className="select tv-symbol-select"
          value={symbol || ''}
          onChange={(e) => setSymbol(e.target.value)}
          disabled={symbols.length === 0}
        >
          {symbol === null && <option value="">Select a symbol…</option>}
          {Object.entries(
            symbols.reduce((groups, s) => {
              const key = s.market || 'other';
              (groups[key] = groups[key] || []).push(s);
              return groups;
            }, {})
          ).map(([market, list]) => (
            <optgroup key={market} label={MARKET_LABELS[market] || market}>
              {list.map((s) => (
                <option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        <div className="tv-gran">
          {GRANULARITIES.map((g) => (
            <button
              key={g.value}
              className={`tv-gran-btn ${granularity === g.value ? 'tv-gran-active' : ''}`}
              onClick={() => setGranularity(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <span className={`tv-status ${statusClass}`}>
          <Radio size={13} /> {statusLabel}
        </span>

        <button
          className="btn-outline btn-small tv-refresh"
          title="Refresh candles"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={!symbol}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="tv-grid">
        <div className="tv-main">
          <div className="tv-stats">
            <div className="tv-stat">
              <div className="tv-stat-label">Last</div>
              <div className="tv-stat-value tv-last-price">{fmt(lastTick?.quote ?? lastClose)}</div>
            </div>
            <div className="tv-stat">
              <div className="tv-stat-label">Change (session)</div>
              <div className={`tv-stat-value ${change >= 0 ? 'roi-up' : 'roi-down'}`}>
                {change == null ? '—' : `${change >= 0 ? '+' : ''}${fmt(change)} (${changePct >= 0 ? '+' : ''}${changePct?.toFixed(2)}%)`}
              </div>
            </div>
            <div className="tv-stat">
              <div className="tv-stat-label">High</div>
              <div className="tv-stat-value">{fmt(high)}</div>
            </div>
            <div className="tv-stat">
              <div className="tv-stat-label">Low</div>
              <div className="tv-stat-value">{fmt(low)}</div>
            </div>
            <div className="tv-stat">
              <div className="tv-stat-label">Ticks received</div>
              <div className="tv-stat-value">{tickCount}</div>
            </div>
          </div>

          <div className="tv-chart-card">
            {marketNotice && (
              <div className="tv-banner tv-banner-error" style={{ margin: 12 }}>
                <AlertTriangle size={14} />
                <span>{marketNotice}</span>
              </div>
            )}
            {candlesLoading && candles.length === 0 && (
              <div className="tv-empty">Loading candles…</div>
            )}
            {candlesError && (
              <div className="tv-banner tv-banner-error" style={{ margin: 12 }}>
                <AlertTriangle size={14} />
                <span>Candle request failed — the symbol may not be available on this account. ({candlesError})</span>
              </div>
            )}
            <CandleChart
              candles={candles}
              granularity={granularity}
              decimals={decimals}
              theme={theme}
            />
          </div>
        </div>

        <aside className="tv-panel">
          <div className="tv-panel-title">Tick stream <span className={statusClass}>●</span></div>
          {ticks.length === 0 ? (
            <div className="tv-empty tv-empty-small">
              <Activity size={18} />
              <span>{wsStatus === 'live' ? 'Waiting for ticks…' : 'Connect to see live ticks.'}</span>
            </div>
          ) : (
            <div className="tv-tick-list">
              {[...ticks].reverse().map((t, i) => {
                const delta = i === 0 && ticks.length > 1 ? t.quote - ticks[ticks.length - 2].quote : 0;
                return (
                  <div className="tv-tick-row" key={`${t.epoch}-${i}`}>
                    <span className={delta >= 0 ? 'roi-up' : 'roi-down'}>
                      {delta > 0 ? <TrendingUp size={12} /> : delta < 0 ? <TrendingDown size={12} /> : <span className="tv-flat-dot" />}
                    </span>
                    <span className="tv-tick-price">{fmt(t.quote)}</span>
                    <span className="tv-tick-time">{new Date(t.epoch * 1000).toLocaleTimeString(undefined, { hour12: false })}</span>
                  </div>
                );
              })}
            </div>
          )}

          {activeSymbol && (
            <div className="tv-info">
              <div className="tv-info-name">{activeSymbol.name}</div>
              <div className="tv-info-row"><span>Symbol</span><span>{activeSymbol.symbol}</span></div>
              <div className="tv-info-row"><span>Market</span><span>{MARKET_LABELS[activeSymbol.market] || activeSymbol.market}</span></div>
              <div className="tv-info-row"><span>Price decimals</span><span>{activeSymbol.decimals ?? '—'}</span></div>
              <div className="tv-info-row"><span>Pip size</span><span>{activeSymbol.pipSize ?? '—'}</span></div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Candlestick chart using TradingView's lightweight-charts (same library
// Deriv's platform uses). Handles full reloads (symbol/granularity) and
// incremental live updates from the tick stream without rebuilding.
// ---------------------------------------------------------------------

function CandleChart({ candles, granularity, decimals, theme }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const volumeRef = useRef(null);
  const appliedRef = useRef(null); // { firstT, count, gran } of last applied data
  const [legend, setLegend] = useState(null);

  const systemLight = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const isLight = theme === 'light' || (theme === 'system' && systemLight);
  const colors = isLight
    ? { bg: '#ffffff', text: '#5c6672', grid: '#eef0f3', border: '#dfe3e8', crosshair: 'rgba(22,24,29,0.25)', labelBg: '#eef0f3' }
    : { bg: '#14181d', text: '#8b93a1', grid: '#1d2229', border: '#23282f', crosshair: 'rgba(242,243,245,0.3)', labelBg: '#23282f' };

  const toTime = (tMs) => {
    // lightweight-charts: business day for daily+, UTCTimestamp (seconds) intraday
    if (granularity >= 86400) {
      const d = new Date(tMs);
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    }
    return Math.floor(tMs / 1000);
  };

  // Create the chart once.
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
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      timeScale: {
        timeVisible: granularity < 86400,
        secondsVisible: false,
        borderColor: colors.border,
        rightOffset: 3,
      },
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

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) { setLegend(null); return; }
      const d = param.seriesData.get(series);
      if (d) setLegend({ ...d, time: param.time });
    });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeRef.current = volume;
    appliedRef.current = null;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      appliedRef.current = null;
    };
  }, [colors.bg, colors.text, colors.grid, colors.border, colors.crosshair, colors.labelBg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update scale/format options when granularity or decimals change.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    chart.applyOptions({ timeScale: { timeVisible: granularity < 86400 } });
    series.applyOptions({ priceFormat: { type: 'price', precision: decimals, minMove: 1 / Math.pow(10, decimals) } });
  }, [granularity, decimals]);

  // Feed data: full reload on new history, incremental update for live ticks.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const volume = volumeRef.current;
    if (!chart || !series || !volume || candles.length === 0) return;

    const toBar = (c) => ({ time: toTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c });
    const toVol = (c) => ({
      time: toTime(c.t),
      value: c.v || 0,
      color: c.c >= c.o ? 'rgba(0,208,160,0.35)' : 'rgba(255,68,79,0.35)',
    });

    const applied = appliedRef.current;
    const firstT = candles[0].t;
    const last = candles[candles.length - 1];
    const needsReload = !applied
      || applied.gran !== granularity
      || applied.firstT !== firstT
      || applied.count !== candles.length;

    if (needsReload) {
      series.setData(candles.map(toBar));
      volume.setData(candles.map(toVol));
      chart.timeScale().scrollToRealTime();
    } else {
      series.update(toBar(last));
      volume.update(toVol(last));
    }

    appliedRef.current = { firstT, count: candles.length, gran: granularity };
  }, [candles, granularity]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tv-canvas-wrap" ref={containerRef}>
      {legend && (
        <div className="tv-legend">
          <span className={`tv-legend-c ${legend.close >= legend.open ? 'roi-up' : 'roi-down'}`}>
            O {Number(legend.open).toFixed(decimals)} H {Number(legend.high).toFixed(decimals)} L {Number(legend.low).toFixed(decimals)} C {Number(legend.close).toFixed(decimals)}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Component styles
// ---------------------------------------------------------------------

const TV_CSS = `
.tv-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.tv-symbol-select { width: 320px; max-width: 100%; }
.tv-gran { display: flex; gap: 4px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 3px; flex-wrap: wrap; }
.tv-gran-btn { background: transparent; border: none; color: var(--text-muted); padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
.tv-gran-active { background: var(--panel-2); color: var(--text); }
.tv-status { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; padding: 5px 10px; border-radius: 999px; }
.tv-live { color: var(--accent-teal); background: rgba(0,208,160,0.1); }
.tv-connecting { color: #ffb224; background: rgba(255,178,36,0.1); }
.tv-offline { color: var(--accent-red); background: rgba(255,68,79,0.1); }
.tv-refresh { margin-left: auto; }

.tv-grid { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; }
.tv-main { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.tv-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.tv-stat { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
.tv-stat-label { font-size: 11px; color: var(--text-muted); font-weight: 600; margin-bottom: 4px; }
.tv-stat-value { font-size: 15px; font-weight: 700; }
.tv-last-price { color: var(--accent-teal); }

.tv-chart-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 10px; min-height: 420px; position: relative; }
.tv-canvas-wrap { width: 100%; height: 420px; position: relative; }
.tv-legend { position: absolute; top: 8px; left: 8px; z-index: 5; background: rgba(11,14,17,0.85); border: 1px solid var(--border); border-radius: 6px; padding: 5px 9px; font-size: 11px; font-family: 'SFMono-Regular', Consolas, monospace; pointer-events: none; }
.tv-legend-c { font-weight: 700; }
.tv-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; height: 100%; min-height: 200px; color: var(--text-muted); font-size: 13px; }
.tv-empty-small { min-height: 120px; }
.tv-banner { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 10px 12px; border-radius: 8px; }
.tv-banner-error { background: rgba(255,68,79,0.1); color: #ff9aa0; }

.tv-panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 12px; min-height: 420px; }
.tv-panel-title { font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; display: flex; align-items: center; justify-content: space-between; }
.tv-tick-list { display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow-y: auto; }
.tv-tick-row { display: grid; grid-template-columns: 20px 1fr auto; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 6px; font-size: 12px; }
.tv-tick-row:hover { background: var(--panel-2); }
.tv-tick-price { font-weight: 700; font-family: 'SFMono-Regular', Consolas, monospace; }
.tv-tick-time { color: var(--text-muted); font-size: 11px; }
.tv-flat-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); }
.tv-info { border-top: 1px solid var(--border); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.tv-info-name { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
.tv-info-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); }
.tv-info-row span:last-child { color: var(--text); font-weight: 600; }

@media (max-width: 1100px) { .tv-grid { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .tv-stats { grid-template-columns: repeat(2, 1fr); } .tv-canvas-wrap { height: 320px; } }
@media (max-width: 480px) { .tv-stats { grid-template-columns: repeat(2, 1fr); } .tv-canvas-wrap { height: 260px; } .tv-symbol-select { width: 100%; } .tv-toolbar { gap: 8px; } .tv-refresh { margin-left: 0; } }
`;

const _inject = () => {
  if (typeof document === 'undefined' || document.getElementById('tv-css')) return;
  const style = document.createElement('style');
  style.id = 'tv-css';
  style.textContent = TV_CSS;
  document.head.appendChild(style);
};
_inject();
