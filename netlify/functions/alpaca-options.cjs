// Alpaca Options Data Netlify Function
// Fetches options chain snapshots from Alpaca Data API

const ALPACA_DATA_BASE = 'https://data.alpaca.markets/v1beta1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body, status = 200) {
  return { statusCode: status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
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
 * Fetch all put option snapshots for a symbol.
 * Returns: { symbol, timestamp, contracts: [{ symbol, strike, expiry, iv, delta, ... }] }
 */
async function getOptionsChain(symbol, optionType = 'put') {
  const data = await alpacaFetch(
    `/options/snapshots/${symbol}?feed=indicative&type=${optionType}&limit=250`
  );

  const contracts = [];
  for (const [occSymbol, snap] of Object.entries(data.snapshots || {})) {
    // Parse OCC symbol: IWN260417P00200000
    const match = occSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
    if (!match) continue;

    const [, , dateStr, type, strikeStr] = match;
    const expiry = `20${dateStr.slice(0, 2)}-${dateStr.slice(2, 4)}-${dateStr.slice(4, 6)}`;
    const strike = parseInt(strikeStr, 10) / 1000;

    const greeks = snap.greeks || {};
    const quote = snap.latestQuote || {};
    const bid = quote.bp || 0;
    const ask = quote.ap || 0;

    contracts.push({
      symbol: occSymbol,
      underlying: symbol,
      expiry,
      strike,
      type: type === 'P' ? 'put' : 'call',
      iv: snap.impliedVolatility || null,
      delta: greeks.delta || null,
      gamma: greeks.gamma || null,
      theta: greeks.theta || null,
      vega: greeks.vega || null,
      rho: greeks.rho || null,
      bid,
      ask,
      mark: bid && ask ? (bid + ask) / 2 : null,
      volume: snap.dailyBar?.v || 0,
      quoteTimestamp: quote.t || null,
    });
  }

  // Sort by expiry then strike
  contracts.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike);

  return {
    symbol,
    timestamp: new Date().toISOString(),
    contractCount: contracts.length,
    contracts,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders };

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    switch (action) {
      case 'chain': {
        const symbol = (params.symbol || 'IWN').toUpperCase();
        const type = params.type || 'put';
        const data = await getOptionsChain(symbol, type);
        return json(data);
      }
      default:
        return json({ error: `Unknown action: ${action}. Available: chain` }, 400);
    }
  } catch (err) {
    console.error('alpaca-options error:', err);
    return json({ error: err.message }, 500);
  }
};
