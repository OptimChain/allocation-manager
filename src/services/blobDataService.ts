/**
 * Service for fetching market data from Netlify Blob stores
 * (options-chain, market-quotes) via the vend-blobs function.
 */

const BASE = '/.netlify/functions/vend-blobs';

// ── Types ──────────────────────────────────────────────────

export interface OptionGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
}

export interface OptionTrade {
  price: number;
  size: number;
  timestamp: string;
}

export interface OptionQuote {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  timestamp: string;
}

export interface OptionSnapshot {
  symbol: string;
  latestTrade?: OptionTrade;
  latestQuote?: OptionQuote;
  greeks?: OptionGreeks;
  impliedVolatility?: number;
}

export interface OptionBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeCount: number;
  vwap: number;
}

export interface OptionsChainBlob {
  timestamp: string;
  underlying: string;
  blob_key: string;
  latest_chain: Record<string, OptionSnapshot | unknown>;
  latest_bars: Record<string, OptionBar[] | unknown>;
  history_count: number;
  history: OptionsHistoryEntry[];
}

export interface OptionsHistoryEntry {
  timestamp: string;
  contracts: Record<string, OptionSnapshot>;
}

export interface MarketQuote {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  spreadBps: number;
  bidSize?: number;
  askSize?: number;
  bidExchange?: string;
  askExchange?: string;
  timestamp: string;
  source: string;
  symbol: string;
  assetClass: string;
}

export interface MarketQuotesBlob {
  timestamp: string;
  blob_key: string;
  latest_quotes: Record<string, MarketQuote | unknown>;
  history_count: number;
  history: MarketQuotesHistoryEntry[];
}

export interface MarketQuotesHistoryEntry {
  timestamp: string;
  quotes: Record<string, MarketQuote>;
}

// ── Helpers ────────────────────────────────────────────────

async function vendBlobs<T>(store: string, action: string, extra?: Record<string, string>): Promise<T> {
  const params = new URLSearchParams({ store, action, ...extra });
  const res = await fetch(`${BASE}?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`vend-blobs ${store}/${action} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Public API ─────────────────────────────────────────────

/** List all blob keys in a store, optionally filtered by prefix. */
export async function listBlobKeys(store: string, prefix?: string): Promise<string[]> {
  const extra: Record<string, string> = {};
  if (prefix) extra.prefix = prefix;
  const data = await vendBlobs<{ keys: string[] }>(store, 'list', extra);
  return data.keys;
}

/** Get a single blob by key. */
export async function getBlob<T>(store: string, key: string): Promise<T> {
  const data = await vendBlobs<{ value: T }>(store, 'get', { key });
  return data.value;
}

/** Fetch the latest options-chain blob for a given symbol. */
export async function getLatestOptionsChain(symbol: string): Promise<OptionsChainBlob | null> {
  const keys = await listBlobKeys('options-chain', `${symbol}/`);
  if (keys.length === 0) return null;
  // Keys are timestamp-sorted; last is most recent
  const latestKey = keys[keys.length - 1];
  return getBlob<OptionsChainBlob>('options-chain', latestKey);
}

/** Fetch the latest market-quotes blob. */
export async function getLatestMarketQuotes(): Promise<MarketQuotesBlob | null> {
  const keys = await listBlobKeys('market-quotes');
  if (keys.length === 0) return null;
  const latestKey = keys[keys.length - 1];
  return getBlob<MarketQuotesBlob>('market-quotes', latestKey);
}

/** List available option symbols (top-level prefixes in options-chain). */
export async function listOptionSymbols(): Promise<string[]> {
  const keys = await listBlobKeys('options-chain');
  const symbols = new Set<string>();
  for (const key of keys) {
    const slash = key.indexOf('/');
    if (slash > 0) symbols.add(key.slice(0, slash));
  }
  return Array.from(symbols).sort();
}
