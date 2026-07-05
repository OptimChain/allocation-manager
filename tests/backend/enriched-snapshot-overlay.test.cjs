// enriched-snapshot: trading-DB order overlay — when the DB has orders, they
// replace the (possibly weeks-stale) blob order book before enrichment.

const t = require('../../netlify/functions/lib/tradingDb.cjs');
const es = require('../../netlify/functions/enriched-snapshot.cjs');

const NOW = new Date().toISOString();

const STALE_BLOB = {
  timestamp: '2026-05-14T22:29:55.030048+00:00',
  order_book: [],
  market_data: null,
  recent_orders: [
    { order_id: 'blob-old-1', symbol: 'OLD', side: 'BUY', state: 'filled', quantity: 1,
      filled_quantity: 1, average_price: 10, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
  ],
  recent_option_orders: [],
  portfolio: {
    cash: 0, equity: 1000, market_value: 1000,
    positions: [], options: [],
    open_orders: [
      { order_id: 'blob-open-1', symbol: 'OLD', side: 'BUY', state: 'queued', quantity: 1,
        limit_price: 10, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z' },
    ],
    open_option_orders: [],
  },
};

let fetchMock;

beforeEach(() => {
  t.__resetForTests();
  t.__setTestClient(t.createMemoryClient());
  process.env.URL = 'https://test.example';
  fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(JSON.parse(JSON.stringify(STALE_BLOB))),
  });
});

afterEach(() => {
  fetchMock.mockRestore();
  delete process.env.URL;
});

afterAll(() => t.__resetForTests());

async function seedDb() {
  const db = t.getDb();
  await t.ensureSchema(db);
  await t.upsertStockOrder(db, t.normalizeStockOrder(
    { order_id: 'db-open-1', symbol: 'SNDK', side: 'BUY', state: 'queued', quantity: 0.3, limit_price: 1762.5, created_at: NOW }), {});
  await t.upsertStockOrder(db, t.normalizeStockOrder(
    { order_id: 'db-buy-1', symbol: 'NVDA', side: 'BUY', state: 'filled', quantity: 2, filled_quantity: 2, average_price: 100, created_at: NOW }), {});
  await t.upsertStockOrder(db, t.normalizeStockOrder(
    { order_id: 'db-sell-1', symbol: 'NVDA', side: 'SELL', state: 'filled', quantity: 2, filled_quantity: 2, average_price: 110, created_at: NOW }), {});
  await t.upsertOptionOrder(db, t.normalizeOptionOrder(
    { order_id: 'db-opt-1', chain_symbol: 'CRWD', direction: 'credit', state: 'filled', quantity: 1, processed_premium: 550, created_at: NOW }), {});
}

describe('enriched-snapshot DB overlay', () => {
  test('DB orders replace the stale blob order book (stock AND options)', async () => {
    await seedDb();
    const res = await es.handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.orders_source).toBe('db');
    expect(new Date(body.orders_as_of).getTime()).toBeGreaterThan(Date.parse('2026-07-01'));

    // Open orders come from the DB, not the stale blob
    expect(body.portfolio.open_orders.map(o => o.order_id)).toEqual(['db-open-1']);
    // Historical orders and P&L windows reflect DB data — options included
    expect(body.recent_orders.map(o => o.order_id)).toEqual(expect.arrayContaining(['db-buy-1', 'db-sell-1']));
    expect(body.recent_pnl.total_realized_pnl).toBe(20);   // (110−100)×2
    expect(body.option_pnl.total_realized_pnl).toBe(550);  // CRWD credit
    expect(body.option_pnl.symbols[0].symbol).toBe('CRWD'); // grouped by chain, not 'OPT'
    expect(body.combined_7d_pnl).toBe(570);
    // Blob-only fields stay blob-sourced
    expect(body.timestamp).toBe(STALE_BLOB.timestamp);
    expect(body.portfolio.equity).toBe(1000);
  });

  test('empty DB keeps blob orders untouched (orders_source=blob)', async () => {
    const res = await es.handler({ httpMethod: 'GET' });
    const body = JSON.parse(res.body);
    expect(body.orders_source).toBe('blob');
    expect(body.orders_as_of).toBe(STALE_BLOB.timestamp);
    expect(body.portfolio.open_orders.map(o => o.order_id)).toEqual(['blob-open-1']);
  });

  test('orders with null created_at do not 500 the snapshot (regression)', async () => {
    await seedDb();
    const db = t.getDb();
    await t.upsertStockOrder(db, t.normalizeStockOrder(
      { order_id: 'db-null-ts', symbol: 'X', side: 'BUY', state: 'filled', quantity: 1, average_price: 5 }), {});
    const res = await es.handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const ids = body.recent_orders.map(o => o.order_id);
    expect(ids).toContain('db-null-ts');
    // nulls sort last, real timestamps stay newest-first
    expect(ids[ids.length - 1]).toBe('db-null-ts');
  });

  test('DB failure degrades gracefully to blob orders', async () => {
    t.__setTestClient({ query: () => Promise.reject(new Error('db down')) });
    const res = await es.handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.orders_source).toBe('blob');
    expect(body.portfolio.open_orders.map(o => o.order_id)).toEqual(['blob-open-1']);
  });
});
