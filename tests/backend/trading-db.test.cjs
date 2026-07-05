// Tests for the Netlify DB backed endpoints (db-orders, db-bot-activity, db-pnl)
// using the in-memory client from lib/tradingDb.cjs — same code path as
// TRADING_DB_MEMORY=1 local runs, no live Neon instance needed.

const t = require('../../netlify/functions/lib/tradingDb.cjs');
const dbOrders = require('../../netlify/functions/db-orders.cjs');
const dbBotActivity = require('../../netlify/functions/db-bot-activity.cjs');
const dbPnl = require('../../netlify/functions/db-pnl.cjs');

function makeEvent({ method = 'GET', params = null, body = null, headers = {} } = {}) {
  return {
    httpMethod: method,
    queryStringParameters: params,
    headers,
    body: body != null ? JSON.stringify(body) : null,
  };
}

function parse(res) {
  return JSON.parse(res.body);
}

const NOW = new Date().toISOString();

beforeEach(() => {
  t.__resetForTests();
  delete process.env.NETLIFY_DATABASE_URL;
  delete process.env.NETLIFY_DATABASE_URL_UNPOOLED;
  delete process.env.DATABASE_URL;
  delete process.env.TRADING_DB_MEMORY;
  delete process.env.TRADING_DB_TOKEN;
  t.__setTestClient(t.createMemoryClient());
});

afterAll(() => t.__resetForTests());

// ── Envelope & availability ─────────────────────────────────────────────────

describe('response envelope', () => {
  test('returns 503 DB_NOT_CONFIGURED envelope when no database is set up', async () => {
    t.__resetForTests(); // no test client, no env vars → getDb() returns null
    for (const fn of [dbOrders, dbBotActivity, dbPnl]) {
      const res = await fn.handler(makeEvent());
      expect(res.statusCode).toBe(503);
      const body = parse(res);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('DB_NOT_CONFIGURED');
      expect(body.source).toBe('netlify-db');
    }
  });

  test('GET db-orders returns the standard envelope shape', async () => {
    const res = await dbOrders.handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      resource: 'orders',
      action: 'list',
      source: 'netlify-db',
      count: 0,
      error: null,
    }));
    expect(typeof body.as_of).toBe('string');
    expect(body.data).toEqual(expect.objectContaining({
      open_orders: [], open_option_orders: [],
      historical_orders: [], historical_option_orders: [],
    }));
  });
});

// ── db-orders ────────────────────────────────────────────────────────────────

describe('db-orders', () => {
  test('upserts engine-blob shaped payload and buckets open vs historical', async () => {
    const post = await dbOrders.handler(makeEvent({
      method: 'POST',
      body: {
        open_orders: [{
          order_id: 'ord-1', symbol: 'TSLA', side: 'BUY', order_type: 'limit',
          trigger: 'immediate', state: 'queued', quantity: 10, limit_price: 245,
          created_at: NOW, updated_at: NOW,
        }],
        recent_orders: [{
          order_id: 'ord-2', symbol: 'AAPL', side: 'SELL', order_type: 'limit',
          state: 'filled', quantity: 5, limit_price: 180, filled_quantity: 5,
          average_price: 180.5, created_at: NOW, updated_at: NOW,
        }],
        open_option_orders: [{
          order_id: 'opt-1', chain_symbol: 'CRWD', direction: 'debit', state: 'confirmed',
          quantity: 1, price: 5.5, created_at: NOW, updated_at: NOW,
          legs: [{ strike: 100, expiration: '2026-09-18', option_type: 'call', side: 'buy' }],
        }],
      },
    }));
    expect(post.statusCode).toBe(200);
    expect(parse(post).data).toEqual(expect.objectContaining({
      stock_upserted: 2, option_upserted: 1, skipped: 0,
    }));

    const get = parse(await dbOrders.handler(makeEvent()));
    expect(get.count).toBe(3);
    expect(get.data.open_orders.map(o => o.order_id)).toEqual(['ord-1']);
    expect(get.data.historical_orders.map(o => o.order_id)).toEqual(['ord-2']);
    expect(get.data.open_option_orders.map(o => o.order_id)).toEqual(['opt-1']);

    // Engine-blob leg spellings are normalized to RH contract names
    const leg = get.data.open_option_orders[0].legs[0];
    expect(leg.strike_price).toBe(100);
    expect(leg.expiration_date).toBe('2026-09-18');
    expect(leg.side).toBe('BUY');
    expect(leg.chain_symbol).toBe('CRWD');

    // scope filter
    const openOnly = parse(await dbOrders.handler(makeEvent({ params: { scope: 'open' } })));
    expect(openOnly.data.open_orders).toHaveLength(1);
    expect(openOnly.data.historical_orders).toHaveLength(0);
  });

  test('normalizes raw RH API field spellings (id/type/price, lowercase side)', async () => {
    await dbOrders.handler(makeEvent({
      method: 'POST',
      body: [{
        id: 'rh-raw-1', symbol: 'NVDA', side: 'buy', type: 'limit', trigger: 'immediate',
        state: 'confirmed', quantity: '2', price: '131.25', cumulative_quantity: '0',
        created_at: '2026-07-01T14:00:00', updated_at: '2026-07-01T14:00:00',
      }],
    }));

    const get = parse(await dbOrders.handler(makeEvent({ params: { scope: 'open' } })));
    const order = get.data.open_orders[0];
    expect(order.order_id).toBe('rh-raw-1');
    expect(order.side).toBe('BUY');
    expect(order.order_type).toBe('limit');
    expect(order.limit_price).toBe(131.25);
    // Naive engine timestamps are treated as UTC
    expect(order.created_at).toBe('2026-07-01T14:00:00.000Z');
  });

  test('upsert is idempotent on order_id and applies state transitions', async () => {
    const base = { order_id: 'ord-x', symbol: 'TSLA', side: 'BUY', state: 'queued', quantity: 1, limit_price: 100, created_at: NOW };
    await dbOrders.handler(makeEvent({ method: 'POST', body: { orders: [base] } }));
    await dbOrders.handler(makeEvent({ method: 'POST', body: { orders: [{ ...base, state: 'filled', filled_quantity: 1, average_price: 99.9 }] } }));

    const get = parse(await dbOrders.handler(makeEvent()));
    expect(get.count).toBe(1);
    expect(get.data.open_orders).toHaveLength(0);
    expect(get.data.historical_orders[0]).toEqual(expect.objectContaining({
      order_id: 'ord-x', state: 'filled', average_price: 99.9,
    }));
  });

  test('rejects bodies with no orders', async () => {
    const res = await dbOrders.handler(makeEvent({ method: 'POST', body: { nothing: true } }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).error.code).toBe('NO_ORDERS');
  });

  test('DELETE removes an order by id', async () => {
    await dbOrders.handler(makeEvent({ method: 'POST', body: { orders: [{ order_id: 'ord-del', symbol: 'X', state: 'queued', created_at: NOW }] } }));
    const del = parse(await dbOrders.handler(makeEvent({ method: 'DELETE', params: { order_id: 'ord-del' } })));
    expect(del.data.deleted).toBe(1);
    expect(parse(await dbOrders.handler(makeEvent())).count).toBe(0);
  });
});

