import {
  overlayTargets,
  visibleOnChart,
  spreadDebit,
  HELD_DEFAULTS,
  BOUNCE_TICKETS,
  SPREAD_TICKETS,
} from './chartTargets';

describe('overlayTargets', () => {
  it('sits NBIS and overlays the six held calls as strikes plus breakevens', () => {
    const rows = overlayTargets({
      symbol: 'NBIS',
      stopPrice: 159.7,
      held: HELD_DEFAULTS,
      proposed: BOUNCE_TICKETS,
    });

    expect(rows.find((r) => r.kind === 'sit')?.label).toMatch(/sit/i);
    expect(rows.find((r) => r.kind === 'stop')?.price).toBe(159.7);

    const held = rows.filter((r) => r.kind === 'held');
    expect(held.map((r) => r.price).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([220, 230]);
    expect(held.find((r) => r.price === 230)?.label).toMatch(/230C/);
    expect(held.find((r) => r.price === 230)?.detail).toMatch(/×4/);

    const be = rows.filter((r) => r.kind === 'breakeven');
    expect(be.find((r) => r.detail?.includes('230'))?.price).toBeCloseTo(236.45, 2);
    expect(be.find((r) => r.detail?.includes('220'))?.price).toBeCloseTo(229.85, 2);

    expect(rows.some((r) => r.kind === 'proposed')).toBe(false);
  });

  it('proposes the 0.22Δ Nov 20 calls on MU / AVGO / NET and does not sit them', () => {
    const mu = overlayTargets({ symbol: 'MU', proposed: BOUNCE_TICKETS });
    expect(mu.find((r) => r.kind === 'proposed')?.price).toBe(1050);
    expect(mu.find((r) => r.kind === 'proposed')?.label).toMatch(/1050C/);
    expect(mu.some((r) => r.kind === 'sit')).toBe(false);

    expect(overlayTargets({ symbol: 'AVGO', proposed: BOUNCE_TICKETS }).find((r) => r.kind === 'proposed')?.price).toBe(380);
    expect(overlayTargets({ symbol: 'NET', proposed: BOUNCE_TICKETS }).find((r) => r.kind === 'proposed')?.price).toBe(370);
  });

  it('keeps far OTM strikes off the 1D price scale', () => {
    const rows = overlayTargets({
      symbol: 'NBIS',
      stopPrice: 159.7,
      held: HELD_DEFAULTS,
      proposed: BOUNCE_TICKETS,
    });
    const onChart = visibleOnChart(rows, { min: 162, max: 171 });
    expect(onChart.map((r) => r.kind).sort()).toEqual(['stop']);
    expect(onChart.some((r) => r.price === 220 || r.price === 230)).toBe(false);
  });

  it('prices call debit verticals bid-side from live books and skips NET (dead short)', () => {
    expect(spreadDebit(21.12, 13.25)).toBe(7.7);
    expect(spreadDebit(5.64, 2.82)).toBe(2.76);
    expect(spreadDebit(1.33, 0.97)).toBe(0.35);

    const mu = overlayTargets({ symbol: 'MU', proposed: BOUNCE_TICKETS, spreads: SPREAD_TICKETS });
    expect(mu.find((r) => r.kind === 'proposed')?.price).toBe(1050);
    const muSpread = mu.find((r) => r.kind === 'spread' && r.price === 1050);
    expect(muSpread?.label).toMatch(/1050\/1100C/);
    expect(mu.find((r) => r.kind === 'spread' && r.price === 1100)?.label).toMatch(/1100C short/);
    expect(mu.find((r) => r.kind === 'breakeven' && r.detail?.includes('1050/1100'))?.price).toBeCloseTo(1057.7, 1);

    expect(
      overlayTargets({ symbol: 'AVGO', spreads: SPREAD_TICKETS }).find((r) => r.kind === 'spread' && r.price === 380)
        ?.label,
    ).toMatch(/380\/400C/);

    const smci = overlayTargets({ symbol: 'SMCI', spreads: SPREAD_TICKETS });
    expect(smci.find((r) => r.kind === 'spread' && r.price === 38)?.label).toMatch(/38\/40C/);
    expect(smci.find((r) => r.kind === 'spread')?.detail).toMatch(/0\.35/);

    expect(overlayTargets({ symbol: 'NET', spreads: SPREAD_TICKETS }).some((r) => r.kind === 'spread')).toBe(false);
    expect(overlayTargets({ symbol: 'NBIS', spreads: SPREAD_TICKETS }).some((r) => r.kind === 'spread')).toBe(false);
  });
});
