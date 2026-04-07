// enriched-snapshot.cjs
// Netlify function — drop into netlify/functions/
//
// Reads the same state-logs blob as order-book-snapshot, then enriches it
// server-side so the frontend receives pre-computed data and does no math.
//
// Enrichments added vs raw snapshot:
//   - pnl_by_period: realized stock + option P&L for every period (1W…5Y)
//   - portfolio.options_summary: aggregated greeks / totals across option positions
//   - portfolio.equity: RH passthrough (authoritative)
//   - portfolio.market_value: stocks + options (RH's own field excludes options)
//   - portfolio.stock_market_value / options_market_value
//   - portfolio.margin_used: abs(tradeable_cash) when negative
//   - portfolio.reconciliation: { rh_equity, computed_equity } for UI callout
//   - portfolio.positions: pre-sorted by abs(profit_loss) desc
//   - recent_orders / recent_option_orders: pre-sorted newest-first

'use strict';

// ── Blob store config (mirrors order-book-snapshot.cjs) ──────────────────────
const ORDER_BOOK_SITE_ID = '3d014fc3-e919-4b4d-b374-e8606dee50df';
const BLOBS_API_BASE     = 'https://api.netlify.com/api/v1/blobs';
const STORE_NAME         = 'state-logs';
const STORE_NAME_HIST    = 'state-logs-historical';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── Blob helpers ─────────────────────────────────────────────────────────────

function hasCompleteMetrics(snapshot) {
  const m = snapshot?.state?.symbols?.BTC?.metrics;
  return m && m.current_price != null && m.intraday_high != null && m.intraday_low != null;
}

async function fetchBlob(token, key, store) {
  const res = await fetch(
    `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/${store}/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Failed to fetch blob ${key}: ${res.status}`);
  return res.json();
}

