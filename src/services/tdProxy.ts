// TwelveData requests go through the server-side proxy function, which holds
// the API key and caches responses in the shared trading DB — one upstream
// credit per (endpoint, params, TTL) across ALL browsers, instead of every
// visitor pulling api.twelvedata.com directly. The response body is verbatim
// TwelveData JSON, so callers parse it exactly as before.

import { API_BASE } from '../config/api';
import { fetchJson } from './http';

export type TdEndpoint = 'time_series' | 'quote' | 'price' | 'exchange_rate';

export function tdProxyUrl(endpoint: TdEndpoint): URL {
  const base = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'http://localhost';
  return new URL(`${API_BASE}/twelvedata/${endpoint}`, base);
}

/**
 * GET a TwelveData endpoint through the proxy and return the raw JSON.
 * TwelveData reports quota/symbol errors as HTTP 200 with `status: "error"`,
 * so both failure shapes are turned into thrown errors here.
 */
export async function tdFetch<T>(
  endpoint: TdEndpoint,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const url = tdProxyUrl(endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const data = await fetchJson<T & { status?: string; message?: string }>(url.toString());
  if (data.status === 'error') {
    throw new Error(data.message || `TwelveData ${endpoint} error for ${params.symbol ?? ''}`.trim());
  }
  return data;
}
