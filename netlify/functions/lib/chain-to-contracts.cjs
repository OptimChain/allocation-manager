'use strict';

/** Map options-chain blob snapshots → MarketDepth contract cards. */

function parseOcc(sym) {
  const m = sym.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, underlying, dateStr, cp, strikeStr] = m;
  const y = 2000 + parseInt(dateStr.slice(0, 2), 10);
  const mo = dateStr.slice(2, 4);
  const d = dateStr.slice(4, 6);
  return {
    underlying,
    expiration: `${y}-${mo}-${d}`,
    optionType: cp === 'C' ? 'call' : 'put',
    strike: parseInt(strikeStr, 10) / 1000,
  };
}

function daysToExpiry(expiration) {
  const exp = new Date(`${expiration}T21:00:00Z`);
  const now = new Date();
  return Math.max(0, Math.ceil((exp - now) / 86400000));
}

function estimateSpot(latestChain) {
  let bestStrike = null;
  let bestDist = Infinity;
  for (const [sym, snap] of Object.entries(latestChain)) {
    if (sym === '_meta') continue;
    const parsed = parseOcc(sym);
    if (!parsed || parsed.optionType !== 'call') continue;
    const delta = snap?.greeks?.delta ?? snap?.greeks?.Delta;
    if (typeof delta !== 'number') continue;
    const dist = Math.abs(delta - 0.5);
    if (dist < bestDist) {
      bestDist = dist;
      bestStrike = parsed.strike;
    }
  }
  return bestStrike ?? 0;
}

function topOfBookDepth(quote, mid) {
  if (!quote) return { bids: [], asks: [] };
  const bidSize = quote.bid_size ?? quote.bidSize ?? 0;
  const askSize = quote.ask_size ?? quote.askSize ?? 0;
  const ts = quote.timestamp || new Date().toISOString();
  return {
    bids: quote.bid > 0
      ? [{ price: quote.bid, size: bidSize, exchange: 'TOB', timestamp: ts }]
      : [],
    asks: quote.ask > 0
      ? [{ price: quote.ask, size: askSize, exchange: 'TOB', timestamp: ts }]
      : [],
  };
}

function buildThetaCurve(dte, theta) {
  if (!dte || typeof theta !== 'number') return [];
  const points = [];
  for (let d = dte; d >= 0; d -= Math.max(1, Math.floor(dte / 20))) {
    points.push({ dte: d, value: Math.round(theta * 100) / 100 });
  }
  return points;
}

/** Latest expiry first, then underlying, strike, type. */
function compareContractsLatestDesc(a, b) {
  const byExpiry = b.expiration.localeCompare(a.expiration);
  if (byExpiry !== 0) return byExpiry;
  const byUnderlying = a.underlying.localeCompare(b.underlying);
  if (byUnderlying !== 0) return byUnderlying;
  if (a.strike !== b.strike) return a.strike - b.strike;
  return a.optionType.localeCompare(b.optionType);
}

function quoteTimestampMs(quote, trade) {
  const raw = quote?.timestamp ?? quote?.t ?? trade?.timestamp ?? trade?.t;
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function snapshotToContract(sym, snap, spot) {
  const parsed = parseOcc(sym);
  if (!parsed) return null;

  const quote = snap.latest_quote || snap.latestQuote;
  const trade = snap.latest_trade || snap.latestTrade;
  const greeksRaw = snap.greeks || {};
  const bid = quote?.bid ?? quote?.bp ?? 0;
  const ask = quote?.ask ?? quote?.ap ?? 0;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (trade?.price ?? trade?.p ?? 0);
  if (mid <= 0) return null;

  const iv = snap.implied_volatility ?? snap.impliedVolatility ?? greeksRaw.iv ?? 0;
  const dte = daysToExpiry(parsed.expiration);
  const theta = greeksRaw.theta ?? 0;
  const depth = topOfBookDepth(quote, mid);
  const quotedAt = quote?.timestamp ?? quote?.t ?? trade?.timestamp ?? trade?.t ?? null;

  return {
    symbol: sym,
    underlying: parsed.underlying,
    optionType: parsed.optionType,
    strike: parsed.strike,
    expiration: parsed.expiration,
    dte,
    spot: spot || estimateSpot({ [sym]: snap }),
    bid,
    ask,
    mid: Math.round(mid * 100) / 100,
    last: trade?.price ?? trade?.p ?? mid,
    volume: trade?.size ?? trade?.s ?? 0,
    openInterest: 0,
    quotedAt,
    greeks: {
      delta: greeksRaw.delta ?? 0,
      gamma: greeksRaw.gamma ?? 0,
      theta,
      vega: greeksRaw.vega ?? 0,
      rho: greeksRaw.rho ?? 0,
      iv: typeof iv === 'number' ? iv : 0,
    },
    bidDepth: depth.bids,
    askDepth: depth.asks,
    thetaDecayCurve: buildThetaCurve(dte, theta),
    _sortTs: quoteTimestampMs(quote, trade),
  };
}

function chainToContracts(chain, spotHint) {
  const spot = spotHint > 0 ? spotHint : estimateSpot(chain);
  const contracts = [];

  for (const [sym, snap] of Object.entries(chain || {})) {
    if (sym === '_meta') continue;
    const c = snapshotToContract(sym, snap, spot);
    if (c) contracts.push(c);
  }

  contracts.sort((a, b) => {
    const byExpiry = compareContractsLatestDesc(a, b);
    if (byExpiry !== 0) return byExpiry;
    return b._sortTs - a._sortTs;
  });
  return contracts.map(({ _sortTs, ...rest }) => rest);
}

module.exports = {
  chainToContracts,
  compareContractsLatestDesc,
  estimateSpot,
  parseOcc,
};