async function listKeys(token, store) {
  const keys = [];
  let cursor = null;
  while (true) {
    const url = `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/${store}` +
      (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to list ${store}: ${res.status}`);
    const data = await res.json();
    for (const b of data.blobs || []) keys.push(b.key);
    if (!data.next_cursor || !data.blobs?.length) break;
    cursor = data.next_cursor;
  }
  return keys;
}

async function fetchRawSnapshot(token) {
  let keys = await listKeys(token, STORE_NAME);
  let store = STORE_NAME;
  if (!keys.length) {
    keys = await listKeys(token, STORE_NAME_HIST);
    store = STORE_NAME_HIST;
  }
  if (!keys.length) throw new Error('No state-logs snapshots found');

  const sorted  = [...keys].sort().reverse();
  const latest  = await fetchBlob(token, sorted[0], store);

  let marketData = null;
  if (hasCompleteMetrics(latest)) {
    marketData = { timestamp: latest.timestamp, symbols: latest.state.symbols };
  } else {
    for (let i = 1; i < Math.min(sorted.length, 6); i++) {
      try {
        const older = await fetchBlob(token, sorted[i], store);
        if (hasCompleteMetrics(older)) {
          marketData = { timestamp: older.timestamp, symbols: older.state.symbols };
          break;
        }
      } catch (e) {
        console.error(`Fallback blob ${sorted[i]} failed:`, e.message);
      }
    }
  }

  const p = latest.portfolio || {};
  return {
    timestamp:             latest.timestamp,
    market_data:           marketData,
    order_book:            latest.order_book            || [],
    recent_orders:         latest.recent_orders         || [],
    recent_option_orders:  latest.recent_option_orders  || [],
    portfolio: {
      cash:               p.cash  || { cash: 0, buying_power: 0, tradeable_cash: 0 },
      equity:             p.equity        ?? 0,
      market_value:       p.market_value  ?? 0,
      positions:          p.positions          || [],
      open_orders:        p.open_orders        || [],
      open_option_orders: p.open_option_orders || [],
      options:            p.options            || [],
    },
  };
}

// ── Enrichment helpers (ported from app/server.py) ───────────────────────────

const PERIOD_DAYS = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '5Y': 1825 };

function periodCutoff(period) {
  return new Date(Date.now() - (PERIOD_DAYS[period] ?? 365) * 86_400_000);
}

function r2(n) { return Math.round(n * 100) / 100; }

function computeStockPnl(orders, cutoff) {
  const filtered = orders.filter(o =>
    o.state === 'filled' && o.symbol && new Date(o.created_at) >= cutoff
  ).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const book = {};
  for (const o of filtered) {
    const sym = o.symbol;
    if (!book[sym]) book[sym] = {
      symbol: sym, realized_pnl: 0,
      total_bought: 0, total_sold: 0,
      buy_count: 0, sell_count: 0,
      shares_held: 0, cost_basis: 0,
    };
    const s     = book[sym];
    const qty   = parseFloat(o.filled_quantity ?? o.quantity ?? 0) || 0;
    const price = parseFloat(o.average_price   ?? o.limit_price ?? 0) || 0;
    const total = qty * price;

    if ((o.side || '').toUpperCase() === 'BUY') {
      s.shares_held  += qty;
      s.cost_basis   += total;
      s.total_bought += total;
      s.buy_count++;
    } else {
      const avg = s.shares_held > 0 ? s.cost_basis / s.shares_held : 0;
      s.realized_pnl += (price - avg) * qty;
      s.cost_basis   -= avg * qty;
      s.shares_held  -= qty;
      s.total_sold   += total;
      s.sell_count++;
    }
  }

  const symbols = Object.values(book)
    .map(s => ({ ...s, realized_pnl: r2(s.realized_pnl), total_bought: r2(s.total_bought), total_sold: r2(s.total_sold) }))
    .sort((a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl));

  return {
    total_realized_pnl: r2(symbols.reduce((s, x) => s + x.realized_pnl, 0)),
    total_buy_volume:   r2(symbols.reduce((s, x) => s + x.total_bought, 0)),
    total_sell_volume:  r2(symbols.reduce((s, x) => s + x.total_sold,   0)),
    filled_count: filtered.length,
    symbols,
  };
}

function computeOptionPnl(orders) {
  const filled = orders.filter(o => o.state === 'filled');
  const book   = {};

  for (const o of filled) {
    const leg     = (o.legs ?? [])[0] ?? {};
    const sym     = leg.chain_symbol || 'OPT';
    // prefer processed_premium; fall back to price × quantity × 100 (per-contract)
    const premium = parseFloat(o.processed_premium) || (parseFloat(o.price ?? 0) * parseFloat(o.quantity ?? 1) * 100) || 0;

    if (!book[sym]) book[sym] = {
      symbol: sym, realized_pnl: 0,
      total_bought: 0, total_sold: 0,
      buy_count: 0, sell_count: 0,
    };
    const s = book[sym];
    const dir = (o.direction || '').toLowerCase();
    if (dir === 'debit') { s.total_bought += premium; s.buy_count++; }
    else                 { s.total_sold   += premium; s.sell_count++; }
  }

  const symbols = Object.values(book).map(s => ({
    ...s,
    realized_pnl: r2(s.total_sold - s.total_bought),
    total_bought: r2(s.total_bought),
    total_sold:   r2(s.total_sold),
  })).sort((a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl));

  return {
    total_realized_pnl: r2(symbols.reduce((s, x) => s + x.realized_pnl, 0)),
    total_buy_volume:   r2(symbols.reduce((s, x) => s + x.total_bought, 0)),
    total_sell_volume:  r2(symbols.reduce((s, x) => s + x.total_sold,   0)),
    filled_count: filled.length,
    symbols,
  };
}

function aggregateOptions(positions) {
  if (!positions.length) return null;
  return {
    count:               positions.length,
    total_cost_basis:    r2(positions.reduce((s, p) => s + (p.cost_basis    ?? 0), 0)),
    total_current_value: r2(positions.reduce((s, p) => s + (p.current_value ?? 0), 0)),
    total_unrealized_pl: r2(positions.reduce((s, p) => s + (p.unrealized_pl ?? 0), 0)),
    total_theta_daily:   r2(positions.reduce((s, p) => s + (p.expected_pl?.theta_daily ?? 0), 0)),
  };
}

function enrichSnapshot(raw) {
  const portfolio   = raw.portfolio;
  const positions   = portfolio.positions;
  const options     = portfolio.options;
  const recentOrders       = raw.recent_orders;
  const recentOptionOrders = raw.recent_option_orders;

  // ── Market value: stocks + options ──
  const stockMV   = r2(positions.reduce((s, p) => s + (p.equity ?? (p.quantity ?? 0) * (p.current_price ?? 0)), 0));
  const optionsMV = r2(options.reduce((s, o)   => s + (o.current_value ?? 0), 0));
  const marketValue = r2(stockMV + optionsMV);

  // ── Cash / margin ──
  const cash      = portfolio.cash ?? {};
  const cashHeld  = cash.tradeable_cash ?? cash.buying_power ?? 0;
  const marginUsed = cashHeld < 0 ? r2(-cashHeld) : 0;

  // ── Equity: RH is authoritative ──
  const rhEquity      = portfolio.equity ?? 0;
  const computedEquity = r2(marketValue + cashHeld);

  // ── P&L by period ──
  const pnlByPeriod = {};
  for (const period of Object.keys(PERIOD_DAYS)) {
    const cutoff = periodCutoff(period);
    pnlByPeriod[period] = {
      stock:  computeStockPnl(recentOrders, cutoff),
      option: computeOptionPnl(recentOptionOrders),
    };
  }

  // ── 7d summary ──
  const recentPnl = computeStockPnl(recentOrders, periodCutoff('1W'));
  const optionPnl = computeOptionPnl(recentOptionOrders);

  // ── Portfolio-level P&L ──
  const totalPl   = r2(positions.reduce((s, p) => s + (p.profit_loss ?? 0), 0));
  const totalCost = positions.reduce((s, p) => s + (p.avg_buy_price ?? 0) * (p.quantity ?? 0), 0);
  const plPct     = totalCost > 0 ? r2((totalPl / totalCost) * 100) : 0;

  return {
    timestamp:   raw.timestamp,
    market_data: raw.market_data,
    order_book:  raw.order_book,
    recent_orders:        [...recentOrders].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    recent_option_orders: [...recentOptionOrders].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    recent_pnl:      recentPnl,
    option_pnl:      optionPnl,
    combined_7d_pnl: r2(recentPnl.total_realized_pnl + optionPnl.total_realized_pnl),
    pnl_by_period:   pnlByPeriod,
    portfolio: {
      ...Object.fromEntries(
        Object.entries(portfolio).filter(([k]) => !['positions','options','equity','market_value'].includes(k))
      ),
      // RH passthrough
      equity:               rhEquity,
      rh_market_value:      portfolio.market_value ?? null,
      // Computed breakdown
      market_value:         marketValue,
      stock_market_value:   stockMV,
      options_market_value: optionsMV,
      margin_used:          marginUsed,
      // Reconciliation callout
      reconciliation: {
        rh_equity:       rhEquity,
        computed_equity: computedEquity,
      },
      // Pre-sorted positions (biggest P&L movers first)
      positions: [...positions].sort((a, b) => Math.abs(b.profit_loss ?? 0) - Math.abs(a.profit_loss ?? 0)),
      options,
      options_summary: aggregateOptions(options),
      total_pl:     totalPl,
      total_pl_pct: plPct,
    },
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'NETLIFY_AUTH_TOKEN not configured' }),
    };
  }

  try {
    const raw      = await fetchRawSnapshot(token);
    const enriched = enrichSnapshot(raw);
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(enriched),
    };
  } catch (err) {
    console.error('enriched-snapshot error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to fetch enriched snapshot' }),
    };
  }
};
