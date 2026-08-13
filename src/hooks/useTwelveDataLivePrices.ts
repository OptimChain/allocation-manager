import { useEffect, useRef, useState } from 'react';
import { TWELVE_DATA_WS_KEY } from '../config/api';

/**
 * Real-time price streaming from the Twelve Data WebSocket.
 *
 * Endpoint: wss://ws.twelvedata.com/v1/quotes/price?apikey=...
 * Granularity: tick-by-tick — the server pushes a `price` event on every
 * market tick (~170 ms latency), the finest grain Twelve Data offers. The
 * REST API floor is 1-minute bars with a 0.3–2 min post-candle delay, so the
 * socket is strictly higher fidelity for "current price / live return".
 *
 * Notes:
 *  - Heartbeat must be sent every ~10s to keep the connection alive.
 *  - Up to 3 concurrent connections per account; symbol count is plan-limited.
 *  - Requires a Twelve Data plan with WebSocket access. If the key is missing
 *    or the plan lacks streaming, the hook degrades to status 'error'/'closed'
 *    and callers should fall back to the last REST close.
 *  - Entitlement is PER SYMBOL, not per account: the server answers a
 *    subscribe with a `subscribe-status` frame that splits the request into
 *    `success` and `fails`, e.g. status 'warning' with BTC/USD subscribed and
 *    SPY/NET/VOO rejected. The socket stays open and healthy either way, so
 *    connection status alone says nothing about whether a given symbol will
 *    ever tick. Callers must therefore look at `streaming` — the symbols the
 *    server actually confirmed — and source everything else over REST, or
 *    those symbols silently sit at the previous daily close.
 */

const WS_URL = 'wss://ws.twelvedata.com/v1/quotes/price';
const HEARTBEAT_MS = 10_000;
const RECONNECT_MS = 3_000;

export interface LivePrice {
  price: number;
  timestamp: number; // ms epoch
}

export type LiveStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export function useTwelveDataLivePrices(symbols: string[]): {
  prices: Record<string, LivePrice>;
  status: LiveStatus;
  streaming: string[];
} {
  const [prices, setPrices] = useState<Record<string, LivePrice>>({});
  const [status, setStatus] = useState<LiveStatus>('idle');
  // Symbols the server confirmed in a `subscribe-status` frame. Sorted so the
  // identity only changes when the set does.
  const [streaming, setStreaming] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const symbolsRef = useRef<string[]>(symbols);
  symbolsRef.current = symbols;

  // Confirmed-streaming set, mutated from socket frames and mirrored into
  // `streaming` state.
  const streamingRef = useRef<Set<string>>(new Set());
  const publishStreaming = () => setStreaming([...streamingRef.current].sort());

  // Stable key so the connection effect only re-runs when the set changes.
  const symbolsKey = [...symbols].sort().join(',');

  // ── Connection lifecycle (one socket, reconnects on drop) ──────────────
  useEffect(() => {
    const apiKey = TWELVE_DATA_WS_KEY;
    if (!apiKey) {
      setStatus('error');
      return;
    }

    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      setStatus('connecting');
      const ws = new WebSocket(`${WS_URL}?apikey=${apiKey}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setStatus('open');
        const subs = symbolsRef.current;
        subscribedRef.current = new Set(subs);
        if (subs.length > 0) {
          ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: subs.join(',') } }));
        }
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'heartbeat' }));
          }
        }, HEARTBEAT_MS);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === 'price' && typeof msg.price === 'number') {
            setPrices((prev) => ({
              ...prev,
              [msg.symbol]: {
                price: msg.price,
                timestamp: typeof msg.timestamp === 'number' ? msg.timestamp * 1000 : Date.now(),
              },
            }));
            return;
          }
          // The server reports per-symbol entitlement here. `status` is 'ok'
          // when everything subscribed and 'warning' on a partial accept, so
          // key off the success/fails lists rather than the status string.
          if (msg.event === 'subscribe-status') {
            for (const item of msg.success ?? []) {
              if (item?.symbol) streamingRef.current.add(item.symbol);
            }
            for (const item of msg.fails ?? []) {
              if (item?.symbol) streamingRef.current.delete(item.symbol);
            }
            publishStreaming();
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!cancelled) setStatus('error');
      };

      ws.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        // Nothing is streaming over a dead socket — drop the confirmations so
        // callers fall back to REST until the reconnect re-confirms them.
        streamingRef.current = new Set();
        if (cancelled) return;
        publishStreaming();
        setStatus('closed');
        reconnect = setTimeout(connect, RECONNECT_MS);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      if (reconnect) clearTimeout(reconnect);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: 'unsubscribe', params: { symbols: 'all' } }));
        } catch {
          // socket already closing
        }
      }
      ws?.close();
      wsRef.current = null;
      subscribedRef.current = new Set();
      streamingRef.current = new Set();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Subscription deltas when the symbol set changes ────────────────────
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return; // onopen handles initial sub

    const desired = new Set(symbols);
    const current = subscribedRef.current;
    const toAdd = [...desired].filter((s) => !current.has(s));
    const toRemove = [...current].filter((s) => !desired.has(s));

    if (toAdd.length > 0) {
      ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: toAdd.join(',') } }));
    }
    if (toRemove.length > 0) {
      ws.send(JSON.stringify({ action: 'unsubscribe', params: { symbols: toRemove.join(',') } }));
      // Unsubscribes are not acknowledged with a subscribe-status frame, so
      // retire them here rather than waiting for a confirmation that never comes.
      toRemove.forEach((s) => streamingRef.current.delete(s));
      publishStreaming();
    }
    subscribedRef.current = desired;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

  return { prices, status, streaming };
}
