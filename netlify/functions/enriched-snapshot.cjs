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

const tokenStore = require('./lib/tokenStore.cjs');

const RH_API = 'https://api.robinhood.com';

// ── Data source: delegate blob-reading to order-book-snapshot ────────────────
// Netlify sets URL to the current deploy's base URL (e.g. https://xxx--site.netlify.app)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── Fetch raw snapshot from order-book-snapshot function ─────────────────────

async function fetchRawSnapshot() {
  const base = (process.env.URL || '').replace(/\/$/, '');
  if (!base) throw new Error('URL env var not set — cannot resolve order-book-snapshot');

  const res = await fetch(`${base}/.netlify/functions/order-book-snapshot`);
  if (!res.ok) throw new Error(`order-book-snapshot returned ${res.status}`);
  return res.json();
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

// ── Field normalizers (handle both engine-formatted and raw RH API blobs) ─────

function normalizePosition(p) {
  // Engine blob uses: avg_entry, market_value, unrealized_pl, unrealized_pl_pct
  // TS contract (SnapshotPosition) expects: avg_buy_price, equity, profit_loss, profit_loss_pct
  const qty = parseFloat(p.quantity ?? p.qty) || 0;
  const avgBuy = parseFloat(p.avg_buy_price ?? p.avg_entry) || 0;
  const current = parseFloat(p.current_price) || avgBuy;
  const equity = parseFloat(p.equity ?? p.market_value ?? qty * current) || 0;
  const pl = parseFloat(p.profit_loss ?? p.unrealized_pl) || 0;
  const plPctRaw = parseFloat(p.profit_loss_pct ?? p.unrealized_pl_pct) || 0;
  // Engine sends decimal fractions (0.09 = 9%); contract wants percentage points
  const plPct = Math.abs(plPctRaw) < 1 ? plPctRaw * 100 : plPctRaw;

  return {
    symbol:          p.symbol,
    name:            p.name ?? p.symbol,
    quantity:        qty,
    avg_buy_price:   r2(avgBuy),
    current_price:   r2(current),
    equity:          r2(equity),
    profit_loss:     r2(pl),
    profit_loss_pct: r2(plPct),
    percent_change:  p.percent_change ?? null,
    percentage:      p.percentage ?? null,
  };
}

function normalizeCash(cashRaw, fallbackEquity = 0) {
  // Engine blob sends portfolio.cash as a bare number (e.g. -84057.39).
  // TS contract (CashInfo) expects an object with cash/buying_power/etc.
  if (typeof cashRaw === 'number') {
    return {
      cash:                          r2(cashRaw),
      cash_available_for_withdrawal: r2(cashRaw),
      buying_power:                  cashRaw < 0 ? r2(Math.abs(cashRaw) * 2) : r2(cashRaw * 2),
      tradeable_cash:                r2(cashRaw),
    };
  }
  if (cashRaw && typeof cashRaw === 'object') {
    return {
      cash:                          r2(cashRaw.cash ?? 0),
      cash_available_for_withdrawal: r2(cashRaw.cash_available_for_withdrawal ?? cashRaw.cash ?? 0),
      buying_power:                  r2(cashRaw.buying_power ?? 0),
      tradeable_cash:                r2(cashRaw.tradeable_cash ?? cashRaw.cash ?? 0),
    };
  }
  return { cash: 0, cash_available_for_withdrawal: 0, buying_power: 0, tradeable_cash: 0 };
}

function normalizeOpenOrder(o) {
  return {
    order_id:        o.order_id  || o.id,
    symbol:          o.symbol    || null,
    side:            (o.side     || '').toUpperCase(),
    order_type:      o.order_type || o.type,
    trigger:         o.trigger,
    state:           o.state,
    quantity:        parseFloat(o.quantity)  || 0,
    limit_price:     parseFloat(o.limit_price || o.price) || 0,
    stop_price:      o.stop_price ? parseFloat(o.stop_price) : null,
    created_at:      o.created_at,
    updated_at:      o.updated_at,
    filled_quantity: parseFloat(o.filled_quantity || o.cumulative_quantity) || 0,
    average_price:   o.average_price ? parseFloat(o.average_price) : null,
  };
}

function normalizeOpenOptionOrder(o) {
  return {
    order_id:         o.order_id || o.id,
    chain_symbol:     o.chain_symbol || null,
    direction:        (o.direction || '').toLowerCase(),
    state:            o.state,
    quantity:         parseFloat(o.quantity) || 0,
    price:            parseFloat(o.price) || 0,
    processed_premium: o.processed_premium ? parseFloat(o.processed_premium) : null,
    order_type:       o.order_type || o.type,
    opening_strategy: o.opening_strategy || null,
    created_at:       o.created_at,
    updated_at:       o.updated_at,
    legs:             (o.legs || []).map(leg => ({
      chain_symbol:   leg.chain_symbol || o.chain_symbol || null,
      strike_price:   leg.strike_price,
      expiration_date: leg.expiration_date,
      option_type:    leg.option_type,
      side:           (leg.side || '').toUpperCase(),
      position_effect: leg.position_effect,
    })),
  };
}

// ── Live Robinhood API helpers ──────────────────────────────────────────────
// Used when blobs have no option data — fetches directly from RH.

const _optionInstrumentCache = {};

async function rhFetch(endpoint) {
  const token = await tokenStore.getToken();
  if (!token) return null;
  const res = await fetch(`${RH_API}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!res.ok) return null;
  return res.json();
}

async function rhFetchAll(endpoint) {
  const all = [];
  let url = endpoint;
  while (url) {
    const data = await rhFetch(url);
    if (!data) break;
    all.push(...(data.results || []));
    url = data.next ? data.next.replace(RH_API, '') : null;
  }
  return all;
}

async function resolveOptionInstrument(optionUrl) {
  const key = optionUrl.replace(RH_API, '');
  if (_optionInstrumentCache[key]) return _optionInstrumentCache[key];
  const inst = await rhFetch(key);
  if (inst) _optionInstrumentCache[key] = inst;
  return inst;
}

/**
 * Fetch live option orders from RH API.
 * Returns { open: [], recent: [] } in the shape enrichSnapshot expects.
 */
async function fetchLiveOptionOrders() {
  const raw = await rhFetchAll('/options/orders/');
  if (!raw.length) return { open: [], recent: [] };

  const open = [];
  const recent = [];

  for (const o of raw) {
    // Resolve legs to get strike/expiration/type
    const legs = [];
    for (const leg of (o.legs || [])) {
      let strike_price = leg.strike_price || null;
      let expiration_date = leg.expiration_date || null;
      let option_type = leg.option_type || null;

      // If leg fields are missing, resolve from option instrument URL
      if ((!strike_price || !expiration_date || !option_type) && leg.option) {
        const inst = await resolveOptionInstrument(leg.option);
        if (inst) {
          strike_price = strike_price || inst.strike_price;
          expiration_date = expiration_date || inst.expiration_date;
          option_type = option_type || inst.type;
        }
      }

      legs.push({
        chain_symbol: leg.chain_symbol || o.chain_symbol || null,
        strike_price,
        expiration_date,
        option_type,
        side: (leg.side || '').toUpperCase(),
        position_effect: leg.position_effect || null,
      });
    }

    const normalized = {
      order_id: o.id,
      chain_symbol: o.chain_symbol || null,
      direction: (o.direction || '').toLowerCase(),
      state: o.state,
      quantity: parseFloat(o.quantity) || 0,
      price: parseFloat(o.price) || 0,
      processed_premium: o.processed_premium ? parseFloat(o.processed_premium) : null,
      order_type: o.type || o.order_type || null,
      opening_strategy: o.opening_strategy || null,
      created_at: o.created_at,
      updated_at: o.updated_at,
      legs,
    };

    if (['queued', 'confirmed', 'unconfirmed', 'partially_filled'].includes(o.state)) {
      open.push(normalized);
    }
    recent.push(normalized);
  }

  // recent: most recent first, cap at 50
  recent.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { open, recent: recent.slice(0, 50) };
}

/**
 * Fetch live option positions from RH API.
 * Returns positions in the shape the frontend OptionPosition interface expects.
 */
async function fetchLiveOptionPositions() {
  const raw = await rhFetchAll('/options/aggregate_positions/?nonzero=true');
  if (!raw.length) return [];

  const positions = [];
  for (const pos of raw) {
    const qty = parseFloat(pos.quantity) || 0;
    if (qty === 0) continue;

    const multiplier = parseFloat(pos.trade_value_multiplier) || 100;
    const avgPrice = parseFloat(pos.average_open_price) || 0;

    // Resolve first leg for strike/expiration/type + market data
    let strike = null, expiration = null, optionType = null, markPrice = null;
    const legs = pos.legs || [];
    if (legs.length > 0 && legs[0].option) {
      const inst = await resolveOptionInstrument(legs[0].option);
      if (inst) {
        strike = parseFloat(inst.strike_price);
        expiration = inst.expiration_date;
        optionType = inst.type;
      }
      // Fetch current mark price
      try {
        const encoded = encodeURIComponent(legs[0].option);
        const md = await rhFetch(`/marketdata/options/?instruments=${encoded}`);
        if (md?.results?.[0]) {
          markPrice = parseFloat(md.results[0].adjusted_mark_price)
            || parseFloat(md.results[0].mark_price) || null;
        }
      } catch (_) { /* ignore */ }
    }

    const costBasis = r2(avgPrice * qty * multiplier);
    const currentValue = markPrice != null ? r2(markPrice * qty * multiplier) : costBasis;
    const unrealizedPl = r2(currentValue - costBasis);
    const unrealizedPlPct = costBasis !== 0 ? r2((unrealizedPl / Math.abs(costBasis)) * 100) : 0;

    positions.push({
      chain_symbol: pos.chain_symbol || pos.symbol,
      symbol: pos.symbol,
      option_type: optionType || 'unknown',
      strike,
      strike_price: strike ? String(strike) : null,
      expiration,
      expiration_date: expiration,
      quantity: qty,
      position_type: (pos.direction || 'long').toLowerCase(),
      avg_price: avgPrice,
      mark_price: markPrice,
      multiplier,
      cost_basis: costBasis,
      current_value: currentValue,
      unrealized_pl: unrealizedPl,
      unrealized_pl_pct: unrealizedPlPct,
    });
  }

  return positions;
}

/**
 * Augment a raw snapshot with live RH option data when blobs are empty.
 */
async function augmentWithLiveOptions(raw) {
  const portfolio = raw.portfolio || {};
  const hasPositions = (portfolio.options || []).length > 0;
  const hasOpenOrders = (portfolio.open_option_orders || []).length > 0;
  const hasRecentOrders = (raw.recent_option_orders || []).length > 0;

  // If blob already has option data, skip live fetch
  if (hasPositions && hasOpenOrders && hasRecentOrders) return raw;

  try {
    const [liveOrders, livePositions] = await Promise.all([
      (!hasOpenOrders || !hasRecentOrders) ? fetchLiveOptionOrders() : Promise.resolve(null),
      !hasPositions ? fetchLiveOptionPositions() : Promise.resolve(null),
    ]);

    if (liveOrders) {
      if (!hasOpenOrders && liveOrders.open.length > 0) {
        portfolio.open_option_orders = liveOrders.open;
      }
      if (!hasRecentOrders && liveOrders.recent.length > 0) {
        raw.recent_option_orders = liveOrders.recent;
      }
    }
    if (livePositions && livePositions.length > 0) {
      portfolio.options = livePositions;
    }
  } catch (err) {
    console.warn('Live option fetch failed (non-fatal):', err.message);
  }

  return raw;
}

function enrichSnapshot(raw) {
  const portfolio   = raw.portfolio;
  // Normalize engine-blob field names → SnapshotPosition / CashInfo contract
  const positions   = (portfolio.positions || []).map(normalizePosition);
  const options     = portfolio.options     || [];
  const openOrders       = (portfolio.open_orders        || []).map(normalizeOpenOrder);
  const openOptionOrders = (portfolio.open_option_orders || []).map(normalizeOpenOptionOrder);
  const recentOrders       = raw.recent_orders        || [];
  const recentOptionOrders = raw.recent_option_orders || [];

  // ── Cash / margin (normalize bare-number cash from engine blob) ──
  const cash      = normalizeCash(portfolio.cash, portfolio.equity);
  const cashHeld  = cash.tradeable_cash ?? cash.buying_power ?? 0;
  const marginUsed = cashHeld < 0 ? r2(-cashHeld) : 0;

  // ── Market value: stocks + options (positions now have .equity) ──
  const stockMV   = r2(positions.reduce((s, p) => s + (p.equity ?? 0), 0));
  const optionsMV = r2(options.reduce((s, o)   => s + (o.current_value ?? 0), 0));
  const marketValue = r2(stockMV + optionsMV);

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

  // ── Portfolio-level P&L (positions now normalized → avg_buy_price populated) ──
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
      // Normalized cash object (CashInfo shape)
      cash,
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
      // Normalized open orders
      open_orders:        openOrders,
      open_option_orders: openOptionOrders,
      options,
      options_summary: aggregateOptions(options),
      total_pl:     totalPl,
      total_pl_pct: plPct,
    },
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

// Export enrichment helpers so local dev (vite-mock-api.ts) can run the same
// code path as production — no duplicated P&L math that can drift.
module.exports.enrichSnapshot = enrichSnapshot;
module.exports.computeStockPnl = computeStockPnl;
module.exports.computeOptionPnl = computeOptionPnl;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  try {
    const raw      = await augmentWithLiveOptions(await fetchRawSnapshot());
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
