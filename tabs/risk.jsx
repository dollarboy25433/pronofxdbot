import { useMemo, useState } from 'react';
import {
  Calculator, Percent, Layers, Crosshair, TrendingUp, TrendingDown, Scale, Zap,
} from 'lucide-react';

const CALCS = [
  { id: 'size', label: 'Position size', icon: Layers },
  { id: 'forex', label: 'Forex lots', icon: Scale },
  { id: 'rr', label: 'Risk / reward', icon: Crosshair },
  { id: 'drawdown', label: 'Drawdown', icon: TrendingDown },
  { id: 'compound', label: 'Compound', icon: TrendingUp },
  { id: 'martingale', label: 'Martingale', icon: Zap },
];

const fmt = (n, d = 2) => {
  if (n === undefined || n === null || n === '') return '—';
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return Number(v.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
};

function NumField({ label, value, onChange, min, step, hint }) {
  return (
    <label className="rc-field">
      <span className="rc-field-label">{label}</span>
      <input
        className="select"
        type="number"
        value={value}
        min={min ?? 0}
        step={step ?? 'any'}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="rc-field-hint">{hint}</span>}
    </label>
  );
}

function MethodToggle({ value, onChange }) {
  return (
    <div className="rc-method">
      <button className={value === 'pct' ? 'rc-method-active' : ''} onClick={() => onChange('pct')}><Percent size={13} /> % of balance</button>
      <button className={value === 'fixed' ? 'rc-method-active' : ''} onClick={() => onChange('fixed')}>Fixed amount</button>
    </div>
  );
}

export default function RiskCalculatorTab() {
  const [calc, setCalc] = useState('size');

  return (
    <div className="section">
      <h2 className="section-title">Risk Calculator</h2>
      <p className="section-sub">Real position-sizing and risk math. Every result is computed live from your inputs — no guesses.</p>

      <div className="rc-pills">
        {CALCS.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              className={`rc-pill ${calc === c.id ? 'rc-pill-active' : ''}`}
              onClick={() => setCalc(c.id)}
            >
              <Icon size={14} /> {c.label}
            </button>
          );
        })}
      </div>

      <div className="rc-body">
        {calc === 'size' && <PositionSize />}
        {calc === 'forex' && <ForexLots />}
        {calc === 'rr' && <RiskReward />}
        {calc === 'drawdown' && <DrawdownCalc />}
        {calc === 'compound' && <CompoundCalc />}
        {calc === 'martingale' && <MartingaleCalc />}
      </div>
    </div>
  );
}

