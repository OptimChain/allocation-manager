// market-depth.cjs
// Netlify function — returns options contract data for the Market Depth page.
// Currently serves mock contracts (SNDK, IWN) until the blob logger
// writes real option data. When that happens, this function should
// read from the blob store instead.

'use strict';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function buildDepth(mid, spreadPct, levels) {
  const bids = [];
  const asks = [];
  const halfSpread = mid * (spreadPct / 2);
  const exchanges = ['CBOE', 'ISE', 'PHLX', 'BOX', 'MIAX', 'ARCA'];
  for (let i = 0; i < levels; i++) {
    const step = halfSpread * (1 + i * 0.4);
    bids.push({
      price: Math.round((mid - step) * 100) / 100,
      size: Math.floor(Math.random() * 80) + 5,
      exchange: exchanges[i % exchanges.length],
      timestamp: new Date().toISOString(),
    });
    asks.push({
      price: Math.round((mid + step) * 100) / 100,
      size: Math.floor(Math.random() * 80) + 5,
      exchange: exchanges[(i + 1) % exchanges.length],
      timestamp: new Date().toISOString(),
    });
  }
  return { bids, asks };
}

function buildThetaCurve(dte, currentMid) {
  const points = [];
  for (let d = dte; d >= 0; d -= Math.max(1, Math.floor(dte / 20))) {
    const frac = d / dte;
    const dailyTheta = d > 0
      ? -(currentMid * (1 - Math.sqrt((d - 1) / dte))) + (currentMid * (1 - Math.sqrt(d / dte)))
      : -currentMid * 0.05;
    points.push({ dte: d, value: Math.round(dailyTheta * 100) / 100 });
  }
  return points;
}

function getContracts() {
  // SNDK $1200 Call 5/8 — spot ~$952, ~26% OTM
  const sndk1200 = {
    symbol: 'SNDK260508C01200000',
    underlying: 'SNDK',
    optionType: 'call',
    strike: 1200,
    expiration: '2026-05-08',
    dte: 23,
    spot: 952.50,
    bid: 5.80,
    ask: 6.40,
    mid: 6.10,
    last: 6.05,
    volume: 1842,
    openInterest: 5620,
    greeks: {
      delta: 0.085, gamma: 0.0004, theta: -0.92,
      vega: 1.45, rho: 0.08, iv: 0.58,
    },
    thetaDecayCurve: buildThetaCurve(23, 6.10),
  };
  const sndk1200Depth = buildDepth(6.10, 0.10, 6);

  // IWN $185 Put 5/15 — spot ~$201, ~8% OTM
  const iwn185 = {
    symbol: 'IWN260515P00185000',
    underlying: 'IWN',
    optionType: 'put',
    strike: 185,
    expiration: '2026-05-15',
    dte: 30,
    spot: 200.85,
    bid: 1.18,
    ask: 1.32,
    mid: 1.25,
    last: 1.22,
    volume: 3210,
    openInterest: 12450,
    greeks: {
      delta: -0.155, gamma: 0.0125, theta: -0.032,
      vega: 0.115, rho: -0.025, iv: 0.215,
    },
    thetaDecayCurve: buildThetaCurve(30, 1.25),
  };
  const iwn185Depth = buildDepth(1.25, 0.11, 6);

  // SNDK $7.70 Put 4/17 — spot ~$952, deep OTM, 2 DTE
  const sndk770 = {
    symbol: 'SNDK260417P00007700',
    underlying: 'SNDK',
    optionType: 'put',
    strike: 7.70,
    expiration: '2026-04-17',
    dte: 2,
    spot: 952.50,
    bid: 0.01,
    ask: 0.03,
    mid: 0.02,
    last: 0.02,
    volume: 520,
    openInterest: 8900,
    greeks: {
      delta: -0.0001, gamma: 0.00001, theta: -0.005,
      vega: 0.0005, rho: -0.00001, iv: 2.10,
    },
    thetaDecayCurve: buildThetaCurve(2, 0.02),
  };
  const sndk770Depth = buildDepth(0.02, 0.5, 6);

  return [
    { ...sndk1200, bidDepth: sndk1200Depth.bids, askDepth: sndk1200Depth.asks },
    { ...iwn185, bidDepth: iwn185Depth.bids, askDepth: iwn185Depth.asks },
    { ...sndk770, bidDepth: sndk770Depth.bids, askDepth: sndk770Depth.asks },
  ];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  try {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        contracts: getContracts(),
      }),
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
