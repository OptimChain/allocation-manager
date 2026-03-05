// Bitcoin Price Service using CoinGecko API (free, no API key needed)
// Documentation: https://www.coingecko.com/en/api/documentation

import endpoints from 'virtual:endpoints';

const COINGECKO_API = endpoints.apis.coingecko;

export interface PriceData {
  timestamp: number;
  price: number;
  date: string;
}

export interface MarketData {
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d: number;
  price_change_percentage_30d: number;
  ath: number;
  ath_date: string;
  atl: number;
  atl_date: string;
  circulating_supply: number;
  max_supply: number;
}

export interface BitcoinData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_24h: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number;
  price_change_percentage_30d_in_currency?: number;
  sparkline_in_7d?: {
    price: number[];
  };
  last_updated: string;
}

// Get current Bitcoin price with market data
export async function getCurrentPrice(currency: string = 'usd'): Promise<BitcoinData> {
  const response = await fetch(
    `${COINGECKO_API}/coins/markets?vs_currency=${currency}&ids=bitcoin&sparkline=true&price_change_percentage=24h,7d,30d`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch current price: ${response.status}`);
  }

  const data = await response.json();
  return data[0];
}

// Get historical price data
export async function getPriceHistory(
  days: number = 30,
  currency: string = 'usd'
): Promise<PriceData[]> {
  const response = await fetch(
    `${COINGECKO_API}/coins/bitcoin/market_chart?vs_currency=${currency}&days=${days}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch price history: ${response.status}`);
  }

  const data = await response.json();

  return data.prices.map(([timestamp, price]: [number, number]) => ({
    timestamp,
    price,
    date: new Date(timestamp).toISOString(),
  }));
}

// Get OHLC (Open, High, Low, Close) data for candlestick charts
export async function getOHLCData(
  days: number = 30,
  currency: string = 'usd'
): Promise<{ timestamp: number; open: number; high: number; low: number; close: number }[]> {
  const response = await fetch(
    `${COINGECKO_API}/coins/bitcoin/ohlc?vs_currency=${currency}&days=${days}`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch OHLC data: ${response.status}`);
  }

  const data = await response.json();

  return data.map(([timestamp, open, high, low, close]: [number, number, number, number, number]) => ({
    timestamp,
    open,
    high,
    low,
    close,
  }));
}

// Get multiple cryptocurrencies for comparison
export async function getMultipleCryptos(
  ids: string[] = ['bitcoin', 'ethereum', 'solana'],
  currency: string = 'usd'
): Promise<BitcoinData[]> {
  const response = await fetch(
    `${COINGECKO_API}/coins/markets?vs_currency=${currency}&ids=${ids.join(',')}&sparkline=true&price_change_percentage=24h,7d,30d`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch crypto prices: ${response.status}`);
  }

  return response.json();
}

// Get detailed Bitcoin info
export async function getBitcoinDetails(): Promise<{
  description: string;
  links: { homepage: string[]; blockchain_site: string[] };
  market_data: MarketData;
}> {
  const response = await fetch(
    `${COINGECKO_API}/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch Bitcoin details: ${response.status}`);
  }

  const data = await response.json();

  return {
    description: data.description?.en || '',
    links: data.links,
    market_data: {
      current_price: data.market_data.current_price.usd,
      market_cap: data.market_data.market_cap.usd,
      total_volume: data.market_data.total_volume.usd,
      price_change_24h: data.market_data.price_change_24h,
      price_change_percentage_24h: data.market_data.price_change_percentage_24h,
      price_change_percentage_7d: data.market_data.price_change_percentage_7d,
      price_change_percentage_30d: data.market_data.price_change_percentage_30d,
      ath: data.market_data.ath.usd,
      ath_date: data.market_data.ath_date.usd,
      atl: data.market_data.atl.usd,
      atl_date: data.market_data.atl_date.usd,
      circulating_supply: data.market_data.circulating_supply,
      max_supply: data.market_data.max_supply,
    },
  };
}

// Simple price check (minimal API call)
export async function getSimplePrice(
  ids: string[] = ['bitcoin'],
  currencies: string[] = ['usd']
): Promise<Record<string, Record<string, number>>> {
  const response = await fetch(
    `${COINGECKO_API}/simple/price?ids=${ids.join(',')}&vs_currencies=${currencies.join(',')}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch simple price: ${response.status}`);
  }

  return response.json();
}

// Format currency for display
export function formatCurrency(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

// Format large numbers (market cap, volume)
export function formatLargeNumber(value: number): string {
  if (value >= 1e12) {
    return `$${(value / 1e12).toFixed(2)}T`;
  }
  if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(2)}B`;
  }
  if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(2)}M`;
  }
  return formatCurrency(value);
}

// Format percentage
export function formatPercentage(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}