// ── db-bot-activity ──────────────────────────────────────────────────────────

describe('db-bot-activity', () => {
  test('appends events (camelCase or snake_case) and lists newest first', async () => {
    const post = await dbBotActivity.handler(makeEvent({
      method: 'POST',
      body: {
        events: [
          { type: 'BUY_ORDER', status: 'submitted', symbol: 'TSLA', quantity: 10, price: 245, dryRun: false, timestamp: '2026-07-05T10:00:00Z' },
          { event_type: 'ANALYSIS', status: 'completed', details: 'Analyzed 5 positions', dry_run: true, created_at: '2026-07-05T11:00:00Z' },
        ],
      },
    }));
    expect(post.statusCode).toBe(200);
    expect(parse(post).data).toEqual(expect.objectContaining({ inserted: 2, skipped: 0 }));

    const get = parse(await dbBotActivity.handler(makeEvent()));
    expect(get.data.events).toHaveLength(2);
    const [newest, oldest] = get.data.events;
    expect(newest.event_type).toBe('ANALYSIS');
    expect(newest.dry_run).toBe(true);
    expect(oldest.event_type).toBe('BUY_ORDER');
    expect(oldest.total).toBe(2450); // derived from quantity × price
    expect(oldest.created_at).toBe('2026-07-05T10:00:00.000Z');
  });

  test('event_id makes appends idempotent', async () => {
    const event = { event_id: 'evt-1', type: 'SELL_ORDER', status: 'submitted', symbol: 'AAPL' };
    await dbBotActivity.handler(makeEvent({ method: 'POST', body: event }));
    const second = parse(await dbBotActivity.handler(makeEvent({ method: 'POST', body: event })));
    expect(second.data).toEqual(expect.objectContaining({ inserted: 0, skipped: 1 }));
    expect(parse(await dbBotActivity.handler(makeEvent())).data.events).toHaveLength(1);
  });

  test('derives event_id from order_id + status when event_id is absent', async () => {
    const fill = { order_id: 'rh-abc-123', type: 'BUY_ORDER', status: 'filled', symbol: 'TSLA', quantity: 10, price: 245 };
    const first = parse(await dbBotActivity.handler(makeEvent({ method: 'POST', body: fill })));
    expect(first.data).toEqual(expect.objectContaining({ inserted: 1, skipped: 0 }));

    // Retry of the same lifecycle transition dedupes via derived key
    const retry = parse(await dbBotActivity.handler(makeEvent({ method: 'POST', body: fill })));
    expect(retry.data).toEqual(expect.objectContaining({ inserted: 0, skipped: 1 }));

    // A different transition for the same order is a distinct event
    const cancelled = parse(await dbBotActivity.handler(makeEvent({
      method: 'POST', body: { ...fill, status: 'cancelled' },
    })));
    expect(cancelled.data).toEqual(expect.objectContaining({ inserted: 1 }));

    const get = parse(await dbBotActivity.handler(makeEvent()));
    const ids = get.data.events.map(e => e.event_id).sort();
    expect(ids).toEqual(['rh-abc-123:cancelled', 'rh-abc-123:filled']);
    expect(get.data.events.every(e => e.order_id === 'rh-abc-123')).toBe(true);

    // GET filter by order_id
    const byOrder = parse(await dbBotActivity.handler(makeEvent({ params: { order_id: 'rh-abc-123' } })));
    expect(byOrder.data.events).toHaveLength(2);
    const miss = parse(await dbBotActivity.handler(makeEvent({ params: { order_id: 'other' } })));
    expect(miss.data.events).toHaveLength(0);
  });

  test('explicit event_id wins over order_id derivation', async () => {
    await dbBotActivity.handler(makeEvent({
      method: 'POST',
      body: { event_id: 'custom-1', order_id: 'rh-abc-123', type: 'BUY_ORDER', status: 'filled' },
    }));
    const get = parse(await dbBotActivity.handler(makeEvent()));
    expect(get.data.events[0].event_id).toBe('custom-1');
    expect(get.data.events[0].order_id).toBe('rh-abc-123');
  });

  test('filters by type and symbol', async () => {
    await dbBotActivity.handler(makeEvent({ method: 'POST', body: { events: [
      { type: 'BUY_ORDER', status: 'submitted', symbol: 'TSLA' },
      { type: 'SELL_ORDER', status: 'submitted', symbol: 'AAPL' },
    ] } }));
    const get = parse(await dbBotActivity.handler(makeEvent({ params: { type: 'BUY_ORDER' } })));
    expect(get.data.events).toHaveLength(1);
    expect(get.data.events[0].symbol).toBe('TSLA');
  });
});

