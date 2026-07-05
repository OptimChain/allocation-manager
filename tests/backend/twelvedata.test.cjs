// Tests for the TwelveData proxy (shared Postgres cache, key server-side).

const t = require('../../netlify/functions/lib/tradingDb.cjs');
const td = require('../../netlify/functions/twelvedata.cjs');

function makeEvent({ endpoint = 'quote', params = {}, method = 'GET' } = {}) {
  return {
    httpMethod: method,
    path: `/.netlify/functions/twelvedata/${endpoint}`,
    queryStringParameters: params,
    headers: {},
  };
}

function parse(res) { return JSON.parse(res.body); }

const QUOTE_PAYLOAD = { symbol: 'SPY', close: '600.10', name: 'SPDR S&P 500' };

let fetchMock;

beforeEach(() => {
  t.__resetForTests();
  t.__setTestClient(t.createMemoryClient());
  process.env.TWELVE_DATA_API_KEY = 'server-key';
  fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(QUOTE_PAYLOAD),
  });
});

afterEach(() => {
  fetchMock.mockRestore();
  delete process.env.TWELVE_DATA_API_KEY;
  delete process.env.VITE_TWELVE_DATA_API_KEY;
});

afterAll(() => t.__resetForTests());

describe('twelvedata proxy', () => {
  test('rejects endpoints outside the whitelist', async () => {
    const res = await td.handler(makeEvent({ endpoint: 'earnings' }));
    expect(res.statusCode).toBe(400);
    expect(parse(res).message).toContain('Unknown endpoint');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('503 when no API key is configured server-side', async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    const res = await td.handler(makeEvent());
    expect(res.statusCode).toBe(503);
  });

  test('miss fetches upstream with the SERVER key, then serves from cache', async () => {
    const first = await td.handler(makeEvent({ params: { symbol: 'SPY', apikey: 'client-smuggled-key' } }));
    expect(first.statusCode).toBe(200);
    expect(first.headers['X-Cache']).toBe('miss');
    expect(parse(first)).toEqual(QUOTE_PAYLOAD);

    // Upstream called once, with the server key — never the client-provided one
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstreamUrl = fetchMock.mock.calls[0][0];
    expect(upstreamUrl).toContain('apikey=server-key');
    expect(upstreamUrl).not.toContain('client-smuggled-key');

    const second = await td.handler(makeEvent({ params: { symbol: 'SPY' } }));
    expect(second.headers['X-Cache']).toBe('hit');
    expect(parse(second)).toEqual(QUOTE_PAYLOAD);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second upstream call
  });

  test('different params are cached independently', async () => {
    await td.handler(makeEvent({ params: { symbol: 'SPY' } }));
    await td.handler(makeEvent({ params: { symbol: 'QQQ' } }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('cache expires after the TTL and refetches', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    nowSpy.mockReturnValue(t0);
    await td.handler(makeEvent({ params: { symbol: 'SPY' } }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(t0 + 30_000); // quote TTL is 60s → still fresh
    expect((await td.handler(makeEvent({ params: { symbol: 'SPY' } }))).headers['X-Cache']).toBe('hit');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(t0 + 61_000); // expired → refetch
    expect((await td.handler(makeEvent({ params: { symbol: 'SPY' } }))).headers['X-Cache']).toBe('miss');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  test('serves stale payload when upstream rate-limits', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    nowSpy.mockReturnValue(t0);
    await td.handler(makeEvent({ params: { symbol: 'SPY' } })); // primes cache

    nowSpy.mockReturnValue(t0 + 120_000); // expired
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 429, message: 'rate limited', status: 'error' }),
    });
    const res = await td.handler(makeEvent({ params: { symbol: 'SPY' } }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Cache']).toBe('stale');
    expect(parse(res)).toEqual(QUOTE_PAYLOAD); // last good data, not the 429
    nowSpy.mockRestore();
  });

  test('passes the upstream error through when there is no cache to fall back on', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 429, message: 'rate limited', status: 'error' }),
    });
    const res = await td.handler(makeEvent({ params: { symbol: 'NEW' } }));
    expect(res.statusCode).toBe(502);
    expect(parse(res).code).toBe(429);
  });

  test('refresh=1 within the floor still serves cache (hammer guard)', async () => {
    await td.handler(makeEvent({ params: { symbol: 'SPY' } }));
    const res = await td.handler(makeEvent({ params: { symbol: 'SPY', refresh: '1' } }));
    expect(res.headers['X-Cache']).toBe('hit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('time_series TTL is interval-aware (1day cached longer than quote)', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    nowSpy.mockReturnValue(t0);
    await td.handler(makeEvent({ endpoint: 'time_series', params: { symbol: 'SPY', interval: '1day' } }));

    nowSpy.mockReturnValue(t0 + 20 * 60_000); // 20min — beyond quote TTL, within 1day TTL (30min)
    const res = await td.handler(makeEvent({ endpoint: 'time_series', params: { symbol: 'SPY', interval: '1day' } }));
    expect(res.headers['X-Cache']).toBe('hit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  test('works without a database (degrades to pass-through, no crash)', async () => {
    t.__resetForTests(); // no db at all
    process.env.TWELVE_DATA_API_KEY = 'server-key';
    const res = await td.handler(makeEvent({ params: { symbol: 'SPY' } }));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual(QUOTE_PAYLOAD);
  });
});
