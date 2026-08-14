// market-depth.cjs
// Netlify function — returns options contract data and per-underlying implied
// volatility surfaces for the Market Depth page.
//
// Vol surfaces are served through lib/vol-surface-pipeline.cjs. Default source
// is parametric mock (VOL_SURFACE_SOURCE=mock). Set VOL_SURFACE_SOURCE=auto on
// Netlify to prefer live blob → Alpaca → mock fallback per symbol.

'use strict';

const {
  buildPayload,
  buildMarketDepthPayload,
} = require('./lib/vol-surface-pipeline.cjs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.buildPayload = buildPayload;
exports.buildMarketDepthPayload = buildMarketDepthPayload;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  try {
    const payload = await buildMarketDepthPayload();
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
  } catch (err) {
    console.error('market-depth error:', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Failed to build market depth' }),
    };
  }
};
