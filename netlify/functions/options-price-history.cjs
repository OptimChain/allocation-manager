// Options Price History Netlify Function
// Proxies Polygon.io options aggregates API for historical contract prices
//
// Usage:
//   GET /.netlify/functions/options-price-history?symbol=IWM&strike=247&expiration=2026-03-13&optionType=put
//   GET /.netlify/functions/options-price-history?symbol=IWM&strike=247&expiration=2026-03-13&optionType=put&from=2026-02-01&to=2026-03-02&timespan=hour

const POLYGON_API = 'https://api.polygon.io/v2/aggs/ticker';
const API_KEY = process.env.POLYGON_API_KEY;

const cache = new Map();
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 20;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function buildOptionsTicker(symbol, expiration, optionType, strike) {
  const date = new Date(expiration);
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const typeChar = optionType.toLowerCase() === 'call' ? 'C' : 'P';
  const strikeInt = Math.round(strike * 1000).toString().padStart(8, '0');
  return `O:${symbol}${yy}${mm}${dd}${typeChar}${strikeInt}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'POLYGON_API_KEY not configured' }),
    };
  }

  const params = event.queryStringParameters || {};
  const { symbol, expiration, strike, optionType } = params;

  if (!symbol || !expiration || !strike || !optionType) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Missing required params: symbol, expiration, strike, optionType',
      }),
    };
  }

  const ticker = buildOptionsTicker(symbol, expiration, optionType, parseFloat(strike));
  const timespan = params.timespan || 'day';
  const multiplier = params.multiplier || '1';
  const to = params.to || new Date().toISOString().slice(0, 10);
  // Default from: 90 days before expiration or 90 days ago, whichever is earlier
  const defaultFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const from = params.from || defaultFrom;

  const cacheKey = `${ticker}:${timespan}:${multiplier}:${from}:${to}`;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(cached.data),
    };
  }

  try {
    const url = `${POLYGON_API}/${ticker}/range/${multiplier}/${timespan}/${from}/${to}?apiKey=${API_KEY}&sort=asc&limit=5000`;
    const res = await fetch(url);

    if (!res.ok) {
      const text = await res.text();
      console.error(`[OPTIONS_PRICE] Polygon error ${res.status}:`, text);
      return {
        statusCode: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Polygon API error: ${res.status}`, ticker }),
      };
    }

    const data = await res.json();
    const response = {
      ticker,
      symbol,
      optionType,
      strike: parseFloat(strike),
      expiration,
      resultsCount: data.resultsCount || 0,
      results: (data.results || []).map((r) => ({
        t: r.t,
        o: r.o,
        h: r.h,
        l: r.l,
        c: r.c,
        v: r.v,
        vw: r.vw,
        n: r.n,
      })),
    };

    // Update cache
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(cacheKey, { data: response, timestamp: Date.now() });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('[OPTIONS_PRICE] Error:', error.message);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message, ticker }),
    };
  }
};
