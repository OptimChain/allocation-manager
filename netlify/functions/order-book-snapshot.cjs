// Order Book Snapshot Netlify Function
//
// Portfolio (positions, options, account) and orders come from Postgres —
// the same Trading DB that backs db-positions and db-orders, written by the
// engine on every tick. This used to read a "state-logs" engine-snapshot blob
// that the engine only wrote when running with DRY_RUN=false, which is why
// positions froze while orders stayed current.
//
// market_data still comes from the blobs: it is BTC metrics written by a
// different producer, and nothing in Postgres carries it. A blob failure
// degrades market_data to null rather than failing the whole snapshot.

const t = require('./lib/tradingDb.cjs');

// 5thstreetcapital Netlify site ID
const ORDER_BOOK_SITE_ID = '3d014fc3-e919-4b4d-b374-e8606dee50df';
const BLOBS_API_BASE = 'https://api.netlify.com/api/v1/blobs';
const STORE_NAME = 'state-logs';
const STORE_NAME_HISTORICAL = 'state-logs-historical';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function hasCompleteMetrics(snapshot) {
  const btc = snapshot?.state?.symbols?.BTC;
  if (!btc || !btc.metrics) return false;
  const m = btc.metrics;
  return m.current_price != null && m.intraday_high != null && m.intraday_low != null;
}

async function fetchBlob(token, key, storeName) {
  const res = await fetch(
    `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/${storeName}/${encodeURIComponent(key)}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch snapshot ${key}: ${res.status}`);
  }
  return res.json();
}

async function listAllBlobKeys(token, storeName) {
  const allKeys = [];
  let cursor = null;

  while (true) {
    let url = `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/${storeName}`;
    if (cursor) {
      url += `?cursor=${encodeURIComponent(cursor)}`;
    }

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to list ${storeName} blobs: ${res.status}`);
    }

    const data = await res.json();
    const blobs = data.blobs || [];
    for (const b of blobs) {
      allKeys.push(b.key);
    }

    if (!data.next_cursor || blobs.length === 0) break;
    cursor = data.next_cursor;
  }

  return allKeys;
}

/** BTC metrics, from blobs. Returns null instead of throwing — see header. */
async function fetchMarketData() {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) {
    console.warn('NETLIFY_AUTH_TOKEN not configured — market_data unavailable');
    return null;
  }

  try {
    let allKeys = await listAllBlobKeys(token, STORE_NAME);
    let activeStore = STORE_NAME;

    // Fall back to historical store if primary is empty
    if (allKeys.length === 0) {
      console.log('Primary state-logs store empty, falling back to state-logs-historical');
      allKeys = await listAllBlobKeys(token, STORE_NAME_HISTORICAL);
      activeStore = STORE_NAME_HISTORICAL;
    }
    if (allKeys.length === 0) return null;

    // Keys are timestamps (e.g. "2026-02-15T02-07-07") plus an optional
    // 'latest' pointer. Sort the timestamped keys descending; non-timestamp
    // keys like 'latest' would otherwise win the sort ('l' > '2').
    const sortedKeys = allKeys.filter(k => /^\d{4}-/.test(k)).sort().reverse();

    // Walk back through recent blobs for the newest complete BTC metrics
    const maxLookback = Math.min(sortedKeys.length, 6);
    for (let i = 0; i < maxLookback; i++) {
      try {
        const blob = await fetchBlob(token, sortedKeys[i], activeStore);
        if (hasCompleteMetrics(blob)) {
          return { timestamp: blob.timestamp, symbols: blob.state.symbols };
        }
      } catch (e) {
        console.error(`Failed to fetch blob ${sortedKeys[i]}:`, e.message);
      }
    }
    return null;
  } catch (e) {
    console.error('market_data lookup failed:', e.message);
    return null;
  }
}

const ORDER_LIMIT = 1000;

/**
 * Split order rows into the open book vs. recent (terminal) history.
 *
 * Placement stubs (no lifecycle state — e.g. trailing-stop placements written
 * by external tools under client-generated ids) never confirm, fill, or
 * cancel, so they stay out of the book the UI renders.
 */
function bucketOrders(rows, toOrder) {
  const open = [], recent = [];
  for (const row of rows) {
    const order = toOrder(row);
    if (t.isUntrackedOrder(order)) continue;
    (t.OPEN_STATES.has(order.state) ? open : recent).push(order);
  }
  return { open, recent };
}

/**
 * Synthesize a leg for legless option rows so downstream P&L groups by
 * chain_symbol instead of falling back to 'OPT' (same treatment as db-pnl).
 */
function withSynthesizedLeg(order) {
  return order.legs && order.legs.length
    ? order
    : { ...order, legs: [{ chain_symbol: order.chain_symbol }] };
}

async function fetchSnapshot() {
  const db = t.getDb();
  if (!db) {
    throw new Error('NETLIFY_DATABASE_URL is not set — cannot read the position book');
  }
  await t.ensureSchema(db);

  const [positionRows, optionRows, accountRow, stockOrderRows, optionOrderRows, marketData] =
    await Promise.all([
      t.fetchPositions(db),
      t.fetchOptionPositions(db),
      t.fetchAccountSnapshot(db),
      t.fetchStockOrders(db, ORDER_LIMIT),
      t.fetchOptionOrders(db, ORDER_LIMIT),
      fetchMarketData(),
    ]);

  const positions = positionRows.map(t.rowToPosition);
  const options   = optionRows.map(t.rowToOptionPosition);
  const account   = t.rowToAccount(accountRow);

  const stockOrders  = bucketOrders(stockOrderRows, t.rowToStockOrder);
  const optionOrders = bucketOrders(
    optionOrderRows, r => withSynthesizedLeg(t.rowToOptionOrder(r)));

  // RH's own equity figure excludes options, so total the book ourselves.
  const stockValue  = positions.reduce((s, p) => s + (p.equity || 0), 0);
  const optionValue = options.reduce((s, o) => s + (o.current_value || 0), 0);

  const cash = account?.cash ?? 0;
  return {
    // The position book's own write time — this is what the dashboard shows
    // for positions, and it now moves with every engine tick.
    timestamp: account?.updated_at ?? new Date().toISOString(),
    portfolio: {
      cash: {
        cash,
        cash_available_for_withdrawal: cash,
        buying_power: account?.buying_power ?? 0,
        tradeable_cash: cash,
      },
      equity: account?.equity ?? 0,
      market_value: t.r2(stockValue + optionValue),
      positions,
      open_orders: stockOrders.open,
      open_option_orders: optionOrders.open,
      options,
    },
    order_book: stockOrders.open,
    recent_orders: stockOrders.recent,
    recent_option_orders: optionOrders.recent,
    market_data: marketData,
    // Provenance for the dashboard's status line. Positions are no longer an
    // "engine snapshot" read out of a blob — both halves come from the DB now.
    orders_source: 'db',
    orders_as_of: new Date().toISOString(),
    positions_source: 'db',
    positions_as_of: account?.updated_at ?? null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const data = await fetchSnapshot();

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('Order book snapshot error:', error);

    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Failed to fetch snapshot' }),
    };
  }
};
