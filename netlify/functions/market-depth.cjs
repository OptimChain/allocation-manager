// market-depth.cjs
// Netlify function — returns options contract data and per-underlying implied
// volatility surfaces for the Market Depth page.
// Currently serves mock contracts (SNDK, IWN, NBIS) and parametric surfaces
// until the blob logger writes real option data. When that happens, this
// function should read chains from the blob store instead and fit the surface
// to them rather than generating it.

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

// ─── Vol surfaces ────────────────────────────────────────────────────────────
// Parametric IV surfaces (skew + smile + term structure) per underlying.
// Deterministic so the surface is stable across refreshes; replace with real
// chain data once the blob logger writes option chains.

const SURFACE_PARAMS = [
  // atmIv: 30d at-the-money vol; skew: log-moneyness tilt at the money (puts
  // rich); smile: convexity; termSlope: vol change per sqrt-year vs the 30d
  // anchor.
  { underlying: 'SNDK', spot: 952.50, atmIv: 0.520, skew: -0.28, smile: 0.65, termSlope: -0.06 },
  { underlying: 'IWN', spot: 200.85, atmIv: 0.205, skew: -0.35, smile: 0.45, termSlope: 0.02 },
  { underlying: 'NBIS', spot: 148.30, atmIv: 0.700, skew: -0.22, smile: 0.85, termSlope: -0.10 },
];

const SURFACE_DTES = [7, 14, 30, 60, 90, 135, 180];
const SURFACE_MONEYNESS = [0.80, 0.875, 0.95, 1.0, 1.05, 1.125, 1.20, 1.30];

// Log-moneyness at which the skew tilt saturates. Keeping the skew linear all
// the way out drags the far call wing toward zero vol; real surfaces flatten
// there and let the smile lift them back up.
const SKEW_WIDTH = 0.20;

function strikeIncrement(spot) {
  if (spot >= 500) return 25;
  if (spot >= 100) return 5;
  return 1;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function surfaceIv(params, strike, dte) {
  const k = Math.log(strike / params.spot);
  // Both skew and smile steepen into short expiries and flatten out in the
  // long end; convexity moves faster than tilt, so they scale differently.
  const skewScale = clamp(Math.sqrt(30 / dte), 0.8, 1.5);
  const smileScale = clamp(30 / dte, 0.6, 2.5);
  const atm = params.atmIv + params.termSlope * (Math.sqrt(dte / 365) - Math.sqrt(30 / 365));
  // tanh(k / w) * w matches `k` near the money and saturates in the wings.
  const skewTerm = params.skew * Math.tanh(k / SKEW_WIDTH) * SKEW_WIDTH * skewScale;
  const smileTerm = params.smile * k * k * smileScale;
  return Math.round(Math.max(atm + skewTerm + smileTerm, 0.05) * 10000) / 10000;
}

function buildVolSurfaces() {
  return SURFACE_PARAMS.map((params) => {
    const inc = strikeIncrement(params.spot);
    const strikes = [...new Set(
      SURFACE_MONEYNESS.map((m) => Math.round((params.spot * m) / inc) * inc),
    )].sort((a, b) => a - b);
    return {
      underlying: params.underlying,
      spot: params.spot,
      strikes,
      dtes: SURFACE_DTES,
      iv: SURFACE_DTES.map((dte) => strikes.map((strike) => surfaceIv(params, strike, dte))),
    };
  });
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

  // NBIS $175 Call 5/15 — spot ~$148, ~18% OTM, high-vol AI infra name
  const nbis175 = {
    symbol: 'NBIS260515C00175000',
    underlying: 'NBIS',
    optionType: 'call',
    strike: 175,
    expiration: '2026-05-15',
    dte: 30,
    spot: 148.30,
    bid: 3.60,
    ask: 3.85,
    mid: 3.73,
    last: 3.70,
    volume: 6480,
    openInterest: 18920,
    greeks: {
      delta: 0.237, gamma: 0.0105, theta: -0.155,
      vega: 0.131, rho: 0.026, iv: 0.693,
    },
    thetaDecayCurve: buildThetaCurve(30, 3.73),
  };
  const nbis175Depth = buildDepth(3.73, 0.08, 6);

  // NBIS $130 Put 5/8 — spot ~$148, ~12% OTM downside hedge
  const nbis130 = {
    symbol: 'NBIS260508P00130000',
    underlying: 'NBIS',
    optionType: 'put',
    strike: 130,
    expiration: '2026-05-08',
    dte: 23,
    spot: 148.30,
    bid: 3.50,
    ask: 3.85,
    mid: 3.66,
    last: 3.60,
    volume: 4120,
    openInterest: 9740,
    greeks: {
      delta: -0.211, gamma: 0.0103, theta: -0.172,
      vega: 0.108, rho: -0.022, iv: 0.753,
    },
    thetaDecayCurve: buildThetaCurve(23, 3.66),
  };
  const nbis130Depth = buildDepth(3.66, 0.10, 6);

  return [
    { ...sndk1200, bidDepth: sndk1200Depth.bids, askDepth: sndk1200Depth.asks },
    { ...iwn185, bidDepth: iwn185Depth.bids, askDepth: iwn185Depth.asks },
    { ...sndk770, bidDepth: sndk770Depth.bids, askDepth: sndk770Depth.asks },
    { ...nbis175, bidDepth: nbis175Depth.bids, askDepth: nbis175Depth.asks },
    { ...nbis130, bidDepth: nbis130Depth.bids, askDepth: nbis130Depth.asks },
  ];
}

function buildPayload() {
  return {
    timestamp: new Date().toISOString(),
    contracts: getContracts(),
    volSurfaces: buildVolSurfaces(),
  };
}

exports.buildPayload = buildPayload;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  try {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
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
