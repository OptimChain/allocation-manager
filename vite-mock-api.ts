/**
 * Vite dev plugin — serves mock data from shared/mocks/ on Netlify function endpoints.
 *
 * Usage: `npm run dev:mock` starts Vite with this plugin active.
 * All /.netlify/functions/* requests return realistic mock data seeded from live market data.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Plugin } from 'vite';

const MOCK_DIR = path.resolve(__dirname, '../shared/mocks');

// Import the production enrichSnapshot function directly — the mock and the
// deployed Netlify function share the exact same P&L computation code.
const require_ = createRequire(import.meta.url);
const { enrichSnapshot } = require_('./netlify/functions/enriched-snapshot.cjs') as {
  enrichSnapshot: (raw: Record<string, unknown>) => Record<string, unknown>;
};

function loadMock(name: string): unknown {
  const file = path.join(MOCK_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/**
 * Build a raw snapshot in the shape `order-book-snapshot` returns, from
 * the local mock fixtures. Then let the production enrichSnapshot do the work.
 */
function buildRawSnapshot(): Record<string, unknown> | null {
  const snapshot = loadMock('order_book_snapshot') as Record<string, unknown> | null;
  if (!snapshot) return null;
  const historicalOrders = (loadMock('_historical_orders') ?? []) as Record<string, unknown>[];

  const portfolio = snapshot.portfolio as Record<string, unknown>;

  // Produce the shape order-book-snapshot returns: timestamp, portfolio,
  // order_book, recent_orders, recent_option_orders, market_data
  return {
    timestamp: snapshot.timestamp,
    portfolio: {
      ...portfolio,
      // Pre-populate with live-like equity numbers. enrichSnapshot will
      // compute stock_market_value / options_market_value / reconciliation.
      equity: (portfolio.equity ?? 0) as number,
      market_value: (portfolio.market_value ?? 0) as number,
    },
    order_book: snapshot.order_book ?? [],
    recent_orders: historicalOrders,
    recent_option_orders: [],
    market_data: snapshot.market_data ?? null,
  };
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

  // Enriched snapshot — delegates to the production enrichSnapshot function
  // (netlify/functions/enriched-snapshot.cjs) so the local mock UI sees the
  // exact same response shape and P&L math as production.
  if (fn === 'enriched-snapshot') {
    const raw = buildRawSnapshot();
    if (!raw) return null;
    return { status: 200, body: enrichSnapshot(raw) };
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
