/**
 * Deriv OAuth 2.0 + PKCE backend (newer OAuth/API architecture)
 * ---------------------------------------------------
 * Flow:
 *  1. Frontend links the user to Deriv's OAuth2 authorize URL (PKCE).
 *  2. User logs in on auth.deriv.com, approves the app.
 *  3. Deriv redirects to /auth/callback with a one-time `code` (+ `state`).
 *  4. We exchange the code for an OAuth2 access token, store it server-side
 *     against a session id, and redirect the user back to the frontend with
 *     just that session id (never put raw tokens in a URL the browser keeps
 *     in history/logs).
 *  5. The frontend calls our API with the session id. We use the access
 *     token against Deriv's REST API (api.derivws.com/trading/v1) to list
 *     accounts and request per-account OTP WebSocket URLs; real-time trading
 *     (balance, contracts, streams) runs over those OTP-authenticated
 *     WebSocket connections — no legacy `authorize` handshake.
 */

import 'dotenv/config'; // loads .env into process.env

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import WebSocket, { WebSocketServer } from 'ws';
import path from 'path';
import pg from 'pg';

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
// 12mb so base64 banner images can reach /api/upload before being handed
// off to Cloudinary (the DB only ever stores the resulting small URLs).
app.use(express.json({ limit: '12mb' }));

const PORT = process.env.PORT || 4000;
const DERIV_APP_ID = process.env.DERIV_APP_ID || '126958'; // used for REST API calls (Deriv-App-ID header)
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// DERIV_APP_ID must be the *numeric* app id from Deriv's classic app
// registration (api.deriv.com -> Manage Apps), used as the `app_id` query
// param on wss://ws.derivws.com. It is easy to confuse with DERIV_CLIENT_ID
// (the OAuth2 client id from developers.deriv.com), which is a long
// alphanumeric string and is NOT accepted by that WebSocket endpoint —
// using it here makes every Deriv API call fail with "InvalidAppID" (seen
// by clients as a 502 on balance/candles/trading endpoints). Warn loudly
// at startup so this misconfiguration is obvious instead of showing up as
// a mysterious 502 later.
if (!/^\d+$/.test(DERIV_APP_ID)) {
  console.warn(
    `[deriv] WARNING: DERIV_APP_ID="${DERIV_APP_ID}" does not look like a numeric Deriv app id. ` +
    'If this is actually your DERIV_CLIENT_ID (OAuth2), every Deriv API call will fail with ' +
    '"InvalidAppID". Get a numeric app id from https://api.deriv.com/dashboard and set it as ' +
    'DERIV_APP_ID separately from DERIV_CLIENT_ID.'
  );
}

// ---------------------------------------------------------------
// PostgreSQL (community data: users, activities, circles, bots,
// copy-trading strategies). On Render set DATABASE_URL to your
// instance's connection string. If it is missing the app still
// runs — community endpoints return 503 until a DB is configured.
// ---------------------------------------------------------------
const DATABASE_URL = process.env.DATABASE_URL;
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const dbConfig = DATABASE_URL
  ? { connectionString: DATABASE_URL }
  : (DB_HOST && DB_NAME && DB_USER && {
      host: DB_HOST,
      port: Number(DB_PORT) || 5432,
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
    });
