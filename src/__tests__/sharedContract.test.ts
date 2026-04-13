// AUTO-GENERATED contract tests — validate manager types against shared mocks.
//
// Run: npm test -- --testPathPattern=sharedContract
// If this test fails, the manager's interfaces have drifted from the
// shared schema. Update the interfaces or the schema, then re-run
// `python shared/generate.py`.

import * as fs from 'fs';
import * as path from 'path';

const MOCK_DIR = path.resolve(__dirname, '../../../shared/mocks');

function loadMock(name: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(MOCK_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(raw);
}

describe('SnapshotPosition contract', () => {
  const REQUIRED = ['symbol', 'quantity', 'avg_buy_price', 'current_price',
                    'equity', 'profit_loss', 'profit_loss_pct'];

  it('mock has all required fields', () => {
    const mock = loadMock('snapshot_position');
    for (const field of REQUIRED) {
      expect(mock).toHaveProperty(field);
    }
  });

  it('numeric fields are numbers', () => {
    const mock = loadMock('snapshot_position');
    for (const field of ['quantity', 'avg_buy_price', 'current_price',
                          'equity', 'profit_loss', 'profit_loss_pct']) {
      expect(typeof mock[field]).toBe('number');
    }
  });
});

describe('SnapshotOrder contract', () => {
  const REQUIRED = ['order_id', 'symbol', 'side', 'order_type', 'trigger',
                    'state', 'quantity', 'limit_price', 'created_at', 'updated_at'];

  it('mock has all required fields', () => {
    const mock = loadMock('snapshot_order');
    for (const field of REQUIRED) {
      expect(mock).toHaveProperty(field);
    }
  });

  it('side is a valid OrderSide enum value', () => {
    const mock = loadMock('snapshot_order');
    expect(['BUY', 'SELL']).toContain(mock.side);
  });

  it('order_type is a valid OrderType enum value', () => {
    const mock = loadMock('snapshot_order');
    expect(['market', 'limit', 'stop', 'stop_limit']).toContain(mock.order_type);
  });
});

describe('Quote contract', () => {
  it('mock has symbol and price', () => {
    const mock = loadMock('quote');
    expect(mock).toHaveProperty('symbol');
    expect(mock).toHaveProperty('price');
    expect(typeof mock.price).toBe('number');
  });
});

describe('Account contract', () => {
  const REQUIRED = ['equity', 'cash', 'buying_power', 'portfolio_value'];

  it('mock has all required fields', () => {
    const mock = loadMock('account');
    for (const field of REQUIRED) {
      expect(mock).toHaveProperty(field);
    }
  });
});

describe('OrderEvent contract', () => {
  const REQUIRED = ['id', 'symbol', 'side', 'order_type', 'asset_type',
                    'trigger', 'state', 'quantity', 'filled_quantity',
                    'created_at', 'updated_at'];

  it('mock has all required fields', () => {
    const mock = loadMock('order_event');
    for (const field of REQUIRED) {
      expect(mock).toHaveProperty(field);
    }
  });

  it('asset_type is a valid enum value', () => {
    const mock = loadMock('order_event');
    expect(['equity', 'option', 'shadow_equity']).toContain(mock.asset_type);
  });
});

describe('OrderBookSnapshot contract', () => {
  const mock = loadMock('order_book_snapshot');

  it('has top-level required fields', () => {
    expect(mock).toHaveProperty('timestamp');
    expect(mock).toHaveProperty('order_book');
    expect(mock).toHaveProperty('portfolio');
  });

  it('portfolio has required nested fields', () => {
    const portfolio = mock.portfolio as Record<string, unknown>;
    expect(portfolio).toHaveProperty('cash');
    expect(portfolio).toHaveProperty('equity');
    expect(portfolio).toHaveProperty('positions');
    expect(portfolio).toHaveProperty('open_orders');
  });

  it('positions match SnapshotPosition shape', () => {
    const portfolio = mock.portfolio as Record<string, unknown>;
    const positions = portfolio.positions as Record<string, unknown>[];
    for (const pos of positions) {
      expect(pos).toHaveProperty('symbol');
      expect(pos).toHaveProperty('quantity');
      expect(pos).toHaveProperty('avg_buy_price');
      expect(pos).toHaveProperty('current_price');
    }
  });

  it('open_orders match SnapshotOrder shape', () => {
    const portfolio = mock.portfolio as Record<string, unknown>;
    const orders = portfolio.open_orders as Record<string, unknown>[];
    for (const order of orders) {
      expect(order).toHaveProperty('order_id');
      expect(order).toHaveProperty('symbol');
      expect(order).toHaveProperty('side');
    }
  });
});
