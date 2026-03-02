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

async function fetchBlobFromStore(token, store, key) {
  const res = await fetch(
    `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/${store}/${encodeURIComponent(key)}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch ${store}/${key}: ${res.status}`);
  }
  const blob = await res.json();
  return normalizeBlob(blob);
}

async function fetchBlob(token, key) {
  return fetchBlobFromStore(token, 'order-book', key);
}

function hasValidPortfolio(blob) {
  return blob.portfolio && blob.portfolio.positions && blob.portfolio.cash;
}

// Normalize blobs from allocation-engine-2.0 (flat format) into the
// nested portfolio structure the UI expects.
//
// v2 shape: { timestamp, account, positions[], open_orders[], ... }
// v1 shape: { timestamp, portfolio: { cash, equity, market_value, positions[], open_orders[], ... }, order_book[], state, ... }
function normalizeBlob(blob) {
  // Already v1 format — nothing to do
  if (blob.portfolio) return blob;

  // Detect v2 format: has account + top-level positions array
  if (blob.account && Array.isArray(blob.positions)) {
    const acct = blob.account;
    const totalMarketValue = (blob.positions || []).reduce((s, p) => s + (p.market_value || 0), 0);

    blob.portfolio = {
      cash: {
        cash: acct.cash ?? 0,
        cash_available_for_withdrawal: acct.buying_power ?? 0,
        buying_power: acct.buying_power ?? 0,
        tradeable_cash: acct.cash ?? 0,
      },
      equity: acct.equity ?? 0,
      market_value: totalMarketValue,
      positions: (blob.positions || []).map(p => ({
        symbol: p.symbol,
        name: p.symbol,
        type: 'stock',
        quantity: p.qty ?? 0,
        avg_buy_price: p.avg_entry ?? 0,
        current_price: p.qty > 0 ? (p.market_value / p.qty) : 0,
        equity: p.market_value ?? 0,
        profit_loss: p.unrealized_pl ?? 0,
        profit_loss_pct: (p.unrealized_pl_pct ?? 0) * 100,
        percent_change: (p.unrealized_pl_pct ?? 0) * 100,
        equity_change: p.unrealized_pl ?? 0,
        pe_ratio: null,
        percentage: totalMarketValue > 0 ? ((p.market_value || 0) / totalMarketValue) * 100 : 0,
      })),
      open_orders: (blob.open_orders || []).map(o => ({
        order_id: o.id,
        symbol: o.symbol,
        side: o.side,
        order_type: o.order_type || 'limit',
        trigger: o.stop_price ? 'stop' : 'immediate',
        state: o.status || 'confirmed',
        quantity: o.qty ?? 0,
        limit_price: o.limit_price ?? null,
        stop_price: o.stop_price ?? null,
        created_at: blob.timestamp,
        updated_at: blob.timestamp,
      })),
      open_option_orders: [],
    };

    // v2 doesn't include order_book — synthesize from open_orders
    if (!blob.order_book) {
      blob.order_book = blob.portfolio.open_orders;
    }
  }

  return blob;
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
  let latest = await fetchBlob(token, sortedKeys[0]);

  // If latest blob is missing portfolio, walk backwards through order-book blobs
  if (!hasValidPortfolio(latest)) {
    console.warn(`Latest blob ${sortedKeys[0]} missing portfolio, checking older order-book blobs`);
    const maxLookback = Math.min(sortedKeys.length, 6);
    for (let i = 1; i < maxLookback; i++) {
      try {
        const older = await fetchBlob(token, sortedKeys[i]);
        if (hasValidPortfolio(older)) {
          console.log(`Using order-book fallback blob ${sortedKeys[i]}`);
          latest = older;
          break;
        }
      } catch (e) {
        console.error(`Failed to fetch order-book fallback ${sortedKeys[i]}:`, e.message);
      }
    }
  }

  // If still missing portfolio, fall back to state-logs store
  if (!hasValidPortfolio(latest)) {
    console.warn('No valid portfolio in order-book store, falling back to state-logs');
    try {
      const logsRes = await fetch(
        `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/state-logs`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (logsRes.ok) {
        const { blobs: logBlobs } = await logsRes.json();
        if (logBlobs && logBlobs.length > 0) {
          const logKeys = logBlobs.map(b => b.key).sort().reverse();
          const maxLogLookback = Math.min(logKeys.length, 6);
          for (let i = 0; i < maxLogLookback; i++) {
            try {
              const logBlob = await fetchBlobFromStore(token, 'state-logs', logKeys[i]);
              if (hasValidPortfolio(logBlob)) {
                console.log(`Using state-logs fallback blob ${logKeys[i]}`);
                latest = logBlob;
                break;
              }
            } catch (e) {
              console.error(`Failed to fetch state-logs blob ${logKeys[i]}:`, e.message);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to list state-logs store:', e.message);
    }
  }

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

  // Default empty portfolio if all fallbacks fail
  const emptyPortfolio = {
    cash: { cash: 0, cash_available_for_withdrawal: 0, buying_power: 0, tradeable_cash: 0 },
    equity: 0,
    market_value: 0,
    positions: [],
    open_orders: [],
    open_option_orders: [],
  };

  return {
    timestamp: latest.timestamp,
    portfolio: latest.portfolio || emptyPortfolio,
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
