// Contract tests for stock orders AND option orders through db-orders:
// exact response shape (keys, types, null semantics) and every accepted
// input dialect (engine-blob, raw RH API, string numerics, naive timestamps).
// The response contracts here mirror the frontend SnapshotOrder /
// SnapshotOptionOrder interfaces and the shared mocks.

const fs = require('fs');
const path = require('path');
const t = require('../../netlify/functions/lib/tradingDb.cjs');
const dbOrders = require('../../netlify/functions/db-orders.cjs');
const dbPnl = require('../../netlify/functions/db-pnl.cjs');

const NOW = new Date().toISOString();

function makeEvent({ method = 'GET', params = null, body = null } = {}) {
  return { httpMethod: method, queryStringParameters: params, headers: {}, body: body != null ? JSON.stringify(body) : null };
}
const parse = res => JSON.parse(res.body);

async function post(body) {
  const res = await dbOrders.handler(makeEvent({ method: 'POST', body }));
  expect(res.statusCode).toBe(200);
  return parse(res);
}
async function getAll(params) {
  return parse(await dbOrders.handler(makeEvent({ params }))).data;
}

beforeEach(() => {
  t.__resetForTests();
  delete process.env.TRADING_DB_TOKEN;
  t.__setTestClient(t.createMemoryClient());
});
afterAll(() => t.__resetForTests());

// ── Response shape: stock orders ─────────────────────────────────────────────

const STOCK_ORDER_KEYS = [
  'order_id', 'symbol', 'side', 'order_type', 'trigger', 'state', 'quantity',
  'limit_price', 'stop_price', 'filled_quantity', 'average_price', 'created_at', 'updated_at',
].sort();

const OPTION_ORDER_KEYS = [
  'order_id', 'chain_symbol', 'direction', 'state', 'quantity', 'price',
  'processed_premium', 'order_type', 'opening_strategy', 'legs', 'created_at', 'updated_at',
].sort();

const OPTION_LEG_KEYS = [
  'chain_symbol', 'strike_price', 'expiration_date', 'option_type', 'side', 'position_effect',
].sort();

describe('stock order response contract', () => {
  test('fully-populated order returns exactly the SnapshotOrder keys with correct types', async () => {
    await post({ orders: [{
      order_id: 'shape-1', symbol: 'TSLA', side: 'BUY', order_type: 'limit', trigger: 'immediate',
      state: 'filled', quantity: 10, limit_price: 245.5, stop_price: 240, filled_quantity: 10,
      average_price: 245.1, created_at: NOW, updated_at: NOW,
    }] });

    const order = (await getAll()).historical_orders[0];
    expect(Object.keys(order).sort()).toEqual(STOCK_ORDER_KEYS);
    expect(order).toEqual({
      order_id: 'shape-1',
      symbol: 'TSLA',
      side: 'BUY',
      order_type: 'limit',
      trigger: 'immediate',
      state: 'filled',
      quantity: 10,
      limit_price: 245.5,
      stop_price: 240,
      filled_quantity: 10,
      average_price: 245.1,
      created_at: NOW,
      updated_at: NOW,
    });
    // numerics are numbers, never strings
    for (const k of ['quantity', 'limit_price', 'stop_price', 'filled_quantity', 'average_price']) {
      expect(typeof order[k]).toBe('number');
    }
  });

  test('minimal order applies null/zero semantics (nullable vs defaulted fields)', async () => {
    await post({ orders: [{ order_id: 'shape-min', symbol: 'X', state: 'queued', created_at: NOW }] });
    const order = (await getAll()).open_orders[0];
    expect(Object.keys(order).sort()).toEqual(STOCK_ORDER_KEYS); // same keys even when sparse
    expect(order.quantity).toBe(0);          // defaulted
    expect(order.limit_price).toBe(0);       // defaulted
    expect(order.stop_price).toBeNull();     // nullable
    expect(order.filled_quantity).toBeNull();// nullable — P&L falls back to quantity
    expect(order.average_price).toBeNull();  // nullable
    expect(order.side).toBeNull();
    expect(order.updated_at).toBeNull();
  });

  test('the shared snapshot_order.json mock round-trips unchanged', async () => {
    const mock = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/mocks/snapshot_order.json'), 'utf-8'));
    await post({ orders: [mock] });
    const order = (await getAll()).open_orders[0];
    for (const [k, v] of Object.entries(mock)) {
      if (k === 'created_at' || k === 'updated_at') {
        expect(new Date(order[k]).getTime()).toBe(new Date(v).getTime());
      } else {
        expect(order[k]).toEqual(v);
      }
    }
  });

  test('the shared order_event.json mock (raw RH id/asset_type dialect) is accepted', async () => {
    const mock = JSON.parse(fs.readFileSync(path.join(__dirname, '../../shared/mocks/order_event.json'), 'utf-8'));
    await post([mock]); // bare-array form, id instead of order_id
    const order = (await getAll()).historical_orders[0];
    expect(order.order_id).toBe(mock.id);
    expect(order.filled_quantity).toBe(mock.filled_quantity);
    expect(order.average_price).toBe(mock.average_price);
  });
});

