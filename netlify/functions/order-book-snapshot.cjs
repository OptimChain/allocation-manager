// Order Book Snapshot Netlify Function
// Reads the latest order-book blob from the 5thstreetcapital site.
//
// Handles two blob formats:
//   1. New (allocation-engine): portfolio/order_book nested structure
//   2. Legacy (runtime): flat account/positions/open_orders at top level
//
// Returns a normalized OrderBookSnapshot for the frontend, plus
// market_data from the most recent blob with complete BTC metrics.

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

// Normalize a blob into the frontend OrderBookSnapshot shape.
// Handles both the new engine format (portfolio nested) and
// the legacy flat format (account/positions/open_orders at top level).
function normalizeSnapshot(blob) {
  // New format: already has portfolio nested correctly
  if (blob.portfolio) {
    return {
      portfolio: blob.portfolio,
      order_book: blob.order_book || blob.portfolio.open_orders || [],
      recent_orders: blob.recent_orders || [],
      recent_option_orders: blob.recent_option_orders || [],
    };
  }

  // Legacy flat format: transform to nested structure
  if (blob.account || blob.positions || blob.open_orders) {
    const acct = blob.account || {};
    const positions = (blob.positions || []).map(p => ({
      symbol: p.symbol,
      quantity: p.qty ?? p.quantity ?? 0,
      avg_buy_price: p.avg_entry ?? p.avg_buy_price ?? 0,
      current_price: p.qty ? (p.market_value / p.qty) : 0,
      equity: p.market_value ?? 0,
      profit_loss: p.unrealized_pl ?? 0,
      profit_loss_pct: p.unrealized_pl_pct ?? 0,
    }));
    const orders = (blob.open_orders || []).map(o => ({
      order_id: o.id ?? o.order_id ?? '',
      symbol: o.symbol,
      side: (o.side || '').toUpperCase(),
      order_type: o.order_type || 'market',
      trigger: o.trigger || 'immediate',
      state: o.status ?? o.state ?? 'unknown',
      quantity: o.qty ?? o.quantity ?? 0,
      limit_price: o.limit_price || 0,
      stop_price: o.stop_price || null,
      created_at: blob.timestamp,
      updated_at: blob.timestamp,
    }));

    return {
      portfolio: {
        cash: {
          cash: acct.cash ?? 0,
          buying_power: acct.buying_power ?? 0,
          cash_available_for_withdrawal: acct.cash ?? 0,
          tradeable_cash: acct.cash ?? 0,
        },
        equity: acct.equity ?? 0,
        market_value: acct.portfolio_value ?? 0,
        positions,
        open_orders: orders,
      },
      order_book: orders,
      recent_orders: [],
      recent_option_orders: [],
    };
  }

  // Unknown format — return empty portfolio
  return {
    portfolio: null,
    order_book: [],
    recent_orders: blob.recent_orders || [],
    recent_option_orders: blob.recent_option_orders || [],
  };
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
  const normalized = normalizeSnapshot(latest);

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
    portfolio: normalized.portfolio,
    order_book: normalized.order_book,
    recent_orders: normalized.recent_orders,
    recent_option_orders: normalized.recent_option_orders,
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
