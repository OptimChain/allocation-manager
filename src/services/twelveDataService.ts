// Twelve Data API Service
// Documentation: https://twelvedata.com/docs

const TWELVE_DATA_API = 'https://api.twelvedata.com';

export interface TimeSeriesData {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface TimeSeriesResponse {
  meta: {
    symbol: string;
    interval: string;
    currency: string;
    exchange: string;
    type: string;
  };
  values: TimeSeriesData[];
  status?: string;
  message?: string;
}

export interface NormalizedPriceData {
  date: string;
  timestamp: number;
  price: number;
}

export interface PortfolioAsset {
  symbol: string;
  displayName: string;
  color: string;
  data: NormalizedPriceData[];
}

const getApiKey = (): string => {
  const key = import.meta.env.VITE_TWELVE_DATA_API_KEY;
  if (!key) {
    throw new Error('VITE_TWELVE_DATA_API_KEY environment variable is not set');
  }
  return key;
};

// Map time ranges to output sizes and intervals
const RANGE_CONFIG: Record<string, { outputsize: number; interval: string }> = {
  '1M': { outputsize: 22, interval: '1day' },
  '3M': { outputsize: 66, interval: '1day' },
  '6M': { outputsize: 130, interval: '1day' },
  '1Y': { outputsize: 252, interval: '1day' },
  '5Y': { outputsize: 260, interval: '1week' },
};

export async function getTimeSeries(
  symbol: string,
  range: string = '1Y'
): Promise<NormalizedPriceData[]> {
  const config = RANGE_CONFIG[range] || RANGE_CONFIG['1Y'];
  const apiKey = getApiKey();

  const url = new URL(`${TWELVE_DATA_API}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', config.interval);
  url.searchParams.set('outputsize', config.outputsize.toString());
  url.searchParams.set('apikey', apiKey);

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Failed to fetch ${symbol}: ${response.status}`);
  }

  const data: TimeSeriesResponse = await response.json();

  if (data.status === 'error') {
    throw new Error(data.message || `API error for ${symbol}`);
  }

  // Normalize and reverse to chronological order (oldest first)
  return data.values
    .map((item) => ({
      date: item.datetime,
      timestamp: new Date(item.datetime).getTime(),
      price: parseFloat(item.close),
    }))
    .reverse();
}

// Portfolio assets configuration
export const PORTFOLIO_ASSETS = [
  { symbol: 'BTC/USD', displayName: 'Bitcoin', color: '#F7931A' },
  { symbol: 'QQQ', displayName: 'QQQ (Nasdaq)', color: '#8B5CF6' },
  { symbol: 'SPY', displayName: 'S&P 500', color: '#3B82F6' },
  { symbol: 'AMZN', displayName: 'Amazon', color: '#FF9900' },
];

export async function getPortfolioData(
  range: string = '1Y'
): Promise<PortfolioAsset[]> {
  const results = await Promise.all(
    PORTFOLIO_ASSETS.map(async (asset) => {
      const data = await getTimeSeries(asset.symbol, range);
      return {
        ...asset,
        data,
      };
    })
  );

  return results;
}
