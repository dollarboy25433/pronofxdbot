/**
 * Deriv OAuth + API backend
 * ---------------------------------------------------
 * Flow:
 *  1. Frontend links user to Deriv's OAuth authorize URL.
 *  2. User logs in on deriv.com, approves the app.
 *  3. Deriv redirects to /auth/callback with acct/token params in the query string.
 *  4. We parse those, store them server-side against a session id,
 *     and redirect the user back to the frontend with just that session id
 *     (never put raw tokens in a URL the browser keeps in history/logs).
 *  5. Frontend calls our API with the session id; we use the stored Deriv
 *     token to open a WebSocket to Deriv's API and fetch account info/balance.
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
app.use(express.json());

const PORT = process.env.PORT || 4000;
const DERIV_APP_ID = process.env.DERIV_APP_ID || '126958'; // used for WebSocket/API calls (Deriv-App-ID header + legacy WS)
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

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
const DERIV_OAUTH = process.env.DERIV_OAUTH || 'v2'; // 'v2' = OAuth2 + PKCE, 'legacy' = old oauth.deriv.com flow

const DERIV_AUTH_BASE = 'https://auth.deriv.com';
const DERIV_REST_BASE = 'https://api.derivws.com';

const DIST_DIR = path.join(process.cwd(), 'dist');

// Serve built frontend in production
app.use(express.static(DIST_DIR));

// --- In-memory session store (swap for Redis/DB in production) ---
// v2 session:  { oauth: 'v2', token, accounts: [{account, token, currency}], createdAt }
// legacy session: { oauth: 'legacy', accounts: [{account, token, currency}], createdAt }
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

  if (DERIV_OAUTH === 'legacy') {
    const url = `https://oauth.deriv.com/oauth2/authorize?app_id=${DERIV_APP_ID}`;
    return res.json({ url, mode });
  }

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

// --- Step 2b: legacy callback (acct1/token1/cur1 params) ---
function handleLegacyCallback(query) {
  const accounts = [];
  let i = 1;
  while (query[`acct${i}`]) {
    accounts.push({
      account: query[`acct${i}`],
      token: query[`token${i}`],
      currency: query[`cur${i}`],
    });
    i++;
  }

  if (accounts.length === 0) {
    return { redirect: `${FRONTEND_URL}/?error=${encodeURIComponent('No accounts returned from Deriv')}` };
  }

  const sessionId = createSession({ oauth: 'legacy', accounts });
  return { redirect: `${FRONTEND_URL}/?session=${sessionId}` };
}

// --- Step 2: Deriv redirects the browser here after login ---
app.get('/auth/callback', async (req, res) => {
  const query = req.query;

  if (query.code || query.error) {
    const outcome = await handleOAuth2Callback(query);
    return res.redirect(outcome.redirect);
  }

  res.redirect(handleLegacyCallback(query).redirect);
});

// --- Resolve accounts for a session (v2 sessions have a token, not acct params) ---
async function accountsFromToken(token) {
  // New REST API: GET /trading/v1/options/accounts (Bearer token + Deriv-App-ID header)
  try {
    const restRes = await fetch(`${DERIV_REST_BASE}/trading/v1/options/accounts`, {
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
        }))
        .filter((a) => a.account);
      if (accounts.length > 0) return accounts;
    }
  } catch { /* fall through to legacy WS */ }

  // Legacy WebSocket fallback: authorize with the token and read the current account
  try {
    const auth = await authorizeInfo(token);
    const info = auth.authorize;
    if (info?.loginid) {
      return [{ account: info.loginid, currency: info.currency, token }];
    }
  } catch { /* no account derivable */ }

  return [];
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
    const result = await derivRequest(acctData.token, { balance: 1 });
    res.json(result.balance);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Deriv contract trading (Manual Trader)
// ---------------------------------------------------------------

// Resolve the token + currency for a specific account in a session.
// v2 sessions carry a single token (data.token); legacy sessions have a
// token per account. Returns null if the account is not in the session.
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
    });
    res.json({ contracts_for: result.contracts_for });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Price a contract (proposal) — never trades, just quotes.
