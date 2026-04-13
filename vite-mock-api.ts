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

  // Enriched snapshot (newer endpoint — serves full TradePage data)
  if (fn === 'enriched-snapshot') {
    const snapshot = loadMock('order_book_snapshot') as Record<string, unknown> | null;
    const account = loadMock('account') as Record<string, unknown> | null;
    if (!snapshot) return null;

    const portfolio = snapshot.portfolio as Record<string, unknown>;
    const positions = (portfolio?.positions ?? []) as Record<string, unknown>[];
    const openOrders = (portfolio?.open_orders ?? []) as Record<string, unknown>[];
    const cash = portfolio?.cash as Record<string, unknown> ?? {};

    const stockMarketValue = positions.reduce((sum, p) => sum + (p.equity as number), 0);
    const totalPl = positions.reduce((sum, p) => sum + (p.profit_loss as number), 0);
    const totalCost = positions.reduce((sum, p) => sum + ((p.quantity as number) * (p.avg_buy_price as number)), 0);
    const totalPlPct = totalCost > 0 ? (totalPl / totalCost) * 100 : 0;

    const mockStockPnl = {
      total_realized_pnl: 842.75,
      total_buy_volume: 12500.00,
      total_sell_volume: 13342.75,
      filled_count: 18,
      symbols: positions.map(p => ({
        symbol: p.symbol as string,
        realized_pnl: Math.round((p.profit_loss as number) * 0.6 * 100) / 100,
        total_bought: Math.round((p.equity as number) * 0.8 * 100) / 100,
        total_sold: Math.round((p.equity as number) * 0.8 * 100 + (p.profit_loss as number) * 0.6 * 100) / 100,
        buy_count: 5,
        sell_count: 3,
        shares_held: p.quantity as number,
        cost_basis: Math.round((p.quantity as number) * (p.avg_buy_price as number) * 100) / 100,
      })),
    };

    const mockOptionPnl = {
      total_realized_pnl: 215.50,
      total_buy_volume: 3200.00,
      total_sell_volume: 3415.50,
      filled_count: 6,
      symbols: [],
    };

    const pnlByPeriod: Record<string, unknown> = {};
    for (const period of ['1W', '1M', '3M', '6M', '1Y', '5Y']) {
      const scale = period === '1W' ? 0.1 : period === '1M' ? 0.3 : period === '3M' ? 0.5 : period === '6M' ? 0.7 : period === '1Y' ? 1.0 : 1.5;
      pnlByPeriod[period] = {
        stock: {
          ...mockStockPnl,
          total_realized_pnl: Math.round(mockStockPnl.total_realized_pnl * scale * 100) / 100,
          total_buy_volume: Math.round(mockStockPnl.total_buy_volume * scale * 100) / 100,
          total_sell_volume: Math.round(mockStockPnl.total_sell_volume * scale * 100) / 100,
          filled_count: Math.max(1, Math.round(mockStockPnl.filled_count * scale)),
        },
        option: {
          ...mockOptionPnl,
          total_realized_pnl: Math.round(mockOptionPnl.total_realized_pnl * scale * 100) / 100,
          total_buy_volume: Math.round(mockOptionPnl.total_buy_volume * scale * 100) / 100,
          total_sell_volume: Math.round(mockOptionPnl.total_sell_volume * scale * 100) / 100,
          filled_count: Math.max(1, Math.round(mockOptionPnl.filled_count * scale)),
        },
      };
    }

    return {
      status: 200,
      body: {
        timestamp: snapshot.timestamp,
        market_data: snapshot.market_data ?? null,
        order_book: openOrders,
        recent_orders: openOrders.slice(0, 5),
        recent_option_orders: [],
        recent_pnl: mockStockPnl,
        option_pnl: mockOptionPnl,
        combined_7d_pnl: Math.round((mockStockPnl.total_realized_pnl + mockOptionPnl.total_realized_pnl) * 0.1 * 100) / 100,
        pnl_by_period: pnlByPeriod,
        portfolio: {
          cash,
          equity: account?.equity ?? (stockMarketValue + (cash.cash as number ?? 0)),
          rh_market_value: null,
          market_value: stockMarketValue + (cash.cash as number ?? 0),
          stock_market_value: stockMarketValue,
          options_market_value: 0,
          margin_used: 0,
          reconciliation: {
            rh_equity: account?.equity ?? stockMarketValue,
            computed_equity: stockMarketValue + (cash.cash as number ?? 0),
          },
          positions,
          open_orders: openOrders,
          open_option_orders: [],
          options: [],
          options_summary: null,
          total_pl: Math.round(totalPl * 100) / 100,
          total_pl_pct: Math.round(totalPlPct * 100) / 100,
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