// ── Response shape: option orders ────────────────────────────────────────────

describe('option order response contract', () => {
  test('fully-populated option order returns exactly the SnapshotOptionOrder keys with correct types', async () => {
    await post({ option_orders: [{
      order_id: 'opt-shape-1', chain_symbol: 'CRWD', direction: 'credit', state: 'filled',
      quantity: 2, price: 5.5, processed_premium: 1100, order_type: 'limit',
      opening_strategy: 'short_put', created_at: NOW, updated_at: NOW,
      legs: [{ chain_symbol: 'CRWD', strike_price: 100, expiration_date: '2026-09-18',
               option_type: 'put', side: 'SELL', position_effect: 'open' }],
    }] });

    const order = (await getAll()).historical_option_orders[0];
    expect(Object.keys(order).sort()).toEqual(OPTION_ORDER_KEYS);
    expect(order).toEqual({
      order_id: 'opt-shape-1',
      chain_symbol: 'CRWD',
      direction: 'credit',
      state: 'filled',
      quantity: 2,
      price: 5.5,
      processed_premium: 1100,
      order_type: 'limit',
      opening_strategy: 'short_put',
      created_at: NOW,
      updated_at: NOW,
      legs: [{
        chain_symbol: 'CRWD', strike_price: 100, expiration_date: '2026-09-18',
        option_type: 'put', side: 'SELL', position_effect: 'open',
      }],
    });
    expect(Object.keys(order.legs[0]).sort()).toEqual(OPTION_LEG_KEYS);
    for (const k of ['quantity', 'price', 'processed_premium']) expect(typeof order[k]).toBe('number');
  });

  test('minimal option order applies null/zero/empty semantics', async () => {
    await post({ option_orders: [{ order_id: 'opt-min', chain_symbol: 'NVDA', state: 'confirmed', created_at: NOW }] });
    const order = (await getAll()).open_option_orders[0];
    expect(Object.keys(order).sort()).toEqual(OPTION_ORDER_KEYS);
    expect(order.quantity).toBe(0);
    expect(order.price).toBe(0);
    expect(order.processed_premium).toBeNull();
    expect(order.opening_strategy).toBeNull();
    expect(order.direction).toBeNull();
    expect(order.legs).toEqual([]);
  });
});

// ── Input dialects ───────────────────────────────────────────────────────────

