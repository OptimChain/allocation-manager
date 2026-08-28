// Vol-surface pipeline: source routing and fallback.

const { resolveSurfaceForSymbol, buildMarketDepthPayload } = require('../../netlify/functions/lib/vol-surface-pipeline.cjs');
const { getConfig, parseSource } = require('../../netlify/functions/lib/vol-surface-config.cjs');

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