let db = null;
if (dbConfig) {
  const { Pool } = pg;
  db = new Pool({
    ...dbConfig,
    ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
    max: 10,
  });
  db.on('error', (e) => console.error('[db] idle client error:', e.message));
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  loginid TEXT PRIMARY KEY,
  currency TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS activities (
  id BIGSERIAL PRIMARY KEY,
  loginid TEXT REFERENCES users(loginid) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activities_loginid ON activities(loginid, created_at DESC);
CREATE TABLE IF NOT EXISTS circles (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  banner TEXT,
  owner_loginid TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS circle_members (
  circle_id BIGINT REFERENCES circles(id) ON DELETE CASCADE,
  loginid TEXT,
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (circle_id, loginid)
);
CREATE TABLE IF NOT EXISTS bots (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  banner TEXT,
  xml TEXT,
  kind TEXT DEFAULT 'shared',
  owner_loginid TEXT,
  uses INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bots_kind ON bots(kind, created_at DESC);
CREATE TABLE IF NOT EXISTS copy_strategies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  banner TEXT,
  params JSONB DEFAULT '{}',
  owner_loginid TEXT,
  followers INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS copy_follows (
  id BIGSERIAL PRIMARY KEY,
  strategy_id BIGINT REFERENCES copy_strategies(id) ON DELETE CASCADE,
  loginid TEXT,
  stake_multiplier NUMERIC DEFAULT 1,
  followed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (strategy_id, loginid)
);
`;

async function initDb() {
  if (!db) return;
  try {
    await db.query(SCHEMA_SQL);
    // Migration for databases created before banner images were added.
    await db.query('ALTER TABLE circles ADD COLUMN IF NOT EXISTS banner TEXT');
    await db.query('ALTER TABLE bots ADD COLUMN IF NOT EXISTS banner TEXT');
    await db.query('ALTER TABLE copy_strategies ADD COLUMN IF NOT EXISTS banner TEXT');
    console.log('[db] connected — schema ready');
  } catch (e) {
    console.error('[db] init failed:', e.message);
  }
}
initDb();

// --- OAuth 2.0 + PKCE configuration (current Deriv flow) ---
// client_id is the OAuth2 client id from developers.deriv.com (an app id is a
// client id). redirect_uri MUST exactly match the one registered for the app.
const DERIV_CLIENT_ID = process.env.DERIV_CLIENT_ID || DERIV_APP_ID;
const DERIV_REDIRECT_URI = process.env.DERIV_REDIRECT_URI || `${'http://localhost:4000'}/auth/callback`;
const DERIV_SCOPES = process.env.DERIV_SCOPES || 'trade account_manage';

const DERIV_AUTH_BASE = 'https://auth.deriv.com';
// Deriv's newer REST API base. Authenticated calls send `Deriv-App-ID` and
// `Authorization: Bearer <oauth token>` headers; the per-account WebSocket
// URLs used for real-time trading come from its /otp endpoint.
const DERIV_REST_BASE = 'https://api.derivws.com/trading/v1';
// Public (token-less) market-data endpoint: active_symbols, ticks_history, ...
const DERIV_WS_PUBLIC = `${DERIV_REST_BASE}/options/ws/public`;

const DIST_DIR = path.join(process.cwd(), 'dist');

// Serve built frontend in production
app.use(express.static(DIST_DIR));

// --- In-memory session store (swap for Redis/DB in production) ---
// session: { oauth: 'v2', token, accounts: [{account, token, currency}], createdAt }
const sessions = new Map();

function createSession(data) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  sessions.set(sessionId, { ...data, createdAt: Date.now() });
  return sessionId;
}

// --- PKCE helpers (RFC 7636) ---
const pendingAuth = new Map(); // state -> { verifier, expiresAt }

function randomBase64Url(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Base64Url(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of pendingAuth) {
    if (entry.expiresAt < now) pendingAuth.delete(state);
  }
}, 60 * 1000);

// --- Step 1: give the frontend the Deriv OAuth URL to redirect to ---
app.get('/auth/login-url', (req, res) => {
  const mode = req.query.mode === 'register' ? 'register' : 'login';

  if (!DERIV_CLIENT_ID || /YOUR_APP_ID/.test(DERIV_CLIENT_ID)) {
    return res.status(500).json({ error: 'DERIV_CLIENT_ID is not configured. Register an app at developers.deriv.com and set DERIV_CLIENT_ID and DERIV_REDIRECT_URI in your .env file.' });
  }

  const state = randomBase64Url(24);
  const verifier = randomBase64Url(32);
  const challenge = sha256Base64Url(verifier);

  pendingAuth.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: DERIV_CLIENT_ID,
    redirect_uri: DERIV_REDIRECT_URI,
    scope: DERIV_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (mode === 'register') params.set('prompt', 'registration');

  res.json({ url: `${DERIV_AUTH_BASE}/oauth2/auth?${params.toString()}`, mode });
});

// --- Step 2a: new OAuth2 + PKCE callback (code + state) ---
async function handleOAuth2Callback(query) {
  const { code, state, error, error_description: errorDescription } = query;

  if (error) {
    return { redirect: `${FRONTEND_URL}/?error=${encodeURIComponent(errorDescription || error)}` };
  }
  if (!code || !state) {
    return { redirect: `${FRONTEND_URL}/?error=${encodeURIComponent('Missing code or state in callback')}` };
  }

  const attempt = pendingAuth.get(state);
  if (!attempt || attempt.expiresAt < Date.now()) {
    pendingAuth.delete(state);
    return { redirect: `${FRONTEND_URL}/?error=${encodeURIComponent('Invalid or expired state (possible CSRF)')}` };
  }
  pendingAuth.delete(state);

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: DERIV_CLIENT_ID,
      code,
      code_verifier: attempt.verifier,
      redirect_uri: DERIV_REDIRECT_URI,
    });

    const tokenRes = await fetch(`${DERIV_AUTH_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return { redirect: `${FRONTEND_URL}/?error=${encodeURIComponent(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 120)}`)}` };
    }

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return { redirect: `${FRONTEND_URL}/?error=${encodeURIComponent('No access_token returned by Deriv')}` };
    }

    const sessionId = createSession({
      oauth: 'v2',
      token: tokenData.access_token,
      accounts: [],
    });

    return { redirect: `${FRONTEND_URL}/?session=${sessionId}` };
  } catch (err) {
    return { redirect: `${FRONTEND_URL}/?error=${encodeURIComponent(`Token exchange failed: ${err.message}`)}` };
  }
}

// --- Step 2: Deriv redirects the browser here after login ---
app.get('/auth/callback', async (req, res) => {
  const outcome = await handleOAuth2Callback(req.query);
  res.redirect(outcome.redirect);
});

// --- Resolve the accounts for a session (v2 sessions hold an OAuth2 token) ---
// Uses Deriv's REST API (GET /trading/v1/options/accounts) with the OAuth2
// access token. The token authorizes every account linked to the Deriv user,
// so it is attached to each entry for the downstream OTP WebSocket calls
// (balance, proposal, buy, sell, ...).
async function accountsFromToken(token) {
  try {
    const restRes = await fetch(`${DERIV_REST_BASE}/options/accounts`, {
      headers: {
        'Deriv-App-ID': DERIV_APP_ID,
        Authorization: `Bearer ${token}`,
      },
    });
    if (restRes.ok) {
      const data = await restRes.json();
      const list = Array.isArray(data)
        ? data
        : (data.accounts || data.data || data.list || []);
      const accounts = list
        .map((a) => ({
          account: a.loginid || a.account_id || a.account || a.id,
          currency: a.currency || a.currency_code || 'USD',
          token,
        }))
        .filter((a) => a.account);
      if (accounts.length > 0) return accounts;
    }
  } catch { /* no accounts derivable */ }

  return [];
}

// --- Request the account-scoped, OTP-authenticated WebSocket URL (REST) ---
// Every authenticated WebSocket in this app — pooled requests, balance and
// contract streams — is opened to the URL returned here. The one-time
// password embedded in it authenticates the socket as `account`, so no
// `authorize` handshake is needed, and the OAuth2 access_token never has to
// go near the retired classic `authorize` command.
async function fetchOtpUrl(token, account) {
  const res = await fetch(
    `${DERIV_REST_BASE}/options/accounts/${encodeURIComponent(account)}/otp`,
    {
      method: 'POST',
      headers: {
        'Deriv-App-ID': DERIV_APP_ID,
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    let message = `Deriv OTP request failed (HTTP ${res.status})`;
    try {
      const body = await res.json();
      const errMsg = body?.errors?.[0]?.message || body?.error;
      if (errMsg) message = errMsg;
    } catch { /* non-JSON error body */ }
    throw Object.assign(new Error(message), { code: `OTP_HTTP_${res.status}` });
  }

  const data = await res.json();
  const url = data?.data?.url;
  if (!url) {
    throw Object.assign(new Error('Deriv did not return a WebSocket URL for this account'), { code: 'OTP_NO_URL' });
  }
  return url;
}

// --- Step 3: frontend asks for the (non-secret) account list for a session ---
const loginNotified = new Set(); // session ids that already logged a 'login' activity
app.get('/api/accounts', async (req, res) => {
  const { session } = req.query;
  const data = sessions.get(session);
  if (!data) return res.status(404).json({ error: 'Session not found or expired' });

  let accounts = data.accounts || [];

  if (data.oauth === 'v2' && accounts.length === 0) {
    accounts = await accountsFromToken(data.token);
    if (accounts.length > 0) data.accounts = accounts;
  }

  // Log the first account resolution as a 'login' activity, once per session.
  if (accounts.length > 0 && !loginNotified.has(session)) {
    loginNotified.add(session);
    logActivity(accounts[0].account, 'login', { accounts: accounts.length });
  }

  // Only expose account id + currency, never the token, to the browser
  res.json({ accounts: accounts.map(({ account, currency }) => ({ account, currency })) });
});

// --- Step 4: fetch balance for a specific account via Deriv WebSocket API ---
app.get('/api/balance', async (req, res) => {
  const { session, account } = req.query;
  const data = sessions.get(session);
  if (!data) return res.status(404).json({ error: 'Session not found or expired' });

  const acctData = (data.accounts || []).find((a) => a.account === account)
    || (data.token ? { token: data.token } : null);
  if (!acctData) return res.status(404).json({ error: 'Account not found in session' });

  try {
    const result = await derivRequest(acctData.token, { balance: 1 }, { label: 'balance', context: { account } });
    res.json(result.balance);
  } catch (err) {
    apiError(res, 502, err);
  }
});

// ---------------------------------------------------------------
// Deriv contract trading (Manual Trader)
// ---------------------------------------------------------------

// Resolve the token + currency for a specific account in a session.
// OAuth2 sessions carry a single access token (data.token) that is attached
// to every account entry when the list is resolved. Returns null if the
// account is not in the session.
function resolveAccount(data, account) {
  const entry = (data.accounts || []).find((a) => a.account === account)
    || (data.token ? { account: null, token: data.token, currency: undefined } : null);
  if (!entry) return null;
  return {
    account: entry.account || account || null,
    currency: entry.currency,
    token: entry.token || data.token,
  };
}

function findSession(req, res) {
  const { session } = req.body || {};
  const sid = session || req.query.session;
  const data = sessions.get(sid);
  if (!data) return res.status(404).json({ error: 'Session not found or expired' });
  const account = (req.body && req.body.account) || req.query.account;
  const acct = resolveAccount(data, account);
  if (!acct) return res.status(404).json({ error: 'Account not found in session' });
  return { data, acct };
}

// Standard API error response: always include the deriv error code + details
// (not just the HTTP status) so failures are diagnosable end-to-end.
function apiError(res, status, err) {
  const body = { error: err.message };
  if (err.code) body.code = err.code;
  if (err.details) body.details = err.details;
  res.status(status).json(body);
}

// Contract types available for a symbol on the logged-in account.
app.get('/api/contracts_for', async (req, res) => {
  const ctx = findSession(req, res);
  if (!ctx) return;

  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  try {
    const result = await derivRequest(ctx.acct.token, {
      contracts_for: symbol,
      currency: ctx.acct.currency || 'USD',
    }, { label: 'contracts_for', context: { symbol, account: ctx.acct.account } });
    res.json({ contracts_for: result.contracts_for });
  } catch (err) {
    apiError(res, 502, err);
  }
});

// Price a contract (proposal) — never trades, just quotes.
app.post('/api/contract/proposal', async (req, res) => {
  const ctx = findSession(req, res);
  if (!ctx) return;

  const { symbol, contract_type, amount, basis = 'stake', duration, duration_unit = 'm', currency, barrier, barrier2, prediction } = req.body || {};
  if (!symbol || !contract_type || amount == null || duration == null) {
    return res.status(400).json({ error: 'Missing symbol, contract_type, amount or duration' });
  }

  try {
    const payload = {
      proposal: 1,
      amount,
      basis,
      contract_type,
      currency: currency || ctx.acct.currency || 'USD',
      duration,
      duration_unit,
      symbol,
    };
    // Digits (Matches/Differs/Over/Under), Highs/Lows and Ends In/Out carry
    // barriers; Accumulators use a `prediction` instead. Forward them so
    // those trade types actually price correctly.
    if (barrier !== undefined && barrier !== '') payload.barrier = barrier;
    if (barrier2 !== undefined && barrier2 !== '') payload.barrier2 = barrier2;
    if (prediction !== undefined && prediction !== '') payload.prediction = prediction;
    const result = await derivRequest(ctx.acct.token, payload, { label: 'proposal', context: { symbol, contract_type, account: ctx.acct.account } });
    res.json({ proposal: result.proposal });
  } catch (err) {
    apiError(res, 502, err);
  }
});

// Buy a real contract from a proposal id + price.
app.post('/api/contract/buy', async (req, res) => {
  const ctx = findSession(req, res);
  if (!ctx) return;

  const { proposal_id, price } = req.body || {};
  if (!proposal_id || price == null) {
    return res.status(400).json({ error: 'Missing proposal_id or price' });
  }

  try {
    const result = await derivRequest(ctx.acct.token, { buy: proposal_id, price }, { label: 'buy', context: { account: ctx.acct.account } });
    res.json({ buy: result.buy });
  } catch (err) {
    apiError(res, 502, err);
  }
});

// Sell an open contract early at the given price (from proposal_open_contract.sell_price).
app.post('/api/contract/sell', async (req, res) => {
  const ctx = findSession(req, res);
  if (!ctx) return;

  const { contract_id, price } = req.body || {};
  if (!contract_id || price == null) {
    return res.status(400).json({ error: 'Missing contract_id or price' });
  }

  try {
    const result = await derivRequest(ctx.acct.token, { sell: contract_id, price }, { label: 'sell', context: { account: ctx.acct.account } });
    res.json({ sell: result.sell });
  } catch (err) {
    apiError(res, 502, err);
  }
});

// List currently open contracts for the account.
app.get('/api/contract/open', async (req, res) => {
  const ctx = findSession(req, res);
  if (!ctx) return;

  try {
    const result = await derivRequest(ctx.acct.token, { portfolio: 1 }, { label: 'portfolio', context: { account: ctx.acct.account } });
    res.json({ contracts: (result.portfolio && result.portfolio.contracts) || [] });
  } catch (err) {
    apiError(res, 502, err);
  }
});

// ---------------------------------------------------------------
// Cashier (Deposit / Withdraw via Deriv's own cashier pages)
// ---------------------------------------------------------------
// The `cashier` API returns the URL of Deriv's hosted deposit/withdrawal
// page for the logged-in account, which we embed via an iframe. Fiat
// accounts use the `doughflow` provider (a hosted cashier page). Crypto
// withdrawals additionally require an email verification code
// (ASK_EMAIL_VERIFY -> verify_email -> retry with the code).
const CRYPTO_CURRENCIES = new Set([
  'BTC', 'ETH', 'LTC', 'USDT', 'USDC', 'DAI', 'UST', 'TUSD',
  'eUSDT', 'tUSDT', 'TUSDT', 'USDT_TRC20', 'USDT_ERC20', 'BTCW', 'ETW', 'LTCW',
]);

function cashierProvider(currency) {
  return CRYPTO_CURRENCIES.has(String(currency || '').toUpperCase()) ? 'crypto' : 'doughflow';
}

// Open Deriv's cashier page (deposit or withdraw) for the account.
app.post('/api/cashier', async (req, res) => {
  const ctx = findSession(req, res);
  if (!ctx) return;

  const { action, verification_code } = req.body || {};
  const cashierAction = action === 'withdraw' ? 'withdraw' : 'deposit';
  const provider = cashierProvider(ctx.acct.currency);

  const payload = { cashier: cashierAction, provider };
  if (provider === 'crypto') payload.type = 'url';
  if (cashierAction === 'withdraw' && provider === 'doughflow' && verification_code) {
    payload.verification_code = verification_code;
  }

  try {
    const result = await derivRequest(ctx.acct.token, payload, { context: { account: ctx.acct.account } });
    const info = result.cashier;
    const url = typeof info === 'string' ? info : (info && (info.url || info.cashier_url)) || null;
    if (!url) {
      return res.status(502).json({ error: 'Deriv did not return a cashier page for this account.' });
    }
    logActivity(ctx.acct.account, cashierAction === 'deposit' ? 'deposit' : 'withdraw', {});
    res.json({ url, provider });
  } catch (err) {
    if (err.code === 'ASK_EMAIL_VERIFY') {
      return res.json({ needVerification: true, error: err.message });
    }
    res.status(502).json({ error: err.message, code: err.code });
  }
});

// Send the email verification code required for withdrawals.
app.post('/api/cashier/verify-email', async (req, res) => {
  const ctx = findSession(req, res);
  if (!ctx) return;

  const { type = 'withdraw' } = req.body || {};
  try {
    const settings = await derivRequest(ctx.acct.token, { get_settings: 1 }, { context: { account: ctx.acct.account } });
    const email = settings.get_settings && settings.get_settings.email;
    if (!email) return res.status(502).json({ error: 'Could not read the account email from Deriv.' });
    await derivRequest(ctx.acct.token, { verify_email: email, type }, { context: { account: ctx.acct.account } });
    res.json({ ok: true, email });
  } catch (err) {
    res.status(502).json({ error: err.message, code: err.code });
  }
});

// --- Deriv diagnostic logging ---
// One-line JSON per entry so Render's console stays greppable. `kind`
// names the failure (RETRY, FAIL, DERIV_ERROR, STREAM_STATUS, ...) and
// `extra` carries the request context (route, symbol, account, code).
function derivLog(level, kind, msg, extra = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), kind, msg, ...extra });
  const line = `[deriv] ${entry}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// Read the body of a rejected WS upgrade. Deriv explains HTTP statuses like
// the 401 rate-limit in the upgrade response body — status alone isn't enough.
function readUpgradeBody(res) {
  return new Promise((resolve) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1000) res.destroy();
    });
    res.on('end', () => resolve(body));
    res.on('error', () => resolve(body));
  });
}

