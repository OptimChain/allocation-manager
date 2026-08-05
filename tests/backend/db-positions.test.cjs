// db-positions: the current holdings book.
//
// POST is a REPLACE, not a merge — positions are a set, not an append-only
// log. These tests pin that contract, since getting it wrong either leaves
// closed positions on the dashboard forever or silently wipes the book.

const t  = require('../../netlify/functions/lib/tradingDb.cjs');
const fn = require('../../netlify/functions/db-positions.cjs');

const post = (body) => fn.handler({ httpMethod: 'POST', body: JSON.stringify(body) });
const get  = (qs)   => fn.handler({ httpMethod: 'GET', queryStringParameters: qs || {} });

async function bodyOf(resPromise) {
  const res = await resPromise;
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

beforeEach(() => {
  t.__resetForTests();
  t.__setTestClient(t.createMemoryClient());
});

afterAll(() => t.__resetForTests());

const NVDA = { symbol: 'NVDA', qty: 10, avg_entry: 100, market_value: 1200,
               unrealized_pl: 200, unrealized_pl_pct: 0.2 };
const SNDK = { symbol: 'SNDK', qty: 2, avg_entry: 50, market_value: 90,
               unrealized_pl: -10, unrealized_pl_pct: -0.1 };
const CRWD_CALL = { chain_symbol: 'CRWD', strike: 300, expiration: '2026-09-18',
                    option_type: 'call', quantity: 1, avg_price: 5, mark_price: 7,
                    current_value: 700, unrealized_pl: 200, unrealized_pl_pct: 0.4 };

describe('db-positions', () => {
  test('stores a book and reads it back in dashboard shape', async () => {
    await post({ positions: [NVDA, SNDK], option_positions: [CRWD_CALL],
                 account: { equity: 5000, cash: 250, buying_power: 500 } });

    const { status, body } = await bodyOf(get());
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.positions.map(p => p.symbol)).toEqual(['NVDA', 'SNDK']);
    expect(body.data.account.equity).toBe(5000);
    expect(body.data.totals.market_value).toBe(1990);
    expect(body.data.counts).toEqual({ positions: 2, option_positions: 1 });
  });

  test('profit_loss_pct is stored as a fraction and surfaced as a percent', async () => {
    await post({ positions: [NVDA] });
    const { body } = await bodyOf(get());
    const nvda = body.data.positions[0];
    expect(nvda.profit_loss_pct).toBe(20);
    expect(nvda.current_price).toBe(120); // derived from equity / quantity
  });

  test('accepts dashboard field spellings as well as engine ones', async () => {
    await post({ positions: [{ symbol: 'AAPL', quantity: 4, avg_buy_price: 10,
                               equity: 60, profit_loss: 20, profit_loss_pct: 50 }] });
    const { body } = await bodyOf(get());
    expect(body.data.positions[0]).toMatchObject({
      symbol: 'AAPL', quantity: 4, avg_buy_price: 10, equity: 60,
      profit_loss: 20, profit_loss_pct: 50,
    });
  });

  test('replaces rather than merges — a closed position is pruned', async () => {
    await post({ positions: [NVDA, SNDK] });
    const second = await bodyOf(post({ positions: [NVDA] }));

    expect(second.body.data.pruned_positions).toBe(1);
    const { body } = await bodyOf(get());
    expect(body.data.positions.map(p => p.symbol)).toEqual(['NVDA']);
  });

  test('an explicit empty array clears the book', async () => {
    await post({ positions: [NVDA, SNDK] });
    await post({ positions: [] });
    const { body } = await bodyOf(get());
    expect(body.data.positions).toEqual([]);
  });

  test('a stock-only sync does not wipe the option book', async () => {
    await post({ positions: [NVDA], option_positions: [CRWD_CALL] });
    await post({ positions: [SNDK] });   // no option_positions key at all

    const { body } = await bodyOf(get());
    expect(body.data.positions.map(p => p.symbol)).toEqual(['SNDK']);
    expect(body.data.option_positions).toHaveLength(1);
  });

  test('a body with no book at all is rejected instead of wiping', async () => {
    await post({ positions: [NVDA] });
    const { status, body } = await bodyOf(post({ note: 'oops' }));

    expect(status).toBe(400);
    expect(body.error.code).toBe('NO_POSITIONS');
    const after = await bodyOf(get());
    expect(after.body.data.positions).toHaveLength(1);
  });

  test('positions missing a symbol are skipped, not stored', async () => {
    const { body } = await bodyOf(post({ positions: [NVDA, { qty: 1 }] }));
    expect(body.data.positions_upserted).toBe(1);
    expect(body.data.skipped).toBe(1);
  });

  test('filters by type and symbol', async () => {
    await post({ positions: [NVDA, SNDK], option_positions: [CRWD_CALL] });

    const stocksOnly = await bodyOf(get({ type: 'stock' }));
    expect(stocksOnly.body.data.option_positions).toEqual([]);

    const oneName = await bodyOf(get({ symbol: 'NVDA' }));
    expect(oneName.body.data.positions.map(p => p.symbol)).toEqual(['NVDA']);
  });

  test('deletes a single stock position by symbol', async () => {
    await post({ positions: [NVDA, SNDK] });
    const res = await fn.handler({ httpMethod: 'DELETE',
                                   queryStringParameters: { symbol: 'NVDA' } });
    expect(JSON.parse(res.body).data.deleted).toBe(1);

    const { body } = await bodyOf(get());
    expect(body.data.positions.map(p => p.symbol)).toEqual(['SNDK']);
  });

  test('an empty store returns an empty book rather than failing', async () => {
    const { status, body } = await bodyOf(get());
    expect(status).toBe(200);
    expect(body.data.positions).toEqual([]);
    expect(body.data.account).toBeNull();
  });
});
