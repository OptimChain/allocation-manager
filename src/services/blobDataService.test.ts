import { listOptionSymbols, listDates, getMarketData } from './blobDataService';
import type { OptionsChainBlob, MarketQuotesBlob } from './blobDataService';

// ── Mock fetch ─────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function errorResponse(status: number, message: string) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ error: message }),
    text: () => Promise.resolve(message),
  });
}

beforeEach(() => mockFetch.mockReset());

// ── listOptionSymbols ──────────────────────────────────────

describe('listOptionSymbols', () => {
  it('returns symbols from vend-blobs list-symbols action', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ symbols: ['CRWD', 'IWN'] }));

    const result = await listOptionSymbols();

    expect(result).toEqual(['CRWD', 'IWN']);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('action=list-symbols');
    expect(url).toContain('store=options-chain');
  });
});

// ── listDates ──────────────────────────────────────────────

describe('listDates', () => {
  it('returns dates from vend-blobs list-dates action', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ dates: ['2026-03-20', '2026-03-19'] }));

    const result = await listDates('CRWD');

    expect(result).toEqual(['2026-03-20', '2026-03-19']);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('action=list-dates');
    expect(url).toContain('symbol=CRWD');
  });
});

// ── getMarketData ──────────────────────────────────────────

const mockOptions: OptionsChainBlob = {
  timestamp: '2026-03-20T23:20:00',
  underlying: 'CRWD',
  blobKey: 'CRWD/2026-03-20T23-20-00',
  latestChain: {
    'CRWD260320C00100000': {
      symbol: 'CRWD260320C00100000',
      latestQuote: { bid: 5.0, ask: 5.5, bidSize: 10, askSize: 20, timestamp: '2026-03-20T23:20:00' },
      greeks: { delta: 0.65, gamma: 0.02, theta: -0.05, vega: 0.15 },
      impliedVolatility: 0.35,
    },
  },
  latestBars: {},
  historyCount: 3,
  history: [],
};

const mockQuotes: MarketQuotesBlob = {
  timestamp: '2026-03-20T23:20:00',
  blobKey: '2026-03-20T23-20-00',
  latestQuotes: {
    'BTC/USD': {
      bid: 66800, ask: 66900, mid: 66850, spread: 100, spreadBps: 15,
      bidSize: 5, askSize: 3, timestamp: '2026-03-20T23:20:00',
      source: 'polygon', symbol: 'BTC/USD', assetClass: 'crypto',
    },
  },
  historyCount: 2,
  history: [],
};

describe('getMarketData', () => {
  it('fetches latest when no date provided', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ options: mockOptions, quotes: mockQuotes }));

    const result = await getMarketData('CRWD');

    expect(result.options).toBeTruthy();
    expect(result.quotes).toBeTruthy();
    expect(result.options!.underlying).toBe('CRWD');
    expect(result.quotes!.latestQuotes['BTC/USD'].mid).toBe(66850);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('action=market-data');
    expect(url).toContain('symbol=CRWD');
    expect(url).not.toContain('date=');
  });

  it('passes date param when provided', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ options: mockOptions, quotes: mockQuotes }));

    await getMarketData('CRWD', '2026-03-20');

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('date=2026-03-20');
  });

  it('returns nulls when server returns nulls', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ options: null, quotes: null }));

    const result = await getMarketData('CRWD');

    expect(result.options).toBeNull();
    expect(result.quotes).toBeNull();
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockReturnValueOnce(errorResponse(500, 'Internal Server Error'));

    await expect(getMarketData('CRWD')).rejects.toThrow('vend-blobs failed (500)');
  });
});