// ── db-pnl ───────────────────────────────────────────────────────────────────

describe('db-pnl', () => {
  test('computes realized stock and option P&L from DB orders', async () => {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    await dbOrders.handler(makeEvent({
      method: 'POST',
      body: {
        orders: [
          { order_id: 'buy-1', symbol: 'TSLA', side: 'BUY', state: 'filled', quantity: 10, filled_quantity: 10, average_price: 100, created_at: hourAgo },
          { order_id: 'sell-1', symbol: 'TSLA', side: 'SELL', state: 'filled', quantity: 10, filled_quantity: 10, average_price: 110, created_at: NOW },
          { order_id: 'open-1', symbol: 'NVDA', side: 'BUY', state: 'queued', quantity: 1, limit_price: 130, created_at: NOW },
        ],
        option_orders: [
          { order_id: 'optsell-1', chain_symbol: 'CRWD', direction: 'credit', state: 'filled', quantity: 1, processed_premium: 550, created_at: NOW },
        ],
      },
    }));

    const res = await dbPnl.handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.ok).toBe(true);
    expect(body.resource).toBe('pnl');

    const week = body.data.periods['1W'];
    expect(week.stock.total_realized_pnl).toBe(100);        // (110 − 100) × 10
    expect(week.stock.symbols[0].symbol).toBe('TSLA');
    expect(week.option.total_realized_pnl).toBe(550);       // credit premium
    expect(week.combined_realized_pnl).toBe(650);

    // All six periods present by default
    expect(Object.keys(body.data.periods).sort()).toEqual(['1M', '1W', '1Y', '3M', '5Y', '6M']);

    // Open orders surfaced for the Open Orders / notional card
    expect(body.data.open_orders.map(o => o.order_id)).toEqual(['open-1']);
    expect(body.data.counts).toEqual(expect.objectContaining({ open_orders: 1, stock_orders: 3, option_orders: 1 }));
  });

  test('single period query and bad period validation', async () => {
    const single = parse(await dbPnl.handler(makeEvent({ params: { period: '1M' } })));
    expect(Object.keys(single.data.periods)).toEqual(['1M']);

    const bad = await dbPnl.handler(makeEvent({ params: { period: 'XX' } }));
    expect(bad.statusCode).toBe(400);
    expect(parse(bad).error.code).toBe('BAD_PERIOD');
  });
});

// ── Write auth (TRADING_DB_TOKEN) ────────────────────────────────────────────

describe('write auth', () => {
  test('when TRADING_DB_TOKEN is set, writes require the bearer token but reads stay open', async () => {
    process.env.TRADING_DB_TOKEN = 'secret-token';
    const order = { orders: [{ order_id: 'auth-1', symbol: 'TSLA', state: 'queued', created_at: NOW }] };

    const denied = await dbOrders.handler(makeEvent({ method: 'POST', body: order }));
    expect(denied.statusCode).toBe(401);
    expect(parse(denied).error.code).toBe('UNAUTHORIZED');

    const allowed = await dbOrders.handler(makeEvent({
      method: 'POST', body: order,
      headers: { authorization: 'Bearer secret-token' },
    }));
    expect(allowed.statusCode).toBe(200);

    const read = await dbOrders.handler(makeEvent());
    expect(read.statusCode).toBe(200);

    const activityDenied = await dbBotActivity.handler(makeEvent({ method: 'POST', body: { type: 'X', status: 'y' } }));
    expect(activityDenied.statusCode).toBe(401);
  });
});
