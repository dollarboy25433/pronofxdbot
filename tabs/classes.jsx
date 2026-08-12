import { useEffect, useMemo, useState } from 'react';
import {
  GraduationCap, CheckCircle2, Circle, ChevronLeft, ChevronRight,
  Award, Clock, BookOpen, Play, RotateCcw, BarChart3,
} from 'lucide-react';

const PROGRESS_KEY = 'pulsetrader_classes_v1';

const LEVEL_META = {
  Beginner: { color: 'var(--accent-teal)', icon: 'seedling' },
  Intermediate: { color: 'var(--accent-indigo)', icon: 'step' },
  Advanced: { color: 'var(--accent-red)', icon: 'rocket' },
};

const COURSES = [
  {
    id: 'deriv-foundations',
    title: 'Deriv Platform Foundations',
    level: 'Beginner',
    category: 'Platform',
    minutes: 32,
    color: 'var(--accent-teal)',
    tagline: 'How Deriv accounts, markets, and contracts actually work — the ground floor for everything else.',
    modules: [
      {
        title: 'Accounts and access',
        lessons: [
          {
            id: 'df-1',
            title: 'Real money vs virtual money',
            minutes: 6,
            body: [
              { t: 'p', text: 'A Deriv account is either a real-money account or a virtual-money (demo) account. Virtual accounts carry the "VRTC" prefix in the account number and are funded with virtual funds that can never be withdrawn. Real accounts carry prefixes like "CR" (cent) or "MF"/"MX" depending on region, and every loss on them is real money you can lose.' },
              { t: 'p', text: 'The single biggest risk on a trading platform is trading a real account before you understand the instrument. Demo accounts let you learn mechanics with zero financial risk, which is exactly why professional traders practice setups in demo before committing capital.' },
              { t: 'list', items: ['Virtual (demo) accounts: free virtual funds, no withdrawals, ideal for practice and for testing bots.', 'Real accounts: funded with your own money, real profit and loss, requires responsible risk management.', 'You can hold multiple Deriv accounts and switch between them — this app lists them all after OAuth login.'] },
              { t: 'tip', text: 'Rule of thumb: only trade a real account after you have a written plan, a fixed stake per trade, and a proven record in demo.' },
            ],
          },
          {
            id: 'df-2',
            title: 'Signing in with the Deriv OAuth flow',
            minutes: 5,
            body: [
              { t: 'p', text: 'This app never sees your Deriv password. Instead it uses OAuth 2: the app redirects you to Deriv, you approve the app on the Deriv side, and Deriv hands the app a short-lived token scoped to your accounts. The backend stores that token server-side against an opaque session id and only ever exposes account numbers and currencies to the browser.' },
              { t: 'list', items: ['The browser only ever holds a session id — never a raw token.', 'Tokens are used server-side to make Deriv API calls (balance, contracts).', 'Logging out discards the session and the server drops the stored token.'] },
            ],
          },
        ],
      },
      {
        title: 'Markets and contracts',
        lessons: [
          {
            id: 'df-3',
            title: 'Markets available on Deriv',
            minutes: 7,
            body: [
              { t: 'p', text: 'Deriv offers a few broad categories: synthetic indices, forex, stock indices, commodities, and cryptocurrencies. Synthetic indices are computer-generated markets that trade 24/7 with no market hours, no gaps, and no dependency on a physical exchange — they are driven by algorithms that replicate the statistical behaviour of real markets.' },
              { t: 'list', items: ['Synthetic indices: Volatility, Boom/Crash, Step, Range Break, Jump — continuous and gap-free.', 'Forex: currency pairs such as EUR/USD, priced in pips, traded during the global FX session.', 'Commodities: gold and silver, sensitive to macro news.', 'Cryptocurrencies and stock indices: higher variance, wider spreads.'] },
              { t: 'tip', text: 'For algorithmic bot trading, synthetic indices are the most forgiving place to start because they trade around the clock and never gap over your stop.' },
            ],
          },
          {
            id: 'df-4',
            title: 'How a contract works',
            minutes: 7,
            body: [
              { t: 'p', text: 'A Deriv contract is a bet on the future price of a market: you stake an amount, pick a direction and a duration, and if the market finishes on the correct side of the prediction you receive a payout. Different contract types ask different questions about price.' },
              { t: 'list', items: ['Rise/Fall: will the exit spot be higher/lower than the entry spot when time expires?', 'Higher/Lower: will the final spot be above/below the entry spot at expiry (touch contracts differ slightly).', 'Touch/No Touch: does price touch a barrier before expiry?', 'Accumulators: grow your stake while price keeps moving your way — pays nothing the moment it steps backwards.'] },
              { t: 'tip', text: 'The payout you receive is calculated from the payout percentage shown before you buy. A contract that "pays 92%" for a correct Rise returns stake × 1.92 if you win and 0 if you lose.' },
            ],
          },
        ],
      },
    ],
    quiz: [
      { q: 'Which account type can you never withdraw from?', options: ['Real account', 'Virtual (demo) account', 'Cent account', 'Synthetic account'], a: 1, explain: 'Virtual accounts are funded with virtual funds for practice and can never be withdrawn.' },
      { q: 'How does this app authenticate you with Deriv?', options: ['It asks for your Deriv password', 'OAuth 2 — you approve the app on Deriv and it receives a token', 'It scrapes your public profile', 'It stores your API token in the URL'], a: 1, explain: 'The OAuth flow keeps your password with Deriv; the app only ever receives a scoped token.' },
      { q: 'What is a distinguishing feature of synthetic indices?', options: ['They only trade during market hours', 'They trade 24/7 with no gaps', 'They are backed by physical commodities', 'They never move'], a: 1, explain: 'Synthetic indices are algorithm-generated and trade continuously, so there are no market-hour or gap limitations.' },
      { q: 'If a Rise/Fall contract pays 92% and your stake is $10, what do you receive on a win?', options: ['$9.20', '$10.00', '$19.20', '$1.92'], a: 2, explain: 'A 92% payout means you get your $10 back plus 92% profit: $19.20 total.' },
    ],
  },
  {
    id: 'synthetic-indices',
    title: 'Synthetic Indices Explained',
    level: 'Beginner',
    category: 'Markets',
    minutes: 30,
    color: 'var(--accent-indigo)',
    tagline: 'What Volatility, Boom/Crash and other derived indices are, and why their behaviour matters for your trades.',
    modules: [
      {
        title: 'The Volatility family',
        lessons: [
          {
            id: 'si-1',
            title: 'What the number means',
            minutes: 6,
            body: [
              { t: 'p', text: 'A Volatility index such as "Volatility 75 Index" is a synthetic market whose statistical behaviour is calibrated to a target annualised volatility — the number in the name. Volatility 10 moves slowly and steadily, while Volatility 100 whips around much more aggressively. The higher the number, the larger the average step per tick and the wider the swings.' },
              { t: 'list', items: ['Lower numbers (R_10, R_25): calmer, smaller candles, better suited to trend-following on longer timeframes.', 'Higher numbers (R_75, R_100): fast ticks and big candles, more profit potential and more risk.', 'Prices move continuously and, unlike forex, are unaffected by news because they are generated by an algorithm.'] },
            ],
          },
          {
            id: 'si-2',
            title: 'Ticks and tick speed',
            minutes: 5,
            body: [
              { t: 'p', text: 'A tick is a single price update. Volatility indices tick a few times per second (the "1s" variants tick exactly once per second). Every tick is a fresh data point your strategy can react to, and the live chart in Trading View is built from this stream.' },
              { t: 'tip', text: 'Fast-ticking markets (Volatility 100) move more than one point per candle even on low timeframes — size your stake for that, not for your broker demo experience. You can watch real tick cadence in the Trading View tick stream.' },
            ],
          },
        ],
      },
      {
        title: 'Boom and Crash',
        lessons: [
          {
            id: 'si-3',
            title: 'How Boom/Crash behave',
            minutes: 7,
            body: [
              { t: 'p', text: 'Boom and Crash indices move in a generally controlled direction and periodically spike violently against the trend. Boom indices drift upward and spike sharply down; Crash indices drift downward and spike sharply up. The number (300/500/1000) reflects how often and how hard the index spikes.' },
              { t: 'list', items: ['A boom spike can retrace dozens of points in seconds — a stop loss on the wrong side gets hit hard.', 'Sellers after a Boom spike and buyers after a Crash spike are common community strategies.', 'Because the "normal" drift is predictable but the spikes are not, position sizing matters more than entry timing.'] },
            ],
          },
          {
            id: 'si-4',
            title: 'Choosing a market to trade',
            minutes: 5,
            body: [
              { t: 'p', text: 'Match the market to your edge. Trend strategies that need clean, slow moves suit R_10–R_25 on 5m+ candles. Fast scalps suit the 1s indices. Spike strategies suit Boom/Crash, but only if you can survive the wrong-side spikes.' },
              { t: 'tip', text: 'Never trade a market you have not watched live for at least a few sessions. The chart and tick feed in this app are a good place to start observing.' },
            ],
          },
        ],
      },
    ],
    quiz: [
      { q: 'What does the number in "Volatility 75 Index" refer to?', options: ['Its price', 'Its target annualised volatility', 'Its trading hours', 'Its minimum stake'], a: 1, explain: 'The number is the target annualised volatility that the synthetic market is calibrated to.' },
      { q: 'Which index will move the most per tick on average?', options: ['R_10', 'R_25', 'R_100', 'They all move identically'], a: 2, explain: 'Higher numbers mean higher volatility and larger average moves.' },
      { q: 'How do Boom indices typically behave?', options: ['They drift down and spike up', 'They drift up and spike down', 'They never move', 'They only spike at market open'], a: 1, explain: 'Boom indices drift upward and periodically spike sharply downward.' },
      { q: 'Why is position sizing critical on Boom/Crash?', options: ['Because spikes are rare', 'Because spikes are unpredictable and can hit wrong-side stops hard', 'Because payouts are fixed', 'Because they do not move'], a: 1, explain: 'The normal drift is predictable but spikes are not, so your risk per trade must survive them.' },
    ],
  },
  {
    id: 'technical-analysis',
    title: 'Technical Analysis Fundamentals',
    level: 'Intermediate',
    category: 'Analysis',
    minutes: 40,
    color: 'var(--accent-red)',
    tagline: 'Price structure, trends, moving averages and momentum — the tools behind most bot strategies.',
    modules: [
      {
        title: 'Reading price structure',
        lessons: [
          {
            id: 'ta-1',
            title: 'Trends, swings and structure',
            minutes: 8,
            body: [
              { t: 'p', text: 'Price moves in waves: swing highs and swing lows form the structure of a chart. A market is in an uptrend when each swing high and swing low is higher than the last; a downtrend is the reverse. Many bot entries are simply "buy pullbacks in an uptrend" or "sell rallies in a downtrend", which is why identifying structure first is the foundation of technical analysis.' },
              { t: 'list', items: ['Uptrend: higher highs and higher lows.', 'Downtrend: lower highs and lower lows.', 'Range: price oscillates between two clear levels.', 'The current candle set is the newest swing — mark the last confirmed swing high/low before trading.'] },
            ],
          },
          {
            id: 'ta-2',
            title: 'Support and resistance',
            minutes: 7,
            body: [
              { t: 'p', text: 'Support is a price zone where buying has repeatedly absorbed selling; resistance is the opposite. Zones matter more than exact lines, and a level that breaks often flips role: old resistance becomes new support and vice versa.' },
              { t: 'tip', text: 'In a backtest, treat a level as confirmed only after it has been touched at least twice. Single-touch "levels" are the most common source of false signals.' },
            ],
          },
        ],
      },
      {
        title: 'Indicators used by bots',
        lessons: [
          {
            id: 'ta-3',
            title: 'Moving averages',
            minutes: 8,
            body: [
              { t: 'p', text: 'A moving average smooths price to reveal the underlying direction. The simple moving average (SMA) weights every candle equally; the exponential (EMA) weights recent candles more, so it reacts faster. Crossovers — for example a fast EMA crossing above a slow EMA — are a classic entry trigger that is easy to encode in a bot.' },
              { t: 'list', items: ['SMA/EMA 20 vs 50: the classic crossover pair.', 'Golden cross / death cross: 50 above/below 200, used on higher timeframes.', 'Price vs MA: trading "with" a rising MA tends to filter many losing trades.'] },
            ],
          },
          {
            id: 'ta-4',
            title: 'Momentum and the RSI',
            minutes: 7,
            body: [
              { t: 'p', text: 'Momentum indicators measure how fast price is changing. The Relative Strength Index (RSI) oscillates between 0 and 100; it is commonly read as overbought above 70 and oversold below 30. Note that in a strong trend RSI can sit "overbought" for a long time, so signals should be combined with structure rather than used alone.' },
              { t: 'tip', text: 'Bots often combine a trend filter (price above MA) with a momentum trigger (RSI crossing 50) to reduce whipsaw. That single design pattern is the backbone of many profitable simple bots.' },
            ],
          },
        ],
      },
    ],
    quiz: [
      { q: 'A market with higher highs and higher lows is in a…', options: ['Downtrend', 'Uptrend', 'Range', 'Sideways market'], a: 1, explain: 'Higher highs and higher lows define an uptrend.' },
      { q: 'When a resistance level breaks, it often…', options: ['Becomes support', 'Disappears forever', 'Gets stronger', 'Moves the market to a new broker'], a: 0, explain: 'Broken levels frequently flip roles: old resistance becomes new support.' },
      { q: 'Which indicator reacts faster to price changes?', options: ['SMA', 'EMA', 'A support line', 'A tick count'], a: 1, explain: 'The EMA weights recent candles more heavily, so it tracks price more quickly.' },
      { q: 'Why should RSI signals be combined with other context?', options: ['RSI is always wrong', 'In strong trends RSI can stay overbought for a long time', 'RSI only works on forex', 'RSI needs 10,000 candles'], a: 1, explain: 'Overbought does not mean "must reverse" — in strong trends RSI can remain overbought, so context matters.' },
    ],
  },
  {
    id: 'risk-management',
    title: 'Risk Management Mastery',
    level: 'Intermediate',
    category: 'Risk',
    minutes: 36,
    color: 'var(--accent-teal)',
    tagline: 'Position sizing, stop losses, drawdown math and why martingale is a trap — the math that keeps you in the game.',
    modules: [
      {
        title: 'Sizing every trade',
        lessons: [
          {
            id: 'rm-1',
            title: 'The 1–2% rule',
            minutes: 7,
            body: [
              { t: 'p', text: 'The 1% rule says: never risk more than 1% of your account on a single trade. Risk is not your stake — it is what you lose if the trade hits your stop. With a $1,000 account that is $10 of maximum loss per trade; with $10,000 it is $100. This is the single most effective habit for surviving losing streaks.' },
              { t: 'p', text: 'Worked example: account $2,000, you risk 1% ($20). Your entry is 100.0 and your stop is 96.0, a 4-point distance. Position size = $20 ÷ 4 = 5 units of the market. If price hits your stop you lose exactly $20 — never more.' },
              { t: 'tip', text: 'The Risk Calculator tab in this app does this computation live. Use it before every trade, not after.' },
            ],
          },
          {
            id: 'rm-2',
            title: 'Stops and risk/reward',
            minutes: 6,
            body: [
              { t: 'p', text: 'A stop loss defines your maximum loss in advance; a take profit defines your target. The ratio between them is your risk/reward. If you risk 4 points to make 8, your R:R is 1:2, and you only need to win 1 trade in 3 to break even.' },
              { t: 'list', items: ['Breakeven win rate = 1 ÷ (1 + R:R). At 1:2 you break even at 33% wins; at 1:1 you need 50%.', 'Place stops beyond a meaningful level (structure), not at a round number where they get hunted.', 'A tight stop that gets hit often is worse than a wider stop that rarely triggers — judge stops by their hit rate and R:R together.'] },
            ],
          },
        ],
      },
      {
        title: 'Surviving losses',
        lessons: [
          {
            id: 'rm-3',
            title: 'The drawdown recovery math',
            minutes: 6,
            body: [
              { t: 'p', text: 'Losses are asymmetric: after a 50% drawdown you need +100% to get back to even. The recovery percentage is loss ÷ (1 − loss). A 10% loss needs 11.1% back, a 25% loss needs 33.3%, a 50% loss needs 100%. The deeper the hole, the harder it is to climb out — which is exactly why small, consistent risk beats occasional huge risk.' },
              { t: 'tip', text: 'If your account is down 20%, resist the urge to double stakes "to get it back fast". The recovery math says that urge is how accounts get wiped. Drawdown recovery is built into the Risk Calculator.' },
            ],
          },
          {
            id: 'rm-4',
            title: 'Why martingale breaks',
            minutes: 7,
            body: [
              { t: 'p', text: 'Martingale doubles the stake after every loss so that one win recovers everything. The problem is capital: after n consecutive losses the required stake is base × 2ⁿ, and the total exposure is base × (2ⁿ − 1). At $1 base, ten straight losses require $1,023 of capital for one $1 profit — and a 1-in-1024 losing streak is guaranteed to arrive eventually on a 50/50 market.' },
              { t: 'list', items: ['Required capital for n doubling steps: base × (2ⁿ − 1).', 'Chance of n straight losses at win-probability p: (1 − p)ⁿ.', 'Even with a capped doubling (e.g. 5 steps), the tail loss is 31× your base stake, while every win still only returns 1 unit.'] },
              { t: 'tip', text: 'Martingale does not change your edge — it changes the distribution of losses into rare but account-destroying ones. The Risk Calculator shows the real numbers.' },
            ],
          },
        ],
      },
    ],
    quiz: [
      { q: 'With a $1,000 account and the 1% rule, what is your max loss per trade?', options: ['$1', '$10', '$100', '$1,000'], a: 1, explain: '1% of $1,000 is $10 — your maximum loss per trade.' },
      { q: 'What win rate do you need to break even at 1:2 risk/reward?', options: ['50%', '40%', '33%', '66%'], a: 2, explain: 'Breakeven = 1 ÷ (1 + 2) = 33.3%.' },
      { q: 'After a 50% drawdown, what return gets you back to even?', options: ['50%', '75%', '100%', '25%'], a: 2, explain: 'Recovery = loss ÷ (1 − loss) = 0.5 ÷ 0.5 = 100%.' },
      { q: 'At $1 base stake with doubling, what capital do 8 straight martingale steps require?', options: ['$8', '$255', '$128', '$511'], a: 1, explain: 'Total exposure = base × (2ⁿ − 1) = 1 × (256 − 1) = $255.' },
    ],
  },
  {
    id: 'bot-fundamentals',
    title: 'Trading Bot Fundamentals',
    level: 'Advanced',
    category: 'Bots',
    minutes: 42,
    color: 'var(--accent-red)',
    tagline: 'The anatomy of a trading bot: entry logic, symbol choice, backtesting and paper trading before real money.',
    modules: [
      {
        title: 'Designing a strategy',
        lessons: [
          {
            id: 'bf-1',
            title: 'Anatomy of a bot',
            minutes: 8,
            body: [
              { t: 'p', text: 'A trading bot is a loop: watch the market until an entry condition triggers, place a contract with a fixed stake and duration, then handle the result and repeat. Every bot is a combination of four decisions — the entry trigger, the stake, the duration/exit, and the restart policy.' },
              { t: 'list', items: ['Entry trigger: a rule such as "2 consecutive rising candles" or "RSI crosses 50".', 'Stake: ideally fixed and risk-based, not a martingale ladder.', 'Duration/exit: when the contract settles or a stop fires.', 'Restart: what the bot does after a win or loss — keep trading, pause, or wait for a cooldown.'] },
            ],
          },
          {
            id: 'bf-2',
            title: 'Choosing a symbol and timeframe',
            minutes: 7,
            body: [
              { t: 'p', text: 'Symbol choice is a strategy decision. A slow trend strategy has no business running on Volatility 100 with 1-minute contracts; it will be chopped to death by noise. Match the strategy cadence to the market: slow markets for trend, fast markets only for fast strategies with tight risk.' },
              { t: 'tip', text: 'A practical test: can you see your edge with the naked eye on the Trading View chart? If the signal is not obvious in hindsight on your chosen timeframe, encoding it in a bot will not make it profitable.' },
            ],
          },
        ],
      },
      {
        title: 'Testing before real money',
        lessons: [
          {
            id: 'bf-3',
            title: 'Backtesting and sample size',
            minutes: 8,
            body: [
              { t: 'p', text: 'A backtest replays historical candles and asks what the strategy would have done. The two classic lies are overfitting and tiny samples. If your strategy has 10 free parameters tuned to one historical period, it will fail forward. A rule of thumb: at least 200–500 trades are needed before a win-rate difference means anything.' },
              { t: 'list', items: ['Test out-of-sample: tune on one period, verify on a completely different one.', 'Count trades, not profits — a 10-trade "80% win rate" is meaningless.', 'Include the costs: every contract has an implied cost built into its payout percentage.'] },
            ],
          },
          {
            id: 'bf-4',
            title: 'Paper trading and going live',
            minutes: 7,
            body: [
              { t: 'p', text: 'Paper trading runs your bot on a virtual-money account exactly as it will run live. If the bot cannot hold its edge in demo over at least a few hundred contracts, real money will not fix it — it will only make the mistakes more expensive. When you do go live, start at minimum stake and scale up only after consistency, not after a single good day.' },
              { t: 'tip', text: 'Log every contract the bot takes. The fastest way to kill a bad bot is a trade journal you actually review — direction, stake, symbol, result, and what the market was doing.' },
            ],
          },
        ],
      },
    ],
    quiz: [
      { q: 'Which of these is NOT one of the four core bot decisions?', options: ['Entry trigger', 'Stake', 'Duration/exit', 'Broker choice'], a: 3, explain: 'The four decisions are entry trigger, stake, duration/exit, and restart policy.' },
      { q: 'A slow trend strategy is best matched to…', options: ['Volatility 100 with 1-minute contracts', 'A slow market with a suitable timeframe', 'Any symbol randomly', 'The fastest tick feed available'], a: 1, explain: 'Match strategy cadence to the market and timeframe, or noise will destroy the edge.' },
      { q: 'Why is trade count important in a backtest?', options: ['It is not important', 'A tiny sample can make noise look like an edge', 'Brokers only accept backtests with 500 trades', 'It determines payout percentage'], a: 1, explain: 'Small samples produce statistically meaningless win rates — aim for 200–500+ trades.' },
      { q: 'What is the purpose of paper trading?', options: ['To earn real profit', 'To validate the bot on virtual money before risking capital', 'To test the broker', 'To inflate your win rate'], a: 1, explain: 'Paper trading proves the bot works in a real environment without risking real money.' },
    ],
  },
  {
    id: 'pips-and-sizing',
    title: 'Pips, Lots & Forex Sizing',
    level: 'Intermediate',
    category: 'Risk',
    minutes: 28,
    color: 'var(--accent-indigo)',
    tagline: 'What a pip is, what a lot is worth, and how to turn risk into the correct position size on currency pairs.',
    modules: [
      {
        title: 'The building blocks',
        lessons: [
          {
            id: 'ps-1',
            title: 'What a pip is',
            minutes: 5,
            body: [
              { t: 'p', text: 'A pip is the standard unit of price movement in forex — normally the 4th decimal place (0.0001) for most pairs, and the 2nd decimal place for JPY pairs. On EUR/USD a move from 1.0850 to 1.0860 is 10 pips. Knowing pip distance is how you convert a stop loss into a risk calculation.' },
              { t: 'tip', text: 'On synthetic indices a "pip" is usually the point (0.01), which is why the Risk Calculator asks you to choose between forex (pips) and point-based markets.' },
            ],
          },
          {
            id: 'ps-2',
            title: 'What a lot is worth',
            minutes: 6,
            body: [
              { t: 'p', text: 'A standard lot is 100,000 units of the base currency; a mini lot is 10,000; a micro lot is 1,000. On a USD-quoted pair, a full standard lot is worth about $10 per pip, a mini lot about $1 per pip, and a micro lot about $0.10 per pip. This "pip value" is the bridge between your risk in dollars and the position size in lots.' },
              { t: 'list', items: ['Standard lot (100k): ≈ $10 per pip on USD-quoted pairs.', 'Mini lot (10k): ≈ $1 per pip.', 'Micro lot (1k): ≈ $0.10 per pip.'] },
            ],
          },
        ],
      },
      {
        title: 'The sizing calculation',
        lessons: [
          {
            id: 'ps-3',
            title: 'Turning risk into lots',
            minutes: 7,
            body: [
              { t: 'p', text: 'Position size = risk amount ÷ (pip value per lot × stop distance in pips). Example: account $5,000, risk 1% ($50), stop 25 pips, pip value $10/lot. Lots = $50 ÷ ($10 × 25) = 0.2 lots. If you round down to 0.1, your actual risk is only $25 — that is fine; never round up.' },
              { t: 'tip', text: 'The Risk Calculator automates this for you. Always size to the nearest smaller lot, never the nearest — rounding up silently breaks your risk budget.' },
            ],
          },
          {
            id: 'ps-4',
            title: 'The hidden cost of leverage',
            minutes: 5,
            body: [
              { t: 'p', text: 'Leverage multiplies both gains and losses. A 100:1 account lets a tiny margin open a huge position — and a 1% adverse move then wipes 100% of the margin. Size the position off your risk, not off the maximum the margin allows.' },
            ],
          },
        ],
      },
    ],
    quiz: [
      { q: 'On EUR/USD, how many pips is a move from 1.0850 to 1.0860?', options: ['1 pip', '10 pips', '100 pips', '0.1 pips'], a: 1, explain: 'EUR/USD is quoted to 4 decimals, so 0.0010 is 10 pips.' },
      { q: 'Approximately how much is a standard lot worth per pip on a USD-quoted pair?', options: ['$0.10', '$1', '$10', '$100'], a: 2, explain: 'A standard lot (100k units) is worth roughly $10 per pip.' },
      { q: 'Risk $100 with a $10/pip value and a 20-pip stop. What is the correct position size in lots?', options: ['1.0', '0.5', '0.2', '2.0'], a: 1, explain: 'Lots = $100 ÷ ($10 × 20) = 0.5 lots.' },
      { q: 'Why should you round position size down rather than to the nearest?', options: ['Brokers require it', 'Rounding up silently exceeds your risk budget', 'It looks cleaner', 'Pip value changes'], a: 1, explain: 'Rounding up increases risk beyond your planned maximum — round down to stay within budget.' },
    ],
  },
];

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProgress(p) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch { /* storage unavailable */ }
}

