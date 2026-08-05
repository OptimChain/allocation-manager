// order-book-snapshot now serves positions AND orders from the trading DB.
// The Netlify "engine snapshot" blob it replaced was only written when the
// engine ran with DRY_RUN=false, so positions froze while orders stayed
// current. These tests pin the DB-sourced contract, and enriched-snapshot's
// pass-through of the provenance fields the dashboard renders.

const t   = require('../../netlify/functions/lib/tradingDb.cjs');
const obs = require('../../netlify/functions/order-book-snapshot.cjs');
const es  = require('../../netlify/functions/enriched-snapshot.cjs');

const NOW = new Date().toISOString();

beforeEach(() => {
  t.__resetForTests();
  t.__setTestClient(t.createMemoryClient());
  // No blobs token → market_data resolves to null without touching the network
  delete process.env.NETLIFY_AUTH_TOKEN;
});

afterAll(() => t.__resetForTests());

async function seedBook() {
  const db = t.getDb();
  await t.ensureSchema(db);

  await t.upsertPosition(db, t.normalizePosition(
    { symbol: 'NVDA', qty: 10, avg_entry: 100, market_value: 1200,
      unrealized_pl: 200, unrealized_pl_pct: 0.2 }), {});
  await t.upsertPosition(db, t.normalizePosition(
    { symbol: 'SNDK', qty: 2, avg_entry: 50, market_value: 90,
      unrealized_pl: -10, unrealized_pl_pct: -0.1 }), {});
  await t.upsertOptionPosition(db, t.normalizeOptionPosition(
    { chain_symbol: 'CRWD', strike: 300, expiration: '2026-09-18', option_type: 'call',
      quantity: 1, avg_price: 5, mark_price: 7, current_value: 700,
      unrealized_pl: 200, unrealized_pl_pct: 0.4, dte: 45 }), {});
  await t.upsertAccountSnapshot(db, t.normalizeAccount(
    { equity: 5000, cash: 250, buying_power: 500, portfolio_value: 4750 }), {});

  await t.upsertStockOrder(db, t.normalizeStockOrder(
    { order_id: 'db-open-1', symbol: 'SNDK', side: 'BUY', state: 'queued',
      quantity: 0.3, limit_price: 1762.5, created_at: NOW }), {});
  await t.upsertStockOrder(db, t.normalizeStockOrder(
    { order_id: 'db-buy-1', symbol: 'NVDA', side: 'BUY', state: 'filled', quantity: 2,
      filled_quantity: 2, average_price: 100, created_at: NOW }), {});
  await t.upsertStockOrder(db, t.normalizeStockOrder(
    { order_id: 'db-sell-1', symbol: 'NVDA', side: 'SELL', state: 'filled', quantity: 2,
      filled_quantity: 2, average_price: 110, created_at: NOW }), {});
  await t.upsertOptionOrder(db, t.normalizeOptionOrder(
    { order_id: 'db-opt-1', chain_symbol: 'CRWD', direction: 'credit', state: 'filled',
      quantity: 1, processed_premium: 550, created_at: NOW }), {});
}

