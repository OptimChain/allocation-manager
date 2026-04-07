// Generic Netlify Blob Storage vending function
// Usage:
//   GET /.netlify/functions/vend-blobs?store=news-articles&action=list
//   GET /.netlify/functions/vend-blobs?store=news-articles&action=list&prefix=index:
//   GET /.netlify/functions/vend-blobs?store=news-articles&action=get&key=index:coindesk
//   GET /.netlify/functions/vend-blobs?store=options-chain&action=list-symbols
//   GET /.netlify/functions/vend-blobs?store=options-chain&action=list-dates&symbol=CRWD
//   GET /.netlify/functions/vend-blobs?action=market-data&symbol=CRWD[&date=2026-03-20]
//
//   Stores on the allocation-engine site (options-chain, market-quotes) are
//   routed automatically via the ALLOC_ENGINE_SITE_ID env var.

// Stores that live on the allocation-engine Netlify site.
// These were written via the REST API (/api/v1/blobs/) so they must be
// read back through the same REST API — the @netlify/blobs SDK uses a
// different internal storage layer and cannot see them.
const ALLOC_ENGINE_STORES = new Set(['options-chain', 'market-quotes']);

const NETLIFY_API = 'https://api.netlify.com/api/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const MAX_FALLBACK_ATTEMPTS = 5;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ── REST API helpers for cross-site blob reads ──────────────

async function restListBlobs(siteId, storeName, token, prefix) {
  const allBlobs = [];
  let cursor = null;
  // Paginate (Netlify returns up to 1000 per page)
  do {
    const url = new URL(`${NETLIFY_API}/blobs/${siteId}/${storeName}`);
    if (prefix) url.searchParams.set('prefix', prefix);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Netlify blobs list failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    allBlobs.push(...(data.blobs || []));
    cursor = data.next_cursor || null;
  } while (cursor);
  return allBlobs;
}

