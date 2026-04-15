// Perplexity News Service
// Fetches AI-curated news for ETF tickers via the Perplexity search API (proxied through Netlify)

import { API_BASE } from '../config/api';

export interface PerplexityNewsItem {
  title: string;
  date: string;
  summary: string;
  impact: 'positive' | 'negative' | 'neutral';
  source: string;
}

export interface PerplexityNewsResponse {
  articles: PerplexityNewsItem[];
  citations: string[];
  ticker: string;
  error?: string;
}

export const NEWS_STRADDLE_TICKERS = [
  { symbol: 'IWN', name: 'iShares Russell 2000 Value', color: '#3B82F6' },
  { symbol: 'CB', name: 'Chubb Limited', color: '#8B5CF6' },
  { symbol: 'AVDV', name: 'Avantis Intl Small Cap Value', color: '#F59E0B' },
  { symbol: 'ISRA', name: 'VanEck Israel ETF', color: '#10B981' },
] as const;

export type NewsStraddleTicker = (typeof NEWS_STRADDLE_TICKERS)[number]['symbol'];

export async function getPerplexityNews(
  ticker: NewsStraddleTicker
): Promise<PerplexityNewsResponse> {
  const params = new URLSearchParams({ ticker });
  const response = await fetch(`${API_BASE}/perplexity-news?${params}`);

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return response.json();
}
