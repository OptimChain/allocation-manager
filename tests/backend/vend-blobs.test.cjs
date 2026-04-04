const { handler } = require('../../netlify/functions/vend-blobs.cjs');

// ── Mock fetch globally ────────────────────────────────────
const mockResponses = new Map();

function mockFetch(url, opts) {
  for (const [pattern, respFn] of mockResponses) {
    if (url.includes(pattern)) return respFn(url, opts);
  }
  return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('not mocked') });
}

global.fetch = jest.fn(mockFetch);

// ── Env setup ──────────────────────────────────────────────
beforeAll(() => {
  process.env.NETLIFY_AUTH_TOKEN = 'test-token';
  process.env.ALLOC_ENGINE_SITE_ID = 'test-site-id';
});

function makeEvent(params) {
  return { httpMethod: 'GET', queryStringParameters: params };
}

function jsonOk(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// ── Sample blob data (snake_case, as Python writes it) ─────
const rawOptionsBlob = {
  timestamp: '2026-03-20T23:20:00',
  underlying: 'CRWD',
  blob_key: 'CRWD/2026-03-20T23-20-00',
  latest_chain: {
    'CRWD260320C00100000': {
      symbol: 'CRWD260320C00100000',
      latest_quote: { bid: 5.0, ask: 5.5, bid_size: 10, ask_size: 20, timestamp: '2026-03-20T23:20:00' },
      greeks: { delta: 0.65, gamma: 0.02, theta: -0.05, vega: 0.15 },
      implied_volatility: 0.35,
    },
  },
  latest_bars: {
    'CRWD260320C00100000': [
      { timestamp: '2026-03-20T23:00:00', open: 5.0, high: 5.5, low: 4.8, close: 5.2, volume: 100, trade_count: 10, vwap: 5.1 },
    ],
  },
  history_count: 3,
  history: [
    { timestamp: '2026-03-20T20:00:00', underlying: 'CRWD', num_contracts: 1, snapshots: [] },
  ],
};

const rawQuotesBlob = {
  timestamp: '2026-03-20T23:20:00',
  blob_key: '2026-03-20T23-20-00',
  latest_quotes: {
    'BTC/USD': {
      bid: 66800, ask: 66900, mid: 66850, spread: 100, spread_bps: 15,
      bid_size: 5, ask_size: 3, bid_exchange: 'CBSE', ask_exchange: 'KRKN',
      timestamp: '2026-03-20T23:20:00', source: 'polygon', symbol: 'BTC/USD', asset_class: 'crypto',
    },
  },
  history_count: 2,
  history: [
    { timestamp: '2026-03-20T20:00:00', quotes: [{ bid: 66700, ask: 66800, mid: 66750, spread: 100, spread_bps: 15, timestamp: '2026-03-20T20:00:00', source: 'polygon', symbol: 'BTC/USD', asset_class: 'crypto' }] },
  ],
};

// ── Tests ──────────────────────────────────────────────────

describe('vend-blobs: list-symbols', () => {
  it('extracts unique symbol prefixes from blob keys', async () => {
    mockResponses.set('/blobs/test-site-id/options-chain', () =>
      jsonOk({ blobs: [{ key: 'CRWD/2026-03-20T23-20-00' }, { key: 'CRWD/2026-03-21T15-00-00' }, { key: 'IWN/2026-03-20T23-20-00' }] })
    );

    const res = await handler(makeEvent({ store: 'options-chain', action: 'list-symbols' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.symbols).toEqual(['CRWD', 'IWN']);
  });
});

describe('vend-blobs: list-dates', () => {
  it('extracts unique dates sorted newest-first', async () => {
    mockResponses.set('/blobs/test-site-id/options-chain', () =>
      jsonOk({ blobs: [{ key: 'CRWD/2026-03-19T15-00-00' }, { key: 'CRWD/2026-03-20T23-20-00' }, { key: 'CRWD/2026-03-20T15-00-00' }] })
    );

    const res = await handler(makeEvent({ store: 'options-chain', action: 'list-dates', symbol: 'CRWD' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.dates).toEqual(['2026-03-20', '2026-03-19']);
  });

  it('returns 400 without symbol param', async () => {
    const res = await handler(makeEvent({ store: 'options-chain', action: 'list-dates' }));
    expect(res.statusCode).toBe(400);
  });
});

describe('vend-blobs: market-data', () => {
  beforeEach(() => {
    mockResponses.clear();
    // List URLs end with the store name (no key path segments after it)
    // Get URLs have the key appended as additional path segments
    mockResponses.set('/options-chain', (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/options-chain')) {
        return jsonOk({ blobs: [{ key: 'CRWD/2026-03-20T23-20-00' }] });
      }
      return jsonOk(rawOptionsBlob);
    });
    mockResponses.set('/market-quotes', (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/market-quotes')) {
        return jsonOk({ blobs: [{ key: '2026-03-20T23-20-00' }] });
      }
      return jsonOk(rawQuotesBlob);
    });
  });

  it('returns camelCase options and quotes for latest', async () => {
    const res = await handler(makeEvent({ action: 'market-data', symbol: 'CRWD' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);

    // Options: camelCase fields
    expect(body.options).toBeTruthy();
    expect(body.options.latestChain).toBeDefined();
    expect(body.options.latestBars).toBeDefined();
    expect(body.options.historyCount).toBe(3);
    expect(body.options.blobKey).toBe('CRWD/2026-03-20T23-20-00');
    expect(body.options.underlying).toBe('CRWD');

    // No snake_case leakage
    expect(body.options.latest_chain).toBeUndefined();
    expect(body.options.latest_bars).toBeUndefined();
    expect(body.options.history_count).toBeUndefined();
    expect(body.options.blob_key).toBeUndefined();

    // Snapshot camelCase
    const snap = body.options.latestChain['CRWD260320C00100000'];
    expect(snap.latestQuote.bidSize).toBe(10);
    expect(snap.latestQuote.askSize).toBe(20);
    expect(snap.impliedVolatility).toBe(0.35);
    expect(snap.greeks.delta).toBe(0.65);

    // Bars camelCase
    const bar = body.options.latestBars['CRWD260320C00100000'][0];
    expect(bar.tradeCount).toBe(10);
    expect(bar.trade_count).toBeUndefined();

    // Quotes: camelCase fields
    expect(body.quotes).toBeTruthy();
    expect(body.quotes.latestQuotes).toBeDefined();
    expect(body.quotes.historyCount).toBe(2);
    expect(body.quotes.latest_quotes).toBeUndefined();

    const quote = body.quotes.latestQuotes['BTC/USD'];
    expect(quote.spreadBps).toBe(15);
    expect(quote.bidSize).toBe(5);
    expect(quote.assetClass).toBe('crypto');
    expect(quote.spread_bps).toBeUndefined();
  });

  it('returns 400 without symbol param', async () => {
    const res = await handler(makeEvent({ action: 'market-data' }));
    expect(res.statusCode).toBe(400);
  });
});

describe('vend-blobs: fallback on empty blobs', () => {
  it('falls back to older key when latest returns empty object', async () => {
    let getCalls = 0;
    mockResponses.clear();
    mockResponses.set('/options-chain', (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/options-chain')) {
        return jsonOk({ blobs: [{ key: 'CRWD/2026-03-19T23-00-00' }, { key: 'CRWD/2026-03-20T23-20-00' }] });
      }
      getCalls++;
      if (url.includes('2026-03-20')) return jsonOk({});
      return jsonOk(rawOptionsBlob);
    });
    mockResponses.set('/market-quotes', (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/market-quotes')) return jsonOk({ blobs: [{ key: '2026-03-20T23-20-00' }] });
      return jsonOk(rawQuotesBlob);
    });

    const res = await handler(makeEvent({ action: 'market-data', symbol: 'CRWD' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.options).toBeTruthy();
    // Should have fallen back to the older key
    expect(getCalls).toBeGreaterThan(1);
  });
});

describe('vend-blobs: backward compat', () => {
  it('list action still returns raw keys', async () => {
    mockResponses.clear();
    mockResponses.set('/blobs/test-site-id/options-chain', () =>
      jsonOk({ blobs: [{ key: 'CRWD/2026-03-20T23-20-00' }] })
    );

    const res = await handler(makeEvent({ store: 'options-chain', action: 'list', prefix: 'CRWD/' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.keys).toEqual(['CRWD/2026-03-20T23-20-00']);
  });

  it('get action still returns raw snake_case value', async () => {
    mockResponses.clear();
    mockResponses.set('/blobs/test-site-id/options-chain', () => jsonOk(rawOptionsBlob));

    const res = await handler(makeEvent({ store: 'options-chain', action: 'get', key: 'CRWD/2026-03-20T23-20-00' }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    // Raw value — still has snake_case
    expect(body.value.latest_chain).toBeDefined();
    expect(body.value.blob_key).toBeDefined();
  });
});
