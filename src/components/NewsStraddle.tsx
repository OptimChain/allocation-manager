import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from 'recharts';
import {
  Newspaper,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getTimeSeries, NormalizedPriceData } from '../services/twelveDataService';
import {
  getPerplexityNews,
  PerplexityNewsItem,
  NEWS_STRADDLE_TICKERS,
  NewsStraddleTicker,
} from '../services/perplexityNewsService';
import { formatCurrency } from '../utils/formatters';

// --- Spike detection ---

interface SpikeEvent {
  date: string;
  timestamp: number;
  price: number;
  returnPct: number;
  direction: 'up' | 'down';
  zscore: number;
}

function detectSpikes(data: NormalizedPriceData[], threshold = 2.0): SpikeEvent[] {
  if (data.length < 10) return [];

  const returns: number[] = [];
  for (let i = 1; i < data.length; i++) {
    returns.push((data[i].price - data[i - 1].price) / data[i - 1].price);
  }

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return [];

  const spikes: SpikeEvent[] = [];
  for (let i = 0; i < returns.length; i++) {
    const zscore = (returns[i] - mean) / stdDev;
    if (Math.abs(zscore) >= threshold) {
      const d = data[i + 1];
      spikes.push({
        date: d.date,
        timestamp: d.timestamp,
        price: d.price,
        returnPct: returns[i] * 100,
        direction: returns[i] > 0 ? 'up' : 'down',
        zscore,
      });
    }
  }
  return spikes;
}

// --- Chart data with spike markers ---

interface ChartPoint extends NormalizedPriceData {
  isSpike?: boolean;
  spikeDirection?: 'up' | 'down';
  returnPct?: number;
}

// --- Time ranges ---

const RANGES = [
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
] as const;

// --- Impact icon helper ---

function ImpactIcon({ impact }: { impact: string }) {
  if (impact === 'positive') return <TrendingUp className="w-4 h-4 text-green-500" />;
  if (impact === 'negative') return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-gray-400" />;
}

