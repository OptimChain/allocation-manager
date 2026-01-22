// Finnhub News API Service
// Documentation: https://finnhub.io/docs/api/company-news
// Free tier: 30 API calls/second

const FINNHUB_API = 'https://finnhub.io/api/v1';

export interface NewsArticle {
  id: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image: string;
  datetime: number;
  related: string;
  category: string;
}

export interface NewsResponse {
  articles: NewsArticle[];
  symbol: string;
  displayName: string;
}

const getApiKey = (): string => {
  const key = import.meta.env.VITE_FINNHUB_API_KEY;
  if (!key) {
    throw new Error('VITE_FINNHUB_API_KEY environment variable is not set');
  }
  return key;
};

// Get date string in YYYY-MM-DD format
const formatDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

// For news, we use standard stock symbols (crypto news uses different endpoint)
const NEWS_SYMBOL_MAP: Record<string, string | null> = {
  'BTC/USD': null, // We'll use market news for crypto
  'QQQ': 'QQQ',
  'SPY': 'SPY',
  'AMZN': 'AMZN',
};

export async function getCompanyNews(
  symbol: string,
  daysBack: number = 7
): Promise<NewsArticle[]> {
  const apiKey = getApiKey();
  const newsSymbol = NEWS_SYMBOL_MAP[symbol] ?? symbol;

  // For crypto, return empty (we'll fetch market news separately)
  if (newsSymbol === null) {
    return [];
  }

  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - daysBack);

  const url = new URL(`${FINNHUB_API}/company-news`);
  url.searchParams.set('symbol', newsSymbol);
  url.searchParams.set('from', formatDate(fromDate));
  url.searchParams.set('to', formatDate(toDate));
  url.searchParams.set('token', apiKey);

  const response = await fetch(url.toString());

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    throw new Error(`Failed to fetch news for ${symbol}: ${response.status}`);
  }

  const data: NewsArticle[] = await response.json();
  return data;
}

export async function getMarketNews(category: string = 'general'): Promise<NewsArticle[]> {
  const apiKey = getApiKey();

  const url = new URL(`${FINNHUB_API}/news`);
  url.searchParams.set('category', category);
  url.searchParams.set('token', apiKey);

  const response = await fetch(url.toString());

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    throw new Error(`Failed to fetch market news: ${response.status}`);
  }

  const data: NewsArticle[] = await response.json();
  return data;
}

// Get crypto news (includes Bitcoin news from market news)
export async function getCryptoNews(): Promise<NewsArticle[]> {
  const apiKey = getApiKey();

  const url = new URL(`${FINNHUB_API}/news`);
  url.searchParams.set('category', 'crypto');
  url.searchParams.set('token', apiKey);

  const response = await fetch(url.toString());

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    throw new Error(`Failed to fetch crypto news: ${response.status}`);
  }

  const data: NewsArticle[] = await response.json();
  return data;
}

// Asset configuration matching twelveDataService
export const NEWS_ASSETS = [
  { symbol: 'BTC/USD', displayName: 'Bitcoin', color: '#F7931A', isCrypto: true },
  { symbol: 'QQQ', displayName: 'QQQ (Nasdaq)', color: '#8B5CF6', isCrypto: false },
  { symbol: 'SPY', displayName: 'S&P 500', color: '#3B82F6', isCrypto: false },
  { symbol: 'AMZN', displayName: 'Amazon', color: '#FF9900', isCrypto: false },
];

export async function getAllPortfolioNews(
  daysBack: number = 7,
  articlesPerAsset: number = 5
): Promise<NewsResponse[]> {
  const results: NewsResponse[] = [];

  // Fetch news for each asset
  for (const asset of NEWS_ASSETS) {
    try {
      let articles: NewsArticle[];

      if (asset.isCrypto) {
        articles = await getCryptoNews();
      } else {
        articles = await getCompanyNews(asset.symbol, daysBack);
      }

      // Limit articles per asset and sort by date (newest first)
      const sortedArticles = articles
        .sort((a, b) => b.datetime - a.datetime)
        .slice(0, articlesPerAsset);

      results.push({
        articles: sortedArticles,
        symbol: asset.symbol,
        displayName: asset.displayName,
      });
    } catch (error) {
      console.error(`Failed to fetch news for ${asset.symbol}:`, error);
      results.push({
        articles: [],
        symbol: asset.symbol,
        displayName: asset.displayName,
      });
    }
  }

  return results;
}

// Get combined news feed (all assets mixed and sorted by date)
export async function getCombinedNewsFeed(
  daysBack: number = 7,
  maxArticles: number = 20
): Promise<(NewsArticle & { assetSymbol: string; assetName: string })[]> {
  const portfolioNews = await getAllPortfolioNews(daysBack, 10);

  const combined = portfolioNews.flatMap((response) =>
    response.articles.map((article) => ({
      ...article,
      assetSymbol: response.symbol,
      assetName: response.displayName,
    }))
  );

  // Sort by date and limit
  return combined
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, maxArticles);
}