function ResultRow({ label, value, tone, strong }) {
  return (
    <div className={`rc-result-row ${tone ? `rc-tone-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Formula({ children }) {
  return <div className="rc-formula">Formula: {children}</div>;
}

// ---- Position size for point-based markets (synthetic / CFD) ----

function PositionSize() {
  const [balance, setBalance] = useState('1000');
  const [method, setMethod] = useState('pct');
  const [riskPct, setRiskPct] = useState('1');
  const [riskFixed, setRiskFixed] = useState('10');
  const [entry, setEntry] = useState('100');
  const [stop, setStop] = useState('96');

  const out = useMemo(() => {
    const bal = parseFloat(balance) || 0;
    const rp = parseFloat(riskPct) || 0;
    const rf = parseFloat(riskFixed) || 0;
    const en = parseFloat(entry);
    const st = parseFloat(stop);
    const riskAmount = method === 'pct' ? (bal * rp) / 100 : rf;
    if (!(en >= 0) || !(st >= 0) || en === st) return null;
    const distance = Math.abs(en - st);
    const units = distance > 0 ? riskAmount / distance : 0;
    return {
      riskAmount, distance, units, positionValue: units * en,
      isLong: en < st, isShort: en > st,
    };
  }, [balance, method, riskPct, riskFixed, entry, stop]);

  return (
    <div className="rc-grid">
      <div className="rc-inputs card">
        <NumField label="Account balance" value={balance} onChange={setBalance} step="0.01" />
        <div className="rc-label">Risk per trade</div>
        <MethodToggle value={method} onChange={setMethod} />
        {method === 'pct' ? (
          <NumField label="Risk %" value={riskPct} onChange={setRiskPct} step="0.1" hint="The 1% rule keeps this at 1–2%." />
        ) : (
          <NumField label="Risk amount" value={riskFixed} onChange={setRiskFixed} step="0.01" />
        )}
        <NumField label="Entry price" value={entry} onChange={setEntry} step="0.01" />
        <NumField label="Stop-loss price" value={stop} onChange={setStop} step="0.01" hint={out ? `You're ${out.isLong ? 'buying (stop below entry)' : 'selling (stop above entry)'}` : ''} />
      </div>

      <div className="rc-outputs card">
        <div className="rc-output-title">Position size</div>
        {out ? (
          <>
            <div className="rc-big">{fmt(out.units)} <span>units</span></div>
            <Formula>units = risk ÷ |entry − stop| = {fmt(out.riskAmount)} ÷ {fmt(out.distance)}</Formula>
            <ResultRow label="Risk amount (max loss)" value={fmt(out.riskAmount)} tone="red" strong />
            <ResultRow label="Risk per unit (1R)" value={fmt(out.distance)} />
            <ResultRow label="Position value" value={fmt(out.positionValue)} />
            <ResultRow label="% of balance at risk" value={`${((out.riskAmount / (balance > 0 ? parseFloat(balance) : 1)) * 100).toFixed(2)}%`} />
          </>
        ) : (
          <div className="rc-na">Enter a valid entry and stop to size the position.</div>
        )}
      </div>
    </div>
  );
}

// ---- Forex lot sizing ----

function ForexLots() {
  const [balance, setBalance] = useState('5000');
  const [method, setMethod] = useState('pct');
  const [riskPct, setRiskPct] = useState('1');
  const [riskFixed, setRiskFixed] = useState('50');
  const [stopPips, setStopPips] = useState('25');
  const [pipValue, setPipValue] = useState('10');

  const out = useMemo(() => {
    const bal = parseFloat(balance) || 0;
    const rp = parseFloat(riskPct) || 0;
    const rf = parseFloat(riskFixed) || 0;
    const pips = parseFloat(stopPips) || 0;
    const pv = parseFloat(pipValue) || 0;
    const riskAmount = method === 'pct' ? (bal * rp) / 100 : rf;
    if (pips <= 0 || pv <= 0) return null;
    const lots = riskAmount / (pv * pips);
    return { riskAmount, lots, actualRisk: lots * pv * pips, marginPips: pips };
  }, [balance, method, riskPct, riskFixed, stopPips, pipValue]);

  return (
    <div className="rc-grid">
      <div className="rc-inputs card">
        <NumField label="Account balance" value={balance} onChange={setBalance} step="0.01" />
        <div className="rc-label">Risk per trade</div>
        <MethodToggle value={method} onChange={setMethod} />
        {method === 'pct' ? (
          <NumField label="Risk %" value={riskPct} onChange={setRiskPct} step="0.1" />
        ) : (
          <NumField label="Risk amount" value={riskFixed} onChange={setRiskFixed} step="0.01" />
        )}
        <NumField label="Stop distance (pips)" value={stopPips} onChange={setStopPips} step="0.1" />
        <NumField label="Pip value per standard lot" value={pipValue} onChange={setPipValue} step="0.01" hint="≈ $10/lot on USD-quoted pairs (EUR/USD, GBP/USD)." />
      </div>

      <div className="rc-outputs card">
        <div className="rc-output-title">Position size (lots)</div>
        {out ? (
          <>
            <div className="rc-big">{fmt(out.lots)} <span>lots</span></div>
            <Formula>lots = risk ÷ (pip value × stop pips) = {fmt(out.riskAmount)} ÷ ({fmt(pipValue)} × {fmt(out.marginPips)})</Formula>
            <ResultRow label="Risk amount (max loss)" value={fmt(out.riskAmount)} tone="red" strong />
            <ResultRow label="Actual risk at this size" value={fmt(out.actualRisk)} />
            <ResultRow label="Risk per pip" value={fmt(out.lots * (parseFloat(pipValue) || 0))} />
            <ResultRow label="% of balance at risk" value={`${((out.riskAmount / (balance > 0 ? parseFloat(balance) : 1)) * 100).toFixed(2)}%`} />
            <p className="rc-note">Round down to the nearest lot increment — rounding up silently exceeds your risk budget.</p>
          </>
        ) : (
          <div className="rc-na">Enter a stop distance and pip value to size the position.</div>
        )}
      </div>
    </div>
  );
}

// ---- Risk / reward ----

function RiskReward() {
  const [entry, setEntry] = useState('100');
  const [stop, setStop] = useState('96');
  const [target, setTarget] = useState('108');
  const [winRate, setWinRate] = useState('45');

  const out = useMemo(() => {
    const en = parseFloat(entry);
    const st = parseFloat(stop);
    const tg = parseFloat(target);
    const wr = parseFloat(winRate) || 0;
    if (!(en >= 0) || !(st >= 0) || !(tg >= 0)) return null;
    const risk = Math.abs(en - st);
    const reward = Math.abs(tg - en);
    if (risk <= 0) return null;
    const rr = reward / risk;
    const breakeven = 1 / (1 + rr);
    const rows = [25, 33, 50, wr].map((w) => ({ w, ev: w / 100 * reward - (1 - w / 100) * risk }));
    return { risk, reward, rr, breakeven, rows };
  }, [entry, stop, target, winRate]);

  return (
    <div className="rc-grid">
      <div className="rc-inputs card">
        <NumField label="Entry price" value={entry} onChange={setEntry} step="0.01" />
        <NumField label="Stop-loss price" value={stop} onChange={setStop} step="0.01" />
        <NumField label="Take-profit price" value={target} onChange={setTarget} step="0.01" />
        <NumField label="Your expected win rate (%)" value={winRate} onChange={setWinRate} step="0.1" />
      </div>

      <div className="rc-outputs card">
        <div className="rc-output-title">Risk / reward profile</div>
        {out ? (
          <>
            <div className="rc-big">{fmt(out.rr, 2)}<span>R : 1</span></div>
            <Formula>R:R = |target − entry| ÷ |entry − stop| = {fmt(out.reward)} ÷ {fmt(out.risk)}</Formula>
            <ResultRow label="Risk per unit (1R)" value={fmt(out.risk)} tone="red" />
            <ResultRow label="Reward per unit" value={fmt(out.reward)} tone="green" />
            <ResultRow label="Breakeven win rate" value={`${(out.breakeven * 100).toFixed(1)}%`} strong />
            <div className="rc-table">
              <div className="rc-table-row rc-table-head"><span>Win rate</span><span>EV per unit</span></div>
              {[...new Map(out.rows.map((r) => [r.w, r])).values()].map((r) => (
                <div className="rc-table-row" key={r.w}>
                  <span>{r.w}%{Math.abs(r.w - (parseFloat(winRate) || 0)) < 0.001 ? ' (yours)' : ''}</span>
                  <span className={r.ev >= 0 ? 'roi-up' : 'roi-down'}>{r.ev >= 0 ? '+' : ''}{fmt(r.ev)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="rc-na">Enter entry, stop and target to see the profile.</div>
        )}
      </div>
    </div>
  );
}

// ---- Drawdown recovery ----

function DrawdownCalc() {
  const [loss, setLoss] = useState('30');
  const [period, setPeriod] = useState('10');

  const out = useMemo(() => {
    const l = parseFloat(loss) || 0;
    const p = parseFloat(period) || 0;
    const recoveryPct = l >= 100 ? Infinity : (l / (1 - l / 100)) * 100;
    const periods = p > 0 && l < 100 ? Math.log(1 / (1 - l / 100)) / Math.log(1 + p / 100) : null;
    const rows = [5, 10, 20, 40].map((dd) => ({
      dd,
      rec: (dd / (1 - dd / 100)) * 100,
      weeksAt10: dd < 100 ? Math.ceil(Math.log(1 / (1 - dd / 100)) / Math.log(1.1)) : null,
    }));
    return { loss: l, recoveryPct, periods, rows };
  }, [loss, period]);

  return (
    <div className="rc-grid">
      <div className="rc-inputs card">
        <NumField label="Current drawdown (%)" value={loss} onChange={setLoss} step="0.1" hint="How far the account is below its peak." />
        <NumField label="Expected return per period (%)" value={period} onChange={setPeriod} step="0.1" hint="e.g. 10 = a 10% return per month/week." />
      </div>

      <div className="rc-outputs card">
        <div className="rc-output-title">Recovery math</div>
        {out && out.loss >= 100 ? (
          <div className="rc-na">A 100% loss can never be recovered — this is why protecting capital comes first.</div>
        ) : out ? (
          <>
            <div className="rc-big">{fmt(out.recoveryPct, 2)}<span>% gain needed</span></div>
            <Formula>recovery % = loss ÷ (1 − loss) = {fmt(out.loss)} ÷ (1 − {fmt(out.loss / 100, 4)})</Formula>
            {out.periods != null && <ResultRow label={`Periods at ${fmt(period)}% per period`} value={fmt(out.periods, 1)} tone="green" strong />}
            <div className="rc-table">
              <div className="rc-table-row rc-table-head"><span>Drawdown</span><span>Recovery needed</span><span>Weeks @10%/wk</span></div>
              {out.rows.map((r) => (
                <div className="rc-table-row" key={r.dd}>
                  <span>{r.dd}%</span>
                  <span className="roi-down">{fmt(r.rec, 1)}%</span>
                  <span>{r.weeksAt10 ?? '—'}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="rc-na">Enter a drawdown percentage.</div>
        )}
      </div>
    </div>
  );
}

// ---- Compound growth ----

function CompoundCalc() {
  const [initial, setInitial] = useState('1000');
  const [monthly, setMonthly] = useState('8');
  const [months, setMonths] = useState('12');

  const out = useMemo(() => {
    const i = parseFloat(initial) || 0;
    const m = parseFloat(monthly) || 0;
    const n = parseFloat(months) || 0;
    if (n <= 0) return null;
    const fv = i * Math.pow(1 + m / 100, n);
    const profit = fv - i;
    const annualized = fv / i > 0 ? Math.pow(fv / i, 12 / n) - 1 : null;
    const series = Array.from({ length: Math.min(Math.ceil(n), 24) }, (_, k) => ({
      m: k + 1,
      v: i * Math.pow(1 + m / 100, k + 1),
    }));
    return { fv, profit, annualized, series };
  }, [initial, monthly, months]);

  return (
    <div className="rc-grid">
      <div className="rc-inputs card">
        <NumField label="Starting capital" value={initial} onChange={setInitial} step="0.01" />
        <NumField label="Return per month (%)" value={monthly} onChange={setMonthly} step="0.1" hint="Can be negative to model losses." />
        <NumField label="Months" value={months} onChange={setMonths} min={1} step="1" />
      </div>

      <div className="rc-outputs card">
        <div className="rc-output-title">Compound growth</div>
        {out ? (
          <>
            <div className="rc-big">{fmt(out.fv)} <span>after {fmt(months, 0)} mo</span></div>
            <Formula>FV = P × (1 + r)ⁿ = {fmt(initial)} × (1 + {fmt(monthly, 2)}%)^{fmt(months, 0)}</Formula>
            <ResultRow label="Total profit" value={fmt(out.profit)} tone={out.profit >= 0 ? 'green' : 'red'} strong />
            <ResultRow label="Annualized return" value={out.annualized != null ? `${(out.annualized * 100).toFixed(1)}%` : '—'} tone={out.annualized >= 0 ? 'green' : 'red'} />
            <ResultRow label="Growth multiple" value={`${(out.fv / (parseFloat(initial) || 1)).toFixed(2)}×`} />
            <div className="rc-note">Compounding works both ways — a fixed 8% monthly return over 12 months is +151%, but the same formula is how a losing streak compounds against you.</div>
          </>
        ) : (
          <div className="rc-na">Enter initial capital, return and months.</div>
        )}
      </div>
    </div>
  );
}

// ---- Martingale reality check ----

function MartingaleCalc() {
  const [base, setBase] = useState('1');
  const [mult, setMult] = useState('2');
  const [winPct, setWinPct] = useState('50');
  const [steps, setSteps] = useState('8');

  const out = useMemo(() => {
    const b = parseFloat(base) || 0;
    const m = parseFloat(mult) || 2;
    const w = parseFloat(winPct) || 0;
    const s = Math.max(1, Math.floor(parseFloat(steps) || 1));
    if (b <= 0) return null;
    const capital = m === 1 ? b * s : (b * (Math.pow(m, s) - 1)) / (m - 1);
    const lastStake = b * Math.pow(m, s - 1);
    const probRun = Math.pow((100 - w) / 100, s);
    const probRecover = 1 - probRun;
    const series = Array.from({ length: s }, (_, k) => ({ step: k + 1, stake: b * Math.pow(m, k), total: (m === 1 ? b * (k + 1) : (b * (Math.pow(m, k + 1) - 1)) / (m - 1)) }));
    return { capital, lastStake, probRun, probRecover, series, s };
  }, [base, mult, winPct, steps]);

  return (
    <div className="rc-grid">
      <div className="rc-inputs card">
        <NumField label="Base stake" value={base} onChange={setBase} step="0.01" />
        <NumField label="Multiplier" value={mult} onChange={setMult} step="0.1" hint="2 = double after every loss." />
        <NumField label="Win probability (%)" value={winPct} onChange={setWinPct} step="0.1" hint="True odds of the market, not the platform's quoted %." />
        <NumField label="Max consecutive steps" value={steps} onChange={setSteps} min={1} step="1" />
      </div>

      <div className="rc-outputs card">
        <div className="rc-output-title">Martingale reality check</div>
        {out ? (
          <>
            <div className="rc-big">{fmt(out.capital)} <span>capital required</span></div>
            <Formula>capital = base × (multⁿ − 1) ÷ (mult − 1) = {fmt(base)} × ({fmt(mult)}^{out.s} − 1) ÷ {fmt(mult - 1)}</Formula>
            <ResultRow label="Last (max) stake" value={fmt(out.lastStake)} />
            <ResultRow label={`Chance of ${out.s} straight losses`} value={`${(out.probRun * 100).toFixed(4)}%`} tone="red" strong />
            <ResultRow label={`Chance of recovering within ${out.s} steps`} value={`${(out.probRecover * 100).toFixed(2)}%`} tone="green" />
            <div className="rc-table">
              <div className="rc-table-row rc-table-head"><span>Step</span><span>Stake</span><span>Total committed</span></div>
              {out.series.map((r) => (
                <div className="rc-table-row" key={r.step}>
                  <span>{r.step}</span>
                  <span>{fmt(r.stake)}</span>
                  <span>{fmt(r.total)}</span>
                </div>
              ))}
            </div>
            <p className="rc-note">You risk {fmt(out.capital)} to win {fmt(base)} — a {fmt(out.capital / (base || 1), 0)}:1 asymmetric bet. The rare losing streak is what the platform edge is priced around.</p>
          </>
        ) : (
          <div className="rc-na">Enter a base stake to run the numbers.</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Component styles
// ---------------------------------------------------------------------

const RC_CSS = `
.rc-pills { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; }
.rc-pill { display: inline-flex; align-items: center; gap: 6px; background: var(--panel); border: 1px solid var(--border); color: var(--text-muted); border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
.rc-pill:hover { color: var(--text); }
.rc-pill-active { background: rgba(255,68,79,0.12); border-color: rgba(255,68,79,0.4); color: var(--accent-red); }

.rc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 860px; align-items: start; }
.rc-inputs { display: flex; flex-direction: column; gap: 14px; }
.rc-label { font-size: 12px; color: var(--text-muted); font-weight: 600; }
.rc-field { display: flex; flex-direction: column; gap: 6px; }
.rc-field-label { font-size: 12px; color: var(--text-muted); font-weight: 600; }
.rc-field-hint { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
.rc-method { display: flex; gap: 4px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 3px; margin-bottom: 2px; }
.rc-method button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; background: transparent; border: none; color: var(--text-muted); padding: 7px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-method .rc-method-active { background: var(--accent-red); color: #fff; }

.rc-outputs { display: flex; flex-direction: column; gap: 10px; }
.rc-output-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
.rc-big { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.rc-big span { font-size: 13px; font-weight: 600; color: var(--text-muted); margin-left: 6px; }
.rc-formula { font-size: 11px; color: var(--text-muted); background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; line-height: 1.5; }
.rc-result-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; padding: 6px 0; border-bottom: 1px dashed var(--border); }
.rc-result-row span { color: var(--text-muted); }
.rc-result-row strong { font-size: 14px; }
.rc-tone-red strong { color: var(--accent-red); }
.rc-tone-green strong { color: var(--accent-teal); }
.rc-na { color: var(--text-muted); font-size: 13px; padding: 10px 0; }
.rc-note { font-size: 11px; color: var(--text-muted); line-height: 1.5; margin: 6px 0 0; }
.rc-table { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; font-size: 12px; margin-top: 6px; }
.rc-table-row { display: grid; grid-template-columns: 1fr 1fr; padding: 7px 12px; border-bottom: 1px solid var(--border); }
.rc-table-row:last-child { border-bottom: none; }
.rc-table-row.rc-table-head { background: var(--panel-2); color: var(--text-muted); text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }

@media (max-width: 760px) { .rc-grid { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .rc-big { font-size: 24px; } .rc-table-row { padding: 7px 10px; } }
`;

const _injectRc = () => {
  if (typeof document === 'undefined' || document.getElementById('rc-css')) return;
  const style = document.createElement('style');
  style.id = 'rc-css';
  style.textContent = RC_CSS;
  document.head.appendChild(style);
};
_injectRc();
