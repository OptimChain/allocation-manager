// Integration test — fetch the latest Netlify Blob and validate against shared schema.
// Path note: __dirname = allocation-manager/src/__tests__/ → ../../.. = prod/
//
// Requires env vars:
//   NETLIFY_API_TOKEN  — Netlify personal access token
//   NETLIFY_SITE_ID    — site id for the blob store
//
// Run:
//   NETLIFY_API_TOKEN=xxx NETLIFY_SITE_ID=yyy npm test -- --testPathPattern=liveBlobContract
//   # or via Makefile:
//   make check-live

const BLOBS_URL = 'https://api.netlify.com/api/v1/blobs';
const STORE_NAME = 'order-book';
const TOKEN = process.env.NETLIFY_API_TOKEN;
const SITE_ID = process.env.NETLIFY_SITE_ID;

const hasCreds = TOKEN && SITE_ID;

async function fetchLatestBlob(): Promise<Record<string, unknown>> {
  const url = `${BLOBS_URL}/${SITE_ID}/${STORE_NAME}/latest`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!resp.ok) throw new Error(`Blob fetch failed: ${resp.status}`);
  return resp.json() as Promise<Record<string, unknown>>;
}

const describeIfCreds = hasCreds ? describe : describe.skip;

describeIfCreds('Live blob — raw shape', () => {
  let blob: Record<string, unknown>;

  beforeAll(async () => {
    blob = await fetchLatestBlob();
  });

  it('has timestamp', () => {
    expect(blob).toHaveProperty('timestamp');
    expect(typeof blob.timestamp).toBe('string');
  });

  it('has account with required fields', () => {
    const account = blob.account as Record<string, unknown>;
    for (const field of ['equity', 'cash', 'buying_power', 'portfolio_value']) {
      expect(account).toHaveProperty(field);
      expect(typeof account[field]).toBe('number');
    }
  });

  it('has positions array', () => {
    expect(Array.isArray(blob.positions)).toBe(true);
  });

  it('positions have required fields', () => {
    const positions = blob.positions as Record<string, unknown>[];
    for (const pos of positions) {
      for (const field of ['symbol', 'qty', 'side', 'market_value', 'avg_entry']) {
        expect(pos).toHaveProperty(field);
      }
    }
  });

  it('has open_orders array', () => {
    expect(Array.isArray(blob.open_orders)).toBe(true);
  });
});

describeIfCreds('Live blob — transformable to OrderBookSnapshot', () => {
  let blob: Record<string, unknown>;

  beforeAll(async () => {
    blob = await fetchLatestBlob();
  });

  it('positions transform to SnapshotPosition shape', () => {
    const positions = blob.positions as Record<string, unknown>[];
    for (const p of positions) {
      const transformed = {
        symbol: p.symbol ?? '',
        name: p.symbol ?? '',
        quantity: Number(p.qty ?? 0),
        avg_buy_price: Number(p.avg_entry ?? 0),
        current_price: Number(p.current_price ?? p.avg_entry ?? 0),
        equity: Number(p.market_value ?? 0),
        profit_loss: Number(p.unrealized_pl ?? 0),
        profit_loss_pct: Number(p.unrealized_pl_pct ?? 0),
      };
      expect(transformed.symbol).toBeTruthy();
      expect(typeof transformed.quantity).toBe('number');
      expect(typeof transformed.avg_buy_price).toBe('number');
      expect(typeof transformed.current_price).toBe('number');
    }
  });

  it('orders transform to SnapshotOrder shape', () => {
    const orders = blob.open_orders as Record<string, unknown>[];
    for (const o of orders) {
      const transformed = {
        order_id: o.id ?? '',
        symbol: o.symbol ?? '',
        side: o.side ?? '',
        order_type: o.type ?? 'market',
        trigger: 'immediate',
        state: o.status ?? o.state ?? '',
        quantity: Number(o.qty ?? 0),
        limit_price: o.limit_price ? Number(o.limit_price) : 0,
      };
      expect(typeof transformed.order_id).toBe('string');
      expect(typeof transformed.symbol).toBe('string');
    }
  });

  it('account transforms to cash info', () => {
    const account = blob.account as Record<string, unknown>;
    expect(typeof account.cash).toBe('number');
    expect(typeof account.buying_power).toBe('number');
  });
});
