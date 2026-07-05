// db-pnl.cjs
// Realized P&L computed server-side from trading DB orders, for the
// "Order P&L" / "Realized P&L" sections of the P&L & Asset Allocation page.
//
//   GET /.netlify/functions/db-pnl              — all periods (1W…5Y)
//   GET /.netlify/functions/db-pnl?period=1M    — a single period
//
// Reuses computeStockPnl / computeOptionPnl from enriched-snapshot.cjs so the
// math cannot drift from the blob-snapshot path. One deliberate improvement:
// option P&L here is filtered to the requested period's cutoff (the snapshot
// path computes option P&L over all history regardless of period).
//
// All responses use the shared envelope: { ok, resource, action, source, as_of, count, data, error }

'use strict';

const t = require('./lib/tradingDb.cjs');
const { computeStockPnl, computeOptionPnl } = require('./enriched-snapshot.cjs');

const RESOURCE = 'pnl';
const PERIOD_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '5Y': 1825 };
// P&L is an aggregate over ALL filled orders in the window, so this is a
// safety cap, not pagination. ~500B/row → 5000 rows ≈ 2.5MB, well within a
// lambda. `truncated: true` in the response means the oldest orders fell
// outside the cap and long-window P&L may be incomplete.
const ORDER_FETCH_LIMIT = 5000;

function periodCutoff(period) {
  return new Date(Date.now() - (PERIOD_DAYS[period] ?? 365) * 86_400_000);
}

// computeOptionPnl expects legs[0].chain_symbol — DB rows already store
// normalized legs, but guard for legless rows by synthesizing one.
function toOptionPnlInput(order) {
  const legs = order.legs && order.legs.length ? order.legs : [{ chain_symbol: order.chain_symbol }];
  return { ...order, legs };
}

async function handleGet(db, event) {
  const params = event.queryStringParameters || {};
  const requested = (params.period || 'all').toUpperCase();
  if (requested !== 'ALL' && !PERIOD_DAYS[requested]) {
    return t.respond(400, t.errorEnvelope(RESOURCE, 'compute', 'BAD_PERIOD',
      `Unknown period "${params.period}". Valid: ${Object.keys(PERIOD_DAYS).join(', ')}, all`));
  }
  const periods = requested === 'ALL' ? Object.keys(PERIOD_DAYS) : [requested];
  // Optional per-underlying filter — matches stock symbol AND option chain_symbol,
  // so ?symbol=CRWD returns that ticker's combined stock + options P&L
  const symbol = (params.symbol || '').toUpperCase() || null;

  const [stockRows, optionRows] = await Promise.all([
    t.fetchStockOrders(db, ORDER_FETCH_LIMIT),
    t.fetchOptionOrders(db, ORDER_FETCH_LIMIT),
  ]);

  const stockOrders  = stockRows.map(t.rowToStockOrder)
    .filter(o => !symbol || o.symbol === symbol);
  const optionOrders = optionRows.map(t.rowToOptionOrder)
    .filter(o => !symbol || o.chain_symbol === symbol);

  const filledOptionOrders = optionOrders.filter(o => o.state === 'filled').map(toOptionPnlInput);

  const periodResults = {};
  for (const period of periods) {
    const cutoff = periodCutoff(period);
    const stock  = computeStockPnl(stockOrders, cutoff);
    const option = computeOptionPnl(filledOptionOrders.filter(o => o.created_at && new Date(o.created_at) >= cutoff));
    periodResults[period] = {
      stock,
      option,
      combined_realized_pnl: t.r2(stock.total_realized_pnl + option.total_realized_pnl),
    };
  }

  const openOrders       = stockOrders.filter(o => t.OPEN_STATES.has(o.state));
  const openOptionOrders = optionOrders.filter(o => t.OPEN_STATES.has(o.state));

  const data = {
    symbol,
    periods: periodResults,
    open_orders: openOrders,
    open_option_orders: openOptionOrders,
    counts: {
      stock_orders:       stockOrders.length,
      option_orders:      optionOrders.length,
      open_orders:        openOrders.length,
      open_option_orders: openOptionOrders.length,
    },
    truncated: stockRows.length === ORDER_FETCH_LIMIT || optionRows.length === ORDER_FETCH_LIMIT,
  };

  return t.respond(200, t.envelope({ resource: RESOURCE, action: 'compute', data, count: periods.length }));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return t.respond(200, '');

  const db = t.getDb();
  if (!db) {
    return t.respond(503, t.errorEnvelope(RESOURCE, 'unavailable', 'DB_NOT_CONFIGURED',
      'NETLIFY_DATABASE_URL is not set. Point it at the Render Postgres (allocation-manager-db) external connection string — see docs/db.md.'));
  }

  try {
    await t.ensureSchema(db);
    if (event.httpMethod === 'GET') return await handleGet(db, event);
    return t.respond(405, t.errorEnvelope(RESOURCE, 'unknown', 'METHOD_NOT_ALLOWED', `${event.httpMethod} not supported`));
  } catch (err) {
    console.error('db-pnl error:', err);
    return t.respond(500, t.errorEnvelope(RESOURCE, 'error', 'DB_ERROR', err.message || 'Unexpected database error'));
  }
};
