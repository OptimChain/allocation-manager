// News service - fetches market news via Netlify function proxies
// Calls multiple sources in parallel and merges results for broader coverage
// Polygon.io + Finnhub for equities, CoinDesk + Finnhub for BTC/crypto

export interface NewsPublisher {
  name: string;
  logo_url: string | null;
  favicon_url: string | null;
}

export interface NewsArticle {
  id: string;
  title: string;
  author: string;
  published_utc: string;
  article_url: string;
  image_url: string | null;
  description: string;
  tickers: string[];
  publisher: NewsPublisher | null;
}

export interface NewsResponse {
  results: NewsArticle[];
  count: number;
  error?: string;
}

// Deduplicate by article_url, then sort newest-first and limit
function mergeAndDedupe(
  arrays: NewsArticle[][],
  limit: number
): NewsArticle[] {
  const seen = new Set<string>();
  const merged: NewsArticle[] = [];

  for (const articles of arrays) {
    for (const article of articles) {
      const key = article.article_url || article.id;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(article);
      }
    }
  }

  merged.sort(
    (a, b) =>
      new Date(b.published_utc).getTime() - new Date(a.published_utc).getTime()
  );

  return merged.slice(0, limit);
}

async function fetchJson(url: string): Promise<NewsResponse> {
  const response = await fetch(url);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function getMarketNews(
  ticker?: string,
  limit = 10
): Promise<NewsResponse> {
  // Build URLs for both sources
  const polygonParams = new URLSearchParams();
  if (ticker) polygonParams.set('ticker', ticker);
  polygonParams.set('limit', String(limit));

  const finnhubParams = new URLSearchParams();
  finnhubParams.set('limit', String(limit));
  if (ticker) {
    finnhubParams.set('symbol', ticker);
  } else {
    finnhubParams.set('category', 'general');
  }

  // Fire both in parallel — settle so one failure doesn't block the other
  const [polygonResult, finnhubResult] = await Promise.allSettled([
    fetchJson(`/.netlify/functions/polygon-news?${polygonParams}`),
    fetchJson(`/.netlify/functions/finnhub-news?${finnhubParams}`),
  ]);

  const sources: NewsArticle[][] = [];
  if (polygonResult.status === 'fulfilled') sources.push(polygonResult.value.results);
  if (finnhubResult.status === 'fulfilled') sources.push(finnhubResult.value.results);

  if (sources.length === 0) {
    // Both failed — throw the first error
    const err =
      polygonResult.status === 'rejected'
        ? polygonResult.reason
        : finnhubResult.status === 'rejected'
          ? finnhubResult.reason
          : new Error('No news sources available');
    throw err;
  }

  const results = mergeAndDedupe(sources, limit);
  return { results, count: results.length };
}

export async function getBtcNews(limit = 10): Promise<NewsResponse> {
  const coindeskParams = new URLSearchParams();
  coindeskParams.set('limit', String(limit));

  const finnhubParams = new URLSearchParams();
  finnhubParams.set('category', 'crypto');
  finnhubParams.set('limit', String(limit));

  // Fire both in parallel
  const [coindeskResult, finnhubResult] = await Promise.allSettled([
    fetchJson(`/.netlify/functions/coindesk-news?${coindeskParams}`),
    fetchJson(`/.netlify/functions/finnhub-news?${finnhubParams}`),
  ]);

  const sources: NewsArticle[][] = [];
  if (coindeskResult.status === 'fulfilled') sources.push(coindeskResult.value.results);
  if (finnhubResult.status === 'fulfilled') sources.push(finnhubResult.value.results);

  if (sources.length === 0) {
    const err =
      coindeskResult.status === 'rejected'
        ? coindeskResult.reason
        : finnhubResult.status === 'rejected'
          ? finnhubResult.reason
          : new Error('No news sources available');
    throw err;
  }

  const results = mergeAndDedupe(sources, limit);
  return { results, count: results.length };
}
