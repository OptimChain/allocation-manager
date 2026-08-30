'use strict';

/**
 * Fetch options chain snapshots for vol-surface construction.
 * Sources: Netlify Blobs (options-chain store) and Alpaca Data API.
 */

const NETLIFY_API = 'https://api.netlify.com/api/v1';
const ALPACA_DATA_BASE = 'https://data.alpaca.markets/v1beta1';
const MAX_FALLBACK_ATTEMPTS = 5;
const { estimateSpot } = require('./chain-to-contracts.cjs');

function dateFromKey(key) {
  const tsStart = key.includes('/') ? key.lastIndexOf('/') + 1 : 0;
  return key.slice(tsStart, tsStart + 10);
}

function pickRichestKey(keys) {
  if (!keys || keys.length === 0) return null;
  if (keys.length === 1) return keys[0];
  // Keys are ISO timestamps under SYMBOL/ — last is newest.
  return keys[keys.length - 1];
}

async function restListBlobs(siteId, storeName, token, prefix) {
  const allBlobs = [];
  let cursor = null;
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
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const url = `${NETLIFY_API}/blobs/${siteId}/${storeName}/${encodedKey}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Netlify blobs get failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function fetchBlobWithFallback(keys, siteId, storeName, token) {
  if (!keys || keys.length === 0) return null;
  const richestIdx = keys.indexOf(pickRichestKey(keys));
  const startIdx = richestIdx >= 0 ? richestIdx : keys.length - 1;
  for (let i = startIdx; i >= Math.max(0, startIdx - MAX_FALLBACK_ATTEMPTS + 1); i--) {
    const value = await restGetBlob(siteId, storeName, keys[i], token);
    if (value !== null && typeof value === 'object' && Object.keys(value).length > 0) {
      return { key: keys[i], value };
    }
  }
  return null;
}

function spotFromQuotesBlob(quotesBlob, symbol) {
  if (!quotesBlob?.latest_quotes && !quotesBlob?.latestQuotes) return null;
  const latest = quotesBlob.latest_quotes || quotesBlob.latestQuotes;
  const q = latest[symbol];
  if (q?.mid > 0) return q.mid;
  if (q?.bid > 0 && q?.ask > 0) return (q.bid + q.ask) / 2;
  return null;
}

/**
 * Fetch latest options-chain blob (+ optional spot from market-quotes) for a symbol.
 */
async function fetchChainFromBlob(symbol) {
  const siteId = process.env.ALLOC_ENGINE_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteId || !token) {
    return { ok: false, reason: 'missing_blob_credentials' };
  }

  const [optionKeys, quoteKeys] = await Promise.all([
    restListBlobs(siteId, 'options-chain', token, `${symbol}/`).then((b) => b.map((x) => x.key)),
    restListBlobs(siteId, 'market-quotes', token, '').then((b) => b.map((x) => x.key)),
  ]);

  const [optionsResult, quotesResult] = await Promise.all([
    fetchBlobWithFallback(optionKeys, siteId, 'options-chain', token),
    fetchBlobWithFallback(quoteKeys, siteId, 'market-quotes', token),
  ]);

  if (!optionsResult) return { ok: false, reason: 'no_options_blob' };

  const chain = optionsResult.value.latest_chain || optionsResult.value.latestChain || {};
  const spot = spotFromQuotesBlob(quotesResult?.value, symbol)
    ?? optionsResult.value.spot
    ?? estimateSpot(chain)
    ?? null;

  return {
    ok: true,
    source: 'blob',
    symbol,
    chain,
    spot,
    timestamp: optionsResult.value.timestamp || new Date().toISOString(),
    blobKey: optionsResult.key,
  };
}

async function alpacaFetch(path) {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) throw new Error('ALPACA_API_KEY and ALPACA_SECRET_KEY must be set');

  const res = await fetch(`${ALPACA_DATA_BASE}${path}`, {
    headers: {
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/**
 * Fetch call + put snapshots and merge into one chain map keyed by OCC symbol.
 */
async function fetchChainFromAlpaca(symbol) {
  // Alpaca caps limit at 1000. OCC symbols sort date-first, so a small limit
  // exhausts itself inside the nearest expiry on dense chains (SPY: 250 ≈ one
  // expiry → surface builder fails its ≥2-expirations threshold).
  const [calls, puts] = await Promise.all([
    alpacaFetch(`/options/snapshots/${symbol}?feed=indicative&type=call&limit=1000`),
    alpacaFetch(`/options/snapshots/${symbol}?feed=indicative&type=put&limit=1000`),
  ]);

  const chain = {
    ...(calls.snapshots || {}),
    ...(puts.snapshots || {}),
  };

  if (Object.keys(chain).length === 0) {
    return { ok: false, reason: 'empty_alpaca_chain' };
  }

  let spot = null;
  try {
    const trade = await alpacaFetch(`/stocks/${symbol}/trades/latest?feed=iex`);
    spot = trade.trade?.p ?? null;
  } catch {
    // Spot is optional; builder will estimate from chain.
  }

  return {
    ok: true,
    source: 'alpaca',
    symbol,
    chain,
    spot,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  fetchChainFromBlob,
  fetchChainFromAlpaca,
  restListBlobs,
  restGetBlob,
  fetchBlobWithFallback,
};
