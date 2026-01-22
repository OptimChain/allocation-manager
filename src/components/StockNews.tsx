import { useState, useEffect } from 'react';
import { Newspaper, ExternalLink, Clock, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import {
  NewsArticle,
  NewsResponse,
  getAllPortfolioNews,
  NEWS_ASSETS,
} from '../services/finnhubNewsService';

interface StockNewsProps {
  articlesPerAsset?: number;
  daysBack?: number;
}

// Format timestamp to relative time (e.g., "2 hours ago")
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp * 1000; // Convert to milliseconds

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
};

// Truncate text to a certain length
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
};

interface NewsCardProps {
  article: NewsArticle;
  assetColor?: string;
}

function NewsCard({ article, assetColor }: NewsCardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-all hover:border-gray-300"
    >
      <div className="flex">
        {/* Thumbnail */}
        {article.image && !imageError ? (
          <div className="w-24 h-24 flex-shrink-0 bg-gray-100">
            <img
              src={article.image}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
            />
          </div>
        ) : (
          <div className="w-24 h-24 flex-shrink-0 bg-gray-100 flex items-center justify-center">
            <Newspaper className="w-8 h-8 text-gray-300" />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {assetColor && (
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: assetColor }}
              />
            )}
            <span className="text-xs text-gray-500 truncate">{article.source}</span>
            <span className="text-xs text-gray-400">|</span>
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatRelativeTime(article.datetime)}
            </span>
          </div>
          <h3 className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">
            {article.headline}
          </h3>
          {article.summary && (
            <p className="text-xs text-gray-500 line-clamp-2">
              {truncateText(article.summary, 120)}
            </p>
          )}
        </div>

        {/* External link icon */}
        <div className="flex items-center px-3">
          <ExternalLink className="w-4 h-4 text-gray-300" />
        </div>
      </div>
    </a>
  );
}

export default function StockNews({ articlesPerAsset = 5, daysBack = 7 }: StockNewsProps) {
  const [newsData, setNewsData] = useState<NewsResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const fetchNews = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await getAllPortfolioNews(daysBack, articlesPerAsset);
      setNewsData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch news');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, [daysBack, articlesPerAsset]);

  // Filter news based on selected asset
  const filteredNews = selectedAsset
    ? newsData.filter((n) => n.symbol === selectedAsset)
    : newsData;

  // Get all articles from filtered news
  const allArticles = filteredNews.flatMap((n) => {
    const asset = NEWS_ASSETS.find((a) => a.symbol === n.symbol);
    return n.articles.map((article) => ({
      ...article,
      assetColor: asset?.color,
      assetName: n.displayName,
    }));
  });

  // Sort by date (newest first)
  const sortedArticles = allArticles.sort((a, b) => b.datetime - a.datetime);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Newspaper className="w-5 h-5 text-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Latest Stock News</h2>
        </div>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse flex gap-3">
              <div className="w-24 h-24 bg-gray-200 rounded-lg flex-shrink-0"></div>
              <div className="flex-1">
                <div className="h-3 bg-gray-200 rounded w-1/4 mb-2"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-full"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Newspaper className="w-5 h-5 text-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Latest Stock News</h2>
        </div>
        <div className="text-center py-6">
          <p className="text-sm text-red-600 mb-3">{error}</p>
          <button
            onClick={() => fetchNews()}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Newspaper className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Latest Stock News</h2>
              <p className="text-xs text-gray-500">Powered by Finnhub</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchNews(true)}
              disabled={refreshing}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              title="Refresh news"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Asset filter tabs */}
        {expanded && (
          <div className="flex gap-1 mt-4 flex-wrap">
            <button
              onClick={() => setSelectedAsset(null)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                selectedAsset === null
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            {NEWS_ASSETS.map((asset) => (
              <button
                key={asset.symbol}
                onClick={() => setSelectedAsset(asset.symbol)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                  selectedAsset === asset.symbol
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: asset.color }}
                />
                {asset.displayName}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* News list */}
      {expanded && (
        <div className="p-4">
          {sortedArticles.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Newspaper className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No news articles found</p>
              <p className="text-xs text-gray-400 mt-1">
                {selectedAsset ? 'Try selecting a different asset' : 'Check back later'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedArticles.map((article) => (
                <NewsCard
                  key={article.id}
                  article={article}
                  assetColor={article.assetColor}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