// Default request label: the Deriv msg_type key(s) of the request.
const derivCtx = (request) => Object.keys(request).filter((k) => k !== 'req_id').join(',');

// ---------------------------------------------------------------
// Deriv WS connection pool
// ---------------------------------------------------------------
// Deriv rate-limits shared/test app ids (esp. from datacenter IPs like
// Render) by answering WS upgrades with an HTTP 401 when too many
// connections arrive in a short burst. Opening a brand-new WebSocket
// for every single API call — accounts, balance, contracts_for, proposal,
// buy — multiplies that risk and is the most common cause of the 502s
// users see when loading the wallet balance. Instead we keep one
// connection per (token, account) (plus one shared connection for public,
// token-less requests) open for a short idle window and multiplex every
// request over it using `req_id`, so a page load that fires off several
// API calls back-to-back reuses a single WS handshake.
const derivPool = new Map(); // key -> pool entry
let derivReqSeq = 1;
const DERIV_POOL_IDLE_MS = 30000;
const DERIV_REQUEST_TIMEOUT_MS = 10000;

// A pooled connection is scoped to (token, account): the OAuth2 access token
// authorizes every account linked to the user, but the authenticated
// WebSocket is fetched per-account from the DerivWS OTP endpoint, so two
// accounts on the same session never share a socket.
function poolKey(token, account) {
  return token ? `${token}:${account || ''}` : '__public__';
}

// Connection-level failures (bad handshake, timeout, socket error) are
// safe to retry with a fresh connection. Genuine Deriv API errors
// (InvalidToken, RateLimit, ContractBuyValidationError, ...) are not.
function isRetryableCode(code) {
  return code === 'TIMEOUT' || code === 'CONNECT' || (typeof code === 'string' && code.startsWith('WS_HTTP_'));
}

function closePoolEntry(key, err) {
  const entry = derivPool.get(key);
  if (!entry || entry.closed) return;
  entry.closed = true;
  derivPool.delete(key);
  clearTimeout(entry.idleTimer);
  const closeErr = err || Object.assign(new Error('Deriv connection closed'), { code: 'CONNECT' });
  if (entry.readyReject) entry.readyReject(closeErr);
  for (const waiter of entry.pending.values()) waiter.reject(closeErr);
  entry.pending.clear();
  try { entry.ws.close(); } catch { /* noop */ }
}

function touchPoolEntry(entry, key) {
  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => closePoolEntry(key), DERIV_POOL_IDLE_MS);
}

async function openPoolConnection(token, account, key) {
  const entry = {
    ws: null,
    pending: new Map(),
    idleTimer: null,
    closed: false,
    readyResolve: null,
    readyReject: null,
  };
  entry.ready = new Promise((resolve, reject) => {
    entry.readyResolve = resolve;
    entry.readyReject = reject;
  });
  derivPool.set(key, entry);

  try {
    // Authenticated connections use Deriv's newer OAuth/API architecture:
    // request the per-account, OTP-authenticated WebSocket URL from the REST
    // API and connect to it. The one-time password in the URL authenticates
    // the socket as `account`, so no `authorize` handshake is needed — and
    // the OAuth2 access_token would be rejected by the retired classic
    // `authorize` command anyway. Public (token-less) requests connect to
    // the shared public market-data endpoint instead.
    const wsUrl = account
      ? await fetchOtpUrl(token, account)
      : DERIV_WS_PUBLIC;
    const ws = new WebSocket(wsUrl);
    entry.ws = ws;

    ws.on('open', () => {
      entry.readyResolve();
    });

    ws.on('message', (msg) => {
      let response;
      try { response = JSON.parse(msg); } catch { return; }

      const waiter = response.req_id != null ? entry.pending.get(response.req_id) : null;
      if (!waiter) return; // unmatched/unsolicited push — ignore here
      entry.pending.delete(response.req_id);
      if (response.error) {
        const err = new Error(response.error.message);
        err.code = response.error.code;
        err.details = response.error.details;
        waiter.reject(err);
      } else {
        waiter.resolve(response);
      }
    });

    ws.on('unexpected-response', (req, res) => {
      readUpgradeBody(res).then((body) => {
        const err = new Error(`Deriv WS upgrade rejected with HTTP ${res.statusCode}`);
        err.code = `WS_HTTP_${res.statusCode}`;
        err.details = body.slice(0, 1000) || null;
        closePoolEntry(key, err);
      });
    });

    ws.on('error', (err) => {
      closePoolEntry(key, Object.assign(new Error(err.message), { code: 'CONNECT' }));
    });

    ws.on('close', () => closePoolEntry(key));
  } catch (err) {
    derivLog('error', 'CONNECT_FAIL', `could not open Deriv connection: ${err.message}`, {
      account: account || null,
      code: err.code || null,
    });
    closePoolEntry(key, err);
  }

  return entry;
}