async function snapshot() {
  const res = await obs.handler({ httpMethod: 'GET' });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

describe('order-book-snapshot (DB-sourced)', () => {
  test('serves positions, options and account from the DB', async () => {
    await seedBook();
    const body = await snapshot();

    expect(body.portfolio.positions.map(p => p.symbol)).toEqual(['NVDA', 'SNDK']);
    expect(body.portfolio.equity).toBe(5000);
    expect(body.portfolio.cash.cash).toBe(250);
    expect(body.portfolio.cash.buying_power).toBe(500);
    // market_value totals stocks AND options (RH's own equity omits options)
    expect(body.portfolio.market_value).toBe(1990);
    expect(body.portfolio.options).toHaveLength(1);
    expect(body.portfolio.options[0].chain_symbol).toBe('CRWD');
  });

  test('profit_loss_pct round-trips a fraction as a percent', async () => {
    await seedBook();
    const body = await snapshot();
    const nvda = body.portfolio.positions.find(p => p.symbol === 'NVDA');
    expect(nvda.profit_loss).toBe(200);
    expect(nvda.profit_loss_pct).toBe(20);   // stored 0.2 → surfaced 20%
    expect(nvda.current_price).toBe(120);    // derived from equity / quantity
  });

  test('orders split into the open book and recent history', async () => {
    await seedBook();
    const body = await snapshot();
    expect(body.order_book.map(o => o.order_id)).toEqual(['db-open-1']);
    expect(body.portfolio.open_orders.map(o => o.order_id)).toEqual(['db-open-1']);
    expect(body.recent_orders.map(o => o.order_id))
      .toEqual(expect.arrayContaining(['db-buy-1', 'db-sell-1']));
  });

  test('reports db provenance for both halves of the status line', async () => {
    await seedBook();
    const body = await snapshot();
    expect(body.orders_source).toBe('db');
    expect(body.positions_source).toBe('db');
    expect(body.positions_as_of).toBeTruthy();
    expect(body.market_data).toBeNull();
  });

  test('untracked placement stubs never reach the rendered order book', async () => {
    await seedBook();
    const db = t.getDb();
    // A trailing-stop placement written by an external tool: client id, no state
    await t.upsertStockOrder(db, t.normalizeStockOrder(
      { order_id: 'db-stub-1', symbol: 'NBIS', side: 'SELL', order_type: 'market',
        stop_price: 189.98, updated_at: NOW }), {});
    await t.upsertOptionOrder(db, t.normalizeOptionOrder(
      { order_id: 'db-opt-stub-1', chain_symbol: 'CRWD', direction: 'credit',
        quantity: 1, updated_at: NOW }), {});

    const body = await snapshot();
    expect(body.recent_orders.map(o => o.order_id)).not.toContain('db-stub-1');
    expect(body.order_book.map(o => o.order_id)).not.toContain('db-stub-1');
    expect(body.recent_option_orders.map(o => o.order_id)).not.toContain('db-opt-stub-1');
    expect(body.recent_orders.map(o => o.order_id))
      .toEqual(expect.arrayContaining(['db-buy-1', 'db-sell-1']));
  });

  test('orders with null created_at do not 500 the snapshot (regression)', async () => {
    await seedBook();
    const db = t.getDb();
    await t.upsertStockOrder(db, t.normalizeStockOrder(
      { order_id: 'db-null-ts', symbol: 'X', side: 'BUY', state: 'filled',
        quantity: 1, average_price: 5 }), {});
    const body = await snapshot();
    const ids = body.recent_orders.map(o => o.order_id);
    expect(ids).toContain('db-null-ts');
    // nulls sort last, real timestamps stay newest-first
    expect(ids[ids.length - 1]).toBe('db-null-ts');
  });

  test('an empty book returns an empty snapshot rather than failing', async () => {
    await t.ensureSchema(t.getDb());
    const body = await snapshot();
    expect(body.portfolio.positions).toEqual([]);
    expect(body.portfolio.equity).toBe(0);
    expect(body.order_book).toEqual([]);
  });
});

describe('enriched-snapshot', () => {
  let fetchMock;
  afterEach(() => fetchMock && fetchMock.mockRestore());

  test('enriches the DB snapshot and carries provenance through', async () => {
    await seedBook();
    const raw = await snapshot();
    process.env.URL = 'https://test.example';
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: () => Promise.resolve(raw),
    });

    const res = await es.handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.orders_source).toBe('db');
    expect(body.positions_source).toBe('db');
    expect(body.recent_pnl.total_realized_pnl).toBe(20);    // (110−100)×2
    expect(body.option_pnl.total_realized_pnl).toBe(550);   // CRWD credit
    expect(body.option_pnl.symbols[0].symbol).toBe('CRWD'); // grouped by chain, not 'OPT'
    expect(body.combined_7d_pnl).toBe(570);
    delete process.env.URL;
  });
});
