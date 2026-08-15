import { useEffect, useState } from 'react';

const LOGO = '/assests/logo%202000x2000.jpg';
const SPLASH_MSGS = [
  'Loading market data…',
  'Warming up the engines…',
  'Connecting to Deriv…',
  'Syncing your accounts…',
  'Calibrating your bots…',
  'Almost there…',
];
const DURATION_MS = 28000;
const FADE_MS = 5000;

export default function SplashScreen({ onDone }) {
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const start = performance.now();
    let raf;
    let timer;
    const tick = (now) => {
      const t = Math.min((now - start) / DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 2.4);
      setProgress(Math.round(eased * 100));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setLeaving(true);
        timer = setTimeout(onDone, FADE_MS);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [onDone]);

  const msg = SPLASH_MSGS[Math.min(Math.floor((progress / 100) * SPLASH_MSGS.length), SPLASH_MSGS.length - 1)];

  return (
    <>
      <style>{`
        .splash {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 4px; background: var(--bg); transition: opacity 0.5s ease;
        }
        .splash-leave { opacity: 0; pointer-events: none; }
        .splash-logo-wrap {
          width: clamp(110px, 24vw, 160px); height: clamp(110px, 24vw, 160px);
          border-radius: 30px; padding: 10px;
          background: linear-gradient(135deg, rgba(255,68,79,0.28), rgba(76,110,245,0.28));
          box-shadow: 0 18px 50px rgba(0,0,0,0.45);
          animation: splash-pop 0.6s cubic-bezier(0.22, 1.4, 0.36, 1) both;
        }
        .splash-logo { width: 100%; height: 100%; object-fit: cover; border-radius: 21px; }
        .splash-name { font-size: clamp(21px, 5vw, 30px); margin: 16px 0 0; letter-spacing: -0.03em; }
        .splash-name span { color: var(--accent-red); }
        .splash-tagline { color: var(--text-muted); font-size: 13px; margin: 2px 0 26px; }
        .splash-bar { width: min(260px, 72vw); height: 6px; border-radius: 999px; background: var(--panel-2); overflow: hidden; }
        .splash-bar-fill {
          height: 100%; border-radius: 999px;
          background: linear-gradient(90deg, var(--accent-red), var(--accent-indigo));
          transition: width 0.12s linear;
        }
        .splash-meta { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: min(260px, 72vw); margin-top: 10px; }
        .splash-msg { color: var(--text-muted); font-size: 12px; }
        .splash-pct { color: var(--text); font-weight: 700; font-size: 12px; font-variant-numeric: tabular-nums; }
        @keyframes splash-pop { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      `}</style>
      <div className={`splash ${leaving ? 'splash-leave' : ''}`}>
        <div className="splash-logo-wrap">
          <img className="splash-logo" src={LOGO} alt="PronoFX Dbot logo" />
        </div>
        <h1 className="splash-name">
          PronoFX <span>Dbot</span>
        </h1>
        <p className="splash-tagline">Your AI-powered trading command center</p>
        <div className="splash-bar">
          <div className="splash-bar-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="splash-meta">
          <span className="splash-msg">{msg}</span>
          <span className="splash-pct">{progress}%</span>
        </div>
      </div>
    </>
  );
}
