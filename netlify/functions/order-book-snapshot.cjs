// Order Book Snapshot Netlify Function
// Reads the latest blob from the 5thstreetcapital site
// Tries order-book first (live data), falls back to state-logs (archive)
// Data is written every ~5 minutes by an external trading system
//
// Handles two blob schemas:
//   Old: { portfolio: { positions, open_orders, options, ... }, order_book, state, ... }
//   New: { account, positions, open_orders, num_positions, ... }
//
// Returns portfolio/order_book from latest blob, and market_data from
// the most recent blob that has complete BTC metrics (walking backwards
// if the latest snapshot has NO_DATA).

// 5thstreetcapital Netlify site ID
const ORDER_BOOK_SITE_ID = '3d014fc3-e919-4b4d-b374-e8606dee50df';
const BLOBS_API_BASE = 'https://api.netlify.com/api/v1/blobs';
const PRIMARY_STORE = 'order-book';
const FALLBACK_STORE = 'state-logs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Detect whether a blob uses the new flat schema (account/positions at top level)
function isNewFormat(blob) {
  return blob.account != null && !blob.portfolio;
}

// Normalize a new-format blob into the old portfolio/order_book shape
function normalizeNewFormat(blob) {
  const acct = blob.account || {};
  return {
    timestamp: blob.timestamp,
    portfolio: {
      cash: {
        cash: acct.cash || 0,
        cash_available_for_withdrawal: acct.buying_power || 0,
        buying_power: acct.buying_power || 0,
        tradeable_cash: acct.cash || 0,
      },
      equity: acct.equity || 0,
      market_value: acct.portfolio_value || 0,
      positions: (blob.positions || []).map((p) => ({
        symbol: p.symbol,
        name: p.symbol,
        type: 'stock',
        quantity: p.qty,
        avg_buy_price: p.avg_entry,
        current_price: p.market_value / (p.qty || 1),
        equity: p.market_value,
        profit_loss: p.unrealized_pl,
        profit_loss_pct: (p.unrealized_pl_pct || 0) * 100,
        percent_change: (p.unrealized_pl_pct || 0) * 100,
        equity_change: p.unrealized_pl,
        pe_ratio: null,
        percentage: 0,
      })),
      open_orders: (blob.open_orders || []).map((o) => ({
        order_id: o.id,
        symbol: o.symbol,
        side: o.side,
        order_type: o.type,
        trigger: 'immediate',
        state: o.status,
        quantity: o.qty,
        limit_price: o.limit_price,
        stop_price: o.stop_price,
        created_at: blob.timestamp,
        updated_at: blob.timestamp,
      })),
      open_option_orders: [],
      options: [],
    },
    order_book: (blob.open_orders || []).map((o) => ({
      order_id: o.id,
      symbol: o.symbol,
      side: o.side,
      order_type: o.type,
      trigger: 'immediate',
      state: o.status,
      quantity: o.qty,
      limit_price: o.limit_price,
      stop_price: o.stop_price,
      created_at: blob.timestamp,
      updated_at: blob.timestamp,
    })),
    recent_orders: [],
    recent_option_orders: [],
  };
}

function hasCompleteMetrics(snapshot) {
  const btc = snapshot?.state?.symbols?.BTC;
  if (!btc || !btc.metrics) return false;
  const m = btc.metrics;
  return m.current_price != null && m.intraday_high != null && m.intraday_low != null;
}

async function fetchBlob(token, storeName, key) {
  const res = await fetch(
    `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/${storeName}/${encodeURIComponent(key)}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch snapshot ${key} from ${storeName}: ${res.status}`);
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

async function fetchSnapshot() {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) {
    throw new Error('NETLIFY_AUTH_TOKEN not configured');
  }

  // Try order-book first (live data), fall back to state-logs (archive)
  let storeName = PRIMARY_STORE;
  let allKeys = await listAllBlobKeys(token, PRIMARY_STORE);

  if (allKeys.length === 0) {
    storeName = FALLBACK_STORE;
    allKeys = await listAllBlobKeys(token, FALLBACK_STORE);
  }

  if (allKeys.length === 0) {
    throw new Error('No snapshots found in order-book or state-logs');
  }

  // Filter to timestamp-formatted keys only (skip "latest" etc.)
  const timestampKeys = allKeys.filter((k) => /^\d{4}-\d{2}-\d{2}T/.test(k));
  if (timestampKeys.length === 0) {
    throw new Error('No timestamp-formatted snapshots found');
  }

  // Sort descending (newest first)
  const sortedKeys = timestampKeys.sort().reverse();

  // Fetch the latest blob — always used for portfolio + order_book
  let latestRaw = await fetchBlob(token, storeName, sortedKeys[0]);
  let latest;

  if (isNewFormat(latestRaw)) {
    latest = normalizeNewFormat(latestRaw);

    // New-format blobs lack options, recent_orders, market_data.
    // Walk backwards to find an old-format blob and merge those fields.
    const maxLookback = Math.min(sortedKeys.length, 10);
    for (let i = 1; i < maxLookback; i++) {
      try {
        const older = await fetchBlob(token, storeName, sortedKeys[i]);
        if (!isNewFormat(older) && older.portfolio) {
          if (older.portfolio.options && older.portfolio.options.length > 0) {
            latest.portfolio.options = older.portfolio.options;
          }
          if (older.portfolio.open_option_orders && older.portfolio.open_option_orders.length > 0) {
            latest.portfolio.open_option_orders = older.portfolio.open_option_orders;
          }
          if (older.recent_orders) {
            latest.recent_orders = older.recent_orders;
          }
          if (older.recent_option_orders) {
            latest.recent_option_orders = older.recent_option_orders;
          }
          break;
        }
      } catch (e) {
        console.error(`Failed to fetch older blob ${sortedKeys[i]}:`, e.message);
      }
    }
  } else {
    latest = latestRaw;
  }

  // Build market_data from the latest blob with complete BTC metrics
  let marketData = null;

  if (hasCompleteMetrics(latestRaw)) {
    marketData = {
      timestamp: latestRaw.timestamp,
      symbols: latestRaw.state.symbols,
    };
  } else {
    // Walk backwards through recent blobs (check up to 5) to find complete metrics
    const maxLookback = Math.min(sortedKeys.length, 6);
    for (let i = 1; i < maxLookback; i++) {
      try {
        const older = await fetchBlob(token, storeName, sortedKeys[i]);
        if (hasCompleteMetrics(older)) {
          marketData = {
            timestamp: older.timestamp,
            symbols: older.state.symbols,
          };
          break;
        }
      } catch (e) {
        console.error(`Failed to fetch fallback blob ${sortedKeys[i]}:`, e.message);
      }
    }
  }

  return {
    timestamp: latest.timestamp,
    portfolio: latest.portfolio,
    order_book: latest.order_book || [],
    recent_orders: latest.recent_orders || [],
    recent_option_orders: latest.recent_option_orders || [],
    market_data: marketData,
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