async function getPoolConnection(token, account) {
  const key = poolKey(token, account);
  let entry = derivPool.get(key);
  if (!entry || entry.closed || !entry.ws || entry.ws.readyState > WebSocket.OPEN) {
    entry = await openPoolConnection(token, account, key);
  }
  await entry.ready;
  touchPoolEntry(entry, key);
  return entry;
}

function sendPooled(entry, request) {
  return new Promise((resolve, reject) => {
    const reqId = derivReqSeq++;
    const timeout = setTimeout(() => {
      entry.pending.delete(reqId);
      reject(Object.assign(new Error('Deriv API request timed out'), { code: 'TIMEOUT' }));
    }, DERIV_REQUEST_TIMEOUT_MS);
    entry.pending.set(reqId, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });
    try {
      entry.ws.send(JSON.stringify({ ...request, req_id: reqId }));
    } catch (err) {
      clearTimeout(timeout);
      entry.pending.delete(reqId);
      reject(err);
    }
  });
}

// --- Send one request over a pooled, reused Deriv WS connection ---
// Authenticated requests need a token AND the target account (context.account),
// which selects the per-account OTP WebSocket URL. Pass `null` for public
// endpoints (ticks_history, active_symbols) that do not require a token.
// Connection-level failures are retried with a short backoff and every
// attempt is logged with the server's rejection body so the underlying
// reason is visible in the logs (and not just a generic 502 downstream).
async function derivRequest(token, request, ctx = {}) {
  const { label = derivCtx(request), context = {}, attempts = 3 } = ctx;
  const account = context.account; // authenticated pool connections are per-account
  const logExtra = { label, ...context };
  let lastErr = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const entry = await getPoolConnection(token, account);
      const response = await sendPooled(entry, request);
      if (attempt > 1) derivLog('warn', 'RETRIED_OK', 'succeeded after retries', { ...logExtra, attempt });
      return response;
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableCode(err.code);
      const extra = { ...logExtra, attempt, of: attempts, code: err.code || null, details: err.details || err.message };
      if (!retryable) {
        derivLog('error', 'DERIV_ERROR', err.message, extra);
        throw err;
      }
      if (attempt >= attempts) {
        derivLog('error', 'FAIL', `giving up: ${err.message}`, extra);
        throw err;
      }
      derivLog('warn', 'RETRY', 'retrying after connection-level failure', extra);
      await new Promise((r) => setTimeout(r, 300 * attempt + Math.floor(Math.random() * 200)));
    }
  }
  throw lastErr;
}

// Attach diagnostics to the long-lived streams (tick/contract/balance):
// log the upgrade rejection status+body and socket errors with context,
// without touching the existing reconnect/close handling.
function attachStreamDiag(ws, kind, context = {}) {
  ws.on('unexpected-response', (req, res) => {
    readUpgradeBody(res).then((body) => {
      derivLog('error', 'STREAM_STATUS', `WS upgrade rejected for ${kind}`, {
        ...context,
        code: `WS_HTTP_${res.statusCode}`,
        details: body.slice(0, 1000) || null,
      });
    });
  });
  ws.on('error', (err) => {
    derivLog('error', 'STREAM_ERROR', `${kind}: ${err.message}`, context);
  });
}

// ---------------------------------------------------------------
// Community + activity (PostgreSQL-backed)
// ---------------------------------------------------------------

// Resolve the Deriv loginid for an authenticated request. A session id
// alone proves the browser owns the OAuth session; we additionally
// require the requested account to belong to that session.
function sessionLoginid(req) {
  const session = req.body?.session || req.query.session;
  const data = session ? sessions.get(session) : null;
  if (!data) return null;
  const account = req.body?.account || req.query.account;
  if (account) {
    const known = (data.accounts || []).find((a) => a.account === account);
    if (known) return known.account;
    // OAuth2 single-token sessions before the account list is resolved
    if (data.token && (!data.accounts || data.accounts.length === 0)) return account;
    return null;
  }
  return null;
}

async function logActivity(loginid, type, detail = {}) {
  if (!db || !loginid) return;
  try {
    await db.query(
      'INSERT INTO users (loginid, last_seen_at) VALUES ($1, now()) ON CONFLICT (loginid) DO UPDATE SET last_seen_at = now()',
      [loginid]
    );
    await db.query(
      'INSERT INTO activities (loginid, type, detail) VALUES ($1, $2, $3)',
      [loginid, type, JSON.stringify(detail)]
    );
  } catch (e) {
    console.error('[db] activity log failed:', e.message);
  }
}

// Log an arbitrary activity for the logged-in user (fire-and-forget).
app.post('/api/activity', (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.json({ ok: true, skipped: true });
  const { type, detail } = req.body || {};
  if (!type) return res.status(400).json({ error: 'Missing activity type' });
  logActivity(loginid, type, detail || {});
  res.json({ ok: true });
});

