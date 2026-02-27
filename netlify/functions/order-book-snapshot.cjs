// Order Book Snapshot Netlify Function
// Reads the latest order-book blob from the 5thstreetcapital site
// Data is written every ~5 minutes by an external trading system
//
// Returns portfolio/order_book from latest blob, and market_data from
// the most recent blob that has complete BTC metrics (walking backwards
// if the latest snapshot has NO_DATA).

// 5thstreetcapital Netlify site ID
const ORDER_BOOK_SITE_ID = '3d014fc3-e919-4b4d-b374-e8606dee50df';
const BLOBS_API_BASE = 'https://api.netlify.com/api/v1/blobs';

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

async function fetchBlob(token, key) {
  const res = await fetch(
    `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/order-book/${encodeURIComponent(key)}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch snapshot ${key}: ${res.status}`);
  }
  return res.json();
}

async function fetchSnapshot() {
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) {
    throw new Error('NETLIFY_AUTH_TOKEN not configured');
  }

  // List all blobs in the order-book store
  const listRes = await fetch(
    `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/order-book`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (!listRes.ok) {
    throw new Error(`Failed to list order-book blobs: ${listRes.status}`);
  }

  const { blobs } = await listRes.json();
  if (!blobs || blobs.length === 0) {
    throw new Error('No order-book snapshots found');
  }

  // Keys are timestamps (e.g. "2026-02-15T02-07-07"), sort descending (newest first)
  const sortedKeys = blobs.map(b => b.key).sort().reverse();

  // Fetch the latest blob — always used for portfolio + order_book
  const latest = await fetchBlob(token, sortedKeys[0]);

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
        const older = await fetchBlob(token, sortedKeys[i]);
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
    order_book: latest.order_book,
    recent_orders: latest.recent_orders || [],
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
