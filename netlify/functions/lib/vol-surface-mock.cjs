'use strict';

/**
 * Parametric IV surfaces and demo contracts for Market Depth.
 * Used when VOL_SURFACE_SOURCE=mock or as the final fallback in auto mode.
 */

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
    const dailyTheta = d > 0
      ? -(currentMid * (1 - Math.sqrt((d - 1) / dte))) + (currentMid * (1 - Math.sqrt(d / dte)))
      : -currentMid * 0.05;
    points.push({ dte: d, value: Math.round(dailyTheta * 100) / 100 });
  }
  return points;
}

const SURFACE_PARAMS = [
  { underlying: 'IWN', spot: 200.85, atmIv: 0.205, skew: -0.35, smile: 0.45, termSlope: 0.02 },
  { underlying: 'CRWD', spot: 340.0, atmIv: 0.380, skew: -0.30, smile: 0.55, termSlope: -0.04 },
  { underlying: 'NBIS', spot: 148.30, atmIv: 0.700, skew: -0.22, smile: 0.85, termSlope: -0.10 },
  { underlying: 'AVGO', spot: 165.0, atmIv: 0.320, skew: -0.25, smile: 0.50, termSlope: -0.03 },
  { underlying: 'SPY', spot: 580.0, atmIv: 0.160, skew: -0.40, smile: 0.58, termSlope: 0.01 },
  { underlying: 'MU', spot: 95.0, atmIv: 0.420, skew: -0.28, smile: 0.60, termSlope: -0.05 },
];

const SURFACE_DTES = [7, 14, 30, 60, 90, 135, 180];
const SURFACE_MONEYNESS = [0.80, 0.875, 0.95, 1.0, 1.05, 1.125, 1.20, 1.30];
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
  const skewScale = clamp(Math.sqrt(30 / dte), 0.8, 1.5);
  const smileScale = clamp(30 / dte, 0.6, 2.5);
  const atm = params.atmIv + params.termSlope * (Math.sqrt(dte / 365) - Math.sqrt(30 / 365));
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
      source: 'mock',
    };
  });
}

function getContracts() {
  const crwd350 = {
    symbol: 'CRWD260515C00350000',
    underlying: 'CRWD',
    optionType: 'call',
    strike: 350,
    expiration: '2026-05-15',
    dte: 30,
    spot: 340.0,
    bid: 18.5,
    ask: 19.2,
    mid: 18.85,
    last: 18.80,
    volume: 2100,
    openInterest: 8200,
    greeks: { delta: 0.42, gamma: 0.008, theta: -0.18, vega: 0.52, rho: 0.04, iv: 0.385 },
    thetaDecayCurve: buildThetaCurve(30, 18.85),
  };
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
    greeks: { delta: -0.155, gamma: 0.0125, theta: -0.032, vega: 0.115, rho: -0.025, iv: 0.215 },
    thetaDecayCurve: buildThetaCurve(30, 1.25),
  };
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
    greeks: { delta: 0.237, gamma: 0.0105, theta: -0.155, vega: 0.131, rho: 0.026, iv: 0.693 },
    thetaDecayCurve: buildThetaCurve(30, 3.73),
  };
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
    greeks: { delta: -0.211, gamma: 0.0103, theta: -0.172, vega: 0.108, rho: -0.022, iv: 0.753 },
    thetaDecayCurve: buildThetaCurve(23, 3.66),
  };

  const pairs = [
    [crwd350, 18.85, 0.04],
    [iwn185, 1.25, 0.11],
    [nbis175, 3.73, 0.08],
    [nbis130, 3.66, 0.10],
  ];

  return pairs.map(([c, mid, spread]) => {
    const depth = buildDepth(mid, spread, 6);
    return { ...c, bidDepth: depth.bids, askDepth: depth.asks };
  });
}

function buildMockPayload() {
  return {
    timestamp: new Date().toISOString(),
    contracts: getContracts(),
    volSurfaces: buildVolSurfaces(),
    meta: {
      volSurfaceSource: 'mock',
      perSymbol: Object.fromEntries(
        SURFACE_PARAMS.map((p) => [p.underlying, { source: 'mock' }]),
      ),
    },
  };
}

module.exports = {
  SURFACE_PARAMS,
  SURFACE_DTES,
  buildVolSurfaces,
  getContracts,
  buildMockPayload,
  surfaceIv,
};
