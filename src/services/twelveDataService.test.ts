/**
 * getQuote, getBitcoinQuote and getEtfQuote all hit the same upstream `quote`
 * endpoint but return different shapes. They share one cache that is persisted
 * to localStorage, so a common `quote:<symbol>` key let whichever page loaded
 * first serve its payload to the others — the Compare page would read a
 * BitcoinQuote and find no `price` field, yielding an undefined live price.
 */

import { getQuote, getQuotes, getBitcoinQuote, getEtfQuote } from './twelveDataService';
import { clearTwelveDataCache } from './twelveDataCache';

const QUOTE_PAYLOAD = {
  symbol: 'BTC/USD',
  name: 'Bitcoin US Dollar',
  datetime: '2026-08-13',
  timestamp: 1786579200,
  open: '63479.99',
  high: '63717.31',
  low: '63460.32',
  close: '63568.59',
  volume: '1234',
  previous_close: '63479.99',
  change: '88.60000',
  percent_change: '0.13957154',
  is_market_open: true,
};

function mockFetchOnce(payload: unknown, ok = true) {
  return jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  });
}

beforeEach(() => {
  clearTwelveDataCache();
  localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('quote cache-key isolation', () => {
  it('does not serve a BitcoinQuote to getQuote', async () => {
    global.fetch = mockFetchOnce(QUOTE_PAYLOAD) as unknown as typeof fetch;

    // Dashboard page warms the cache first.
    const btc = await getBitcoinQuote();
    expect(btc.close).toBeCloseTo(63568.59);

    // Compare page then asks for the same symbol through the live-quote path.
    const quote = await getQuote('BTC/USD');

    // Before the fix this returned the BitcoinQuote, so `price` was undefined.
    expect(typeof quote.price).toBe('number');
    expect(Number.isFinite(quote.price)).toBe(true);
    expect(quote.price).toBeCloseTo(63568.59);
    expect(quote.timestamp).toBe(1786579200 * 1000);
  });

  it('does not serve a live Quote to getBitcoinQuote', async () => {
    global.fetch = mockFetchOnce(QUOTE_PAYLOAD) as unknown as typeof fetch;

    await getQuote('BTC/USD');
    const btc = await getBitcoinQuote();

    // The reverse direction: BitcoinQuote fields must survive intact.
    expect(Number.isFinite(btc.open)).toBe(true);
    expect(Number.isFinite(btc.high)).toBe(true);
    expect(Number.isFinite(btc.previous_close)).toBe(true);
    expect(btc.close).toBeCloseTo(63568.59);
  });

  it('does not serve an EtfQuote to getQuote for the same ticker', async () => {
    global.fetch = mockFetchOnce({ ...QUOTE_PAYLOAD, symbol: 'BTC' }) as unknown as typeof fetch;

    // 'BTC' is both the Grayscale mini ETF (getEtfQuote) and a Compare asset.
    const etf = await getEtfQuote('BTC');
    expect(Number.isFinite(etf.previous_close)).toBe(true);

    const quote = await getQuote('BTC');
    expect(Number.isFinite(quote.price)).toBe(true);
  });

  it('keeps the namespaces separate in localStorage', async () => {
    global.fetch = mockFetchOnce(QUOTE_PAYLOAD) as unknown as typeof fetch;

    await getBitcoinQuote();
    await getQuote('BTC/USD');

    const keys = Object.keys(localStorage).filter((k) => k.includes('BTC/USD'));
    expect(keys).toContain('td-cache:quote:btc:BTC/USD');
    expect(keys).toContain('td-cache:quote:live:BTC/USD');
  });
});

describe('getQuotes', () => {
  it('drops symbols whose payload has no usable price', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      const bad = String(url).includes('BROKEN');
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => (bad ? { ...QUOTE_PAYLOAD, close: 'n/a' } : QUOTE_PAYLOAD),
      });
    }) as unknown as typeof fetch;

    const quotes = await getQuotes(['BTC/USD', 'BROKEN']);

    // A NaN price would flow into return maths and Date construction downstream.
    expect(Object.keys(quotes)).toEqual(['BTC/USD']);
    expect(quotes['BROKEN']).toBeUndefined();
  });

  it('tolerates a per-symbol request failure', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('FAILS')) return Promise.reject(new Error('429'));
      return Promise.resolve({ ok: true, status: 200, json: async () => QUOTE_PAYLOAD });
    }) as unknown as typeof fetch;

    const quotes = await getQuotes(['BTC/USD', 'FAILS']);

    expect(Object.keys(quotes)).toEqual(['BTC/USD']);
  });
});
