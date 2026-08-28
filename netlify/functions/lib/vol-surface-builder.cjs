'use strict';

/**
 * Build VolSurfaceData grids from normalized option chain quotes.
 */

function parseOccSymbol(sym) {
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

function dteFromExpiry(expiration, asOf = new Date()) {
  const exp = new Date(`${expiration}T21:00:00Z`);
  const ms = exp.getTime() - asOf.getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

/**
 * Normalize chain snapshots (blob or Alpaca) into quote rows.
 * @param {Record<string, object>} chain - latestChain map or Alpaca snapshots
 * @param {'blob'|'alpaca'} format
 */
function extractQuotes(chain, format = 'blob') {
  const quotes = [];

  if (format === 'alpaca') {
    for (const [occSymbol, snap] of Object.entries(chain || {})) {
      const parsed = parseOccSymbol(occSymbol);
      if (!parsed) continue;
      const iv = snap.impliedVolatility ?? snap.iv;
      if (iv == null || iv <= 0) continue;
      quotes.push({
        symbol: occSymbol,
        underlying: parsed.underlying,
        strike: parsed.strike,
        expiration: parsed.expiration,
        dte: dteFromExpiry(parsed.expiration),
        optionType: parsed.optionType,
        iv: iv > 3 ? iv / 100 : iv,
      });
    }
    return quotes;
  }

  for (const [key, snap] of Object.entries(chain || {})) {
    if (key === '_meta') continue;
    const parsed = parseOccSymbol(key);
    if (!parsed) continue;
    const rawIv = snap.impliedVolatility ?? snap.implied_volatility;
    if (rawIv == null || rawIv <= 0) continue;
    quotes.push({
      symbol: key,
      underlying: parsed.underlying,
      strike: parsed.strike,
      expiration: parsed.expiration,
      dte: dteFromExpiry(parsed.expiration),
      optionType: parsed.optionType,
      iv: rawIv > 3 ? rawIv / 100 : rawIv,
    });
  }

  return quotes;
}

/** Estimate spot from the strike nearest |delta| ≈ 0.5, else ATM strike. */
function estimateSpot(quotes) {
  const withDelta = quotes.filter((q) => q.delta != null && Math.abs(q.delta) > 0.01);
  if (withDelta.length > 0) {
    const atm = withDelta.reduce((best, q) =>
      (Math.abs(Math.abs(q.delta) - 0.5) < Math.abs(Math.abs(best.delta) - 0.5) ? q : best));
    return atm.strike;
  }
  if (quotes.length === 0) return null;
  const strikes = quotes.map((q) => q.strike).sort((a, b) => a - b);
  return strikes[Math.floor(strikes.length / 2)];
}

function nearestFill(row, colIdx) {
  let best = null;
  let bestDist = Infinity;
  for (let j = 0; j < row.length; j++) {
    if (row[j] == null) continue;
    const dist = Math.abs(j - colIdx);
    if (dist < bestDist) {
      bestDist = dist;
      best = row[j];
    }
  }
  return best;
}

function fillGrid(iv, minVal = 0.05) {
  const filled = iv.map((row) => [...row]);
  for (let i = 0; i < filled.length; i++) {
    for (let j = 0; j < filled[i].length; j++) {
      if (filled[i][j] != null) continue;
      const fromRow = nearestFill(filled[i], j);
      const fromCol = (() => {
        let best = null;
        let bestDist = Infinity;
        for (let k = 0; k < filled.length; k++) {
          if (filled[k][j] == null) continue;
          const dist = Math.abs(k - i);
          if (dist < bestDist) {
            bestDist = dist;
            best = filled[k][j];
          }
        }
        return best;
      })();
      filled[i][j] = fromRow ?? fromCol ?? minVal;
    }
  }
  return filled.map((row) =>
    row.map((v) => Math.round(Math.max(v, minVal) * 10000) / 10000),
  );
}

/**
 * @param {string} underlying
 * @param {number|null} spot
 * @param {Array<{strike,dte,iv,optionType}>} quotes
 * @param {{ minDtes?: number, minStrikes?: number, source?: string }} opts
 * @returns {object|null}
 */
function buildSurfaceFromQuotes(underlying, spot, quotes, opts = {}) {
  const minDtes = opts.minDtes ?? 2;
  const minStrikes = opts.minStrikes ?? 3;
  const valid = quotes.filter((q) => q.iv > 0 && q.dte >= 0);
  if (valid.length === 0) return null;

  const resolvedSpot = spot ?? estimateSpot(valid);
  if (!resolvedSpot || resolvedSpot <= 0) return null;

  const dteSet = [...new Set(valid.map((q) => q.dte))].sort((a, b) => a - b);
  const expirations = [...new Set(valid.map((q) => q.expiration).filter(Boolean))].sort();

  // When dte buckets collapse (e.g. expired chain → all dte=0), bucket by expiration.
  const useExpirationRows = dteSet.length < minDtes && expirations.length >= minDtes;
  const rows = useExpirationRows ? expirations : dteSet.map(String);
  const dtes = useExpirationRows ? expirations.map((exp) => dteFromExpiry(exp)) : dteSet;

  const strikes = [...new Set(valid.map((q) => q.strike))].sort((a, b) => a - b);
  if (rows.length < minDtes || strikes.length < minStrikes) return null;

  const byKey = new Map();
  for (const q of valid) {
    const row = useExpirationRows ? q.expiration : String(q.dte);
    const key = `${row}:${q.strike}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(q.iv);
  }

  const iv = rows.map((row) =>
    strikes.map((strike) => {
      const vals = byKey.get(`${row}:${strike}`);
      if (!vals) return null;
      return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10000) / 10000;
    }),
  );

  const filled = fillGrid(iv);

  return {
    underlying,
    spot: resolvedSpot,
    strikes,
    dtes,
    iv: filled,
    source: opts.source || 'chain',
    quoteCount: valid.length,
  };
}

module.exports = {
  parseOccSymbol,
  dteFromExpiry,
  extractQuotes,
  estimateSpot,
  buildSurfaceFromQuotes,
  fillGrid,
};
