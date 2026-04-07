// Order Book Snapshot Netlify Function
// Reads the latest state-logs blob from the 5thstreetcapital site
// Data is written every ~5 minutes by an external trading system
//
// Returns portfolio/order_book from latest blob, and market_data from
// the most recent blob that has complete BTC metrics (walking backwards
// if the latest snapshot has NO_DATA).

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

async function fetchSnapshot() {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) {
    throw new Error('NETLIFY_AUTH_TOKEN not configured');
  }

  let allKeys = await listAllBlobKeys(token, STORE_NAME);
  let activeStore = STORE_NAME;

  // Fall back to historical store if primary is empty
  if (allKeys.length === 0) {
    console.log('Primary state-logs store empty, falling back to state-logs-historical');
    allKeys = await listAllBlobKeys(token, STORE_NAME_HISTORICAL);
    activeStore = STORE_NAME_HISTORICAL;
  }

  if (allKeys.length === 0) {
    throw new Error('No state-logs snapshots found');
  }

  // Keys are timestamps (e.g. "2026-02-15T02-07-07"), sort descending (newest first)
  const sortedKeys = allKeys.sort().reverse();

  // Fetch the latest blob — always used for portfolio + order_book
  const latest = await fetchBlob(token, sortedKeys[0], activeStore);

  // Build market_data from the latest blob with complete BTC metrics
  let marketData = null;

  if (hasCompleteMetrics(latest)) {
    marketData = {
      timestamp: latest.timestamp,
      symbols: latest.state.symbols,
    };
  } else {
    // Walk backwards through recent blobs (check up to 5) to find complete metrics
    const maxLookback = Math.min(sortedKeys.length, 6); // skip index 0 (already checked)
    for (let i = 1; i < maxLookback; i++) {
      try {
        const older = await fetchBlob(token, sortedKeys[i], activeStore);
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

  const portfolio = latest.portfolio || {};
  return {
    timestamp: latest.timestamp,
    portfolio: {
      cash: portfolio.cash || { cash: 0, cash_available_for_withdrawal: 0, buying_power: 0, tradeable_cash: 0 },
      equity: portfolio.equity || 0,
      market_value: portfolio.market_value || 0,
      positions: portfolio.positions || [],
      open_orders: portfolio.open_orders || [],
      open_option_orders: portfolio.open_option_orders || [],
      options: portfolio.options || [],
    },
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
