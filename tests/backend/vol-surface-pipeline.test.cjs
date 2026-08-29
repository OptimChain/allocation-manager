// Vol-surface pipeline: source routing and fallback.

const {
  resolveSurfaceForSymbol,
  buildMarketDepthPayload,
  selectLiveContractsPerSymbol,
  mergeLiveAndMockContracts,
} = require('../../netlify/functions/lib/vol-surface-pipeline.cjs');
const { getConfig, parseSource } = require('../../netlify/functions/lib/vol-surface-config.cjs');
const { getContracts, expirationFromDte } = require('../../netlify/functions/lib/vol-surface-mock.cjs');

describe('vol-surface-config', () => {
  const orig = process.env.VOL_SURFACE_SOURCE;

  afterEach(() => {
    if (orig === undefined) delete process.env.VOL_SURFACE_SOURCE;
    else process.env.VOL_SURFACE_SOURCE = orig;
  });

  it('defaults to mock', () => {
    delete process.env.VOL_SURFACE_SOURCE;
    expect(getConfig().source).toBe('mock');
  });

  it('parses auto source', () => {
    expect(parseSource('auto')).toBe('auto');
    expect(parseSource('AUTO')).toBe('auto');
  });

  it('rejects unknown sources', () => {
    expect(parseSource('yahoo')).toBe('mock');
  });
});

describe('resolveSurfaceForSymbol', () => {
  it('returns mock surface when source is mock', async () => {
    const config = { source: 'mock', minDtes: 2, minStrikes: 3, blobSymbol: (s) => s };
    const { surface, chainMeta } = await resolveSurfaceForSymbol('IWN', config);
    expect(surface.underlying).toBe('IWN');
    expect(chainMeta.source).toBe('mock');
    expect(surface.iv.length).toBeGreaterThan(0);
  });

  it('falls back to mock when blob credentials are missing', async () => {
    const origSite = process.env.ALLOC_ENGINE_SITE_ID;
    const origToken = process.env.NETLIFY_AUTH_TOKEN;
    delete process.env.ALLOC_ENGINE_SITE_ID;
    delete process.env.NETLIFY_AUTH_TOKEN;

    const config = { source: 'auto', minDtes: 2, minStrikes: 3, blobSymbol: (s) => s };
    const { chainMeta } = await resolveSurfaceForSymbol('IWN', config);
    expect(chainMeta.source).toBe('mock');
    expect(chainMeta.fallback).toBe(true);

    if (origSite) process.env.ALLOC_ENGINE_SITE_ID = origSite;
    if (origToken) process.env.NETLIFY_AUTH_TOKEN = origToken;
  });
});

describe('buildMarketDepthPayload', () => {
  const orig = process.env.VOL_SURFACE_SOURCE;

  afterEach(() => {
    if (orig === undefined) delete process.env.VOL_SURFACE_SOURCE;
    else process.env.VOL_SURFACE_SOURCE = orig;
  });

  it('includes meta when mock', async () => {
    process.env.VOL_SURFACE_SOURCE = 'mock';
    const payload = await buildMarketDepthPayload();
    expect(payload.meta.volSurfaceSource).toBe('mock');
    expect(payload.volSurfaces.length).toBeGreaterThan(0);
    expect(payload.meta.symbols.length).toBe(6);
  });
});

describe('selectLiveContractsPerSymbol', () => {
  function stub(underlying, expiration, n) {
    return Array.from({ length: n }, (_, i) => ({
      underlying,
      expiration,
      symbol: `${underlying}${expiration.replace(/-/g, '').slice(2)}C${String(i).padStart(8, '0')}`,
      strike: 100 + i,
      optionType: 'call',
    }));
  }

  it('does not let one symbol fill the entire cap', () => {
    const buckets = [
      ...stub('IWN', '2026-04-17', 86),
      ...stub('CRWD', '2026-03-06', 100),
    ];
    const selected = selectLiveContractsPerSymbol(buckets, ['IWN', 'CRWD', 'AVGO'], 40);
    const counts = selected.reduce((acc, c) => {
      acc[c.underlying] = (acc[c.underlying] || 0) + 1;
      return acc;
    }, {});
    expect(counts.IWN).toBe(20);
    expect(counts.CRWD).toBe(20);
    expect(counts.AVGO).toBeUndefined();
  });

  it('merge prefers live CRWD over mock when selected', () => {
    const live = stub('CRWD', '2026-03-06', 5);
    const merged = mergeLiveAndMockContracts(live, ['CRWD', 'AVGO']);
    expect(merged.filter((c) => c.underlying === 'CRWD').every((c) => c.dataSource === 'live')).toBe(true);
    expect(merged.filter((c) => c.underlying === 'AVGO').every((c) => c.dataSource === 'mock')).toBe(true);
  });
});

describe('mock contracts stay forward-dated', () => {
  it('uses expirations ~dte days ahead of today', () => {
    const expected30 = expirationFromDte(30);
    const contracts = getContracts();
    const avgo = contracts.find((c) => c.underlying === 'AVGO');
    expect(avgo.expiration).toBe(expected30);
    expect(avgo.dte).toBe(30);
    expect(avgo.symbol).toContain(expected30.replace(/-/g, '').slice(2));
    expect(avgo.expiration >= '2026-08-29').toBe(true);
  });
});
