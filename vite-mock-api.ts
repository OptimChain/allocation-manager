/**
 * Vite dev plugin — serves mock data from shared/mocks/ on Netlify function endpoints.
 *
 * Usage: `npm run dev:mock` starts Vite with this plugin active.
 * All /.netlify/functions/* requests return realistic mock data seeded from live market data.
 */

import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

const MOCK_DIR = path.resolve(__dirname, '../shared/mocks');

function loadMock(name: string): unknown {
  const file = path.join(MOCK_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// Build mock responses for each Netlify function endpoint
function getMockResponse(pathname: string, params: URLSearchParams): { status: number; body: unknown } | null {
  const fn = pathname.replace('/.netlify/functions/', '');

  // Order Book Snapshot
  if (fn === 'order-book-snapshot') {
    const snapshot = loadMock('order_book_snapshot');
    return snapshot ? { status: 200, body: snapshot } : null;
  }

  // Robinhood Portfolio
  if (fn === 'robinhood-portfolio') {
    const action = params.get('action');
    const account = loadMock('account') as Record<string, unknown> | null;
    const snapshot = loadMock('order_book_snapshot') as Record<string, unknown> | null;
    const positions = (snapshot?.portfolio as Record<string, unknown>)?.positions ?? [];

    if (action === 'portfolio') {
      return {
        status: 200,
        body: {
          accountNumber: 'MOCK-001',
          buyingPower: account?.buying_power ?? 10000,
          cash: account?.cash ?? 5000,
          portfolioValue: account?.portfolio_value ?? 48750,
          extendedHoursValue: account?.portfolio_value ?? 48750,
          totalGain: 2500,
          positions: (positions as Record<string, unknown>[]).map(p => ({
            symbol: p.symbol,
            name: p.name ?? p.symbol,
            quantity: p.quantity,
            averageCost: p.avg_buy_price,
            currentPrice: p.current_price,
            totalCost: (p.quantity as number) * (p.avg_buy_price as number),
            currentValue: p.equity,
            gain: p.profit_loss,
            gainPercent: p.profit_loss_pct,
          })),
        },
      };
    }

    if (action === 'orders') {
      const orders = (snapshot?.portfolio as Record<string, unknown>)?.open_orders ?? [];
      return {
        status: 200,
        body: (orders as Record<string, unknown>[]).map(o => ({
          id: o.order_id,
          symbol: o.symbol,
          name: o.symbol,
          side: (o.side as string).toLowerCase(),
          type: o.order_type,
          quantity: o.quantity,
          price: o.limit_price,
          state: o.state,
          createdAt: o.created_at,
          updatedAt: o.updated_at,
        })),
      };
    }

    if (action === 'pnl') {
      return {
        status: 200,
        body: {
          totalRealizedPnL: 1250.50,
          totalBuyVolume: 25000,
          totalSellVolume: 26250.50,
          symbols: [],
          orders: [],
        },
      };
    }

    return { status: 200, body: {} };
  }

  // Robinhood Auth
  if (fn === 'robinhood-auth') {
    const action = params.get('action');
    if (action === 'status') {
      return {
        status: 200,
        body: {
          authenticated: true,
          message: 'Mock authenticated',
          expiresIn: 86400,
        },
      };
    }
    if (action === 'connect') {
      return {
        status: 200,
        body: { authenticated: true, message: 'Mock connected' },
      };
    }
    return { status: 200, body: { authenticated: true, message: 'OK' } };
  }

  // Robinhood Bot
  if (fn === 'robinhood-bot') {
    const action = params.get('action');
    if (action === 'status') {
      return {
        status: 200,
        body: { status: 'idle', actionsCount: 0, lastAction: null },
      };
    }
    if (action === 'actions') {
      return { status: 200, body: { actions: [], total: 0 } };
    }
    if (action === 'analyze') {
      const quote = loadMock('quote') as Record<string, unknown> | null;
      return {
        status: 200,
        body: {
          timestamp: new Date().toISOString(),
          buyingPower: 10864.20,
          suggestions: [
            {
              type: 'buy',
              symbol: quote?.symbol ?? 'BTC/USD',
              reason: 'Mock analysis: price below 200-day MA',
              priority: 'medium',
            },
          ],
          holdings: [],
        },
      };
    }
    if (action === 'quote') {
      const quote = loadMock('quote');
      return quote ? { status: 200, body: quote } : null;
    }
    if (action === 'order') {
      return {
        status: 200,
        body: { status: 'ok', message: 'Mock order placed (dry run)', orderId: 'mock-order-001' },
      };
    }
    return { status: 200, body: {} };
  }

  // Vend blobs
  if (fn === 'vend-blobs') {
    const store = params.get('store');
    const action = params.get('action') ?? 'list';
    const key = params.get('key');

    if (action === 'list') {
      const raw = loadMock('_raw_market_quotes');
      if (store === 'market-quotes' && raw) {
        return {
          status: 200,
          body: { store, count: 1, keys: [(raw as Record<string, unknown>).timestamp ?? 'latest'] },
        };
      }
      return { status: 200, body: { store, count: 0, keys: [] } };
    }

    if (action === 'get' && store === 'market-quotes') {
      const raw = loadMock('_raw_market_quotes');
      return raw ? { status: 200, body: { store, key, value: raw } } : null;
    }

    return { status: 200, body: { store, count: 0, keys: [] } };
  }

  // Alert Slack (fire and forget)
  if (fn === 'alert-slack') {
    return { status: 200, body: { ok: true, message: 'Mock alert sent' } };
  }

  // CoinGecko market
  if (fn === 'coingecko-market') {
    return {
      status: 200,
      body: [{
        id: 'bitcoin',
        symbol: 'btc',
        name: 'Bitcoin',
        current_price: 70885.88,
        market_cap: 1400000000000,
        total_volume: 35000000000,
        price_change_24h: 1250.50,
        price_change_percentage_24h: 1.8,
        high_24h: 71500,
        low_24h: 69200,
        last_updated: new Date().toISOString(),
      }],
    };
  }

  // Polygon / CoinDesk news
  if (fn === 'polygon-news' || fn === 'coindesk-news') {
    return {
      status: 200,
      body: {
        results: [
          {
            id: 'mock-news-1',
            title: 'Bitcoin Surges Past $70K on Institutional Demand',
            author: 'Mock Reporter',
            published_utc: new Date().toISOString(),
            article_url: 'https://example.com/mock-news',
            image_url: null,
            description: 'Mock news article for local development.',
            tickers: ['BTC'],
            publisher: { name: 'Mock News', logo_url: null, favicon_url: null },
          },
        ],
        count: 1,
      },
    };
  }

  // Deribit DVOL
  if (fn === 'deribit-dvol') {
    return {
      status: 200,
      body: { dvol: 55.2, timestamp: new Date().toISOString() },
    };
  }

  // Enriched snapshot — serves full TradePage data with P&L computed from
  // historical orders (same algorithm as netlify/functions/enriched-snapshot.cjs).
  if (fn === 'enriched-snapshot') {
    const snapshot = loadMock('order_book_snapshot') as Record<string, unknown> | null;
    const account = loadMock('account') as Record<string, unknown> | null;
    const historicalOrders = (loadMock('_historical_orders') ?? []) as Record<string, unknown>[];
    if (!snapshot) return null;

    const portfolio = snapshot.portfolio as Record<string, unknown>;
    const positions = (portfolio?.positions ?? []) as Record<string, unknown>[];
    const openOrders = (portfolio?.open_orders ?? []) as Record<string, unknown>[];
    const rawCash = portfolio?.cash as unknown;
    const cashInfo = (typeof rawCash === 'object' && rawCash !== null)
      ? rawCash as Record<string, unknown>
      : { cash: Number(rawCash) || 0, buying_power: 0, tradeable_cash: Number(rawCash) || 0, cash_available_for_withdrawal: 0 };
    const cashHeld = (cashInfo.tradeable_cash as number ?? cashInfo.cash as number ?? 0);

    const stockMarketValue = positions.reduce((sum, p) => sum + (p.equity as number ?? 0), 0);
    const totalPl = positions.reduce((sum, p) => sum + (p.profit_loss as number ?? 0), 0);
    const totalCost = positions.reduce((sum, p) => sum + ((p.quantity as number) * (p.avg_buy_price as number ?? 0)), 0);
    const totalPlPct = totalCost > 0 ? (totalPl / totalCost) * 100 : 0;

    const r2 = (n: number) => Math.round(n * 100) / 100;
    const PERIOD_DAYS: Record<string, number> = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '5Y': 1825 };

    // Mirror the FIFO weighted-average cost-basis algorithm from enriched-snapshot.cjs
    function computeStockPnl(orders: Record<string, unknown>[], cutoff: Date) {
      const filtered = orders
        .filter(o => o.state === 'filled' && o.symbol && new Date(o.created_at as string) >= cutoff)
        .sort((a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime());

      const book: Record<string, { symbol: string; realized_pnl: number; total_bought: number; total_sold: number; buy_count: number; sell_count: number; shares_held: number; cost_basis: number }> = {};
      for (const o of filtered) {
        const sym = o.symbol as string;
        if (!book[sym]) book[sym] = { symbol: sym, realized_pnl: 0, total_bought: 0, total_sold: 0, buy_count: 0, sell_count: 0, shares_held: 0, cost_basis: 0 };
        const s = book[sym];
        const qty = parseFloat(String(o.filled_quantity ?? o.quantity ?? 0)) || 0;
        const price = parseFloat(String(o.average_price ?? o.price ?? o.limit_price ?? 0)) || 0;
        const total = qty * price;

        if (String(o.side ?? '').toUpperCase() === 'BUY') {
          s.shares_held += qty;
          s.cost_basis += total;
          s.total_bought += total;
          s.buy_count++;
        } else {
          const avg = s.shares_held > 0 ? s.cost_basis / s.shares_held : 0;
          s.realized_pnl += (price - avg) * qty;
          s.cost_basis -= avg * qty;
          s.shares_held -= qty;
          s.total_sold += total;
          s.sell_count++;
        }
      }

      const symbols = Object.values(book)
        .map(s => ({ ...s, realized_pnl: r2(s.realized_pnl), total_bought: r2(s.total_bought), total_sold: r2(s.total_sold), cost_basis: r2(s.cost_basis) }))
        .sort((a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl));

      return {
        total_realized_pnl: r2(symbols.reduce((s, x) => s + x.realized_pnl, 0)),
        total_buy_volume: r2(symbols.reduce((s, x) => s + x.total_bought, 0)),
        total_sell_volume: r2(symbols.reduce((s, x) => s + x.total_sold, 0)),
        filled_count: filtered.length,
        symbols,
      };
    }

    const pnlByPeriod: Record<string, unknown> = {};
    for (const period of Object.keys(PERIOD_DAYS)) {
      const cutoff = new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000);
      pnlByPeriod[period] = {
        stock: computeStockPnl(historicalOrders, cutoff),
        option: { total_realized_pnl: 0, total_buy_volume: 0, total_sell_volume: 0, filled_count: 0, symbols: [] },
      };
    }

    const recentPnl = computeStockPnl(historicalOrders, new Date(Date.now() - 7 * 86_400_000));
    const optionPnl = { total_realized_pnl: 0, total_buy_volume: 0, total_sell_volume: 0, filled_count: 0, symbols: [] };

    return {
      status: 200,
      body: {
        timestamp: snapshot.timestamp,
        market_data: snapshot.market_data ?? null,
        order_book: openOrders,
        recent_orders: historicalOrders.slice(0, 50),
        recent_option_orders: [],
        recent_pnl: recentPnl,
        option_pnl: optionPnl,
        combined_7d_pnl: r2(recentPnl.total_realized_pnl + optionPnl.total_realized_pnl),
        pnl_by_period: pnlByPeriod,
        portfolio: {
          cash: cashInfo,
          equity: (account?.equity as number) ?? (stockMarketValue + cashHeld),
          rh_market_value: null,
          market_value: r2(stockMarketValue + cashHeld),
          stock_market_value: r2(stockMarketValue),
          options_market_value: 0,
          margin_used: cashHeld < 0 ? r2(-cashHeld) : 0,
          reconciliation: {
            rh_equity: (account?.equity as number) ?? stockMarketValue,
            computed_equity: r2(stockMarketValue + cashHeld),
          },
          positions: [...positions].sort((a, b) => Math.abs((b.profit_loss as number) ?? 0) - Math.abs((a.profit_loss as number) ?? 0)),
          open_orders: openOrders,
          open_option_orders: [],
          options: [],
          options_summary: null,
          total_pl: r2(totalPl),
          total_pl_pct: r2(totalPlPct),
        },
      },
    };
  }

  return null;
}

export function mockApiPlugin(): Plugin {
  return {
    name: 'mock-netlify-functions',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/.netlify/functions/')) {
          return next();
        }

        const url = new URL(req.url, 'http://localhost');
        const params = url.searchParams;
        const result = getMockResponse(url.pathname, params);

        if (!result) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Mock not found for ' + url.pathname }));
          return;
        }

        res.writeHead(result.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(result.body));
      });
    },
  };
}
