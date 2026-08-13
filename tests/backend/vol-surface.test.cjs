// Vol surfaces served by market-depth.
//
// The surface is parametric, not sampled from a chain, so nothing downstream
// catches a bad parametrization — a sign flip in the skew term or a runaway
// wing still renders as a perfectly smooth (and perfectly wrong) mesh. These
// tests pin the qualitative shape a real equity IV surface has: puts bid over
// calls, a smile that lifts both wings, and a term structure that flattens as
// expiries lengthen.

const { buildPayload } = require('../../netlify/functions/market-depth.cjs');

const payload = buildPayload();
const surfaces = payload.volSurfaces;
const byName = Object.fromEntries(surfaces.map(s => [s.underlying, s]));

/** IV at the grid point nearest `strike`, for the given DTE. */
function ivAt(surface, strike, dte) {
  const j = surface.dtes.indexOf(dte);
  const i = surface.strikes.reduce(
    (best, k, idx) => (Math.abs(k - strike) < Math.abs(surface.strikes[best] - strike) ? idx : best),
    0,
  );
  return surface.iv[j][i];
}

/** Index of the strike closest to spot. */
function atmIndex(surface) {
  return surface.strikes.reduce(
    (best, k, i) => (Math.abs(k - surface.spot) < Math.abs(surface.strikes[best] - surface.spot) ? i : best),
    0,
  );
}

describe('vol surface grid', () => {
  it('covers every underlying that has contracts', () => {
    const withContracts = [...new Set(payload.contracts.map(c => c.underlying))].sort();
    expect(surfaces.map(s => s.underlying).sort()).toEqual(withContracts);
  });

  it('includes NBIS', () => {
    expect(byName.NBIS).toBeDefined();
    expect(byName.NBIS.spot).toBeGreaterThan(0);
  });

  it('is fully populated and dimensioned [dte][strike]', () => {
    for (const s of surfaces) {
      expect(s.strikes.length).toBeGreaterThan(1);
      expect(s.dtes.length).toBeGreaterThan(1);
      expect(s.iv).toHaveLength(s.dtes.length);
      for (const row of s.iv) {
        expect(row).toHaveLength(s.strikes.length);
        for (const v of row) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }
      }
    }
  });

  it('has strictly ascending strikes that straddle spot', () => {
    for (const s of surfaces) {
      const sorted = [...s.strikes].sort((a, b) => a - b);
      expect(s.strikes).toEqual(sorted);
      expect(new Set(s.strikes).size).toBe(s.strikes.length);
      expect(s.strikes[0]).toBeLessThan(s.spot);
      expect(s.strikes[s.strikes.length - 1]).toBeGreaterThan(s.spot);
    }
  });

  it('has ascending expiries', () => {
    for (const s of surfaces) {
      expect(s.dtes).toEqual([...s.dtes].sort((a, b) => a - b));
    }
  });
});

describe('surface shape', () => {
  it('prices downside puts above upside calls at the same distance (skew)', () => {
    for (const s of surfaces) {
      const down = ivAt(s, s.spot * 0.85, 30);
      const up = ivAt(s, s.spot * 1.15, 30);
      expect(down).toBeGreaterThan(up);
    }
  });

  it('lifts both wings above the money (smile)', () => {
    for (const s of surfaces) {
      const atm = s.iv[s.dtes.indexOf(30)][atmIndex(s)];
      expect(s.iv[s.dtes.indexOf(30)][0]).toBeGreaterThan(atm);
      const wing = s.iv[s.dtes.indexOf(30)][s.strikes.length - 1];
      expect(wing).toBeGreaterThan(atm * 0.75);
    }
  });

  it('keeps the far call wing from collapsing toward zero vol', () => {
    // A linear skew term drags the upside wing down without bound; the
    // saturating form has to hold it near the money level instead.
    for (const s of surfaces) {
      for (const dte of s.dtes) {
        const atm = s.iv[s.dtes.indexOf(dte)][atmIndex(s)];
        const wing = s.iv[s.dtes.indexOf(dte)][s.strikes.length - 1];
        expect(wing).toBeGreaterThan(atm * 0.6);
      }
    }
  });

  it('flattens the smile as expiries lengthen', () => {
    for (const s of surfaces) {
      const spread = dte => {
        const row = s.iv[s.dtes.indexOf(dte)];
        return Math.max(...row) - Math.min(...row);
      };
      expect(spread(180)).toBeLessThan(spread(7));
    }
  });

  it('quotes NBIS well above the broad-market ETF', () => {
    const nbisAtm = byName.NBIS.iv[byName.NBIS.dtes.indexOf(30)][atmIndex(byName.NBIS)];
    const iwnAtm = byName.IWN.iv[byName.IWN.dtes.indexOf(30)][atmIndex(byName.IWN)];
    expect(nbisAtm).toBeGreaterThan(iwnAtm * 2);
  });
});

describe('contracts agree with their surface', () => {
  // Only checked near the money. Out in the wings a smooth parametric surface
  // and an individual quote legitimately diverge, and the marker the page draws
  // for a held contract sits at that contract's own IV precisely so the gap is
  // visible — a dot off the mesh means the quote is rich or cheap to the fit,
  // which is signal, not a rendering fault. (SNDK's 26%-OTM call is the case in
  // point: its 58% IV does not agree with its own $6.10 mid either.)
  const NEAR_THE_MONEY = 0.2;

  it('prices near-the-money contracts within a few vol points of the surface', () => {
    let compared = 0;
    for (const c of payload.contracts) {
      const s = byName[c.underlying];
      if (!s) continue;
      const inGrid =
        c.strike >= s.strikes[0] &&
        c.strike <= s.strikes[s.strikes.length - 1] &&
        c.dte >= s.dtes[0] &&
        c.dte <= s.dtes[s.dtes.length - 1];
      if (!inGrid) continue;
      if (Math.abs(c.strike - s.spot) / s.spot > NEAR_THE_MONEY) continue;

      const nearestDte = s.dtes.reduce((a, b) => (Math.abs(b - c.dte) < Math.abs(a - c.dte) ? b : a));
      expect(Math.abs(c.greeks.iv - ivAt(s, c.strike, nearestDte))).toBeLessThan(0.04);
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(3);
  });

  it('carries the NBIS contracts', () => {
    const nbis = payload.contracts.filter(c => c.underlying === 'NBIS');
    expect(nbis.map(c => c.symbol).sort()).toEqual([
      'NBIS260508P00130000',
      'NBIS260515C00175000',
    ]);
    for (const c of nbis) {
      expect(c.bid).toBeLessThanOrEqual(c.mid);
      expect(c.mid).toBeLessThanOrEqual(c.ask);
      expect(c.bidDepth.length).toBeGreaterThan(0);
      expect(c.askDepth.length).toBeGreaterThan(0);
      expect(c.greeks.theta).toBeLessThan(0);
      expect(Math.abs(c.greeks.delta)).toBeLessThan(1);
    }
  });

  it('signs option deltas by side', () => {
    for (const c of payload.contracts) {
      if (c.optionType === 'call') expect(c.greeks.delta).toBeGreaterThan(0);
      else expect(c.greeks.delta).toBeLessThan(0);
    }
  });
});
