/**
 * Service for fetching market data from Netlify Blob stores
 * (options-chain, market-quotes) via the vend-blobs function.
 *
 * The allocation-engine Python scripts write snake_case JSON.
 * We normalise to camelCase at the service boundary so the rest
 * of the frontend can work with idiomatic TypeScript types.
 */

const BASE = '/.netlify/functions/vend-blobs';

// ── Public (camelCase) types ────────────────────────────────

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
  greeks?: OptionGreeks | null;
  impliedVolatility?: number | null;
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

export interface OptionsHistoryEntry {
  timestamp: string;
  underlying: string;
  numContracts: number;
  snapshots: OptionSnapshot[];
}

export interface OptionsChainBlob {
  timestamp: string;
  underlying: string;
  blob_key: string;
  latest_chain: Record<string, OptionSnapshot>;
  latest_bars: Record<string, OptionBar[]>;
  history_count: number;
  history: OptionsHistoryEntry[];
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
  latest_quotes: Record<string, MarketQuote>;
  history_count: number;
  history: MarketQuotesHistoryEntry[];
}

export interface MarketQuotesHistoryEntry {
  timestamp: string;
  quotes: Record<string, MarketQuote>;
}

// ── snake_case → camelCase mapping ──────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapOptionSnapshot(raw: any): OptionSnapshot {
  if (!raw) return raw;
  return {
    symbol: raw.symbol,
    latestTrade: raw.latest_trade ?? raw.latestTrade,
    latestQuote: raw.latest_quote || raw.latestQuote
      ? {
          bid: (raw.latest_quote ?? raw.latestQuote)?.bid,
          ask: (raw.latest_quote ?? raw.latestQuote)?.ask,
          bidSize: (raw.latest_quote ?? raw.latestQuote)?.bid_size ?? (raw.latest_quote ?? raw.latestQuote)?.bidSize ?? 0,
          askSize: (raw.latest_quote ?? raw.latestQuote)?.ask_size ?? (raw.latest_quote ?? raw.latestQuote)?.askSize ?? 0,
          timestamp: (raw.latest_quote ?? raw.latestQuote)?.timestamp,
        }
      : undefined,
    greeks: raw.greeks ?? null,
    impliedVolatility: raw.implied_volatility ?? raw.impliedVolatility ?? null,
  };
}

function mapMarketQuote(raw: any): MarketQuote {
  if (!raw) return raw;
  return {
    bid: raw.bid,
    ask: raw.ask,
    mid: raw.mid,
    spread: raw.spread,
    spreadBps: raw.spread_bps ?? raw.spreadBps ?? 0,
    bidSize: raw.bid_size ?? raw.bidSize,
    askSize: raw.ask_size ?? raw.askSize,
    bidExchange: raw.bid_exchange ?? raw.bidExchange,
    askExchange: raw.ask_exchange ?? raw.askExchange,
    timestamp: raw.timestamp,
    source: raw.source,
    symbol: raw.symbol,
    assetClass: raw.asset_class ?? raw.assetClass ?? '',
  };
}

function mapOptionsChainBlob(raw: any): OptionsChainBlob {
  // Map latest_chain entries
  const latest_chain: Record<string, OptionSnapshot> = {};
  for (const [k, v] of Object.entries(raw.latest_chain || {})) {
    if (k === '_meta') continue;
    latest_chain[k] = mapOptionSnapshot(v);
  }

  // Map latest_bars (already mostly numeric, just normalise tradeCount)
  const latest_bars: Record<string, OptionBar[]> = {};
  for (const [k, v] of Object.entries(raw.latest_bars || {})) {
    if (k === '_meta' || !Array.isArray(v)) continue;
    latest_bars[k] = (v as any[]).map((b) => ({
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      tradeCount: b.trade_count ?? b.tradeCount ?? 0,
      vwap: b.vwap,
    }));
  }

  // Map history — actual shape has { timestamp, underlying, num_contracts, snapshots: [...] }
  const history: OptionsHistoryEntry[] = (raw.history || []).map((h: any) => ({
    timestamp: h.timestamp,
    underlying: h.underlying ?? raw.underlying,
    numContracts: h.num_contracts ?? h.numContracts ?? 0,
    snapshots: (h.snapshots || []).map(mapOptionSnapshot),
  }));

  return {
    timestamp: raw.timestamp,
    underlying: raw.underlying,
    blob_key: raw.blob_key,
    latest_chain,
    latest_bars,
    history_count: raw.history_count ?? 0,
    history,
  };
}

function mapMarketQuotesBlob(raw: any): MarketQuotesBlob {
  const latest_quotes: Record<string, MarketQuote> = {};
  for (const [k, v] of Object.entries(raw.latest_quotes || {})) {
    if (k === '_meta') continue;
    latest_quotes[k] = mapMarketQuote(v);
  }

  const history: MarketQuotesHistoryEntry[] = (raw.history || []).map((h: any) => {
    const quotes: Record<string, MarketQuote> = {};
    const rawQuotes = h.quotes || [];
    if (Array.isArray(rawQuotes)) {
      // Actual shape: quotes is an array of quote objects with a .symbol field
      for (const q of rawQuotes) {
        if (q && q.symbol) quotes[q.symbol] = mapMarketQuote(q);
      }
    } else {
      // Fallback: dict keyed by symbol
      for (const [k, v] of Object.entries(rawQuotes)) {
        if (k === '_meta') continue;
        quotes[k] = mapMarketQuote(v);
      }
    }
    return { timestamp: h.timestamp, quotes };
  });

  return {
    timestamp: raw.timestamp,
    blob_key: raw.blob_key,
    latest_quotes,
    history_count: raw.history_count ?? 0,
    history,
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

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

/**
 * Pick the richest blob key from a sorted list of timestamp keys.
 *
 * End-of-day blobs accumulate the most history + greeks. Strategy:
 *  1. Find the last key from the most recent *completed* date
 *     (any date before today's UTC date).
 *  2. If everything is from today (or there's only one date),
 *     fall back to the absolute latest key.
 *
 * Keys look like "CRWD/2026-03-20T23-20-00" or "2026-03-20T23-20-00".
 */
function pickRichestKey(keys: string[]): string {
  if (keys.length <= 1) return keys[keys.length - 1];

  const todayUTC = new Date().toISOString().slice(0, 10); // "2026-03-24"

  // Walk backwards to find the last key from a date before today
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    // Extract the date portion — handle both "SYM/DATE" and "DATE" formats
    const tsStart = key.includes('/') ? key.lastIndexOf('/') + 1 : 0;
    const dateStr = key.slice(tsStart, tsStart + 10); // "2026-03-20"
    if (dateStr < todayUTC) return key;
  }

  // All keys are from today — return the latest
  return keys[keys.length - 1];
}

/** Fetch the richest options-chain blob for a given symbol (end-of-day preferred). */
export async function getLatestOptionsChain(symbol: string): Promise<OptionsChainBlob | null> {
  const keys = await listBlobKeys('options-chain', `${symbol}/`);
  if (keys.length === 0) return null;
  const bestKey = pickRichestKey(keys);
  const raw = await getBlob<unknown>('options-chain', bestKey);
  return mapOptionsChainBlob(raw);
}

/** Fetch the richest market-quotes blob (end-of-day preferred). */
export async function getLatestMarketQuotes(): Promise<MarketQuotesBlob | null> {
  const keys = await listBlobKeys('market-quotes');
  if (keys.length === 0) return null;
  const bestKey = pickRichestKey(keys);
  const raw = await getBlob<unknown>('market-quotes', bestKey);
  return mapMarketQuotesBlob(raw);
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