function ImpactBadge({ impact }: { impact: string }) {
  const colors: Record<string, string> = {
    positive: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    negative: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    neutral: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[impact] || colors.neutral}`}>
      {impact}
    </span>
  );
}

// --- Main component ---

export default function NewsStraddle() {
  const { isDark } = useTheme();
  const [selectedTicker, setSelectedTicker] = useState<NewsStraddleTicker>('IWN');
  const [range, setRange] = useState('1Y');
  const [priceData, setPriceData] = useState<NormalizedPriceData[]>([]);
  const [news, setNews] = useState<PerplexityNewsItem[]>([]);
  const [citations, setCitations] = useState<string[]>([]);
  const [loadingPrice, setLoadingPrice] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [refreshingNews, setRefreshingNews] = useState(false);

  // Fetch price data
  useEffect(() => {
    let cancelled = false;
    async function fetchPrice() {
      setLoadingPrice(true);
      setPriceError(null);
      try {
        const data = await getTimeSeries(selectedTicker, range);
        if (!cancelled) setPriceData(data);
      } catch (err) {
        if (!cancelled) setPriceError(err instanceof Error ? err.message : 'Failed to load prices');
      } finally {
        if (!cancelled) setLoadingPrice(false);
      }
    }
    fetchPrice();
    return () => { cancelled = true; };
  }, [selectedTicker, range]);

  // Fetch news
  const fetchNews = async (isRefresh = false) => {
    if (isRefresh) setRefreshingNews(true);
    else setLoadingNews(true);
    setNewsError(null);
    try {
      const resp = await getPerplexityNews(selectedTicker);
      setNews(resp.articles);
      setCitations(resp.citations || []);
    } catch (err) {
      setNewsError(err instanceof Error ? err.message : 'Failed to load news');
    } finally {
      setLoadingNews(false);
      setRefreshingNews(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, [selectedTicker]);

  // Spike detection
  const spikes = useMemo(() => detectSpikes(priceData, 2.0), [priceData]);

  // Chart data
  const chartData: ChartPoint[] = useMemo(() => {
    const spikeTimestamps = new Set(spikes.map((s) => s.timestamp));
    const spikeMap = new Map(spikes.map((s) => [s.timestamp, s]));
    return priceData.map((d) => ({
      ...d,
      isSpike: spikeTimestamps.has(d.timestamp),
      spikeDirection: spikeMap.get(d.timestamp)?.direction,
      returnPct: spikeMap.get(d.timestamp)?.returnPct,
    }));
  }, [priceData, spikes]);

  // Merge news dates with spike dates for annotation
  const newsDateSet = useMemo(() => new Set(news.map((n) => n.date)), [news]);

  const tickerConfig = NEWS_STRADDLE_TICKERS.find((t) => t.symbol === selectedTicker)!;
  const axisColor = isDark ? '#a1a1aa' : '#71717a';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';

  const minPrice = priceData.length > 0 ? Math.min(...priceData.map((d) => d.price)) : 0;
  const maxPrice = priceData.length > 0 ? Math.max(...priceData.map((d) => d.price)) : 100;
  const padding = (maxPrice - minPrice) * 0.05;

  const estOpts: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York' };

  const formatXAxis = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { ...estOpts, month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* Strategy description */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <Zap className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              News Straddle
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mt-1 text-sm leading-relaxed">
              Buy a put and a call when a price spike is detected. Spikes are identified as daily
              returns exceeding 2 standard deviations from the rolling mean. News context from
              Perplexity AI helps label what drove each event. Tracks IWN, CB, AVDV, and ISRA.
            </p>
          </div>
        </div>
      </div>

      {/* Ticker selector + range */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-2">
          {NEWS_STRADDLE_TICKERS.map((t) => (
            <button
              key={t.symbol}
              onClick={() => setSelectedTicker(t.symbol as NewsStraddleTicker)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                selectedTicker === t.symbol
                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
              }`}
            >
              {t.symbol}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                range === r.value
                  ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400 ml-auto">
          {spikes.length} spike{spikes.length !== 1 ? 's' : ''} detected
        </div>
      </div>

      {/* Price chart with spike dots */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          {tickerConfig.name} ({selectedTicker})
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Price with spike events highlighted
        </p>

        {loadingPrice ? (
          <div className="h-[350px] flex items-center justify-center">
            <div className="text-center">
              <div className="h-6 w-6 border-2 border-gray-300 dark:border-gray-600 border-t-gray-800 dark:border-t-gray-200 rounded-full animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading price data...</p>
            </div>
          </div>
        ) : priceError ? (
          <div className="h-[350px] flex items-center justify-center">
            <div className="text-center">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-500">{priceError}</p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="timestamp"
                type="category"
                tickFormatter={formatXAxis}
                tick={{ fontSize: 11, fill: axisColor }}
                axisLine={{ stroke: gridColor }}
                tickLine={{ stroke: gridColor }}
                interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
              />
              <YAxis
                domain={[minPrice - padding, maxPrice + padding]}
                tickFormatter={(v) => formatCurrency(v)}
                tick={{ fontSize: 11, fill: axisColor }}
                axisLine={{ stroke: gridColor }}
                tickLine={{ stroke: gridColor }}
                width={70}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const d = payload[0].payload as ChartPoint;
                    return (
                      <div className="bg-white dark:bg-zinc-900 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-800 text-xs">
                        <p className="text-gray-500 dark:text-gray-400 mb-1">{d.date}</p>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {formatCurrency(d.price)}
                        </p>
                        {d.isSpike && (
                          <p className={`mt-1 font-medium ${d.spikeDirection === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                            Spike: {d.returnPct! > 0 ? '+' : ''}{d.returnPct!.toFixed(2)}%
                          </p>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke={tickerConfig.color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              {/* Spike dots */}
              {spikes.map((spike, i) => (
                <ReferenceDot
                  key={i}
                  x={spike.timestamp}
                  y={spike.price}
                  r={5}
                  fill={spike.direction === 'up' ? '#22c55e' : '#ef4444'}
                  stroke={isDark ? '#18181b' : '#ffffff'}
                  strokeWidth={2}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {/* Spike legend */}
        {!loadingPrice && !priceError && spikes.length > 0 && (
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
              Positive spike (&gt;2&sigma;)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
              Negative spike (&lt;-2&sigma;)
            </span>
          </div>
        )}
      </div>

      {/* Two-column: Spike events + News feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Spike events table */}
        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Spike Events
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Days with |return| &gt; 2&sigma;
            </p>
          </div>
          {loadingPrice ? (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              Loading...
            </div>
          ) : spikes.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No spikes detected in this period.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-zinc-900 max-h-[400px] overflow-y-auto">
              {spikes
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((spike, i) => {
                  const hasNews = newsDateSet.has(spike.date);
                  return (
                    <div key={i} className="px-6 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {spike.date}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatCurrency(spike.price)}
                          {hasNews && (
                            <span className="ml-2 text-amber-500">
                              <Newspaper className="w-3 h-3 inline" /> news
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <span
                          className={`text-sm font-semibold ${
                            spike.direction === 'up' ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {spike.returnPct > 0 ? '+' : ''}
                          {spike.returnPct.toFixed(2)}%
                        </span>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          z={spike.zscore.toFixed(1)}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Rolling news feed */}
        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-900">
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                News Feed
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                via Perplexity AI &middot; {selectedTicker}
              </p>
            </div>
            <button
              onClick={() => fetchNews(true)}
              disabled={refreshingNews}
              className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
              title="Refresh news"
            >
              <RefreshCw className={`w-4 h-4 ${refreshingNews ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loadingNews ? (
            <div className="p-6 text-center">
              <Newspaper className="w-8 h-8 text-gray-300 dark:text-gray-600 animate-pulse mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Fetching news...</p>
            </div>
          ) : newsError ? (
            <div className="p-6 text-center">
              <p className="text-sm text-red-500 mb-2">{newsError}</p>
              <button
                onClick={() => fetchNews()}
                className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : news.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No news found for {selectedTicker}.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-zinc-900 max-h-[400px] overflow-y-auto">
              {news.map((item, i) => (
                <div key={i} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <ImpactIcon impact={item.impact} />
                        <h4 className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2">
                          {item.title}
                        </h4>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
                        {item.summary}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {item.date}
                        </span>
                        {item.source && (
                          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                            {item.source}
                          </span>
                        )}
                        <ImpactBadge impact={item.impact} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Citations */}
          {citations.length > 0 && (
            <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-900">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Sources</p>
              <div className="flex flex-wrap gap-1">
                {citations.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:text-blue-600 hover:underline truncate max-w-[200px]"
                  >
                    [{i + 1}]
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