// Recent activity feed for the logged-in user.
app.get('/api/activity', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.json({ activities: [] });
  try {
    const { rows } = await db.query(
      'SELECT type, detail, created_at FROM activities WHERE loginid = $1 ORDER BY created_at DESC LIMIT 30',
      [loginid]
    );
    res.json({ activities: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Circles ---
app.get('/api/circles', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const loginid = sessionLoginid(req);
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.description, c.banner, c.owner_loginid,
              COUNT(m.loginid)::int AS members,
              COALESCE(BOOL_OR(m.loginid = $1), false) AS joined
         FROM circles c
         LEFT JOIN circle_members m ON m.circle_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC`,
      [loginid]
    );
    res.json({ circles: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/circles', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const { name, description, banner } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO circles (name, description, banner, owner_loginid) VALUES ($1, $2, $3, $4) RETURNING id, name, description, banner, owner_loginid',
      [name, description || '', banner || null, loginid]
    );
    await db.query(
      "INSERT INTO circle_members (circle_id, loginid, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING",
      [rows[0].id, loginid]
    );
    logActivity(loginid, 'circle_create', { circle_id: rows[0].id, name });
    res.json({ circle: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/circles/:id/join', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const id = Number(req.params.id);
  const joined = req.body?.joined === true;
  try {
    if (joined) {
      await db.query(
        "INSERT INTO circle_members (circle_id, loginid, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
        [id, loginid]
      );
      logActivity(loginid, 'circle_join', { circle_id: id });
    } else {
      await db.query(
        "DELETE FROM circle_members WHERE circle_id = $1 AND loginid = $2 AND role <> 'owner'",
        [id, loginid]
      );
      logActivity(loginid, 'circle_leave', { circle_id: id });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/circles/:id/members', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { rows } = await db.query(
      `SELECT m.loginid, m.role, m.joined_at, u.last_seen_at
         FROM circle_members m
         LEFT JOIN users u ON u.loginid = m.loginid
        WHERE m.circle_id = $1
        ORDER BY (m.role = 'owner') DESC, m.joined_at ASC`,
      [Number(req.params.id)]
    );
    res.json({ members: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Bots (free + shared) ---
app.get('/api/bots', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const loginid = sessionLoginid(req);
  const kind = req.query.kind === 'free' ? 'free' : 'shared';
  try {
    const { rows } = await db.query(
      `SELECT id, name, description, banner, kind, owner_loginid, uses, created_at,
              (owner_loginid = $2) AS owned
         FROM bots WHERE kind = $1
        ORDER BY created_at DESC`,
      [kind, loginid]
    );
    res.json({ bots: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bots', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const { name, description, banner, xml, kind = 'shared' } = req.body || {};
  if (!name || !xml) return res.status(400).json({ error: 'Name and strategy XML are required' });
  const k = kind === 'free' ? 'free' : 'shared';
  try {
    const { rows } = await db.query(
      'INSERT INTO bots (name, description, banner, xml, kind, owner_loginid) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, kind, owner_loginid',
      [name, description || '', banner || null, xml, k, loginid]
    );
    logActivity(loginid, k === 'free' ? 'bot_upload_free' : 'bot_share', { bot_id: rows[0].id, name });
    res.json({ bot: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/bots/:id/xml', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { rows } = await db.query('SELECT xml FROM bots WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Bot not found' });
    res.json({ xml: rows[0].xml });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bots/:id/use', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const loginid = sessionLoginid(req);
  try {
    await db.query('UPDATE bots SET uses = uses + 1 WHERE id = $1', [Number(req.params.id)]);
    if (loginid) logActivity(loginid, 'bot_use', { bot_id: Number(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/bots/:id', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  try {
    await db.query('DELETE FROM bots WHERE id = $1 AND owner_loginid = $2', [Number(req.params.id), loginid]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Copy-trading strategies ---
app.get('/api/copy/strategies', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const loginid = sessionLoginid(req);
  try {
    const { rows } = await db.query(
      `SELECT id, name, description, banner, params, owner_loginid, followers, status, created_at,
              (owner_loginid = $1) AS owned
         FROM copy_strategies
        ORDER BY created_at DESC`,
      [loginid]
    );
    res.json({ strategies: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/copy/strategies', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const { name, description, banner, params } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO copy_strategies (name, description, banner, params, owner_loginid) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description || '', banner || null, JSON.stringify(params || {}), loginid]
    );
    logActivity(loginid, 'copy_strategy_create', { strategy_id: rows[0].id, name });
    res.json({ strategy: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/copy/strategies/:id/follow', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  const id = Number(req.params.id);
  const following = req.body?.following === true;
  try {
    if (following) {
      const ins = await db.query(
        'INSERT INTO copy_follows (strategy_id, loginid) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, loginid]
      );
      if (ins.rowCount === 1) {
        await db.query('UPDATE copy_strategies SET followers = followers + 1 WHERE id = $1', [id]);
      }
      logActivity(loginid, 'copy_follow', { strategy_id: id });
    } else {
      await db.query('DELETE FROM copy_follows WHERE strategy_id = $1 AND loginid = $2', [id, loginid]);
      await db.query('UPDATE copy_strategies SET followers = GREATEST(followers - 1, 0) WHERE id = $1', [id]);
      logActivity(loginid, 'copy_unfollow', { strategy_id: id });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/copy/follows', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.json({ follows: [] });
  try {
    const { rows } = await db.query('SELECT strategy_id FROM copy_follows WHERE loginid = $1', [loginid]);
    res.json({ follows: rows.map((r) => r.strategy_id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/copy/strategies/:id', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  if (!db) return res.status(503).json({ error: 'Database not configured' });
  try {
    await db.query('DELETE FROM copy_strategies WHERE id = $1 AND owner_loginid = $2', [Number(req.params.id), loginid]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// AI Hub (Google Gemini)
// Proxies requests to the Gemini API so the API key never leaves
// the server. Add GEMINI_API_KEY to .env to enable.
// ---------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Primary model + fallbacks, tried in order when one returns a quota
// (429) or transient 5xx. GEMINI_MODEL can be a single model or a
// comma-separated chain, e.g. GEMINI_MODEL="gemini-2.5-flash,gemini-2.0-flash".
const GEMINI_MODELS = (process.env.GEMINI_MODEL || 'gemini-2.0-flash')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (GEMINI_MODELS.length === 0) GEMINI_MODELS.push('gemini-2.0-flash');

app.get('/api/ai/status', (req, res) => {
  res.json({ configured: !!GEMINI_API_KEY, model: GEMINI_MODELS[0], models: GEMINI_MODELS });
});

app.post('/api/ai', async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'AI is not configured — add GEMINI_API_KEY to the server env.' });
  const { prompt, context, temperature = 0.7 } = req.body || {};
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'Missing prompt' });
  const systemInstruction = context || 'You are an expert trading assistant for a Deriv binary-options bot called PronoFX Dbot. Be concise, practical and honest about risk. You can reference synthetic indices, forex and crypto symbols. Never promise guaranteed profits.';
  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: String(prompt).slice(0, 4000) }] }],
    generationConfig: { temperature: Math.min(Math.max(temperature, 0), 1) },
  };

  let lastErr = 'Gemini request failed';
  for (const model of GEMINI_MODELS) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        lastErr = `Gemini API error (${resp.status}) on ${model}: ${errText.slice(0, 200)}`;
        // No point trying another model for an invalid API key/auth failure.
        if (resp.status === 400 || resp.status === 401 || resp.status === 403) break;
        await new Promise((r) => setTimeout(r, 700));
        continue;
      }
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      return res.json({ text, model });
    } catch (e) {
      lastErr = `Gemini request failed on ${model}: ${e.message}`;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  res.status(500).json({ error: lastErr });
});

// ---------------------------------------------------------------
// Image uploads (Cloudinary)
// Banner pickers read images as base64 data URLs; this endpoint hands
// them to Cloudinary and returns the hosted URL, so the database only
// stores small URLs (no PayloadTooLarge errors, no giant DB rows).
// Set CLOUDINARY_URL (cloudinary://API_KEY:API_SECRET@CLOUD_NAME) in
// .env to enable. Without it the data URL is echoed back so community
// uploads still work locally in development.
// ---------------------------------------------------------------
const CLOUDINARY_PARTS = (process.env.CLOUDINARY_URL || '')
  .match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);

function uploadToCloudinary(dataUrl) {
  if (!CLOUDINARY_PARTS) return Promise.reject(new Error('CLOUDINARY_URL is not configured'));
  const [, api_key, api_secret, cloud_name] = CLOUDINARY_PARTS;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`timestamp=${timestamp}${api_secret}`).digest('hex');
  const form = new FormData();
  form.append('file', dataUrl);
  form.append('api_key', api_key);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);
  return fetch(`https://api.cloudinary.com/v1_1/${cloud_name}/image/upload`, { method: 'POST', body: form })
    .then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error?.message || `Cloudinary HTTP ${r.status}`);
      return body.secure_url || body.url;
    });
}

app.post('/api/upload', async (req, res) => {
  const loginid = sessionLoginid(req);
  if (!loginid) return res.status(401).json({ error: 'Not authenticated' });
  const { data } = req.body || {};
  if (!data || typeof data !== 'string') return res.status(400).json({ error: 'Missing image data' });
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!m) return res.status(400).json({ error: 'Image must be a base64 data URL' });
  const raw = Buffer.from(m[2], 'base64');
  if (!raw.length) return res.status(400).json({ error: 'Empty image data' });
  if (raw.length > 800 * 1024) return res.status(400).json({ error: 'Image too large (max 800 KB)' });
  if (!CLOUDINARY_PARTS) return res.json({ url: data }); // dev fallback
  try {
    const url = await uploadToCloudinary(data);
    res.json({ url });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------------------------------------------------------------
// Public market data: symbol catalog + candle history
// ---------------------------------------------------------------

const FX_SYMBOLS = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY'];
const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD', 'LTCUSD', 'SOLUSD', 'ADAUSD', 'DOTUSD', 'MATICUSD'];
const COMMODITY_SYMBOLS = ['XAUUSD', 'XAGUSD', 'XAUSPD'];

// Static fallback catalog (real Deriv symbols + metadata) used only when the
// live `active_symbols` request to Deriv fails, so the UI still works offline.
const FALLBACK_SYMBOLS = [
  { symbol: 'R_10', name: 'Volatility 10 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'R_25', name: 'Volatility 25 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'R_50', name: 'Volatility 50 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'R_75', name: 'Volatility 75 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'R_100', name: 'Volatility 100 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'VRTC', name: 'Volatility 250 (1s) Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'BOOM300', name: 'Boom 300 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'BOOM500', name: 'Boom 500 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'BOOM1000', name: 'Boom 1000 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'CRASH300', name: 'Crash 300 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'CRASH500', name: 'Crash 500 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'CRASH1000', name: 'Crash 1000 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'STEPSINDEX', name: 'Step Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'STP10M', name: 'Step Index 10M', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  { symbol: 'RDB1000', name: 'Range Break 1000 Index', market: 'synthetic_index', pip: 0.01, pipSize: 0.0001, decimals: 2 },
  ...FX_SYMBOLS.map((s) => ({ symbol: s, name: s, market: 'forex', pip: 0.0001, pipSize: 0.00001, decimals: 5 })),
  ...CRYPTO_SYMBOLS.map((s) => ({ symbol: s, name: s, market: 'cryptocurrency', pip: 1, pipSize: 0.1, decimals: 1 })),
  { symbol: 'XAUUSD', name: 'Gold/USD', market: 'commodities', pip: 0.01, pipSize: 0.001, decimals: 3 },
  { symbol: 'XAGUSD', name: 'Silver/USD', market: 'commodities', pip: 0.01, pipSize: 0.001, decimals: 3 },
];

const symbolCache = { data: null, at: 0, source: null };
const SYMBOL_CACHE_MS = 6 * 60 * 60 * 1000; // refresh the catalog every 6h

// Candidate catalog for app ids where `active_symbols` is disabled (e.g. the
// default test app id). Each entry: [symbol, display name].
const CANDIDATE_SYMBOLS = [
  ['R_10', 'Volatility 10 Index'], ['R_25', 'Volatility 25 Index'], ['R_50', 'Volatility 50 Index'],
  ['R_75', 'Volatility 75 Index'], ['R_100', 'Volatility 100 Index'],
  ['1HZ10V', 'Volatility 10 (1s) Index'], ['1HZ25V', 'Volatility 25 (1s) Index'],
  ['1HZ50V', 'Volatility 50 (1s) Index'], ['1HZ75V', 'Volatility 75 (1s) Index'],
  ['1HZ100V', 'Volatility 100 (1s) Index'], ['VRTC', 'Volatility 250 (1s) Index'],
  ['BOOM300', 'Boom 300 Index'], ['BOOM500', 'Boom 500 Index'], ['BOOM1000', 'Boom 1000 Index'],
  ['CRASH300', 'Crash 300 Index'], ['CRASH500', 'Crash 500 Index'], ['CRASH1000', 'Crash 1000 Index'],
  ['STEPSINDEX', 'Step Index'], ['STP10M', 'Step Index 10M'], ['RDB1000', 'Range Break 1000 Index'],
  ['jump10', 'Jump 10 Index'], ['jump25', 'Jump 25 Index'], ['jump50', 'Jump 50 Index'],
  ['jump75', 'Jump 75 Index'], ['jump100', 'Jump 100 Index'],
  ...FX_SYMBOLS.map((s) => [s, s]),
  ...CRYPTO_SYMBOLS.map((s) => [s, s]),
  ['XAUUSD', 'Gold/USD'], ['XAGUSD', 'Silver/USD'],
];

// Probe a list of symbols with a single WS connection; returns the ones that
// actually answer for this app id. Used when active_symbols is unavailable.
// NOTE: `ticks_history` with `style: 'candles'` answers with `msg_type: 'candles'`
// (NOT 'history'), so both shapes are accepted. Retries on connection errors
// (Deriv's shared test app ids occasionally answer the WS upgrade with a 401).
function probeAvailableSymbols(candidates) {
  return new Promise((resolve, reject) => {
    const valid = [];
    let index = 0;
    let attempts = 3;
    let ws;

    const cleanup = () => { try { ws.close(); } catch { /* noop */ } };

    const tryConnect = () => {
      ws = new WebSocket(DERIV_WS_PUBLIC);
      const timeout = setTimeout(() => { cleanup(); resolve(valid); }, 20000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ ticks_history: candidates[index][0], count: 1, end: 'latest', granularity: 60, style: 'candles' }));
      });
      ws.on('message', (msg) => {
        let response;
        try { response = JSON.parse(msg); } catch { return; }
        const candleOk = response.msg_type === 'candles' && response.candles && response.candles.length > 0;
        const historyOk = response.msg_type === 'history' && response.history && response.history.prices && response.history.prices.length > 0;
        if (candleOk || historyOk) valid.push(candidates[index]);
        index += 1;
        if (index >= candidates.length) {
          clearTimeout(timeout);
          cleanup();
          resolve(valid);
        } else {
          ws.send(JSON.stringify({ ticks_history: candidates[index][0], count: 1, end: 'latest', granularity: 60, style: 'candles' }));
        }
      });
      ws.on('unexpected-response', (req, res) => {
        readUpgradeBody(res).then((body) => {
          derivLog('error', 'STREAM_STATUS', 'WS upgrade rejected during symbol probe', {
            code: `WS_HTTP_${res.statusCode}`,
            details: body.slice(0, 1000) || null,
            candidate: candidates[index] ? candidates[index][0] : null,
            index,
            of: candidates.length,
          });
          clearTimeout(timeout);
          cleanup();
          attempts -= 1;
          if (attempts > 0 && index < candidates.length) {
            setTimeout(tryConnect, 2000 * (3 - attempts));
          } else {
            reject(new Error(`WS probe connection failed after ${3 - attempts} attempt(s)`));
          }
        });
      });
      ws.on('error', () => {
        clearTimeout(timeout);
        cleanup();
        attempts -= 1;
        if (attempts > 0 && index < candidates.length) {
          setTimeout(tryConnect, 2000 * (3 - attempts));
        } else {
          reject(new Error(`WS probe connection failed after ${3 - attempts} attempt(s)`));
        }
      });
    };

    tryConnect();
  });
}

