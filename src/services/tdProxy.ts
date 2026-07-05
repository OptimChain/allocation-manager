// TwelveData requests go through the server-side proxy function, which holds
// the API key and caches responses in the shared trading DB — one upstream
// credit per (endpoint, params, TTL) across ALL browsers, instead of every
// visitor pulling api.twelvedata.com directly. The response body is verbatim
// TwelveData JSON, so callers parse it exactly as before.

import { API_BASE } from '../config/api';

export type TdEndpoint = 'time_series' | 'quote' | 'price' | 'exchange_rate';

export function tdProxyUrl(endpoint: TdEndpoint): URL {
  const base = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : 'http://localhost';
  return new URL(`${API_BASE}/twelvedata/${endpoint}`, base);
}
