import {
  PnlCalculator,
  computeSummary,
  computeLots,
  Fill,
} from './pnlService';

const fill = (t: string, side: 'BUY' | 'SELL', qty: number, px: number): Fill => ({
  t,
  side,
  qty,
  px,
});

describe('PnlCalculator', () => {
  it('blends buys into a weighted average open price', () => {
    const c = new PnlCalculator();
    c.updateByTradefeed('BUY', 10, 100);
    c.updateByTradefeed('BUY', 20, 100);
    expect(c.netPosition).toBe(200);
    expect(c.avgOpenPrice).toBe(15);
    expect(c.realizedPnl).toBe(0);
  });

  it('realizes P&L on a partial sell without moving the average', () => {
    const c = new PnlCalculator();
    c.updateByTradefeed('BUY', 10, 100);
    c.updateByTradefeed('SELL', 12, 40);
    expect(c.realizedPnl).toBeCloseTo(80); // (12-10) * 40
    expect(c.avgOpenPrice).toBe(10);
    expect(c.netPosition).toBe(60);
  });

  it('resets the average on close-and-open and flips the position', () => {
    const c = new PnlCalculator();
    c.updateByTradefeed('BUY', 10, 100);
    c.updateByTradefeed('SELL', 12, 150);
    expect(c.realizedPnl).toBeCloseTo(200); // (12-10) * 100
    expect(c.netPosition).toBe(-50);
    expect(c.avgOpenPrice).toBe(12);
  });

  it('realizes short-side P&L when buying back below the average', () => {
    const c = new PnlCalculator();
    c.updateByTradefeed('SELL', 20, 100); // short 100 @ 20
    c.updateByTradefeed('BUY', 15, 100);
    expect(c.realizedPnl).toBeCloseTo(500); // (15-20) * 100 * (-1)
    expect(c.netPosition).toBe(0);
  });

  it('marks unrealized against the average open price', () => {
    const c = new PnlCalculator();
    c.updateByTradefeed('BUY', 10, 100);
    c.updateByMarketdata(13);
    expect(c.unrealizedPnl).toBeCloseTo(300);
    expect(c.totalPnl).toBeCloseTo(300);
  });

  it('tracks peak open cost as net investment', () => {
    const c = new PnlCalculator();
    c.updateByTradefeed('BUY', 10, 100); // cost 1000
    c.updateByTradefeed('BUY', 10, 200); // cost 3000
    c.updateByTradefeed('SELL', 10, 250); // reduce
    c.updateByTradefeed('BUY', 1, 1); // trigger max() after peak
    expect(c.netInvestment).toBe(3000);
  });
});

describe('computeSummary', () => {
  const fills: Fill[] = [
    fill('2026-01-01T00:00:00Z', 'BUY', 100, 10),
    fill('2026-01-05T00:00:00Z', 'BUY', 100, 20),
    fill('2026-01-20T00:00:00Z', 'SELL', 50, 18),
    fill('2026-02-10T00:00:00Z', 'SELL', 100, 12),
  ];

  it('computes totals and passes both cross-checks', () => {
    const s = computeSummary(fills, 14);
    expect(s.netPosition).toBeCloseTo(50);
    expect(s.avgOpenPrice).toBeCloseTo(15);
    expect(s.realizedPnl).toBeCloseTo(50 * 3 + 100 * -3); // -150
    expect(s.unrealizedPnl).toBeCloseTo(50 * (14 - 15)); // -50
    expect(s.totalPnl).toBeCloseTo(-200);
    expect(s.crossChecks.position).toBe(true);
    expect(s.crossChecks.realized).toBe(true);
    expect(s.crossChecks.closedFormRealized).toBeCloseTo(s.realizedPnl);
  });

  it('sorts fills by timestamp before replaying', () => {
    const shuffled = [fills[3], fills[0], fills[2], fills[1]];
    expect(computeSummary(shuffled, 14)).toEqual(computeSummary(fills, 14));
  });

  it('handles an empty fill stream', () => {
    const s = computeSummary([], 14);
    expect(s.fills).toBe(0);
    expect(s.netPosition).toBe(0);
    expect(s.firstFill).toBeNull();
    expect(s.crossChecks.position).toBe(true);
    expect(s.crossChecks.realized).toBe(true);
  });
});

describe('computeLots', () => {
  const fills: Fill[] = [
    fill('2026-01-01T00:00:00Z', 'BUY', 100, 10),
    fill('2026-01-05T00:00:00Z', 'BUY', 100, 20),
    fill('2026-01-20T00:00:00Z', 'SELL', 50, 18),
    fill('2026-02-10T00:00:00Z', 'SELL', 100, 12),
  ];

  it('buckets realized P&L into windows anchored at the first fill', () => {
    const lots = computeLots(fills, 14);
    expect(lots).toHaveLength(3);
    expect(lots[0].fills).toBe(2); // Jan 1 + Jan 5
    expect(lots[0].realizedPnl).toBe(0);
    expect(lots[1].fills).toBe(1); // Jan 20 sell
    expect(lots[1].realizedPnl).toBeCloseTo(150);
    expect(lots[2].fills).toBe(1); // Feb 10 sell
    expect(lots[2].realizedPnl).toBeCloseTo(-300);
    expect(lots[2].endPosition).toBeCloseTo(50);
  });

  it('reconciles to the same total at every window size', () => {
    const total = computeSummary(fills, 14).realizedPnl;
    for (const days of [1, 7, 14, 30, 90]) {
      const sum = computeLots(fills, days).reduce((a, w) => a + w.realizedPnl, 0);
      expect(sum).toBeCloseTo(total);
    }
  });

  it('omits empty windows', () => {
    const lots = computeLots(fills, 7);
    expect(lots.every((w) => w.fills > 0)).toBe(true);
  });

  it('returns [] for no fills', () => {
    expect(computeLots([], 30)).toEqual([]);
  });
});
