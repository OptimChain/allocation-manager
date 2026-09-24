// http.cjs
// Shared HTTP helpers for Netlify functions: CORS headers, JSON responses,
// and a timeout-bounded fetch (Netlify sync functions die at 10s — an
// unbounded upstream call must not eat the whole budget).

'use strict';

const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

/**
 * fetch() with a hard deadline. Combines with a caller-supplied `signal`.
 * On timeout throws an Error naming the host and budget.
 */
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const timeout = AbortSignal.timeout(ms);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...opts, signal });
  } catch (err) {
    if (timeout.aborted) {
      let host = String(url);
      try { host = new URL(String(url)).host; } catch { /* keep raw */ }
      throw new Error(`${host} timed out after ${ms}ms`, { cause: err });
    }
    throw err;
  }
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Write-guard: when TRADING_DB_TOKEN is set, mutating requests must carry
 * `Authorization: Bearer <token>` or `X-Api-Key: <token>`. Reads stay open.
 * Returns an error message string when denied, null when allowed.
 */
function checkWriteAuth(event) {
  const token = process.env.TRADING_DB_TOKEN;
  if (!token) return null;
  const headers = event.headers || {};
  const auth   = headers.authorization || headers.Authorization || '';
  const apiKey = headers['x-api-key'] || headers['X-Api-Key'] || '';
  if (safeEqual(auth, `Bearer ${token}`) || safeEqual(apiKey, token)) return null;
  return 'Missing or invalid credentials — set Authorization: Bearer <TRADING_DB_TOKEN>';
}

module.exports = { CORS, json, fetchWithTimeout, checkWriteAuth };
