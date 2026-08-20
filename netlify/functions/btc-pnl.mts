// BTC P&L — average-open-price P&L from live stock_orders fills.
// GET /.netlify/functions/btc-pnl?view=summary|lots|fills&days=30&symbol=BTC&mark=30.60
//
//   view=summary (default) — totals, open position, avg cost, cross-checks
//   view=lots&days=N        — realized P&L bucketed into fixed N-day windows
//                             anchored at the first fill (default 30, 1–365)
//   view=fills              — the raw fill ledger, oldest first
//
// Fills come from the trading Postgres (public.stock_orders, state=filled),
// via TRADING_DATABASE_URL. The mark defaults to the live position price from
// allocation-engine-api (/api/positions: market_value / qty) and can be
// overridden with ?mark=. Calculation lives in src/services/pnlService.ts —
// the same module a frontend can use to compute P&L client-side.

import pg from 'pg';
import {
  computeSummary,
  computeLots,
  Fill,
} from '../../src/services/pnlService';

const ENGINE_API =
  process.env.ALLOCATION_ENGINE_API_URL ||
  'https://allocation-engine-api.onrender.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function fetchFills(symbol: string): Promise<Fill[]> {
  const client = new pg.Client({
    connectionString: process.env.TRADING_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT created_at, side, filled_quantity, average_price
       FROM public.stock_orders
       WHERE symbol = $1 AND state = 'filled' AND filled_quantity > 0
       ORDER BY created_at`,
      [symbol],
    );
    return res.rows.map((r) => ({
      t: new Date(r.created_at).toISOString(),
      side: r.side === 'BUY' ? 'BUY' : 'SELL',
      qty: Number(r.filled_quantity),
      px: Number(r.average_price),
    }));
  } finally {
    await client.end();
  }
}

// Live mark = market_value / qty from the engine's enriched positions.
async function fetchLiveMark(symbol: string): Promise<number | null> {
  const res = await fetch(`${ENGINE_API}/api/positions`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    positions: { symbol: string; market_value: number; qty: number }[];
  };
  const pos = data.positions.find((p) => p.symbol === symbol);
  if (!pos || !pos.qty) return null;
  return pos.market_value / pos.qty;
}

export default async function handler(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response('', { headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }
  if (!process.env.TRADING_DATABASE_URL) {
    return json({ error: 'TRADING_DATABASE_URL is not configured' }, 500);
  }

  const url = new URL(request.url);
  const view = url.searchParams.get('view') || 'summary';
  const symbol = (url.searchParams.get('symbol') || 'BTC').toUpperCase();
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) {
    return json({ error: `Invalid symbol: ${symbol}` }, 400);
  }

  try {
    const fills = await fetchFills(symbol);

    if (view === 'fills') {
      return json({ symbol, count: fills.length, fills });
    }

    if (view === 'lots') {
      const days = parseInt(url.searchParams.get('days') || '30', 10);
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        return json({ error: `Invalid days: must be 1-365` }, 400);
      }
      const windows = computeLots(fills, days);
      const totalRealized = windows.reduce((a, w) => a + w.realizedPnl, 0);
      return json({ symbol, days, totalRealized, windows });
    }

    if (view !== 'summary') {
      return json({ error: `Unknown view: ${view}` }, 400);
    }

    const markParam = url.searchParams.get('mark');
    let mark: number | null = markParam ? Number(markParam) : null;
    let markSource = 'query';
    if (mark === null || !Number.isFinite(mark)) {
      mark = await fetchLiveMark(symbol);
      markSource = 'engine-api';
    }
    if (mark === null) {
      return json(
        { error: `No live mark available for ${symbol} — pass ?mark=` },
        502,
      );
    }
    const summary = computeSummary(fills, mark);
    return json({ symbol, markSource, ...summary });
  } catch (err) {
    console.error('[btc-pnl] failed:', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
