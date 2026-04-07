import { useState, useEffect } from 'react';
import { Newspaper, ExternalLink, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { getMarketNews, getBtcNews, NewsArticle } from '../services/newsService';

const TICKER_FILTERS = [
  { label: 'All', value: '' },
  { label: 'BTC', value: 'BTC' },
  { label: 'SPY', value: 'SPY' },
  { label: 'QQQ', value: 'QQQ' },
  { label: 'AAPL', value: 'AAPL' },
  { label: 'NVDA', value: 'NVDA' },
  { label: 'TSLA', value: 'TSLA' },
];

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NewsSummary() {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState('');
  const [expanded, setExpanded] = useState(true);

  const fetchNews = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = selectedTicker === 'BTC'
        ? await getBtcNews(10)
        : await getMarketNews(selectedTicker || undefined, 10);
      setArticles(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch news');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, [selectedTicker]);

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-900">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left"
        >
          <Newspaper className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Market News</h3>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          )}
        </button>
        <button
          onClick={() => fetchNews(true)}
          disabled={refreshing}
          className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
          title="Refresh news"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {expanded && (
        <>
          {/* Ticker filters */}
          <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-100 dark:border-zinc-900 overflow-x-auto">
            {TICKER_FILTERS.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setSelectedTicker(filter.value)}
                className={`px-3 py-1 rounded text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedTicker === filter.value
                    ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                    : 'bg-gray-100 dark:bg-zinc-900 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="divide-y divide-gray-100 dark:divide-zinc-900">
            {loading ? (
              <div className="px-6 py-12 text-center">
                <Newspaper className="w-8 h-8 text-gray-300 dark:text-gray-600 animate-pulse mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Loading news...</p>
              </div>
            ) : error ? (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-red-500 mb-2">{error}</p>
                <button
                  onClick={() => fetchNews()}
                  className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : articles.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">No news articles found.</p>
              </div>
            ) : (
              articles.map((article) => (
                <a
                  key={article.id}
                  href={article.article_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-4 px-6 py-4 hover:bg-gray-50 dark:hover:bg-zinc-900 transition-colors group"
                >
                  {article.image_url && (
                    <img
                      src={article.image_url}
                      alt=""
                      className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors line-clamp-2">
                        {article.title}
                      </h4>
                      <ExternalLink className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 flex-shrink-0 mt-0.5" />
                    </div>
                    {article.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                        {article.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      {article.publisher?.name && (
                        <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                          {article.publisher.name}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {timeAgo(article.published_utc)}
                      </span>
                      {article.tickers.length > 0 && (
                        <div className="flex gap-1">
                          {article.tickers.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 bg-gray-100 dark:bg-zinc-900 text-gray-500 dark:text-gray-400 rounded text-xs"
                            >
                              {t}
                            </span>
                          ))}
                          {article.tickers.length > 3 && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              +{article.tickers.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </a>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