describe('input dialect normalization', () => {
  test('stock: raw RH spellings + string numerics normalize to the contract', async () => {
    await post([{
      id: 'dial-s1',                       // → order_id
      symbol: 'NVDA',
      side: 'buy',                         // → BUY
      type: 'stop_limit',                  // → order_type
      trigger: 'stop',
      state: 'queued',
      quantity: '2.5',                     // string → number
      price: '131.25',                     // → limit_price
      stop_price: '128.00',
      cumulative_quantity: '1.5',          // → filled_quantity
      average_price: '130.99',
      created_at: '2026-07-01T14:00:00',   // naive → UTC
      updated_at: '2026-07-01 14:05:00',   // space-separated naive → UTC
    }]);
    const order = (await getAll()).open_orders[0];
    expect(order).toEqual(expect.objectContaining({
      order_id: 'dial-s1', side: 'BUY', order_type: 'stop_limit',
      quantity: 2.5, limit_price: 131.25, stop_price: 128,
      filled_quantity: 1.5, average_price: 130.99,
      created_at: '2026-07-01T14:00:00.000Z',
      updated_at: '2026-07-01T14:05:00.000Z',
    }));
  });

  test('stock: explicit engine-blob fields win over RH aliases when both present', async () => {
    await post({ orders: [{
      order_id: 'dial-s2', id: 'WRONG', order_type: 'limit', type: 'WRONG',
      limit_price: 100, price: 999, filled_quantity: 3, cumulative_quantity: 999,
      symbol: 'X', state: 'queued', created_at: NOW,
    }] });
    const order = (await getAll()).open_orders[0];
    expect(order.order_id).toBe('dial-s2');
    expect(order.order_type).toBe('limit');
    expect(order.limit_price).toBe(100);
    expect(order.filled_quantity).toBe(3);
  });

  test('option: leg aliases (strike/expiration) and order-level chain_symbol propagate into legs', async () => {
    await post({ option_orders: [{
      id: 'dial-o1',
      chain_symbol: 'CRWD',                // order-level (RH gotcha: not inside legs)
      direction: 'CREDIT',                 // → lowercase
      state: 'filled',
      quantity: '1',
      price: '5.50',
      created_at: '2026-07-02T13:00:00',
      legs: [{ strike: '100.5', expiration: '2026-09-18', option_type: 'call', side: 'sell' }],
    }] });
    const order = (await getAll()).historical_option_orders[0];
    expect(order.order_id).toBe('dial-o1');
    expect(order.direction).toBe('credit');
    expect(order.price).toBe(5.5);
    expect(order.legs[0]).toEqual({
      chain_symbol: 'CRWD',                // propagated from the order level
      strike_price: '100.5',
      expiration_date: '2026-09-18',
      option_type: 'call',
      side: 'SELL',
      position_effect: null,
    });
    // chain_symbol also derivable the other way: leg-level only
    await post({ option_orders: [{
      order_id: 'dial-o2', state: 'filled', quantity: 1, price: 1, created_at: NOW,
      legs: [{ chain_symbol: 'NVDA', strike_price: 120, expiration_date: '2026-12-18', option_type: 'put', side: 'buy' }],
    }] });
    const o2 = (await getAll()).historical_option_orders.find(o => o.order_id === 'dial-o2');
    expect(o2.chain_symbol).toBe('NVDA');  // lifted from the first leg
  });

  test('mixed bare array classifies stock vs option automatically', async () => {
    await post([
      { id: 'mix-s', symbol: 'TSLA', side: 'buy', state: 'queued', quantity: 1, price: 100, created_at: NOW },
      { id: 'mix-o', chain_symbol: 'TSLA', direction: 'debit', state: 'confirmed', quantity: 1, price: 2, created_at: NOW },
      { id: 'mix-o2', state: 'queued', quantity: 1, created_at: NOW,
        legs: [{ strike: 50, expiration: '2026-08-21', option_type: 'call', side: 'buy' }] },
    ]);
    const data = await getAll();
    expect(data.open_orders.map(o => o.order_id)).toEqual(['mix-s']);
    expect(data.open_option_orders.map(o => o.order_id).sort()).toEqual(['mix-o', 'mix-o2']);
  });

  test('orders without any id are skipped and counted, valid ones still land', async () => {
    const result = await post({ orders: [
      { symbol: 'NOID', state: 'queued', created_at: NOW },
      { order_id: 'ok-1', symbol: 'OK', state: 'queued', created_at: NOW },
    ] });
    expect(result.data).toEqual(expect.objectContaining({ stock_upserted: 1, skipped: 1, order_ids: ['ok-1'] }));
  });
});

// ── Shape consistency across endpoints ───────────────────────────────────────

describe('cross-endpoint shape consistency', () => {
  test('db-pnl open_orders / open_option_orders use the same contracts as db-orders', async () => {
    await post({
      orders: [{ order_id: 'x-s', symbol: 'TSLA', side: 'BUY', state: 'queued', quantity: 1, limit_price: 100, created_at: NOW }],
      option_orders: [{ order_id: 'x-o', chain_symbol: 'CRWD', direction: 'debit', state: 'confirmed', quantity: 1, price: 2, created_at: NOW,
        legs: [{ strike: 100, expiration: '2026-09-18', option_type: 'call', side: 'buy' }] }],
    });
    const pnl = parse(await dbPnl.handler(makeEvent({ params: { period: '1W' } }))).data;
    expect(Object.keys(pnl.open_orders[0]).sort()).toEqual(STOCK_ORDER_KEYS);
    expect(Object.keys(pnl.open_option_orders[0]).sort()).toEqual(OPTION_ORDER_KEYS);
    expect(Object.keys(pnl.open_option_orders[0].legs[0]).sort()).toEqual(OPTION_LEG_KEYS);
  });
});
