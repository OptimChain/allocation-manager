import { useEffect, useRef, useState } from 'react';
import { getQuotes } from '../services/twelveDataService';
import type { LivePrice, LiveStatus } from './useTwelveDataLivePrices';

/**
 * REST polling fallback for "current price / live return".
 *
 * The TwelveData WebSocket (see useTwelveDataLivePrices) requires a plan with
 * streaming access; on the basic plan it never delivers ticks and the live
 * indicator sits at 'error'. This hook instead polls the `quote` endpoint
 * through the proxy on an interval — lower fidelity than a socket, but it
 * works on any plan and keeps the current price / legend fresh.
 *
 * Shares the WS hook's return shape so callers can swap between them. Only
 * runs while `enabled` is true, so it stays dark when the socket is working.
 */

const DEFAULT_INTERVAL_MS = 60_000;

export function useTwelveDataQuotePolling(
  symbols: string[],
  opts: { enabled?: boolean; intervalMs?: number } = {},
): { prices: Record<string, LivePrice>; status: LiveStatus } {
  const { enabled = true, intervalMs = DEFAULT_INTERVAL_MS } = opts;
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [status, setStatus] = useState<LiveStatus>('idle');

  // Stable key so the effect only re-runs when the set actually changes.
  const symbolsKey = [...symbols].sort().join(',');

  const symbolsRef = useRef<string[]>(symbols);
  symbolsRef.current = symbols;

  useEffect(() => {
    if (!enabled || symbols.length === 0) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('connecting');

    const poll = async () => {
      try {
        const quotes = await getQuotes(symbolsRef.current);
        if (cancelled) return;
        const next: Record<string, LivePrice> = {};
        for (const [symbol, q] of Object.entries(quotes)) {
          next[symbol] = { price: q.price, timestamp: q.timestamp };
        }
        setPrices(next);
        // 'open' once we have at least one quote; else treat as an error so the
        // caller shows "Offline" rather than a permanent "Connecting…".
        setStatus(Object.keys(next).length > 0 ? 'open' : 'error');
      } catch {
        if (!cancelled) setStatus('error');
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, enabled, intervalMs]);

  return { prices, status };
}
