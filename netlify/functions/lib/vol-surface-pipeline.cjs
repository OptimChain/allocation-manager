'use strict';

const { getConfig } = require('./vol-surface-config.cjs');
const { buildMockPayload, getContracts, buildVolSurfaces } = require('./vol-surface-mock.cjs');
const { extractQuotes, buildSurfaceFromQuotes } = require('./vol-surface-builder.cjs');
const { fetchChainFromBlob, fetchChainFromAlpaca } = require('./fetch-options-chain.cjs');
const { chainToContracts } = require('./chain-to-contracts.cjs');

async function trySource(source, symbol, blobSymbol, config) {
  if (source === 'blob') {
    const result = await fetchChainFromBlob(blobSymbol);
    if (!result.ok) return null;
    const quotes = extractQuotes(result.chain, 'blob');
    const surface = buildSurfaceFromQuotes(symbol, result.spot, quotes, {
      minDtes: config.minDtes,
      minStrikes: config.minStrikes,
      source: 'blob',
    });
    if (!surface) return null;
    return {
      surface,
      chain: result.chain,
      spot: result.spot,
      chainMeta: {
        source: 'blob',
        blobKey: result.blobKey,
        timestamp: result.timestamp,
        quoteCount: quotes.length,
      },
    };
  }

  if (source === 'alpaca') {
    const result = await fetchChainFromAlpaca(symbol);
    if (!result.ok) return null;
    const quotes = extractQuotes(result.chain, 'alpaca');
    const surface = buildSurfaceFromQuotes(symbol, result.spot, quotes, {
      minDtes: config.minDtes,
      minStrikes: config.minStrikes,
      source: 'alpaca',
    });
    if (!surface) return null;
    return {
      surface,
      chain: result.chain,
      spot: result.spot,
      chainMeta: {
        source: 'alpaca',
        timestamp: result.timestamp,
        quoteCount: quotes.length,
      },
    };
  }

  return null;
}

async function resolveSurfaceForSymbol(symbol, config) {
  const blobSymbol = config.blobSymbol(symbol);
  const mockSurface = buildVolSurfaces().find((s) => s.underlying === symbol) || null;

  if (config.source === 'mock') {
    return {
      surface: mockSurface,
      chainMeta: { source: 'mock' },
      chain: null,
      spot: mockSurface?.spot ?? null,
    };
  }

  const attemptOrder = config.source === 'auto'
    ? ['blob', 'alpaca']
    : [config.source];

  for (const src of attemptOrder) {
    try {
      const live = await trySource(src, symbol, blobSymbol, config);
      if (live) return live;
    } catch (err) {
      console.warn(`vol-surface ${symbol} via ${src}:`, err.message);
    }
  }

  return {
    surface: mockSurface,
    chainMeta: { source: 'mock', fallback: true, requested: config.source },
    chain: null,
    spot: mockSurface?.spot ?? null,
  };
}

/**
 * Build the full market-depth payload, routing vol surfaces through the
 * configured source with per-symbol fallback to parametric mock.
 */
async function buildMarketDepthPayload() {
  const config = getConfig();

  if (config.source === 'mock') {
    return buildMockPayload();
  }

  const perSymbol = {};
  const surfaces = [];
  const contractBuckets = [];

  await Promise.all(config.symbols.map(async (symbol) => {
    const { surface, chainMeta, chain, spot } = await resolveSurfaceForSymbol(symbol, config);
    perSymbol[symbol] = chainMeta;
    if (surface) surfaces.push(surface);
    if (chain && Object.keys(chain).length > 0) {
      contractBuckets.push(...chainToContracts(chain, spot));
    }
  }));

  surfaces.sort((a, b) => a.underlying.localeCompare(b.underlying));

  const maxContracts = parseInt(process.env.MARKET_DEPTH_MAX_CONTRACTS || '40', 10);
  const liveContracts = contractBuckets
    .sort((a, b) => b.volume - a.volume)
    .slice(0, maxContracts);

  const liveCount = Object.values(perSymbol).filter((m) => m.source !== 'mock').length;
  const volSurfaceSource = liveCount === config.symbols.length && liveCount > 0
    ? config.source === 'auto' ? 'auto' : config.source
    : liveCount > 0
      ? 'mixed'
      : 'mock';

  return {
    timestamp: new Date().toISOString(),
    contracts: liveContracts.length > 0 ? liveContracts : getContracts(),
    volSurfaces: surfaces.length > 0 ? surfaces : buildVolSurfaces(),
    meta: {
      volSurfaceSource,
      configuredSource: config.source,
      symbols: config.symbols,
      perSymbol,
      contractSource: liveContracts.length > 0 ? 'chain' : 'mock',
      contractCount: liveContracts.length,
    },
  };
}

/** Sync mock payload — used by existing parametric shape tests. */
function buildPayload() {
  return buildMockPayload();
}

module.exports = {
  buildMarketDepthPayload,
  buildPayload,
  resolveSurfaceForSymbol,
};