async function restGetBlob(siteId, storeName, key, token) {
  // Key may contain slashes (e.g. "CRWD/2026-03-02T20-45-27") that must stay
  // as literal path separators — only encode each segment individually.
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const url = `${NETLIFY_API}/blobs/${siteId}/${storeName}/${encodedKey}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Netlify blobs get failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Key selection helpers ───────────────────────────────────

function dateFromKey(key) {
  const tsStart = key.includes('/') ? key.lastIndexOf('/') + 1 : 0;
  return key.slice(tsStart, tsStart + 10);
}

function pickRichestKey(keys) {
  if (!keys || keys.length === 0) return null;
  if (keys.length === 1) return keys[0];

  const todayUTC = new Date().toISOString().slice(0, 10);

  // Walk backwards to find the last key from a date before today (EOD preferred)
  for (let i = keys.length - 1; i >= 0; i--) {
    if (dateFromKey(keys[i]) < todayUTC) return keys[i];
  }

  // All keys are from today — return the latest
  return keys[keys.length - 1];
}

// ── Blob fetch with fallback ────────────────────────────────

async function fetchBlobWithFallback(keys, siteId, storeName, token) {
  if (!keys || keys.length === 0) return null;

  const richestIdx = keys.indexOf(pickRichestKey(keys));
  const startIdx = richestIdx >= 0 ? richestIdx : keys.length - 1;

  // Try from richest backwards
  for (let i = startIdx; i >= Math.max(0, startIdx - MAX_FALLBACK_ATTEMPTS + 1); i--) {
    const value = await restGetBlob(siteId, storeName, keys[i], token);
    if (value !== null && typeof value === 'object' && Object.keys(value).length > 0) {
      return { key: keys[i], value };
    }
  }

  return null;
}

// ── snake_case → camelCase mappers ──────────────────────────

function mapOptionSnapshot(raw) {
  if (!raw) return raw;
  const rawQuote = raw.latest_quote ?? raw.latestQuote;
  return {
    symbol: raw.symbol,
    latestTrade: raw.latest_trade ?? raw.latestTrade,
    latestQuote: rawQuote
      ? {
          bid: rawQuote.bid,
          ask: rawQuote.ask,
          bidSize: rawQuote.bid_size ?? rawQuote.bidSize ?? 0,
          askSize: rawQuote.ask_size ?? rawQuote.askSize ?? 0,
          timestamp: rawQuote.timestamp,
        }
      : undefined,
    greeks: raw.greeks ?? null,
    impliedVolatility: raw.implied_volatility ?? raw.impliedVolatility ?? null,
  };
}

function mapMarketQuote(raw) {
  if (!raw) return raw;
  return {
    bid: raw.bid,
    ask: raw.ask,
    mid: raw.mid,
    spread: raw.spread,
    spreadBps: raw.spread_bps ?? raw.spreadBps ?? 0,
    bidSize: raw.bid_size ?? raw.bidSize,
    askSize: raw.ask_size ?? raw.askSize,
    bidExchange: raw.bid_exchange ?? raw.bidExchange,
    askExchange: raw.ask_exchange ?? raw.askExchange,
    timestamp: raw.timestamp,
    source: raw.source,
    symbol: raw.symbol,
    assetClass: raw.asset_class ?? raw.assetClass ?? '',
  };
}

function mapOptionsChainBlob(raw) {
  if (!raw) return null;

  const latestChain = {};
  for (const [k, v] of Object.entries(raw.latest_chain || {})) {
    if (k === '_meta') continue;
    latestChain[k] = mapOptionSnapshot(v);
  }

  const latestBars = {};
  for (const [k, v] of Object.entries(raw.latest_bars || {})) {
    if (k === '_meta' || !Array.isArray(v)) continue;
    latestBars[k] = v.map((b) => ({
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      tradeCount: b.trade_count ?? b.tradeCount ?? 0,
      vwap: b.vwap,
    }));
  }

  const history = (raw.history || []).map((h) => ({
    timestamp: h.timestamp,
    underlying: h.underlying ?? raw.underlying,
    numContracts: h.num_contracts ?? h.numContracts ?? 0,
    snapshots: (h.snapshots || []).map(mapOptionSnapshot),
  }));

  return {
    timestamp: raw.timestamp,
    underlying: raw.underlying,
    blobKey: raw.blob_key,
    latestChain,
    latestBars,
    historyCount: raw.history_count ?? 0,
    history,
  };
}

function mapMarketQuotesBlob(raw) {
  if (!raw) return null;

  const latestQuotes = {};
  for (const [k, v] of Object.entries(raw.latest_quotes || {})) {
    if (k === '_meta') continue;
    latestQuotes[k] = mapMarketQuote(v);
  }

  const history = (raw.history || []).map((h) => {
    const quotes = {};
    const rawQuotes = h.quotes || [];
    if (Array.isArray(rawQuotes)) {
      for (const q of rawQuotes) {
        if (q && q.symbol) quotes[q.symbol] = mapMarketQuote(q);
      }
    } else {
      for (const [k, v] of Object.entries(rawQuotes)) {
        if (k === '_meta') continue;
        quotes[k] = mapMarketQuote(v);
      }
    }
    return { timestamp: h.timestamp, quotes };
  });

  return {
    timestamp: raw.timestamp,
    blobKey: raw.blob_key,
    latestQuotes,
    historyCount: raw.history_count ?? 0,
    history,
  };
}

// ── Handler ─────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || 'list';
  const token = process.env.NETLIFY_AUTH_TOKEN;

  try {
    // ── New combined market-data action ──
    if (action === 'market-data') {
      const symbol = params.symbol;
      if (!symbol) return jsonResponse(400, { error: 'Missing "symbol" parameter' });

      const siteId = process.env.ALLOC_ENGINE_SITE_ID;
      if (!siteId) return jsonResponse(500, { error: 'ALLOC_ENGINE_SITE_ID not configured' });

      const date = params.date;

      // Fetch keys for both stores in parallel
      const optionsPrefix = date ? `${symbol}/${date}` : `${symbol}/`;
      const quotesPrefix = date || '';

      const [optionKeys, quoteKeys] = await Promise.all([
        restListBlobs(siteId, 'options-chain', token, optionsPrefix).then((b) => b.map((x) => x.key)),
        restListBlobs(siteId, 'market-quotes', token, quotesPrefix).then((b) => b.map((x) => x.key)),
      ]);

      // Fetch blobs in parallel with fallback
      const [optionsResult, quotesResult] = await Promise.all([
        fetchBlobWithFallback(optionKeys, siteId, 'options-chain', token),
        fetchBlobWithFallback(quoteKeys, siteId, 'market-quotes', token),
      ]);

      return jsonResponse(200, {
        options: optionsResult ? mapOptionsChainBlob(optionsResult.value) : null,
        quotes: quotesResult ? mapMarketQuotesBlob(quotesResult.value) : null,
      });
    }

    // ── New list-symbols action ──
    if (action === 'list-symbols') {
      const siteId = process.env.ALLOC_ENGINE_SITE_ID;
      if (!siteId) return jsonResponse(500, { error: 'ALLOC_ENGINE_SITE_ID not configured' });

      const blobs = await restListBlobs(siteId, 'options-chain', token, '');
      const symbols = new Set();
      for (const b of blobs) {
        const slash = b.key.indexOf('/');
        if (slash > 0) symbols.add(b.key.slice(0, slash));
      }
      return jsonResponse(200, { symbols: Array.from(symbols).sort() });
    }

    // ── New list-dates action ──
    if (action === 'list-dates') {
      const symbol = params.symbol;
      if (!symbol) return jsonResponse(400, { error: 'Missing "symbol" parameter' });

      const siteId = process.env.ALLOC_ENGINE_SITE_ID;
      if (!siteId) return jsonResponse(500, { error: 'ALLOC_ENGINE_SITE_ID not configured' });

      const blobs = await restListBlobs(siteId, 'options-chain', token, `${symbol}/`);
      const dates = new Set();
      for (const b of blobs) dates.add(dateFromKey(b.key));
      return jsonResponse(200, { dates: Array.from(dates).sort().reverse() });
    }

    // ── Existing actions require store param ──
    const storeName = params.store;
    if (!storeName) {
      return jsonResponse(400, { error: 'Missing "store" query parameter' });
    }

    const useRestApi = ALLOC_ENGINE_STORES.has(storeName) && process.env.ALLOC_ENGINE_SITE_ID;

    // ── REST API path (allocation-engine cross-site stores) ──
    if (useRestApi) {
      const siteId = process.env.ALLOC_ENGINE_SITE_ID;

      if (action === 'list') {
        const blobs = await restListBlobs(siteId, storeName, token, params.prefix || '');
        const keys = blobs.map((b) => b.key);
        return jsonResponse(200, { store: storeName, count: keys.length, keys });
      }

      if (action === 'get') {
        const key = params.key;
        if (!key) return jsonResponse(400, { error: 'Missing "key" query parameter' });
        const value = await restGetBlob(siteId, storeName, key, token);
        if (value === null) return jsonResponse(404, { error: 'Key not found', store: storeName, key });
        return jsonResponse(200, { store: storeName, key, value });
      }
    }

    // ── SDK path (local stores on this site) ──
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({
      name: storeName,
      siteID: params.siteId || process.env.NETLIFY_SITE_ID,
      token,
    });

    if (action === 'list') {
      const prefix = params.prefix || '';
      const { blobs } = await store.list({ prefix });
      const keys = blobs.map((b) => b.key);
      return jsonResponse(200, { store: storeName, count: keys.length, keys });
    }

    if (action === 'get') {
      const key = params.key;
      if (!key) return jsonResponse(400, { error: 'Missing "key" query parameter' });

      const value = await store.get(key, { type: 'json' });
      if (value === null) return jsonResponse(404, { error: 'Key not found', store: storeName, key });
      return jsonResponse(200, { store: storeName, key, value });
    }

    return jsonResponse(400, { error: 'Unknown action. Use "list", "get", "list-symbols", "list-dates", or "market-data".' });
  } catch (error) {
    console.error('[VEND_BLOBS] Error:', error.message);
    return jsonResponse(500, { error: error.message });
  }
};
