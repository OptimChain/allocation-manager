// Robinhood Portfolio Netlify Function
// Fetches portfolio data from Robinhood API
// Uses Netlify Blobs for token persistence

const tokenStore = require('./lib/tokenStore.cjs');

const ROBINHOOD_API_BASE = 'https://api.robinhood.com';

// In-memory instrument cache to avoid redundant API calls
const instrumentCache = {};
const optionsInstrumentCache = {};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/**
 * Get authentication token from Blob store.
 */
async function getAuthToken() {
  const token = await tokenStore.getToken();
  if (!token) {
    throw new Error('Not authenticated. Connect to Robinhood first.');
  }
  return token;
}

async function fetchWithAuth(endpoint) {
  const token = await getAuthToken();

  const response = await fetch(`${ROBINHOOD_API_BASE}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Token expired, clear cache
      await tokenStore.clearToken();
      throw new Error('Session expired. Please reconnect to Robinhood.');
    }
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

async function getPortfolio() {
  const [accounts, positions] = await Promise.all([
    fetchWithAuth('/accounts/'),
    fetchWithAuth('/positions/?nonzero=true'),
  ]);

  const account = accounts.results?.[0];
  if (!account) {
    throw new Error('No Robinhood account found');
  }

  // Get portfolio value
  const portfolioUrl = account.portfolio?.replace(ROBINHOOD_API_BASE, '') || '/portfolios/';
  const portfolio = await fetchWithAuth(portfolioUrl);

  // Process positions
  const positionsData = positions.results || [];

  // Fetch instrument details for each position
  const enrichedPositions = await Promise.all(
    positionsData.map(async (position) => {
      try {
        const instrumentUrl = position.instrument.replace(ROBINHOOD_API_BASE, '');
        const instrument = await fetchWithAuth(instrumentUrl);

        // Get current quote
        const quoteUrl = `/quotes/${instrument.symbol}/`;
        let quote = null;
        try {
          quote = await fetchWithAuth(quoteUrl);
        } catch (e) {
          console.warn(`Could not fetch quote for ${instrument.symbol}`);
        }

        const quantity = parseFloat(position.quantity);
        const averageCost = parseFloat(position.average_buy_price);
        const currentPrice = quote ? parseFloat(quote.last_trade_price) : averageCost;
        const totalCost = quantity * averageCost;
        const currentValue = quantity * currentPrice;
        const gain = currentValue - totalCost;
        const gainPercent = totalCost > 0 ? (gain / totalCost) * 100 : 0;

        return {
          symbol: instrument.symbol,
          name: instrument.simple_name || instrument.name,
          quantity: quantity,
          averageCost: averageCost,
          currentPrice: currentPrice,
          totalCost: totalCost,
          currentValue: currentValue,
          gain: gain,
          gainPercent: gainPercent,
        };
      } catch (e) {
        console.error('Error processing position:', e);
        return null;
      }
    })
  );

  return {
    accountNumber: account.account_number,
    buyingPower: parseFloat(account.buying_power || 0),
    cash: parseFloat(account.cash || 0),
    portfolioValue: parseFloat(portfolio.equity || 0),
    extendedHoursValue: parseFloat(portfolio.extended_hours_equity || portfolio.equity || 0),
    totalGain: parseFloat(portfolio.equity || 0) - parseFloat(portfolio.adjusted_equity_previous_close || portfolio.equity || 0),
    positions: enrichedPositions.filter(p => p !== null),
  };
}

async function getRecentOrders() {
  const orders = await fetchWithAuth('/orders/?updated_at[gte]=2024-01-01');

  const enrichedOrders = await Promise.all(
    (orders.results || []).slice(0, 50).map(async (order) => {
      try {
        const instrumentUrl = order.instrument.replace(ROBINHOOD_API_BASE, '');
        const instrument = await fetchWithAuth(instrumentUrl);

        return {
          id: order.id,
          symbol: instrument.symbol,
          name: instrument.simple_name || instrument.name,
          side: order.side,
          type: order.type,
          quantity: parseFloat(order.quantity),
          price: parseFloat(order.price || order.average_price || 0),
          state: order.state,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
        };
      } catch (e) {
        return null;
      }
    })
  );

  return enrichedOrders.filter(o => o !== null);
}

async function getInstrument(instrumentUrl) {
  const key = instrumentUrl.replace(ROBINHOOD_API_BASE, '');
  if (instrumentCache[key]) return instrumentCache[key];
  const instrument = await fetchWithAuth(key);
  instrumentCache[key] = instrument;
  return instrument;
}

async function getOptionsInstrument(optionUrl) {
  const key = optionUrl.replace(ROBINHOOD_API_BASE, '');
  if (optionsInstrumentCache[key]) return optionsInstrumentCache[key];
  const instrument = await fetchWithAuth(key);
  optionsInstrumentCache[key] = instrument;
  return instrument;
}

async function getOptionsPositions() {
  const data = await fetchWithAuth('/options/aggregate_positions/?nonzero=true');
  const positions = data.results || [];

  const enriched = await Promise.all(
    positions.map(async (pos) => {
      try {
        const quantity = parseFloat(pos.quantity);
        if (quantity === 0) return null;

        const multiplier = parseFloat(pos.trade_value_multiplier) || 100;
        const avgOpenPrice = parseFloat(pos.average_open_price);

        // Resolve the first leg to get strike/expiration/type
        const legs = pos.legs || [];
        let strike = null;
        let expiration = null;
        let optionType = null;
        let optionUrl = null;

        if (legs.length > 0 && legs[0].option) {
          const optionInstrument = await getOptionsInstrument(legs[0].option);
          strike = parseFloat(optionInstrument.strike_price);
          expiration = optionInstrument.expiration_date;
          optionType = optionInstrument.type;
          optionUrl = legs[0].option;
        }

        // Fetch current market data for mark price
        let markPrice = null;
        if (optionUrl) {
          try {
            const encodedUrl = encodeURIComponent(optionUrl);
            const marketData = await fetchWithAuth(
              `/marketdata/options/?instruments=${encodedUrl}`
            );
            if (marketData.results && marketData.results.length > 0) {
              markPrice = parseFloat(marketData.results[0].adjusted_mark_price)
                || parseFloat(marketData.results[0].mark_price)
                || null;
            }
          } catch (e) {
            console.warn(`Could not fetch market data for option: ${pos.symbol}`);
          }
        }

        const totalCost = avgOpenPrice * quantity * multiplier;
        const currentValue = markPrice !== null
          ? markPrice * quantity * multiplier
          : totalCost;
        const gain = currentValue - totalCost;
        const gainPercent = totalCost !== 0 ? (gain / Math.abs(totalCost)) * 100 : 0;

        return {
          symbol: pos.symbol || pos.chain_symbol,
          strategy: pos.strategy,
          direction: pos.direction,
          optionType: optionType,
          strike: strike,
          expiration: expiration,
          quantity: quantity,
          avgOpenPrice: avgOpenPrice,
          markPrice: markPrice,
          multiplier: multiplier,
          totalCost: totalCost,
          currentValue: currentValue,
          gain: gain,
          gainPercent: gainPercent,
        };
      } catch (e) {
        console.error('Error processing options position:', e);
        return null;
      }
    })
  );

  return {
    positions: enriched.filter(p => p !== null),
  };
}

async function getAllFilledOrders() {
  let url = '/orders/?updated_at[gte]=2024-01-01';
  const allOrders = [];

  while (url) {
    const data = await fetchWithAuth(url);
    const filled = (data.results || []).filter(o => o.state === 'filled');
    allOrders.push(...filled);
    url = data.next ? data.next.replace(ROBINHOOD_API_BASE, '') : null;
  }

  return allOrders;
}

async function calculateOrderPnL() {
  const filledOrders = await getAllFilledOrders();

  // Enrich with instrument data
  const enriched = (await Promise.all(
    filledOrders.map(async (order) => {
      try {
        const instrument = await getInstrument(order.instrument);
        return {
          id: order.id,
          symbol: instrument.symbol,
          name: instrument.simple_name || instrument.name,
          side: order.side,
          quantity: parseFloat(order.quantity),
          price: parseFloat(order.average_price || order.price || 0),
          total: parseFloat(order.quantity) * parseFloat(order.average_price || order.price || 0),
          createdAt: order.created_at,
        };
      } catch (e) {
        return null;
      }
    })
  )).filter(o => o !== null);

  // Sort chronologically (oldest first) for cost basis calculation
  enriched.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Group by symbol and calculate P&L using weighted average cost basis
  const symbolMap = {};
  for (const order of enriched) {
    if (!symbolMap[order.symbol]) {
      symbolMap[order.symbol] = {
        symbol: order.symbol,
        name: order.name,
        realizedPnL: 0,
        totalBought: 0,
        totalSold: 0,
        buyCount: 0,
        sellCount: 0,
        totalBuyShares: 0,
        totalSellShares: 0,
        sharesHeld: 0,
        costBasis: 0,
      };
    }
    const s = symbolMap[order.symbol];
    const total = order.quantity * order.price;

    if (order.side === 'buy') {
      s.sharesHeld += order.quantity;
      s.costBasis += total;
      s.totalBought += total;
      s.totalBuyShares += order.quantity;
      s.buyCount++;
    } else if (order.side === 'sell') {
      const avgCost = s.sharesHeld > 0 ? s.costBasis / s.sharesHeld : 0;
      const realizedGain = (order.price - avgCost) * order.quantity;
      s.realizedPnL += realizedGain;
      s.costBasis -= avgCost * order.quantity;
      s.sharesHeld -= order.quantity;
      s.totalSold += total;
      s.totalSellShares += order.quantity;
      s.sellCount++;
    }
  }

  const symbols = Object.values(symbolMap).map(s => ({
    symbol: s.symbol,
    name: s.name,
    realizedPnL: Math.round(s.realizedPnL * 100) / 100,
    totalBought: Math.round(s.totalBought * 100) / 100,
    totalSold: Math.round(s.totalSold * 100) / 100,
    buyCount: s.buyCount,
    sellCount: s.sellCount,
    avgBuyPrice: s.totalBuyShares > 0
      ? Math.round((s.totalBought / s.totalBuyShares) * 100) / 100
      : 0,
    avgSellPrice: s.totalSellShares > 0
      ? Math.round((s.totalSold / s.totalSellShares) * 100) / 100
      : 0,
    remainingShares: Math.round(s.sharesHeld * 10000) / 10000,
    remainingCostBasis: Math.round(s.costBasis * 100) / 100,
  }));

  // Sort by absolute realized P&L (biggest movers first)
  symbols.sort((a, b) => Math.abs(b.realizedPnL) - Math.abs(a.realizedPnL));

  return {
    totalRealizedPnL: Math.round(symbols.reduce((sum, s) => sum + s.realizedPnL, 0) * 100) / 100,
    totalBuyVolume: Math.round(symbols.reduce((sum, s) => sum + s.totalBought, 0) * 100) / 100,
    totalSellVolume: Math.round(symbols.reduce((sum, s) => sum + s.totalSold, 0) * 100) / 100,
    symbols,
    orders: enriched.reverse(), // most recent first for display
  };
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const action = event.queryStringParameters?.action || 'portfolio';

    let data;
    switch (action) {
      case 'status':
        data = await tokenStore.getAuthStatus();
        break;

      case 'portfolio':
        data = await getPortfolio();
        break;

      case 'orders':
        data = await getRecentOrders();
        break;

      case 'pnl':
        data = await calculateOrderPnL();
        break;

      case 'options':
        data = await getOptionsPositions();
        break;

      default:
        throw new Error(`Unknown action: ${action}. Available: status, portfolio, orders, pnl, options`);
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('Robinhood API error:', error);

    const isAuthError = error.message.includes('Not authenticated') || error.message.includes('expired');

    return {
      statusCode: isAuthError ? 401 : 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: error.message || 'An error occurred',
        requiresAuth: isAuthError,
      }),
    };
  }
};