app.post('/api/contract/proposal', async (req, res) => {
  const ctx = findSession(req, res);
  if (!ctx) return;

  const { symbol, contract_type, amount, basis = 'stake', duration, duration_unit = 'm', currency } = req.body || {};
  if (!symbol || !contract_type || amount == null || duration == null) {
    return res.status(400).json({ error: 'Missing symbol, contract_type, amount or duration' });
  }

  try {
    const result = await derivRequest(ctx.acct.token, {
      proposal: 1,
      amount,
      basis,
      contract_type,
      currency: currency || ctx.acct.currency || 'USD',
      duration,
      duration_unit,
      symbol,
    });
    res.json({ proposal: result.proposal });
  } catch (err) {
    res.status(502).json({ error: err.message });
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
    const result = await derivRequest(ctx.acct.token, { buy: proposal_id, price });
    res.json({ buy: result.buy });
  } catch (err) {
    res.status(502).json({ error: err.message });
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
    const result = await derivRequest(ctx.acct.token, { sell: contract_id, price });
    res.json({ sell: result.sell });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// List currently open contracts for the account.
app.get('/api/contract/open', async (req, res) => {
  const ctx = findSession(req, res);
  if (!ctx) return;

  try {
    const result = await derivRequest(ctx.acct.token, { portfolio: 1 });
    res.json({ contracts: (result.portfolio && result.portfolio.contracts) || [] });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- Helper: open a short-lived WS connection, send one request ---
// Pass a token to authorize first (account data). Pass `null` for public
// endpoints (ticks_history, active_symbols) that do not require a token.
function derivRequest(token, request) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Deriv API request timed out'));
    }, 10000);

    ws.on('open', () => {
      if (token) ws.send(JSON.stringify({ authorize: token }));
      else ws.send(JSON.stringify(request));
    });

    ws.on('message', (msg) => {
      const response = JSON.parse(msg);

      if (response.error) {
        clearTimeout(timeout);
        ws.close();
        return reject(new Error(response.error.message));
      }

      if (response.msg_type === 'authorize') {
        ws.send(JSON.stringify(request));
      } else {
        clearTimeout(timeout);
        ws.close();
        resolve(response);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// --- Helper: open a WS, authorize with a token, resolve with the authorize result ---
function authorizeInfo(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('authorize timed out'));
    }, 10000);

    ws.on('open', () => ws.send(JSON.stringify({ authorize: token })));
    ws.on('message', (msg) => {
      const response = JSON.parse(msg);
      if (response.error) {
        clearTimeout(timeout);
        ws.close();
        return reject(new Error(response.error.message));
      }
      if (response.msg_type === 'authorize') {
        clearTimeout(timeout);
        ws.close();
        resolve(response);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
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
    // v2 single-token sessions before the account list is resolved
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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

app.get('/api/ai/status', (req, res) => {
  res.json({ configured: !!GEMINI_API_KEY, model: GEMINI_MODEL });
});

app.post('/api/ai', async (req, res) => {
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'AI is not configured — add GEMINI_API_KEY to the server env.' });
  const { prompt, context, temperature = 0.7 } = req.body || {};
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'Missing prompt' });
  try {
    const systemInstruction = context || 'You are an expert trading assistant for a Deriv binary-options bot called PronoFX Dbot. Be concise, practical and honest about risk. You can reference synthetic indices, forex and crypto symbols. Never promise guaranteed profits.';
    const body = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: String(prompt).slice(0, 4000) }] }],
      generationConfig: { temperature: Math.min(Math.max(temperature, 0), 1) },
    };
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: `Gemini API error (${resp.status}): ${errText.slice(0, 200)}` });
    }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
function probeAvailableSymbols(candidates) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_TICK_WS);
    const valid = [];
    let index = 0;

    const timeout = setTimeout(() => { ws.close(); resolve(valid); }, 20000);

    ws.on('open', () => ws.send(JSON.stringify({ ticks_history: candidates[0][0], count: 1, end: 'latest', granularity: 60, style: 'candles' })));

    ws.on('message', (msg) => {
      let response;
      try { response = JSON.parse(msg); } catch { return; }
      if (response.msg_type === 'history' && response.candles) {
        valid.push(candidates[index]);
      }
      index += 1;
      if (index >= candidates.length) {
        clearTimeout(timeout);
        ws.close();
        resolve(valid);
      } else {
        ws.send(JSON.stringify({ ticks_history: candidates[index][0], count: 1, end: 'latest', granularity: 60, style: 'candles' }));
      }
    });

    ws.on('error', (err) => { clearTimeout(timeout); ws.close(); reject(err); });
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
      console.error(`[symbols] probe failed: ${probeErr.message}`);
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
    });

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
    res.status(502).json({ error: err.message });
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