// Build the curated symbol catalog. Tries active_symbols first (fast, single
// request), then a WS probe of candidates, then the static fallback.
async function buildSymbolCatalog() {
  let symbols = null;
  let mode = 'active_symbols';

  try {
    const result = await derivRequest(null, { active_symbols: 'brief' });
    const all = result.active_symbols || [];
    const curated = all.filter((s) =>
      /^(R_\d+|1HZ\d+V|VRTC)/.test(s.symbol) ||
      /^(BOOM|CRASH)\d+/.test(s.symbol) ||
      /^(Step|STP|RDB|jump)\d*/.test(s.symbol) ||
      FX_SYMBOLS.includes(s.symbol) ||
      CRYPTO_SYMBOLS.includes(s.symbol) ||
      COMMODITY_SYMBOLS.includes(s.symbol)
    );

    if (curated.length > 0) {
      symbols = curated.map((s) => ({
        symbol: s.symbol,
        name: s.display_name,
        market: s.market,
        pip: s.pip,
        pipSize: s.pip_size,
        decimals: s.decimal_places,
        exchangeIsOpen: s.exchange_is_open,
      }));
    }
  } catch { /* fall through to probe */ }

  if (!symbols) {
    try {
      const available = await probeAvailableSymbols(CANDIDATE_SYMBOLS);
      symbols = available.map(([symbol, name]) => ({
        symbol,
        name,
        market: /^R_|^1HZ|^VRTC|^BOOM|^CRASH|^Step|^STP|^RDB|^jump/.test(symbol) ? 'synthetic_index' : 'forex',
        pip: /^R_|^1HZ|^VRTC|^BOOM|^CRASH|^Step|^STP|^RDB|^jump/.test(symbol) ? 0.01 : 0.0001,
        pipSize: /^R_|^1HZ|^VRTC|^BOOM|^CRASH|^Step|^STP|^RDB|^jump/.test(symbol) ? 0.0001 : 0.00001,
        decimals: /^R_|^1HZ|^VRTC|^BOOM|^CRASH|^Step|^STP|^RDB|^jump/.test(symbol) ? 2 : 5,
      }));
      mode = 'probe';
    } catch (probeErr) {
      console.error(`[symbols] probe failed: ${probeErr.message}`, probeErr.code ? `code=${probeErr.code}` : '', probeErr.details ? `details=${probeErr.details}` : '');
    }
  }

  if (!symbols || symbols.length === 0) {
    symbols = FALLBACK_SYMBOLS;
    mode = 'static-fallback';
  }

  return { symbols, mode };
}

let symbolsRefresh = null; // in-flight background refresh promise

// Serve immediately (cache or fallback) so the UI never waits on the probe;
// refresh the catalog in the background afterwards.
app.get('/api/symbols', (req, res) => {
  if (symbolCache.data && Date.now() - symbolCache.at < SYMBOL_CACHE_MS) {
    return res.json({ symbols: symbolCache.data, cached: true, source: symbolCache.source });
  }

  const serve = { symbols: symbolCache.data || FALLBACK_SYMBOLS, cached: !!symbolCache.data, source: symbolCache.source || 'static-fallback' };
  res.json(serve);

  if (!symbolsRefresh) {
    symbolsRefresh = buildSymbolCatalog()
      .then(({ symbols, mode }) => {
        symbolCache.data = symbols;
        symbolCache.source = mode;
        symbolCache.at = Date.now();
      })
      .catch((e) => console.error(`[symbols] background refresh failed: ${e.message}`))
      .finally(() => { symbolsRefresh = null; });
  }
});

app.get('/api/candles', async (req, res) => {
  const { symbol, granularity = 60, count = 300 } = req.query;
  const gran = parseInt(granularity, 10);
  const n = Math.min(parseInt(count, 10) || 300, 5000);

  try {
    const result = await derivRequest(null, {
      ticks_history: symbol,
      adjust_start_time: 1,
      count: n,
      end: 'latest',
      granularity: gran,
      style: 'candles',
    }, { label: 'candles', context: { symbol, granularity: gran, count: n } });

    const candles = (result.candles || []).map((c) => ({
      t: c.epoch * 1000,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    }));

    res.json({ symbol, granularity: gran, candles });
  } catch (err) {
    apiError(res, 502, err);
  }
});

