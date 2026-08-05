// Batched upserts: one round trip per chunk instead of one per row.
//
// The engine posts its whole order book every sync (225 rows is normal).
// Row-at-a-time upserts took ~20s against Render Postgres — past the client's
// read timeout and Netlify's function limit — so the sync failed far more
// often than it landed, and order history sat a month stale.

const t = require('../../netlify/functions/lib/tradingDb.cjs');

/** Wraps the memory client and counts the statements actually issued. */
function countingClient() {
  const inner = t.createMemoryClient();
  const statements = [];
  return {
    statements,
    async query(text, params = []) {
      statements.push(text.trim());
      return inner.query(text, params);
    },
  };
}

const order = i => ({
  order_id: `ord-${i}`, symbol: 'NVDA', side: 'BUY', state: 'filled',
  quantity: 1, filled_quantity: 1, average_price: 100,
  created_at: '2026-08-01T00:00:00Z',
});

let db;
beforeEach(() => {
  t.__resetForTests();
  db = countingClient();
  t.__setTestClient(db);
});
afterAll(() => t.__resetForTests());

const inserts = () => db.statements.filter(s => /^INSERT INTO stock_orders/i.test(s));

describe('batched upserts', () => {
  test('225 orders become 5 statements, not 225', async () => {
    await t.ensureSchema(db);
    const rows = Array.from({ length: 225 }, (_, i) =>
      ({ value: t.normalizeStockOrder(order(i)), raw: order(i) }));

    const written = await t.upsertStockOrders(db, rows);

    expect(written).toBe(225);
    expect(inserts()).toHaveLength(5);          // ceil(225 / 50)
  });

  test('every row survives the round trip', async () => {
    await t.ensureSchema(db);
    const rows = Array.from({ length: 120 }, (_, i) =>
      ({ value: t.normalizeStockOrder(order(i)), raw: order(i) }));
    await t.upsertStockOrders(db, rows);

    const stored = await t.fetchStockOrders(db, 500);
    expect(stored).toHaveLength(120);
    expect(stored.map(r => r.order_id)).toContain('ord-119');
  });

  test('duplicate ids collapse to the last one', async () => {
    // Postgres rejects a multi-row upsert that hits the same conflict target
    // twice, and a payload can legitimately repeat an id.
    await t.ensureSchema(db);
    const first  = { ...order(1), symbol: 'OLD' };
    const second = { ...order(1), symbol: 'NEW' };
    const rows = [first, second].map(raw =>
      ({ value: t.normalizeStockOrder(raw), raw }));

    const written = await t.upsertStockOrders(db, rows);

    expect(written).toBe(1);
    const stored = await t.fetchStockOrders(db, 10);
    expect(stored).toHaveLength(1);
    expect(stored[0].symbol).toBe('NEW');
  });

  test('an empty batch issues no statement at all', async () => {
    await t.ensureSchema(db);
    expect(await t.upsertStockOrders(db, [])).toBe(0);
    expect(inserts()).toHaveLength(0);
  });

  test('re-posting the same book updates in place', async () => {
    await t.ensureSchema(db);
    const rows = Array.from({ length: 10 }, (_, i) =>
      ({ value: t.normalizeStockOrder(order(i)), raw: order(i) }));
    await t.upsertStockOrders(db, rows);
    await t.upsertStockOrders(db, rows);

    expect(await t.fetchStockOrders(db, 500)).toHaveLength(10);
  });

  test('positions batch the same way', async () => {
    await t.ensureSchema(db);
    const rows = Array.from({ length: 60 }, (_, i) => {
      const raw = { symbol: `SYM${i}`, qty: 1, avg_entry: 10,
                    market_value: 12, unrealized_pl: 2, unrealized_pl_pct: 0.2 };
      return { value: t.normalizePosition(raw), raw };
    });

    expect(await t.upsertPositions(db, rows)).toBe(60);
    expect(db.statements.filter(s => /^INSERT INTO positions/i.test(s))).toHaveLength(2);
    expect(await t.fetchPositions(db)).toHaveLength(60);
  });
});
