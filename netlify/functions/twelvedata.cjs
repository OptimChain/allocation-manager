// twelvedata.cjs
// Server-side TwelveData proxy with a shared Postgres cache — the single
// consolidation point for every TwelveData REST pull the dashboard makes.
//
//   GET /.netlify/functions/twelvedata/time_series?symbol=SPY&interval=1day&outputsize=402
//   GET /.netlify/functions/twelvedata/quote?symbol=BTC/USD
//   GET /.netlify/functions/twelvedata/price?symbol=SPY
//
// Why: the frontend previously called api.twelvedata.com directly from every
// browser with the API key in the bundle — N viewers = N× API credits and
// 429s. This proxy holds the key server-side and caches responses in the
// trading DB, so identical requests across ALL browsers and lambda instances
// cost one upstream credit per TTL window.
//
// Behavior:
//   - Response body is the verbatim TwelveData JSON (drop-in for the client)
//   - X-Cache header: hit | miss | stale
//   - TTL by endpoint/interval (see ttlSecondsFor); ?refresh=1 forces a
//     refetch but never more than once per REFRESH_FLOOR_S per key
//   - Upstream failure or TwelveData error body → serve the last cached
//     payload (X-Cache: stale) rather than surfacing a 429 to the UI

'use strict';

const t = require('./lib/tradingDb.cjs');

const TD_API = 'https://api.twelvedata.com';
const ALLOWED_ENDPOINTS = new Set(['time_series', 'quote', 'price', 'exchange_rate']);
const REFRESH_FLOOR_S = 15;

// Params forwarded upstream — apikey (server-owned) and refresh (ours) excluded
const PARAM_BLOCKLIST = new Set(['apikey', 'refresh']);

const CORS = { ...t.CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// In-flight upstream fetches, deduped per lambda instance
const inFlight = new Map();

function ttlSecondsFor(endpoint, params) {
  if (endpoint === 'quote' || endpoint === 'price' || endpoint === 'exchange_rate') return 60;
  // time_series: slower intervals change less often
  const interval = params.interval || '1day';
  if (interval === '1min') return 120;
  if (interval === '5min') return 180;
  if (/^(15|30|45)min$/.test(interval)) return 300;
  if (/^[124]h$/.test(interval)) return 600;
  if (interval === '1day') return 1800;
  return 3600; // 1week / 1month
}

function respond(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function isErrorPayload(payload) {
  // TwelveData returns HTTP 200 with { code, message, status: 'error' } on
  // rate limits and bad requests
  return !payload || typeof payload !== 'object' || payload.status === 'error' || payload.code >= 400;
}

async function fetchUpstream(endpoint, params, apiKey) {
  const url = new URL(`${TD_API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apikey', apiKey);
  const res = await fetch(url.toString());
  const payload = await res.json().catch(() => null);
  return { httpOk: res.ok, payload };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return respond(200, '');
  if (event.httpMethod !== 'GET') {
    return respond(405, { status: 'error', code: 405, message: 'GET only' });
  }

  // Endpoint from the path suffix: /.netlify/functions/twelvedata/<endpoint>
  const match = (event.path || '').match(/\/twelvedata\/?([a-z_]*)/);
  const endpoint = (match && match[1]) || (event.queryStringParameters || {}).endpoint || '';
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return respond(400, {
      status: 'error', code: 400,
      message: `Unknown endpoint "${endpoint}". Allowed: ${[...ALLOWED_ENDPOINTS].join(', ')}`,
    });
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY || process.env.VITE_TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return respond(503, { status: 'error', code: 503, message: 'TWELVE_DATA_API_KEY is not configured on the site' });
  }

  const rawParams = event.queryStringParameters || {};
  const params = {};
  for (const k of Object.keys(rawParams).sort()) {
    if (!PARAM_BLOCKLIST.has(k) && k !== 'endpoint' && rawParams[k] !== '') params[k] = rawParams[k];
  }
  const cacheKey = `${endpoint}?${new URLSearchParams(params).toString()}`;
  const wantsRefresh = rawParams.refresh === '1' || rawParams.refresh === 'true';

  const db = t.getDb();

  try {
    let cached = null;
    if (db) {
      await t.ensureSchema(db);
      cached = await t.getMarketCache(db, cacheKey);
    }

    const ttlMs = ttlSecondsFor(endpoint, params) * 1000;
    const freshEnough = cached && (
      wantsRefresh ? cached.age_ms < REFRESH_FLOOR_S * 1000 : cached.age_ms < ttlMs
    );
    if (freshEnough) {
      return respond(200, cached.payload, { 'X-Cache': 'hit', 'Age': String(Math.floor(cached.age_ms / 1000)) });
    }

    // Cache miss/expired → fetch upstream (deduped per instance)
    let pending = inFlight.get(cacheKey);
    if (!pending) {
      pending = fetchUpstream(endpoint, params, apiKey).finally(() => inFlight.delete(cacheKey));
      inFlight.set(cacheKey, pending);
    }
    const { httpOk, payload } = await pending;

    if (httpOk && !isErrorPayload(payload)) {
      if (db) await t.setMarketCache(db, cacheKey, endpoint, payload);
      return respond(200, payload, { 'X-Cache': 'miss' });
    }

    // Upstream failed (429, 5xx, malformed) — serve the last good payload if any
    if (cached) {
      return respond(200, cached.payload, { 'X-Cache': 'stale', 'Age': String(Math.floor(cached.age_ms / 1000)) });
    }
    return respond(502, payload || { status: 'error', code: 502, message: 'TwelveData request failed' });
  } catch (err) {
    console.error('twelvedata proxy error:', err);
    return respond(500, { status: 'error', code: 500, message: err.message || 'proxy error' });
  }
};
