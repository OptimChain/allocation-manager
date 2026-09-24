// Shared JSON fetch for every service module. Adds a request timeout so a hung
// upstream (or a function past its Netlify limit) surfaces as an error instead
// of an infinite spinner, and normalises error messages across the envelopes
// our functions return ({error: string} | {error: {message}} | {message}).

import { API_BASE } from '../config/api';

export const DEFAULT_TIMEOUT_MS = 15_000;

export interface FetchJsonOptions extends RequestInit {
  /** Abort after this many ms (default 15s). */
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown = null) {
    super(message);
    this.name = 'HttpError';
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as { error?: unknown; message?: unknown };
    if (typeof b.error === 'string') return b.error;
    if (b.error && typeof b.error === 'object' && typeof (b.error as { message?: unknown }).message === 'string') {
      return (b.error as { message: string }).message;
    }
    if (typeof b.message === 'string') return b.message;
  }
  return `Request failed: ${status}`;
}

function withTimeout(signal: AbortSignal | null | undefined, ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return signal ?? undefined;
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
}

/** fetch → JSON with a timeout; throws HttpError on non-2xx. */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...init } = options;
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: withTimeout(signal, timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new HttpError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 0);
    }
    throw err;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new HttpError(errorMessage(body, response.status), response.status, body);
  }
  return response.json() as Promise<T>;
}

/** fetchJson against a Netlify function path, e.g. apiJson('/db-orders?scope=open'). */
export function apiJson<T>(endpoint: string, options?: FetchJsonOptions): Promise<T> {
  return fetchJson<T>(`${API_BASE}${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
}
