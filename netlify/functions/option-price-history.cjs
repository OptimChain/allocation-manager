// Option Price History Netlify Function
// Samples historical order-book blob snapshots and returns compact
// options pricing time series data for charting.
//
// GET /.netlify/functions/option-price-history?days=7&samples=24

const ORDER_BOOK_SITE_ID = '3d014fc3-e919-4b4d-b374-e8606dee50df';
const BLOBS_API_BASE = 'https://api.netlify.com/api/v1/blobs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

async function fetchBlob(token, key) {
  const res = await fetch(
    `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/order-book/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`Blob fetch failed: ${key} ${res.status}`);
  }
  return res.json();
}

// Convert key "2026-02-15T02-07-07" to epoch ms
function keyToMs(key) {
  const iso = key.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3Z');
  return new Date(iso).getTime();
}

// Pick N evenly spaced indices from an array of length total
function sampleIndices(total, n) {
  if (total <= n) return Array.from({ length: total }, (_, i) => i);
  const step = (total - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(i * step));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const token = process.env.NETLIFY_AUTH_TOKEN;
    if (!token) {
      throw new Error('NETLIFY_AUTH_TOKEN not configured');
    }

    const days = parseInt(event.queryStringParameters?.days || '7', 10);
    const maxSamples = Math.min(
      parseInt(event.queryStringParameters?.samples || '24', 10),
      48
    );

    const cutoff = Date.now() - days * 86400000;

    // List all blob keys in the order-book store
    const listRes = await fetch(
      `${BLOBS_API_BASE}/${ORDER_BOOK_SITE_ID}/order-book`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) {
      throw new Error(`Failed to list blobs: ${listRes.status}`);
    }

    const { blobs } = await listRes.json();
    if (!blobs || blobs.length === 0) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshots: [] }),
      };
    }

    // Filter keys within the requested time range, sort ascending
    const inRange = blobs
      .map((b) => b.key)
      .filter((key) => keyToMs(key) >= cutoff)
      .sort();

    if (inRange.length === 0) {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshots: [] }),
      };
    }

    // Sample evenly across the range
    const indices = sampleIndices(inRange.length, maxSamples);
    const selectedKeys = indices.map((i) => inRange[i]);

    // Fetch sampled blobs in parallel, extract only options data
    const results = await Promise.allSettled(
      selectedKeys.map((key) => fetchBlob(token, key))
    );

    const snapshots = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== 'fulfilled') continue;
      const blob = results[i].value;
      const opts = blob?.portfolio?.options;
      if (!opts || opts.length === 0) continue;

      snapshots.push({
        timestamp: selectedKeys[i],
        timestampMs: keyToMs(selectedKeys[i]),
        options: opts.map((o) => ({
          chain_symbol: o.chain_symbol,
          option_type: o.option_type,
          strike: o.strike,
          expiration: o.expiration,
          mark_price: o.mark_price,
          iv: o.greeks?.iv ?? null,
          quantity: o.quantity,
          position_type: o.position_type,
        })),
      });
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshots }),
    };
  } catch (error) {
    console.error('Option price history error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Failed to fetch option history' }),
    };
  }
};
