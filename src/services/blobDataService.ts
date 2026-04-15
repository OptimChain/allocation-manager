/**
 * Service for fetching market data from Netlify Blob stores
 * (options-chain, market-quotes) via the vend-blobs function.
 *
 * The server handles snake_case → camelCase normalisation so the
 * frontend receives idiomatic TypeScript types directly.
 */

import { API_BASE } from '../config/api';

const BASE = `${API_BASE}/vend-blobs`;

// ── Public types ──────��──────────────────────────────────────

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
  blobKey: string;
  latestChain: Record<string, OptionSnapshot>;
  latestBars: Record<string, OptionBar[]>;
  historyCount: number;
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
  blobKey: string;
  latestQuotes: Record<string, MarketQuote>;
  historyCount: number;
  history: MarketQuotesHistoryEntry[];
}

export interface MarketQuotesHistoryEntry {
  timestamp: string;
  quotes: Record<string, MarketQuote>;
}

export interface MarketDataResult {
  options: OptionsChainBlob | null;
  quotes: MarketQuotesBlob | null;
}

// ── Helper ───────────────────────────────────────────────────

async function vendBlobs<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${BASE}?${qs}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`vend-blobs failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Public API (3 functions) ─────────────────────────────────

/** List available option symbols (e.g. ["CRWD", "IWM"]). */
export async function listOptionSymbols(): Promise<string[]> {
  const data = await vendBlobs<{ symbols: string[] }>({
    store: 'options-chain',
    action: 'list-symbols',
  });
  return data.symbols;
}

/** List available dates for a symbol's options data (newest first). */
export async function listDates(symbol: string): Promise<string[]> {
  const data = await vendBlobs<{ dates: string[] }>({
    store: 'options-chain',
    action: 'list-dates',
    symbol,
  });
  return data.dates;
}

/**
 * Fetch options chain + market quotes for a symbol.
 * Omit `date` to get the latest (richest EOD blob with fallback).
 * Provide `date` (e.g. "2026-03-20") to fetch a specific day.
 */
export async function getMarketData(
  symbol: string,
  date?: string,
): Promise<MarketDataResult> {
  const params: Record<string, string> = { action: 'market-data', symbol };
  if (date) params.date = date;
  const data = await vendBlobs<{ options: OptionsChainBlob | null; quotes: MarketQuotesBlob | null }>(params);
  return { options: data.options ?? null, quotes: data.quotes ?? null };
}
