'use strict';

/**
 * Vol-surface runtime config. Flip VOL_SURFACE_SOURCE on Netlify to go live.
 *
 *   mock   — parametric surfaces (default, safe for dev)
 *   blob   — options-chain Netlify Blobs (allocation-engine cron dumps)
 *   alpaca — Alpaca Data API snapshots (needs ALPACA_API_KEY + ALPACA_SECRET_KEY)
 *   auto   — blob → alpaca → mock fallback per symbol
 */

const VALID_SOURCES = new Set(['mock', 'blob', 'alpaca', 'auto']);

const DEFAULT_SYMBOLS = ['SNDK', 'IWN', 'NBIS'];

/** Blob store symbol may differ from display ticker (e.g. IWN chain stored as IWN). */
const BLOB_SYMBOL_MAP = {
  IWN: 'IWN',
  SNDK: 'SNDK',
  NBIS: 'NBIS',
  CRWD: 'CRWD',
};

function parseSource(raw) {
  const v = (raw || 'mock').toLowerCase().trim();
  return VALID_SOURCES.has(v) ? v : 'mock';
}

function parseSymbols(raw) {
  if (!raw || !raw.trim()) return DEFAULT_SYMBOLS;
  return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function getConfig() {
  return {
    source: parseSource(process.env.VOL_SURFACE_SOURCE),
    symbols: parseSymbols(process.env.VOL_SURFACE_SYMBOLS),
    minDtes: parseInt(process.env.VOL_SURFACE_MIN_DTES || '2', 10),
    minStrikes: parseInt(process.env.VOL_SURFACE_MIN_STRIKES || '3', 10),
    blobSymbol: (ticker) => BLOB_SYMBOL_MAP[ticker] || ticker,
  };
}

module.exports = {
  VALID_SOURCES,
  DEFAULT_SYMBOLS,
  BLOB_SYMBOL_MAP,
  getConfig,
  parseSource,
  parseSymbols,
};
