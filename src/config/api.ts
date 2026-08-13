/**
 * API base URL — controlled by environment:
 *
 *   .env.development  →  proxies to prod (no local creds needed)
 *   .env.production   →  relative path (deployed functions)
 *   dev:mock          →  relative path (Vite mock plugin intercepts)
 */
export const API_BASE = import.meta.env.VITE_API_BASE || '/.netlify/functions';

/**
 * Twelve Data key for the price WebSocket. REST traffic goes through the
 * server-side proxy and needs no key here; the socket is browser-to-vendor, so
 * it can only authenticate with a bundled key.
 */
export const TWELVE_DATA_WS_KEY: string | undefined = import.meta.env.VITE_TWELVE_DATA_API_KEY;
