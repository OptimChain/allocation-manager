// Market Cap & Volume Netlify Function
// Primary: CoinCap (free, no key, generous rate limits)
// Fallback: CoinGecko
// In-memory cache to avoid rate-limiting (429s)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Cache lives across invocations within the same Lambda container
let cache = { data: null, source: null, timestamp: 0 };
const CACHE_TTL_MS = 60_000; // 60 seconds

async function fetchFromCoinCap() {
  const response = await fetch('https://api.coincap.io/v2/assets/bitcoin');
  if (!response.ok) throw new Error(`CoinCap ${response.status}`);
  const { data } = await response.json();
  return {
    market_cap: data.marketCapUsd ? parseFloat(data.marketCapUsd) : null,
    total_volume: data.volumeUsd24Hr ? parseFloat(data.volumeUsd24Hr) : null,
  };
}

async function fetchFromCoinGecko() {
  const response = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true'
  );
  if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
  const data = await response.json();
  return {
    market_cap: data.bitcoin?.usd_market_cap ?? null,
    total_volume: data.bitcoin?.usd_24h_vol ?? null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const now = Date.now();

  // Return cached data if still fresh
  if (cache.data && now - cache.timestamp < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        'X-Data-Source': cache.source,
        'X-Cache': 'HIT',
      },
      body: JSON.stringify(cache.data),
    };
  }

  // Try CoinCap first, fall back to CoinGecko
  let result = null;
  let source = 'coincap';

  try {
    result = await fetchFromCoinCap();
    console.log('CoinCap OK — market_cap:', result.market_cap, 'volume:', result.total_volume);
  } catch (err) {
    console.warn('CoinCap failed, trying CoinGecko:', err.message);
    source = 'coingecko';
    try {
      result = await fetchFromCoinGecko();
      console.log('CoinGecko fallback OK — market_cap:', result.market_cap, 'volume:', result.total_volume);
    } catch (err2) {
      console.error('Both sources failed:', err2.message);

      // Serve stale cache if available rather than returning an error
      if (cache.data) {
        console.log('Serving stale cache (age:', Math.round((now - cache.timestamp) / 1000), 's)');
        return {
          statusCode: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=30',
            'X-Data-Source': cache.source,
            'X-Cache': 'STALE',
          },
          body: JSON.stringify(cache.data),
        };
      }

      return {
        statusCode: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: '502 Both sources unavailable', market_cap: null, total_volume: null }),
      };
    }
  }

  // Update cache
  cache = { data: result, source, timestamp: now };

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'X-Data-Source': source,
      'X-Cache': 'MISS',
    },
    body: JSON.stringify(result),
  };
};
