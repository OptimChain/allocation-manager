// Build VolSurfaceData grids from chain snapshots.

const {
  parseOccSymbol,
  dteFromExpiry,
  extractQuotes,
  buildSurfaceFromQuotes,
  fillGrid,
} = require('../../netlify/functions/lib/vol-surface-builder.cjs');

describe('parseOccSymbol', () => {
  it('parses OCC format', () => {
    expect(parseOccSymbol('IWN260515P00185000')).toEqual({
      underlying: 'IWN',
      expiration: '2026-05-15',
      optionType: 'put',
      strike: 185,
    });
  });
});

describe('extractQuotes from blob chain', () => {
  const chain = {
    'IWN260515P00185000': { implied_volatility: 0.22, greeks: { delta: -0.15 } },
    'IWN260515C00205000': { implied_volatility: 0.21, greeks: { delta: 0.35 } },
    'IWN260717P00185000': { implied_volatility: 0.24, greeks: { delta: -0.18 } },
    'IWN260717C00205000': { implied_volatility: 0.23, greeks: { delta: 0.32 } },
    'IWN260717P00175000': { implied_volatility: 0.26, greeks: { delta: -0.22 } },
    'IWN260717C00195000': { implied_volatility: 0.25, greeks: { delta: 0.38 } },
  };

  it('extracts IV quotes with decimal vol', () => {
    const quotes = extractQuotes(chain, 'blob');
    expect(quotes.length).toBeGreaterThanOrEqual(4);
    expect(quotes.every((q) => q.iv > 0 && q.iv < 1)).toBe(true);
  });
});

describe('buildSurfaceFromQuotes', () => {
  const asOf = new Date('2026-04-15T16:00:00Z');

  function makeQuotes() {
    const expiries = ['2026-05-15', '2026-06-19'];
    const strikes = [175, 185, 195, 205];
    const quotes = [];
    for (const exp of expiries) {
      const dte = dteFromExpiry(exp, asOf);
      for (const strike of strikes) {
        quotes.push({
          strike,
          dte,
          iv: 0.20 + (205 - strike) * 0.002 + dte * 0.0005,
          optionType: strike < 195 ? 'put' : 'call',
        });
      }
    }
    return quotes;
  }

  it('builds a dimensioned surface grid', () => {
    const surface = buildSurfaceFromQuotes('IWN', 195, makeQuotes(), { minDtes: 2, minStrikes: 3 });
    expect(surface).not.toBeNull();
    expect(surface.underlying).toBe('IWN');
    expect(surface.strikes.length).toBeGreaterThanOrEqual(3);
    expect(surface.dtes.length).toBeGreaterThanOrEqual(2);
    expect(surface.iv).toHaveLength(surface.dtes.length);
    for (const row of surface.iv) {
      expect(row).toHaveLength(surface.strikes.length);
      for (const v of row) {
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('returns null when chain is too sparse', () => {
    expect(buildSurfaceFromQuotes('IWN', 195, [{ strike: 185, dte: 30, iv: 0.22 }], {
      minDtes: 2,
      minStrikes: 3,
    })).toBeNull();
  });

  it('prices downside above upside (skew) on synthetic chain', () => {
    const surface = buildSurfaceFromQuotes('IWN', 195, makeQuotes(), { minDtes: 2, minStrikes: 3 });
    const dteIdx = 0;
    const lowStrike = surface.strikes[0];
    const highStrike = surface.strikes[surface.strikes.length - 1];
    const lowIv = surface.iv[dteIdx][surface.strikes.indexOf(lowStrike)];
    const highIv = surface.iv[dteIdx][surface.strikes.indexOf(highStrike)];
    expect(lowIv).toBeGreaterThan(highIv);
  });
});

describe('fillGrid', () => {
  it('fills null cells from neighbors', () => {
    const filled = fillGrid([[0.2, null, 0.25], [null, 0.22, null]]);
    for (const row of filled) {
      for (const v of row) {
        expect(v).toBeGreaterThan(0);
      }
    }
    expect(filled[0][1]).toBe(0.2);
  });
});
