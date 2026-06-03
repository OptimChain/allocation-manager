/**
 * API base URL — controlled by environment:
 *
 *   .env.development  →  proxies to prod (no local creds needed)
 *   .env.production   →  relative path (deployed functions)
 *   dev:mock          →  relative path (Vite mock plugin intercepts)
 */
export const API_BASE = import.meta.env.VITE_API_BASE || '/.netlify/functions';
