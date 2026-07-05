// tradingDb.cjs
// Shared library for the Netlify DB (Neon Postgres) backed trading endpoints:
//   db-orders.cjs, db-bot-activity.cjs, db-pnl.cjs
//
// Responsibilities:
//   - Neon client bootstrap from NETLIFY_DATABASE_URL (set by `netlify db init`)
//   - Schema creation (idempotent, memoized per lambda instance)
//   - Field normalizers that accept BOTH engine-blob and raw RH API spellings
//     (order_id/id, order_type/type, limit_price/price, BUY/buy, strike/strike_price…)
//   - The response envelope shared by every db-* endpoint (see `envelope`)
//   - An in-memory client (TRADING_DB_MEMORY=1) for local endpoint testing and jest

'use strict';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

// States that count as "open" — everything else is historical
const OPEN_STATES = new Set(['queued', 'unconfirmed', 'confirmed', 'pending', 'partially_filled', 'new']);

// ── Client bootstrap ──────────────────────────────────────────────────────────

let testClient   = null;
let memoryClient = null;
let neonClient   = null;
let schemaReady  = null;
let activeSource = 'netlify-db';

/** Neon endpoints use the serverless HTTP driver; anything else (e.g. a
 *  Render Postgres) is plain Postgres over TCP via node-postgres. */
function isNeonUrl(url) {
  try { return new URL(url).hostname.endsWith('.neon.tech'); } catch { return false; }
}

