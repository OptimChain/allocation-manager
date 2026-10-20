import React from 'react';
import { render, screen } from '@testing-library/react';
import EventPriceChart from './EventPriceChart';
import type { CoverageName, StopRiskEvent } from '../services/stopEventStream';

jest.mock('../services/twelveDataService', () => ({
  getIntradaySeries: () => Promise.resolve([]),
}));

jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts');
  return {
    ...Original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    ComposedChart: ({ children }: { children: React.ReactNode }) => <svg>{children}</svg>,
    Line: () => null,
    Scatter: () => null,
    ReferenceLine: ({ y, label }: { y?: number; label?: string | { value?: string } }) => (
      <g data-testid="chart-target-line" data-y={y}>
        {typeof label === 'string' ? label : label?.value}
      </g>
    ),
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
  };
});

const NAME: CoverageName = {
  symbol: 'NBIS',
  quantity: 89.126,
  covered_qty: 22,
  uncovered_qty: 67.126,
  coverage_pct: 0.25,
  trail_percent: 6,
  coded_trail_percent: 6,
  stop_price: 159.7,
  last_trail_price: 160.22,
  mark: 165.46,
  avg_entry: 177.98,
  equity: 14750,
  profit_loss: -1116,
  profit_loss_pct: -7,
  stop_id: 'stop-nbis',
  stop_type: 'market',
  stop_state: 'confirmed',
};

const EVENTS: StopRiskEvent[] = [
  {
    type: 'engine',
    id: 'fill-1',
    code: 'order_filled',
    symbol: 'NBIS',
    side: 'BUY',
    status: 'filled',
    order_type: 'limit',
    price: 165.4,
    ts: new Date().toISOString(),
    message: 'BUY 1 NBIS',
  },
];

describe('EventPriceChart target overlay', () => {
  it('chips the NBIS sit and held 220/230 calls without drawing those strikes on the 1D scale', async () => {
    const now = Date.now();
    render(
      <EventPriceChart
        events={EVENTS}
        ticks={{ NBIS: [{ symbol: 'NBIS', price: 165.46, ts: new Date(now).toISOString() }] }}
        names={[NAME]}
        designated={['NBIS']}
        focusSymbol="NBIS"
        loadBackfill={async () => [
          { timestamp: now - 60 * 60 * 1000, price: 164 },
          { timestamp: now - 30 * 60 * 1000, price: 168 },
          { timestamp: now, price: 165.46 },
        ]}
      />,
    );

    expect(await screen.findByTestId('event-price-chart')).toBeTruthy();
    const chips = screen.getAllByTestId('chart-target');
    expect(chips.map((el) => el.getAttribute('data-kind')).sort()).toEqual(
      ['breakeven', 'breakeven', 'held', 'held', 'sit', 'stop'].sort(),
    );
    expect(chips.some((el) => /sit/i.test(el.textContent || ''))).toBe(true);
    expect(chips.some((el) => /230C/.test(el.textContent || ''))).toBe(true);

    const lines = screen.getAllByTestId('chart-target-line');
    const ys = lines.map((el) => Number(el.getAttribute('data-y')));
    expect(ys).toContain(159.7);
    expect(ys.some((y) => y === 220 || y === 230)).toBe(false);
  });
});
