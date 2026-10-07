import { render } from '@testing-library/react';
import { AvgCost, TotalGain } from './TradePage';
import type { SnapshotPosition } from '../services/robinhoodService';

const pos = (over: Partial<SnapshotPosition>): SnapshotPosition => ({
  symbol: 'AMZN', quantity: 23, avg_buy_price: 0, current_price: 272.22,
  equity: 6261.06, profit_loss: 6261.06, profit_loss_pct: 0, ...over,
});

describe('positions with no cost basis', () => {
  test('zero avg cost renders "—" for cost and gain, not $0 / full value', () => {
    const { container } = render(<><AvgCost pos={pos({})} /><TotalGain pos={pos({})} /></>);
    expect(container.textContent).toBe('——');
  });

  test('known avg cost renders cost and gain', () => {
    const p = pos({ symbol: 'V', avg_buy_price: 346.87, profit_loss: 46.54, profit_loss_pct: 0.72 });
    const { container } = render(<><AvgCost pos={p} /><TotalGain pos={p} /></>);
    expect(container.textContent).toContain('$346.87');
    expect(container.textContent).toContain('$46.54');
    expect(container.textContent).toContain('0.72%');
  });
});