// ---------------------------------------------------------------
// Live tick stream: one Deriv WS connection per symbol, fanned out
// to any number of browser clients connected to /ws?symbol=...
//
// Hybrid feed. Deriv's `ticks` subscription streams real-time ticks,
// but shared/public app ids (e.g. 126958) throttle it by returning
// EMPTY tick placeholders. When that is detected we transparently
// fall back to polling `ticks_history` (which works reliably) and
// keep broadcasting the same `msg_type: 'tick'` payloads to clients.
// Market errors (MarketIsClosed / InvalidSymbol / ...) are broadcast
// to clients as `msg_type: 'market_status'` so the UI can notify the
// user instead of silently showing a dead chart.
// ---------------------------------------------------------------

const tickStreams = new Map(); // symbol -> stream object

let tickPollReqSeq = 1;

function getTickStream(symbol) {
  let stream = tickStreams.get(symbol);
  if (stream) return stream;

  stream = {
    ws: null,
    clients: new Set(),
    retry: 0,
    mode: 'stream',        // 'stream' (ticks subscribe) or 'poll' (ticks_history)
    lastEpoch: 0,          // highest epoch already broadcast (dedup for poll overlap)
    emptyTicks: 0,         // consecutive placeholder ticks seen while streaming
    pollTimer: null,
    pollInFlight: false,
    granularity: 60,       // candle bucket width in seconds (clients may change it)
    candle: null,          // forming candle for stream-mode ohlc aggregation
    // Deriv requires req_id to be an integer (a string like `th:${symbol}`
    // is rejected with InputValidationFailed) — use unique integers per
    // stream so poll responses can be matched to the right request.
    thReqId: tickPollReqSeq++,
    ocReqId: tickPollReqSeq++,
  };
  tickStreams.set(symbol, stream);

  const broadcast = (payload) => {
    const s = JSON.stringify(payload);
    for (const client of [...stream.clients]) {
      if (client.readyState === client.OPEN) client.send(s);
    }
  };

  // Aggregate real streaming ticks into an ohlc candle at the stream's
  // granularity so candle charts get the same open/high/low/close updates
  // a `ticks_history` + `subscribe` stream would push.
  const updateStreamCandle = (quote, epoch) => {
    const gran = stream.granularity;
    const bucket = Math.floor(epoch / gran) * gran;
    const cur = stream.candle;
    if (!cur || cur.epoch !== bucket) {
      stream.candle = { epoch: bucket, open: quote, high: quote, low: quote, close: quote };
      broadcast({ msg_type: 'ohlc', ohlc: { symbol, epoch: bucket, open: quote, high: quote, low: quote, close: quote, granularity: gran } });
    } else {
      cur.high = Math.max(cur.high, quote);
      cur.low = Math.min(cur.low, quote);
      cur.close = quote;
      broadcast({ msg_type: 'ohlc', ohlc: { symbol, epoch: bucket, open: cur.open, high: cur.high, low: cur.low, close: quote, granularity: gran } });
    }
  };

  const handleTick = (quote, epoch) => {
    if (epoch != null && epoch <= stream.lastEpoch) return;
    if (epoch != null) stream.lastEpoch = epoch;
    broadcast({ msg_type: 'tick', tick: { quote, epoch, symbol } });
    if (stream.mode === 'stream') updateStreamCandle(quote, epoch);
  };

  const handleError = (error) => {
    const code = error && error.code;
    broadcast({
      msg_type: 'market_status',
      symbol,
      marketClosed: code === 'MarketIsClosed' || code === 'TradingPlatformClosed',
      unavailable: code === 'InvalidSymbol' || code === 'InputValidationFailed',
      code,
      message: (error && error.message) || code,
    });
  };

  const pollTick = () => {
    if (stream.mode !== 'poll' || stream.clients.size === 0) return;
    if (!stream.ws || stream.ws.readyState !== WebSocket.OPEN) return;
    if (stream.pollInFlight) return;
    stream.pollInFlight = true;
    stream.ws.send(JSON.stringify({
      ticks_history: symbol,
      count: 5,
      end: 'latest',
      adjust_start_time: 1,
      style: 'ticks',
      req_id: stream.thReqId,
    }));
    stream.ws.send(JSON.stringify({
      ticks_history: symbol,
      count: 3,
      end: 'latest',
      adjust_start_time: 1,
      granularity: stream.granularity,
      style: 'candles',
      req_id: stream.ocReqId,
    }));
  };

  const startPollTimer = () => {
    if (stream.pollTimer) return;
    stream.pollTimer = setInterval(pollTick, 1000);
    pollTick();
  };

  // Shared app ids answer `ticks` with empty placeholder messages. The
  // moment one arrives we switch to polling — a real stream would send a
  // real tick first.
  const enterPollMode = () => {
    if (stream.mode === 'poll') return;
    stream.mode = 'poll';
    startPollTimer();
  };

  const connect = () => {
    if (stream.ws) { try { stream.ws.close(); } catch { /* noop */ } stream.ws = null; }
    stream.ws = new WebSocket(DERIV_WS_PUBLIC);
    attachStreamDiag(stream.ws, 'tick', { symbol });
    stream.ws.on('open', () => {
      stream.retry = 0;
      if (stream.mode === 'poll') {
        pollTick();
      } else {
        stream.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
      }
    });
    stream.ws.on('message', (msg) => {
      let parsed;
      try { parsed = JSON.parse(msg); } catch { return; }

      if (parsed.msg_type === 'tick') {
        const t = parsed.tick;
        if (t && t.symbol === symbol) {
          // real streaming tick
          handleTick(t.quote, t.epoch);
        } else if (stream.mode === 'stream') {
          // Shared/throttled app ids reject `ticks subscribe` outright
          // (e.g. InvalidSymbol) instead of the empty placeholder this
          // used to check for. Either way, fall back to polling.
          stream.emptyTicks += 1;
          if (stream.emptyTicks >= 1) enterPollMode();
        }
        return;
      }

      // Poll responses are matched by req_id (Deriv echoes it back), not by
      // msg_type — a rejected poll request also echoes our req_id but with
      // msg_type set to the request's own key (e.g. 'ticks_history') plus
      // an `error` field, so matching by req_id first catches that too and
      // avoids leaving pollInFlight stuck forever.
      if (parsed.req_id === stream.thReqId) {
        stream.pollInFlight = false;
        if (parsed.error) { handleError(parsed.error); return; }
        const h = parsed.history;
        if (h && h.prices && h.times && h.prices.length) {
          for (let i = 0; i < h.prices.length; i++) {
            handleTick(h.prices[i], h.times[i]);
          }
        } else if (h && h.prices && h.prices.length === 0) {
          // no ticks — market may be closed; signal it once
          broadcast({ msg_type: 'market_status', symbol, marketClosed: true, code: 'MarketIsClosed', message: `Market is closed for ${symbol}.` });
        }
        return;
      }

      if (parsed.req_id === stream.ocReqId) {
        stream.pollInFlight = false;
        if (parsed.error) { handleError(parsed.error); return; }
        const list = parsed.candles || [];
        if (list.length === 0) return;
        // the last candle is the currently forming one; push its latest OHLC
        const c = list[list.length - 1];
        if (c.epoch != null && c.open != null) {
          broadcast({
            msg_type: 'ohlc',
            ohlc: {
              symbol,
              epoch: c.epoch,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
              granularity: stream.granularity,
            },
          });
        }
        return;
      }

      if (parsed.msg_type === 'error') {
        stream.pollInFlight = false;
        handleError(parsed.error);
        if (stream.mode === 'stream') enterPollMode();
      }
    });
    stream.ws.on('close', () => {
      stream.ws = null;
      stream.pollInFlight = false;
      if (stream.clients.size === 0) {
        clearInterval(stream.pollTimer);
        stream.pollTimer = null;
        tickStreams.delete(symbol);
        return;
      }
      const delay = Math.min(1000 * 2 ** stream.retry, 30000);
      stream.retry += 1;
      setTimeout(connect, delay);
    });
    stream.ws.on('error', () => { /* close handler owns reconnect */ });
  };

  connect();
  return stream;
}

function releaseTickStream(symbol, client) {
  const stream = tickStreams.get(symbol);
  if (!stream) return;
  stream.clients.delete(client);
  if (stream.clients.size === 0) {
    clearInterval(stream.pollTimer);
    stream.pollTimer = null;
    if (stream.ws) {
      stream.ws.close();
      stream.ws = null;
    }
    tickStreams.delete(symbol);
  }
}