export default function ClassesTab() {
  const [selectedId, setSelectedId] = useState(null);
  const [progress, setProgress] = useState(() => loadProgress());

  useEffect(() => { saveProgress(progress); }, [progress]);

  const course = useMemo(() => COURSES.find((c) => c.id === selectedId), [selectedId]);

  if (course) {
    return (
      <CourseDetail
        course={course}
        progress={progress}
        setProgress={setProgress}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="section">
      <h2 className="section-title">Classes</h2>
      <p className="section-sub">Guided courses on the Deriv platform, synthetic indices, technical analysis, risk and bots. Track your progress and pass the end-of-course quiz for a certificate.</p>
      <div className="cls-grid">
        {COURSES.map((c) => (
          <CourseCard key={c.id} course={c} progress={progress[c.id]} onOpen={() => setSelectedId(c.id)} />
        ))}
      </div>
    </div>
  );
}

function CourseCard({ course, progress, onOpen }) {
  const lessonCount = course.modules.reduce((n, m) => n + m.lessons.length, 0);
  const done = progress ? Object.keys(progress.done || {}).length : 0;
  const pct = Math.round((done / lessonCount) * 100);
  const meta = LEVEL_META[course.level];
  const completed = progress?.completed;

  return (
    <div className="cls-card" style={{ borderTopColor: course.color }}>
      <div className="cls-card-head">
        <span className="cls-level" style={{ color: meta.color, borderColor: meta.color }}>{course.level}</span>
        <span className="cls-category">{course.category}</span>
        {completed && <span className="cls-completed"><Award size={13} /> Certified</span>}
      </div>
      <h3 className="cls-card-title">{course.title}</h3>
      <p className="cls-card-tagline">{course.tagline}</p>
      <div className="cls-card-meta">
        <span><Clock size={13} /> {course.minutes} min</span>
        <span><BookOpen size={13} /> {lessonCount} lessons</span>
        {done > 0 && <span className="roi-up">{pct}% complete</span>}
      </div>
      <button className="btn-primary cls-open" onClick={onOpen}>
        {done === 0 ? 'Start course' : done === lessonCount && !progress.quiz ? 'Take the quiz' : 'Continue'}
      </button>
      {lessonCount > 0 && (
        <div className="cls-progress">
          <div className="cls-progress-fill" style={{ width: `${pct}%`, background: course.color }} />
        </div>
      )}
    </div>
  );
}

function CourseDetail({ course, progress, setProgress, onBack }) {
  const lessonCount = course.modules.reduce((n, m) => n + m.lessons.length, 0);
  const done = Object.keys(progress?.done || {}).length;
  const pct = Math.round((done / lessonCount) * 100);
  const quizPassed = progress?.quiz && progress.quiz.score >= 70;
  const allDone = done === lessonCount;
  const certified = allDone && quizPassed;

  const [view, setView] = useState({ type: 'overview' });

  useEffect(() => {
    try { window.scrollTo(0, 0); } catch { /* ignore */ }
  }, [view]);

  function markLesson(lessonId) {
    setProgress((p) => {
      const cur = p[course.id] || { done: {}, enrolled: true };
      return { ...p, [course.id]: { ...cur, done: { ...cur.done, [lessonId]: true }, enrolled: true } };
    });
  }

  const openLesson = (lessonId) => {
    setView({ type: 'lesson', lessonId });
  };

  const openQuiz = () => setView({ type: 'quiz' });

  if (view.type === 'lesson') {
    const lesson = COURSE_LESSON(course, view.lessonId);
    if (!lesson) { setView({ type: 'overview' }); return null; }
    const isDone = !!progress?.[course.id]?.done?.[view.lessonId];
    return (
      <LessonView
        course={course}
        lesson={lesson}
        isDone={isDone}
        onComplete={() => markLesson(view.lessonId)}
        onNavigate={(id) => setView({ type: 'lesson', lessonId: id })}
        onBack={() => setView({ type: 'overview' })}
        onQuiz={() => setView({ type: 'quiz' })}
        hasQuiz={!!course.quiz?.length}
      />
    );
  }

  if (view.type === 'quiz') {
    return (
      <QuizView
        course={course}
        progress={progress}
        setProgress={setProgress}
        onBack={() => setView({ type: 'overview' })}
      />
    );
  }

  return (
    <div className="section">
      <button className="btn-ghost btn-small cls-back" onClick={onBack}><ChevronLeft size={14} /> All classes</button>

      <div className="cls-detail-head">
        <div>
          <h2 className="section-title">{course.title}</h2>
          <p className="section-sub">{course.tagline}</p>
          <div className="cls-card-meta">
            <span className="cls-level" style={{ color: course.color, borderColor: course.color }}>{course.level}</span>
            <span><Clock size={13} /> {course.minutes} min</span>
            <span><BookOpen size={13} /> {lessonCount} lessons</span>
            <span className="roi-up">{pct}% complete</span>
          </div>
        </div>
        <div className="cls-cert-box">
          <Award size={22} color={certified ? 'var(--accent-teal)' : 'var(--text-muted)'} />
          <div className="cls-cert-text">
            <strong>{certified ? 'Course completed' : 'Certificate'}</strong>
            <span>{certified ? `Awarded ${new Date().toLocaleDateString()}` : `Finish all lessons and score ≥70% on the quiz${allDone ? ' — the quiz awaits' : ''}`}</span>
          </div>
        </div>
      </div>

      <div className="cls-progress cls-progress-lg">
        <div className="cls-progress-fill" style={{ width: `${pct}%`, background: course.color }} />
      </div>

      <div className="cls-modules">
        {course.modules.map((mod, mi) => (
          <div className="cls-module" key={mod.title}>
            <div className="cls-module-title">Module {mi + 1} — {mod.title}</div>
            {mod.lessons.map((l, li) => {
              const isDone = !!progress?.[course.id]?.done?.[l.id];
              return (
                <button key={l.id} className="cls-lesson-row" onClick={() => openLesson(l.id)}>
                  {isDone ? <CheckCircle2 size={16} className="roi-up" /> : <Circle size={16} className="cls-circle" />}
                  <span className="cls-lesson-num">{mi + 1}.{li + 1}</span>
                  <span className="cls-lesson-name">{l.title}</span>
                  <span className="cls-lesson-min">{l.minutes} min</span>
                  <ChevronRight size={14} className="cls-chev" />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {course.quiz?.length > 0 && (
        <div className="cls-quiz-card">
          <div>
            <strong>End-of-course quiz</strong>
            <p>{progress?.quiz ? `Last score: ${progress.quiz.score}% — ${quizPassed ? 'passed' : 'retake to pass (≥70%)'}` : `${course.quiz.length} questions. Score ≥70% to earn the certificate.`}</p>
          </div>
          <button className="btn-primary" onClick={openQuiz}>{progress?.quiz ? 'Retake quiz' : 'Start quiz'}</button>
        </div>
      )}
    </div>
  );
}

function COURSE_LESSON(course, lessonId) {
  for (const m of course.modules) {
    const found = m.lessons.find((l) => l.id === lessonId);
    if (found) return found;
  }
  return null;
}

function LessonView({ course, lesson, isDone, onComplete, onBack, onQuiz, hasQuiz }) {
  const [nextId, prevId] = useMemo(() => {
    const ids = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
    const i = ids.indexOf(lesson.id);
    return [i < ids.length - 1 ? ids[i + 1] : null, i > 0 ? ids[i - 1] : null];
  }, [course, lesson.id]);

  return (
    <div className="section cls-lesson-wrap">
      <button className="btn-ghost btn-small cls-back" onClick={onBack}><ChevronLeft size={14} /> Back to course</button>
      <div className="cls-lesson-head">
        <div className="cls-lesson-kicker">{course.title}</div>
        <h2 className="section-title">{lesson.title}</h2>
        <span className="cls-lesson-min"><Clock size={12} /> {lesson.minutes} min read</span>
      </div>

      <div className="cls-lesson-body">
        {lesson.body.map((block, i) => {
          if (block.t === 'h') return <h3 className="cls-lesson-h" key={i}>{block.text}</h3>;
          if (block.t === 'list') return (
            <ul className="cls-lesson-list" key={i}>
              {block.items.map((item, j) => <li key={j}>{item}</li>)}
            </ul>
          );
          if (block.t === 'tip') return <div className="cls-lesson-tip" key={i}><GraduationCap size={15} /> {block.text}</div>;
          return <p className="cls-lesson-p" key={i}>{block.text}</p>;
        })}
      </div>

      <div className="cls-lesson-nav">
        {prevId && <button className="btn-outline" onClick={() => onNavigate(prevId)}><ChevronLeft size={14} /> Previous</button>}
        {isDone ? (
          <button className="btn-primary" onClick={() => { if (nextId) onNavigate(nextId); else if (hasQuiz) onQuiz(); else onBack(); }}>{nextId ? 'Next lesson' : hasQuiz ? 'Take the quiz' : 'Finish'}</button>
        ) : (
          <button className="btn-primary" onClick={onComplete}>{nextId ? 'Mark complete' : 'Complete'}</button>
        )}
      </div>
    </div>
  );
}

function QuizView({ course, progress, setProgress, onBack }) {
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const score = Object.keys(answers).length;
  const correct = course.quiz.reduce((n, q, i) => (answers[i] === q.a ? n + 1 : n), 0);
  const pct = Math.round((correct / course.quiz.length) * 100);
  const passed = pct >= 70;

  function submit() {
    if (Object.keys(answers).length < course.quiz.length) return;
    setSubmitted(true);
    setProgress((p) => ({
      ...p,
      [course.id]: {
        ...(p[course.id] || {}),
        quiz: { score: pct, passed, at: Date.now() },
      },
    }));
  }

  function retake() {
    setAnswers({});
    setSubmitted(false);
    setProgress((p) => ({ ...p, [course.id]: { ...(p[course.id] || {}), quiz: null } }));
  }

  return (
    <div className="section cls-quiz-wrap">
      <button className="btn-ghost btn-small cls-back" onClick={onBack}><ChevronLeft size={14} /> Back to course</button>
      <h2 className="section-title">{course.title} — Quiz</h2>
      <p className="section-sub">{course.quiz.length} questions · score ≥70% to pass · {score}/{course.quiz.length} answered</p>

      <div className="cls-questions">
        {course.quiz.map((q, qi) => (
          <div className="cls-question" key={qi}>
            <div className="cls-q-num">Q{qi + 1}</div>
            <div className="cls-q-text">{q.q}</div>
            <div className="cls-q-options">
              {q.options.map((opt, oi) => {
                let cls = 'cls-q-opt';
                if (submitted) {
                  if (oi === q.a) cls += ' cls-q-correct';
                  else if (answers[qi] === oi) cls += ' cls-q-wrong';
                  else cls += ' cls-q-dim';
                } else if (answers[qi] === oi) {
                  cls += ' cls-q-selected';
                }
                return (
                  <button key={oi} className={cls} disabled={submitted} onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}>
                    {opt}
                  </button>
                );
              })}
            </div>
            {submitted && (
              <div className={`cls-q-explain ${answers[qi] === q.a ? 'cls-q-explain-ok' : 'cls-q-explain-bad'}`}>
                {answers[qi] === q.a ? 'Correct. ' : 'Incorrect. '}{q.explain}
              </div>
            )}
          </div>
        ))}
      </div>

      {submitted && (
        <div className={`cls-result ${passed ? 'cls-result-pass' : 'cls-result-fail'}`}>
          <div className="cls-result-score">{pct}%</div>
          <div className="cls-result-text">
            <strong>{passed ? 'You passed!' : 'Not yet — keep going.'}</strong>
            <span>{correct} of {course.quiz.length} correct. {passed ? `Certificate awarded${progress?.[course.id]?.done ? ' — all lessons complete!' : ' — finish all lessons to finalise it.'}` : 'Review the explanations above and retake when ready.'}</span>
          </div>
          {!passed && <button className="btn-primary" onClick={retake}><RotateCcw size={14} /> Retake</button>}
          {passed && <button className="btn-outline" onClick={onBack}>Back to course</button>}
        </div>
      )}

      {!submitted && (
        <div className="cls-quiz-submit">
          <button className="btn-primary" disabled={score < course.quiz.length} onClick={submit}>
            Submit quiz ({score}/{course.quiz.length})
          </button>
          {score < course.quiz.length && <span className="section-sub">Answer all questions to submit.</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Component styles
// ---------------------------------------------------------------------

const CLS_CSS = `
.cls-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 16px; max-width: 1100px; }
.cls-card { background: var(--panel); border: 1px solid var(--border); border-top-width: 3px; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
.cls-card-head { display: flex; align-items: center; gap: 8px; }
.cls-level { font-size: 10px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; border: 1px solid; border-radius: 999px; padding: 2px 8px; }
.cls-category { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.cls-completed { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--accent-teal); }
.cls-card-title { font-size: 16px; margin: 0; }
.cls-card-tagline { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: 0; min-height: 36px; }
.cls-card-meta { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-muted); }
.cls-card-meta span { display: inline-flex; align-items: center; gap: 4px; }
.cls-open { align-self: flex-start; }
.cls-progress { height: 4px; border-radius: 999px; background: var(--panel-2); overflow: hidden; }
.cls-progress-fill { height: 100%; border-radius: 999px; transition: width 0.3s ease; }
.cls-progress-lg { height: 8px; max-width: 720px; margin: 16px 0 4px; }

.cls-back { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 14px; }
.cls-detail-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px; align-items: flex-start; }
.cls-cert-box { display: flex; gap: 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; max-width: 360px; }
.cls-cert-text { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.cls-cert-text strong { font-size: 13px; }
.cls-cert-text span { color: var(--text-muted); }

.cls-modules { display: flex; flex-direction: column; gap: 18px; max-width: 720px; margin-top: 18px; }
.cls-module-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 8px; }
.cls-lesson-row { display: grid; grid-template-columns: 20px 34px 1fr auto 16px; align-items: center; gap: 8px; width: 100%; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; cursor: pointer; font-size: 13px; color: var(--text); text-align: left; margin-bottom: 6px; }
.cls-lesson-row:hover { border-color: var(--accent-red); }
.cls-circle { color: var(--text-muted); }
.cls-lesson-num { color: var(--text-muted); font-size: 12px; }
.cls-lesson-name { font-weight: 600; }
.cls-lesson-min { color: var(--text-muted); font-size: 12px; }
.cls-chev { color: var(--text-muted); }

.cls-quiz-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; max-width: 720px; margin-top: 20px; }
.cls-quiz-card strong { font-size: 14px; }
.cls-quiz-card p { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); }

.cls-lesson-wrap { max-width: 780px; }
.cls-lesson-head { margin: 4px 0 16px; }
.cls-lesson-kicker { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent-red); margin-bottom: 6px; }
.cls-lesson-body { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
.cls-lesson-p { margin: 0; font-size: 14px; line-height: 1.7; color: var(--text); }
.cls-lesson-h { margin: 8px 0 0; font-size: 15px; }
.cls-lesson-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
.cls-lesson-list li { font-size: 14px; line-height: 1.6; color: var(--text); }
.cls-lesson-tip { display: flex; gap: 8px; background: rgba(76,110,245,0.1); border: 1px solid rgba(76,110,245,0.3); border-radius: 10px; padding: 12px 14px; font-size: 13px; line-height: 1.6; color: #b8c4f8; }
.cls-lesson-tip svg { flex-shrink: 0; margin-top: 2px; color: var(--accent-indigo); }
.cls-lesson-nav { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }

.cls-quiz-wrap { max-width: 780px; }
.cls-questions { display: flex; flex-direction: column; gap: 16px; }
.cls-question { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 18px; }
.cls-q-num { font-size: 11px; font-weight: 800; color: var(--accent-red); margin-bottom: 6px; }
.cls-q-text { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.cls-q-options { display: flex; flex-direction: column; gap: 8px; }
.cls-q-opt { text-align: left; background: var(--panel-2); border: 1px solid var(--border); color: var(--text); border-radius: 10px; padding: 10px 14px; font-size: 13px; cursor: pointer; }
.cls-q-opt:hover:not(:disabled) { border-color: var(--accent-indigo); }
.cls-q-selected { border-color: var(--accent-indigo); background: rgba(76,110,245,0.12); }
.cls-q-correct { border-color: var(--accent-teal); background: rgba(0,208,160,0.12); color: var(--accent-teal); }
.cls-q-wrong { border-color: var(--accent-red); background: rgba(255,68,79,0.12); color: #ff9aa0; }
.cls-q-dim { opacity: 0.45; }
.cls-q-explain { margin-top: 10px; font-size: 12px; line-height: 1.5; border-radius: 8px; padding: 10px 12px; }
.cls-q-explain-ok { background: rgba(0,208,160,0.08); color: #8fe8cd; }
.cls-q-explain-bad { background: rgba(255,68,79,0.08); color: #ffb0b5; }
.cls-result { display: flex; align-items: center; gap: 14px; border-radius: 14px; padding: 16px; margin-top: 18px; border: 1px solid; }
.cls-result-pass { border-color: rgba(0,208,160,0.4); background: rgba(0,208,160,0.08); }
.cls-result-fail { border-color: rgba(255,68,79,0.4); background: rgba(255,68,79,0.08); }
.cls-result-score { font-size: 30px; font-weight: 800; }
.cls-result-pass .cls-result-score { color: var(--accent-teal); }
.cls-result-fail .cls-result-score { color: var(--accent-red); }
.cls-result-text { display: flex; flex-direction: column; gap: 2px; font-size: 13px; flex: 1; }
.cls-result-text span { color: var(--text-muted); }
.cls-quiz-submit { display: flex; align-items: center; gap: 12px; margin-top: 18px; }
.cls-quiz-submit .section-sub { margin: 0; }

@media (max-width: 760px) {
  .cls-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
}
@media (max-width: 600px) {
  .cls-card-meta { flex-wrap: wrap; row-gap: 6px; }
  .cls-card-head { flex-wrap: wrap; }
  .cls-lesson-row { grid-template-columns: 18px 30px minmax(0, 1fr) 16px; }
  .cls-lesson-min { display: none; }
  .cls-lesson-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cls-lesson-body { padding: 16px; }
  .cls-quiz-card { flex-direction: column; align-items: flex-start; }
  .cls-result { flex-wrap: wrap; }
  .cls-cert-box { max-width: 100%; }
  .cls-detail-head { flex-direction: column; }
  .cls-lesson-nav { flex-wrap: wrap; }
  .cls-quiz-submit { flex-wrap: wrap; }
}
@media (max-width: 480px) {
  .cls-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .cls-card { padding: 12px; gap: 8px; }
  .cls-card-title { font-size: 13px; }
  .cls-card-tagline { font-size: 11px; min-height: 0; line-height: 1.4; }
  .cls-card-meta { gap: 4px 8px; font-size: 10px; }
  .cls-card-head { gap: 6px; }
  .cls-level { font-size: 9px; padding: 1px 6px; }
  .cls-category { display: none; }
  .cls-open { width: 100%; justify-content: center; padding: 7px 8px; font-size: 11px; }
  .cls-lesson-body { padding: 14px; }
  .cls-question { padding: 14px; }
  .cls-quiz-submit .btn-primary { width: 100%; }
  .cls-lesson-nav .btn-primary, .cls-lesson-nav .btn-outline { flex: 1; justify-content: center; }
}
`;

const _injectCls = () => {
  if (typeof document === 'undefined' || document.getElementById('cls-css')) return;
  const style = document.createElement('style');
  style.id = 'cls-css';
  style.textContent = CLS_CSS;
  document.head.appendChild(style);
};
_injectCls();