function createUrlClient(url) {
  if (isNeonUrl(url)) {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(url);
    return { query: (text, params = []) => sql.query(text, params) };
  }
  const { Pool } = require('pg');
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const pool = new Pool({
    connectionString: url,
    max: 2,
    idleTimeoutMillis: 10_000,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  return { query: async (text, params = []) => (await pool.query(text, params)).rows };
}

/**
 * Returns a `{ query(text, params) → Promise<rows> }` client, or null if no
 * DB is configured. A real database URL always wins over TRADING_DB_MEMORY,
 * so a site deployed in memory mode self-heals once a database is attached.
 * NETLIFY_DATABASE_URL comes from the Neon extension flow / manual setup;
 * NETLIFY_DB_URL is set by the newer built-in Netlify Database platform.
 */
function getDb() {
  if (testClient) { activeSource = 'netlify-db'; return testClient; }
  const url = process.env.NETLIFY_DATABASE_URL
    || process.env.NETLIFY_DATABASE_URL_UNPOOLED
    || process.env.NETLIFY_DB_URL
    || process.env.DATABASE_URL;
  if (url) {
    if (!neonClient) neonClient = createUrlClient(url);
    activeSource = 'netlify-db';
    return neonClient;
  }
  if (process.env.TRADING_DB_MEMORY === '1') {
    if (!memoryClient) memoryClient = createMemoryClient();
    activeSource = 'memory';
    return memoryClient;
  }
  return null;
}

function __setTestClient(client) {
  testClient  = client;
  schemaReady = null;
}

function __resetForTests() {
  testClient   = null;
  memoryClient = null;
  neonClient   = null;
  schemaReady  = null;
  activeSource = 'netlify-db';
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS stock_orders (
     order_id        TEXT PRIMARY KEY,
     symbol          TEXT,
     side            TEXT,
     order_type      TEXT,
     trigger_type    TEXT,
     state           TEXT,
     quantity        DOUBLE PRECISION,
     limit_price     DOUBLE PRECISION,
     stop_price      DOUBLE PRECISION,
     filled_quantity DOUBLE PRECISION,
     average_price   DOUBLE PRECISION,
     created_at      TIMESTAMPTZ,
     updated_at      TIMESTAMPTZ,
     raw             JSONB,
     ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS stock_orders_created_at_idx ON stock_orders (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS stock_orders_state_idx ON stock_orders (state)`,
  `CREATE TABLE IF NOT EXISTS option_orders (
     order_id          TEXT PRIMARY KEY,
     chain_symbol      TEXT,
     direction         TEXT,
     state             TEXT,
     quantity          DOUBLE PRECISION,
     price             DOUBLE PRECISION,
     processed_premium DOUBLE PRECISION,
     order_type        TEXT,
     opening_strategy  TEXT,
     legs              JSONB,
     created_at        TIMESTAMPTZ,
     updated_at        TIMESTAMPTZ,
     raw               JSONB,
     ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS option_orders_created_at_idx ON option_orders (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS option_orders_state_idx ON option_orders (state)`,
  `CREATE TABLE IF NOT EXISTS bot_activity (
     id         BIGSERIAL PRIMARY KEY,
     event_id   TEXT UNIQUE,
     order_id   TEXT,
     event_type TEXT NOT NULL,
     status     TEXT NOT NULL,
     symbol     TEXT,
     quantity   DOUBLE PRECISION,
     price      DOUBLE PRECISION,
     total      DOUBLE PRECISION,
     message    TEXT,
     details    TEXT,
     dry_run    BOOLEAN NOT NULL DEFAULT false,
     metadata   JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // Upgrade path for tables created before order_id existed
  `ALTER TABLE bot_activity ADD COLUMN IF NOT EXISTS order_id TEXT`,
  `CREATE INDEX IF NOT EXISTS bot_activity_created_at_idx ON bot_activity (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS bot_activity_order_id_idx ON bot_activity (order_id)`,
];

async function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of SCHEMA_STATEMENTS) await db.query(stmt);
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// ── Value coercion ────────────────────────────────────────────────────────────

function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

/** Naive engine-blob timestamps are UTC without a Z — append it before parsing. */
function toIso(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts.toISOString();
  let s = String(ts);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function safeParse(v, fallback) {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function r2(n) { return Math.round(n * 100) / 100; }

// ── Normalizers (accept engine-blob AND raw RH API spellings) ─────────────────

/** True when the payload looks like an option order rather than a stock order. */
function isOptionOrder(o) {
  return Boolean(
    (Array.isArray(o.legs) && o.legs.length) ||
    o.chain_symbol ||
    o.direction ||
    o.processed_premium != null ||
    o.opening_strategy
  );
}

function normalizeStockOrder(o) {
  const orderId = o.order_id || o.id;
  if (!orderId) return null;
  return {
    order_id:        String(orderId),
    symbol:          o.symbol || null,
    side:            (o.side || '').toUpperCase() || null,
    order_type:      o.order_type || o.type || null,
    trigger:         o.trigger || null,
    state:           o.state || null,
    quantity:        toNum(o.quantity) ?? 0,
    limit_price:     toNum(o.limit_price ?? o.price) ?? 0,
    stop_price:      toNum(o.stop_price),
    filled_quantity: toNum(o.filled_quantity ?? o.cumulative_quantity) ?? 0,
    average_price:   toNum(o.average_price),
    created_at:      toIso(o.created_at),
    updated_at:      toIso(o.updated_at),
  };
}

function normalizeOptionOrder(o) {
  const orderId = o.order_id || o.id;
  if (!orderId) return null;
  const rawLegs = Array.isArray(o.legs) ? o.legs : [];
  const legs = rawLegs.map(leg => ({
    chain_symbol:    leg.chain_symbol || o.chain_symbol || null,
    strike_price:    leg.strike_price ?? leg.strike ?? null,
    expiration_date: leg.expiration_date ?? leg.expiration ?? null,
    option_type:     leg.option_type || null,
    side:            (leg.side || '').toUpperCase() || null,
    position_effect: leg.position_effect || null,
  }));
  return {
    order_id:          String(orderId),
    chain_symbol:      o.chain_symbol || legs[0]?.chain_symbol || null,
    direction:         (o.direction || '').toLowerCase() || null,
    state:             o.state || null,
    quantity:          toNum(o.quantity) ?? 0,
    price:             toNum(o.price) ?? 0,
    processed_premium: toNum(o.processed_premium),
    order_type:        o.order_type || o.type || null,
    opening_strategy:  o.opening_strategy || null,
    legs,
    created_at:        toIso(o.created_at),
    updated_at:        toIso(o.updated_at),
  };
}

function normalizeBotEvent(e) {
  const quantity = toNum(e.quantity);
  const price    = toNum(e.price);
  const orderId  = e.order_id != null ? String(e.order_id) : (e.orderId != null ? String(e.orderId) : null);
  const status   = e.status || 'unknown';
  // De-dup key precedence: explicit event_id/id wins; otherwise derive one
  // from the RH order id + status so writers can pass order_id straight
  // through and lifecycle events (submitted/filled/…) dedupe on retries.
  const explicitId = e.event_id != null ? String(e.event_id) : (e.id != null ? String(e.id) : null);
  return {
    event_id:   explicitId ?? (orderId ? `${orderId}:${status}` : null),
    order_id:   orderId,
    event_type: e.event_type || e.type || 'UNKNOWN',
    status,
    symbol:     e.symbol || null,
    quantity,
    price,
    total:      toNum(e.total) ?? (quantity != null && price != null ? r2(quantity * price) : null),
    message:    e.message || null,
    details:    e.details || null,
    dry_run:    Boolean(e.dry_run ?? e.dryRun ?? false),
    metadata:   e.metadata ?? null,
    created_at: toIso(e.created_at || e.timestamp) || new Date().toISOString(),
  };
}

// ── Writes ────────────────────────────────────────────────────────────────────

async function upsertStockOrder(db, order, rawSource) {
  await db.query(
    `INSERT INTO stock_orders
       (order_id, symbol, side, order_type, trigger_type, state, quantity, limit_price,
        stop_price, filled_quantity, average_price, created_at, updated_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     ON CONFLICT (order_id) DO UPDATE SET
       symbol = EXCLUDED.symbol, side = EXCLUDED.side, order_type = EXCLUDED.order_type,
       trigger_type = EXCLUDED.trigger_type, state = EXCLUDED.state, quantity = EXCLUDED.quantity,
       limit_price = EXCLUDED.limit_price, stop_price = EXCLUDED.stop_price,
       filled_quantity = EXCLUDED.filled_quantity, average_price = EXCLUDED.average_price,
       created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
       raw = EXCLUDED.raw, ingested_at = now()`,
    [order.order_id, order.symbol, order.side, order.order_type, order.trigger, order.state,
     order.quantity, order.limit_price, order.stop_price, order.filled_quantity,
     order.average_price, order.created_at, order.updated_at,
     JSON.stringify(rawSource ?? null)]
  );
}

async function upsertOptionOrder(db, order, rawSource) {
  await db.query(
    `INSERT INTO option_orders
       (order_id, chain_symbol, direction, state, quantity, price, processed_premium,
        order_type, opening_strategy, legs, created_at, updated_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb)
     ON CONFLICT (order_id) DO UPDATE SET
       chain_symbol = EXCLUDED.chain_symbol, direction = EXCLUDED.direction,
       state = EXCLUDED.state, quantity = EXCLUDED.quantity, price = EXCLUDED.price,
       processed_premium = EXCLUDED.processed_premium, order_type = EXCLUDED.order_type,
       opening_strategy = EXCLUDED.opening_strategy, legs = EXCLUDED.legs,
       created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
       raw = EXCLUDED.raw, ingested_at = now()`,
    [order.order_id, order.chain_symbol, order.direction, order.state, order.quantity,
     order.price, order.processed_premium, order.order_type, order.opening_strategy,
     JSON.stringify(order.legs), order.created_at, order.updated_at,
     JSON.stringify(rawSource ?? null)]
  );
}

/** Inserts one bot event; returns the new id, or null when skipped as a duplicate event_id. */
async function insertBotEvent(db, ev) {
  const rows = await db.query(
    `INSERT INTO bot_activity
       (event_id, order_id, event_type, status, symbol, quantity, price, total, message, details, dry_run, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [ev.event_id, ev.order_id, ev.event_type, ev.status, ev.symbol, ev.quantity, ev.price, ev.total,
     ev.message, ev.details, ev.dry_run, JSON.stringify(ev.metadata), ev.created_at]
  );
  if (!rows.length) return null;
  // node-postgres returns BIGSERIAL as a string; Neon HTTP returns a number
  return typeof rows[0].id === 'string' ? parseInt(rows[0].id, 10) : rows[0].id;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

async function fetchStockOrders(db, limit) {
  return db.query(
    `SELECT * FROM stock_orders ORDER BY created_at DESC NULLS LAST LIMIT $1`,
    [limit]
  );
}

async function fetchOptionOrders(db, limit) {
  return db.query(
    `SELECT * FROM option_orders ORDER BY created_at DESC NULLS LAST LIMIT $1`,
    [limit]
  );
}

async function fetchBotEvents(db, limit) {
  return db.query(
    `SELECT * FROM bot_activity ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit]
  );
}

// ── Row → API object mappers (SnapshotOrder / SnapshotOptionOrder contracts) ──

function rowToStockOrder(r) {
  return {
    order_id:        r.order_id,
    symbol:          r.symbol,
    side:            r.side,
    order_type:      r.order_type,
    trigger:         r.trigger_type,
    state:           r.state,
    quantity:        toNum(r.quantity) ?? 0,
    limit_price:     toNum(r.limit_price) ?? 0,
    stop_price:      toNum(r.stop_price),
    filled_quantity: toNum(r.filled_quantity) ?? 0,
    average_price:   toNum(r.average_price),
    created_at:      toIso(r.created_at),
    updated_at:      toIso(r.updated_at),
  };
}

function rowToOptionOrder(r) {
  return {
    order_id:          r.order_id,
    chain_symbol:      r.chain_symbol,
    direction:         r.direction,
    state:             r.state,
    quantity:          toNum(r.quantity) ?? 0,
    price:             toNum(r.price) ?? 0,
    processed_premium: toNum(r.processed_premium),
    order_type:        r.order_type,
    opening_strategy:  r.opening_strategy,
    legs:              safeParse(r.legs, []),
    created_at:        toIso(r.created_at),
    updated_at:        toIso(r.updated_at),
  };
}

function rowToBotEvent(r) {
  return {
    id:         typeof r.id === 'string' ? parseInt(r.id, 10) : r.id,
    event_id:   r.event_id,
    order_id:   r.order_id ?? null,
    event_type: r.event_type,
    status:     r.status,
    symbol:     r.symbol,
    quantity:   toNum(r.quantity),
    price:      toNum(r.price),
    total:      toNum(r.total),
    message:    r.message,
    details:    r.details,
    dry_run:    Boolean(r.dry_run),
    metadata:   safeParse(r.metadata, null),
    created_at: toIso(r.created_at),
  };
}

// ── Response envelope ─────────────────────────────────────────────────────────
// Every db-* endpoint returns this object. External callers (Robinhood MCP)
// should branch on `ok`, read payload from `data`, and diagnostics from `error`.

function envelope({ resource, action, data = null, count = null, error = null }) {
  return {
    ok:       !error,
    resource,
    action,
    source:   activeSource, // 'netlify-db', or 'memory' when TRADING_DB_MEMORY=1
    as_of:    new Date().toISOString(),
    count,
    data,
    error,
  };
}

function errorEnvelope(resource, action, code, message) {
  return envelope({ resource, action, error: { code, message } });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

/**
 * Write-guard: when TRADING_DB_TOKEN is set, mutating requests must carry
 * `Authorization: Bearer <token>` or `X-Api-Key: <token>`. Reads stay open.
 * Returns an error message string when denied, null when allowed.
 */
function checkWriteAuth(event) {
  const token = process.env.TRADING_DB_TOKEN;
  if (!token) return null;
  const headers = event.headers || {};
  const auth   = headers.authorization || headers.Authorization || '';
  const apiKey = headers['x-api-key'] || headers['X-Api-Key'] || '';
  if (auth === `Bearer ${token}` || apiKey === token) return null;
  return 'Missing or invalid credentials — set Authorization: Bearer <TRADING_DB_TOKEN>';
}

// ── In-memory client (TRADING_DB_MEMORY=1) ────────────────────────────────────
// Implements exactly the SQL statements this module issues. Data lives for the
// lifetime of the process — for local endpoint testing and jest only.

function createMemoryClient() {
  const stockOrders  = new Map();
  const optionOrders = new Map();
  const botEvents    = [];
  let seq = 0;

  const byCreatedDesc = (a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));

  return {
    async query(text, params = []) {
      const sql = text.trim();

      if (/^CREATE (TABLE|INDEX)|^ALTER TABLE/i.test(sql)) return [];

      if (/^INSERT INTO stock_orders/i.test(sql)) {
        const [order_id, symbol, side, order_type, trigger_type, state, quantity, limit_price,
               stop_price, filled_quantity, average_price, created_at, updated_at, raw] = params;
        stockOrders.set(order_id, {
          order_id, symbol, side, order_type, trigger_type, state, quantity, limit_price,
          stop_price, filled_quantity, average_price, created_at, updated_at, raw,
        });
        return [];
      }

      if (/^INSERT INTO option_orders/i.test(sql)) {
        const [order_id, chain_symbol, direction, state, quantity, price, processed_premium,
               order_type, opening_strategy, legs, created_at, updated_at, raw] = params;
        optionOrders.set(order_id, {
          order_id, chain_symbol, direction, state, quantity, price, processed_premium,
          order_type, opening_strategy, legs, created_at, updated_at, raw,
        });
        return [];
      }

      if (/^INSERT INTO bot_activity/i.test(sql)) {
        const [event_id, order_id, event_type, status, symbol, quantity, price, total,
               message, details, dry_run, metadata, created_at] = params;
        if (event_id != null && botEvents.some(e => e.event_id === event_id)) return [];
        const row = { id: ++seq, event_id, order_id, event_type, status, symbol, quantity, price, total,
                      message, details, dry_run, metadata, created_at };
        botEvents.push(row);
        return [{ id: row.id }];
      }

      if (/^SELECT \* FROM stock_orders/i.test(sql)) {
        return [...stockOrders.values()].sort(byCreatedDesc).slice(0, params[0] ?? 500);
      }
      if (/^SELECT \* FROM option_orders/i.test(sql)) {
        return [...optionOrders.values()].sort(byCreatedDesc).slice(0, params[0] ?? 500);
      }
      if (/^SELECT \* FROM bot_activity/i.test(sql)) {
        return [...botEvents].sort((a, b) => byCreatedDesc(a, b) || b.id - a.id).slice(0, params[0] ?? 500);
      }

      if (/^DELETE FROM stock_orders/i.test(sql)) {
        const existed = stockOrders.delete(params[0]);
        return existed ? [{ order_id: params[0] }] : [];
      }
      if (/^DELETE FROM option_orders/i.test(sql)) {
        const existed = optionOrders.delete(params[0]);
        return existed ? [{ order_id: params[0] }] : [];
      }

      throw new Error(`Memory client: unhandled SQL: ${sql.slice(0, 80)}`);
    },
  };
}

module.exports = {
  CORS,
  OPEN_STATES,
  getDb,
  ensureSchema,
  toNum,
  toIso,
  r2,
  isOptionOrder,
  normalizeStockOrder,
  normalizeOptionOrder,
  normalizeBotEvent,
  upsertStockOrder,
  upsertOptionOrder,
  insertBotEvent,
  fetchStockOrders,
  fetchOptionOrders,
  fetchBotEvents,
  rowToStockOrder,
  rowToOptionOrder,
  rowToBotEvent,
  envelope,
  errorEnvelope,
  respond,
  checkWriteAuth,
  createMemoryClient,
  __setTestClient,
  __resetForTests,
};