// ---------------------------------------------------------------
// Live contract stream: one authenticated Deriv WS per open
// contract (token:contract_id), fanned out to browser clients that
// connected to /ws?symbol=...&contract=...&session=...&account=...
// The `proposal_open_contract` updates carry entry/current spot,
// sell price, expiry and final status so the trader chart can mark
// the entry point and run the expiry countdown live.
// ---------------------------------------------------------------

const contractStreams = new Map(); // `token:account:contract_id` -> { ws, clients: Set, retry }

function getContractStream(token, account, contractId) {
  const key = `${token}:${account}:${contractId}`;
  let stream = contractStreams.get(key);
  if (stream) return stream;

  stream = { ws: null, clients: new Set(), retry: 0 };
  contractStreams.set(key, stream);

  const connect = () => {
    fetchOtpUrl(token, account)
      .then((url) => {
        const ws = new WebSocket(url);
        stream.ws = ws;
        attachStreamDiag(ws, 'contract', { contractId, account });
        ws.on('open', () => {
          stream.retry = 0;
          ws.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1, contract_id: contractId }));
        });
        ws.on('message', (msg) => {
          let parsed;
          try { parsed = JSON.parse(msg); } catch { return; }
          if (parsed.msg_type === 'proposal_open_contract') {
            const payload = JSON.stringify(parsed);
            for (const client of [...stream.clients]) {
              if (client.readyState === client.OPEN) client.send(payload);
            }
          }
        });
        ws.on('close', () => {
          stream.ws = null;
          contractStreams.delete(key);
          if (stream.clients.size > 0) {
            const delay = Math.min(1000 * 2 ** stream.retry, 30000);
            stream.retry += 1;
            setTimeout(connect, delay);
          }
        });
        ws.on('error', () => { /* close handler owns reconnect */ });
      })
      .catch(() => {
        contractStreams.delete(key);
        if (stream.clients.size > 0) {
          const delay = Math.min(1000 * 2 ** stream.retry, 30000);
          stream.retry += 1;
          setTimeout(connect, delay);
        }
      });
  };

  connect();
  return stream;
}

function releaseContractStream(token, account, contractId, client) {
  const key = `${token}:${account}:${contractId}`;
  const stream = contractStreams.get(key);
  if (!stream) return;
  stream.clients.delete(client);
  if (stream.clients.size === 0 && stream.ws) {
    stream.ws.close();
    contractStreams.delete(key);
  }
}

// ---------------------------------------------------------------
// Live balance stream: one OTP-authenticated Deriv WS per
// (token, account), subscribed to `balance` (subscribe: 1) so any
// account change (buy, sell, win, cashier deposit/withdraw) is
// pushed to the browser automatically — matching Deriv's real-time
// balance.
// ---------------------------------------------------------------

const balanceStreams = new Map(); // `token:account` -> { ws, clients: Set, retry }

function getBalanceStream(token, account) {
  const key = `${token}:${account}`;
  let stream = balanceStreams.get(key);
  if (stream) return stream;

  stream = { ws: null, clients: new Set(), retry: 0 };
  balanceStreams.set(key, stream);

  const connect = () => {
    fetchOtpUrl(token, account)
      .then((url) => {
        const ws = new WebSocket(url);
        stream.ws = ws;
        attachStreamDiag(ws, 'balance', { account });
        ws.on('open', () => {
          stream.retry = 0;
          ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        });
        ws.on('message', (msg) => {
          let parsed;
          try { parsed = JSON.parse(msg); } catch { return; }
          if (parsed.msg_type === 'balance') {
            const payload = JSON.stringify({ msg_type: 'balance', balance: parsed.balance });
            for (const client of [...stream.clients]) {
              if (client.readyState === client.OPEN) client.send(payload);
            }
          } else if (parsed.msg_type === 'error') {
            const payload = JSON.stringify({ msg_type: 'balance_error', error: parsed.error });
            for (const client of [...stream.clients]) {
              if (client.readyState === client.OPEN) client.send(payload);
            }
          }
        });
        ws.on('close', () => {
          stream.ws = null;
          balanceStreams.delete(key);
          if (stream.clients.size > 0) {
            const delay = Math.min(1000 * 2 ** stream.retry, 30000);
            stream.retry += 1;
            setTimeout(connect, delay);
          }
        });
        ws.on('error', () => { /* close handler owns reconnect */ });
      })
      .catch(() => {
        balanceStreams.delete(key);
        if (stream.clients.size > 0) {
          const delay = Math.min(1000 * 2 ** stream.retry, 30000);
          stream.retry += 1;
          setTimeout(connect, delay);
        }
      });
  };

  connect();
  return stream;
}

function releaseBalanceStream(token, account, client) {
  const key = `${token}:${account}`;
  const stream = balanceStreams.get(key);
  if (!stream) return;
  stream.clients.delete(client);
  if (stream.clients.size === 0 && stream.ws) {
    stream.ws.close();
    balanceStreams.delete(key);
  }
}

// SPA fallback: serve index.html for any non-API route
app.use((req, res) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/api')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

const httpServer = app.listen(PORT, () => {
  console.log(`Deriv backend running on http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const initialSymbol = url.searchParams.get('symbol');
  const initialContract = url.searchParams.get('contract');
  const initialGranularity = parseInt(url.searchParams.get('granularity'), 10);
  const sessionId = url.searchParams.get('session');
  const account = url.searchParams.get('account');

  const sessionData = sessionId ? sessions.get(sessionId) : null;
  const acctData = sessionData ? resolveAccount(sessionData, account) : null;

  ws._symbols = new Set();
  ws._contracts = new Set(); // `token:account:contract_id` keys
  let balanceToken = null;   // token for the live balance subscription
  let balanceAccount = null; // account for the live balance subscription

  const subscribeSymbol = (symbol, granularity) => {
    if (!symbol || ws._symbols.has(symbol)) return;
    ws._symbols.add(symbol);
    const stream = getTickStream(symbol);
    if (granularity) stream.granularity = Math.max(1, Math.min(granularity, 86400));
    stream.clients.add(ws);
  };
  const unsubscribeSymbol = (symbol) => {
    if (ws._symbols.delete(symbol)) releaseTickStream(symbol, ws);
  };
  const subscribeContract = (contractId) => {
    if (!contractId || !acctData) return;
    const key = `${acctData.token}:${acctData.account}:${contractId}`;
    if (ws._contracts.has(key)) return;
    ws._contracts.add(key);
    getContractStream(acctData.token, acctData.account, contractId).clients.add(ws);
  };
  const unsubscribeContract = (contractId) => {
    if (!contractId || !acctData) return;
    const key = `${acctData.token}:${acctData.account}:${contractId}`;
    if (ws._contracts.delete(key)) releaseContractStream(acctData.token, acctData.account, contractId, ws);
  };
  const subscribeBalance = () => {
    if (!acctData || balanceToken) return;
    balanceToken = acctData.token;
    balanceAccount = acctData.account;
    getBalanceStream(acctData.token, acctData.account).clients.add(ws);
  };
  const unsubscribeBalance = () => {
    if (!balanceToken) return;
    releaseBalanceStream(balanceToken, balanceAccount, ws);
    balanceToken = null;
    balanceAccount = null;
  };

  if (initialSymbol) subscribeSymbol(initialSymbol, initialGranularity);
  if (initialContract && acctData) subscribeContract(initialContract);

  ws.send(JSON.stringify({
    msg_type: 'connected',
    symbol: initialSymbol || null,
    contract: initialContract || null,
  }));

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.action === 'subscribe') {
        if (parsed.symbol) subscribeSymbol(parsed.symbol);
        if (parsed.contract) subscribeContract(parsed.contract);
        if (parsed.balance) subscribeBalance();
      }
      if (parsed.action === 'unsubscribe') {
        if (parsed.symbol) unsubscribeSymbol(parsed.symbol);
        if (parsed.contract) unsubscribeContract(parsed.contract);
        if (parsed.balance) unsubscribeBalance();
      }
      if (parsed.action === 'set_granularity' && parsed.granularity) {
        const sym = parsed.symbol || initialSymbol;
        const gran = parseInt(parsed.granularity, 10);
        if (sym && gran > 0) {
          const stream = tickStreams.get(sym);
          if (stream) stream.granularity = Math.max(1, Math.min(gran, 86400));
        }
      }
    } catch { /* ignore malformed control messages */ }
  });

  ws.on('close', () => {
    for (const symbol of ws._symbols) releaseTickStream(symbol, ws);
    for (const key of ws._contracts) {
      const [token, account, contractId] = key.split(':');
      releaseContractStream(token, account, contractId, ws);
    }
    if (balanceToken) releaseBalanceStream(balanceToken, balanceAccount, ws);
  });
});

// Ping clients so half-open browser connections get cleaned up.
setInterval(() => {
  wss.clients.forEach((client) => {
    if (!client.isAlive) return client.terminate();
    client.isAlive = false;
    client.ping();
  });
}, 30000);
