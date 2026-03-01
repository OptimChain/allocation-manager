import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { getEtfQuote, EtfQuote } from '../services/twelveDataService';
import { formatCurrency, formatPercentage } from '../utils/formatters';

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export default function MbtFuturesPrice() {
  const [quote, setQuote] = useState<EtfQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      if (lastFetched && Date.now() - lastFetched < CACHE_DURATION) return;

      setLoading(!quote);
      setError(null);

      try {
        const data = await getEtfQuote('MBT');
        if (!mounted) return;
        setQuote(data);
        setLastFetched(Date.now());
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch MBT data');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();

    const interval = setInterval(fetchData, CACHE_DURATION);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
        <div className="animate-pulse flex items-center gap-3">
          <div className="w-8 h-8 bg-gray-200 dark:bg-zinc-800 rounded-lg" />
          <div className="flex-1">
            <div className="h-4 w-32 bg-gray-200 dark:bg-zinc-800 rounded mb-2" />
            <div className="h-6 w-20 bg-gray-200 dark:bg-zinc-800 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-orange-50 dark:bg-orange-950">
            <Activity className="w-4 h-4 text-orange-600 dark:text-orange-400" />
          </div>
          <span className="text-sm font-medium text-gray-900 dark:text-white">MBT Futures</span>
        </div>
        <p className="text-xs text-red-500 mt-2">{error}</p>
        <button
          onClick={() => { setLastFetched(null); setError(null); }}
          className="text-xs text-gray-500 dark:text-gray-400 hover:underline mt-1"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!quote) return null;

  const isPositive = quote.change >= 0;
  const isMarketOpen = quote.is_market_open;

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-orange-50 dark:bg-orange-950">
            <Activity className="w-4 h-4 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">MBT Futures</h3>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                isMarketOpen
                  ? 'border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                  : 'border border-gray-200 dark:border-zinc-800 text-gray-500 dark:text-gray-400'
              }`}>
                {isMarketOpen ? 'Open' : 'Closed'}
              </span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {quote.name} &middot; {quote.datetime}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {formatCurrency(quote.close)}
          </p>
          <div className={`flex items-center justify-end gap-1 ${
            isPositive ? 'text-green-600' : 'text-red-600'
          }`}>
            {isPositive
              ? <TrendingUp className="w-3 h-3" />
              : <TrendingDown className="w-3 h-3" />}
            <span className="text-xs font-medium">
              {formatPercentage(quote.percent_change)}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({quote.change >= 0 ? '+' : ''}{formatCurrency(quote.change)})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