const DERIV_TICK_WS = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;
const tickStreams = new Map(); // symbol -> stream object

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
  };
  tickStreams.set(symbol, stream);

  const broadcast = (payload) => {
    const s = JSON.stringify(payload);
    for (const client of [...stream.clients]) {
      if (client.readyState === client.OPEN) client.send(s);
    }
  };

  const handleTick = (quote, epoch) => {
    if (epoch != null && epoch <= stream.lastEpoch) return;
    if (epoch != null) stream.lastEpoch = epoch;
    broadcast({ msg_type: 'tick', tick: { quote, epoch, symbol } });
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
      req_id: `th:${symbol}`,
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
    stream.ws = new WebSocket(DERIV_TICK_WS);
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
          stream.emptyTicks += 1;
          if (stream.emptyTicks >= 1) enterPollMode();
        }
      } else if (parsed.msg_type === 'history') {
        if (parsed.req_id !== `th:${symbol}`) return;
        stream.pollInFlight = false;
        const h = parsed.history;
        if (h && h.prices && h.times) {
          for (let i = 0; i < h.prices.length; i++) {
            handleTick(h.prices[i], h.times[i]);
          }
        } else if (h && h.prices && h.prices.length === 0) {
          // no ticks — market may be closed; signal it once
          broadcast({ msg_type: 'market_status', symbol, marketClosed: true, code: 'MarketIsClosed', message: `Market is closed for ${symbol}.` });
        }
      } else if (parsed.msg_type === 'error') {
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

const contractStreams = new Map(); // `token:contract_id` -> { ws, clients: Set, retry }

function getContractStream(token, contractId) {
  const key = `${token}:${contractId}`;
  let stream = contractStreams.get(key);
  if (stream) return stream;

  stream = { ws: null, clients: new Set(), retry: 0 };
  contractStreams.set(key, stream);

  const connect = () => {
    stream.ws = new WebSocket(DERIV_TICK_WS);
    stream.ws.on('open', () => {
      stream.retry = 0;
      stream.ws.send(JSON.stringify({ authorize: token }));
    });
    stream.ws.on('message', (msg) => {
      let parsed;
      try { parsed = JSON.parse(msg); } catch { return; }
      if (parsed.msg_type === 'authorize') {
        stream.ws.send(JSON.stringify({ proposal_open_contract: 1, subscribe: 1, contract_id: contractId }));
      } else if (parsed.msg_type === 'proposal_open_contract') {
        const payload = JSON.stringify(parsed);
        for (const client of [...stream.clients]) {
          if (client.readyState === client.OPEN) client.send(payload);
        }
      }
    });
    stream.ws.on('close', () => {
      contractStreams.delete(key);
      if (stream.clients.size > 0) {
        const delay = Math.min(1000 * 2 ** stream.retry, 30000);
        stream.retry += 1;
        setTimeout(connect, delay);
      }
    });
    stream.ws.on('error', () => { /* close handler owns reconnect */ });
  };

  connect();
  return stream;
}

function releaseContractStream(token, contractId, client) {
  const key = `${token}:${contractId}`;
  const stream = contractStreams.get(key);
  if (!stream) return;
  stream.clients.delete(client);
  if (stream.clients.size === 0 && stream.ws) {
    stream.ws.close();
    contractStreams.delete(key);
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
  const sessionId = url.searchParams.get('session');
  const account = url.searchParams.get('account');

  const sessionData = sessionId ? sessions.get(sessionId) : null;
  const acctData = sessionData ? resolveAccount(sessionData, account) : null;

  ws._symbols = new Set();
  ws._contracts = new Set(); // token:contract_id keys

  const subscribeSymbol = (symbol) => {
    if (!symbol || ws._symbols.has(symbol)) return;
    ws._symbols.add(symbol);
    getTickStream(symbol).clients.add(ws);
  };
  const unsubscribeSymbol = (symbol) => {
    if (ws._symbols.delete(symbol)) releaseTickStream(symbol, ws);
  };
  const subscribeContract = (contractId) => {
    if (!contractId || !acctData) return;
    const key = `${acctData.token}:${contractId}`;
    if (ws._contracts.has(key)) return;
    ws._contracts.add(key);
    getContractStream(acctData.token, contractId).clients.add(ws);
  };
  const unsubscribeContract = (contractId) => {
    if (!contractId || !acctData) return;
    const key = `${acctData.token}:${contractId}`;
    if (ws._contracts.delete(key)) releaseContractStream(acctData.token, contractId, ws);
  };

  if (initialSymbol) subscribeSymbol(initialSymbol);
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
      }
      if (parsed.action === 'unsubscribe') {
        if (parsed.symbol) unsubscribeSymbol(parsed.symbol);
        if (parsed.contract) unsubscribeContract(parsed.contract);
      }
    } catch { /* ignore malformed control messages */ }
  });

  ws.on('close', () => {
    for (const symbol of ws._symbols) releaseTickStream(symbol, ws);
    for (const key of ws._contracts) {
      const sep = key.indexOf(':');
      releaseContractStream(key.slice(0, sep), key.slice(sep + 1), ws);
    }
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
