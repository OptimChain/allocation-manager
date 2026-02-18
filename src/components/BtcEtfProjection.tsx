import { useState, useEffect, useMemo } from 'react';
import { BarChart3, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { getEtfQuote, getBtcPriceAtTime, EtfQuote } from '../services/twelveDataService';
import { formatCurrency, formatPercentage } from '../utils/formatters';

interface BtcEtfProjectionProps {
  currentBtcPrice: number;
}

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export default function BtcEtfProjection({ currentBtcPrice }: BtcEtfProjectionProps) {
  const [etfQuote, setEtfQuote] = useState<EtfQuote | null>(null);
  const [btcAtClose, setBtcAtClose] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchEtfData() {
      if (lastFetched && Date.now() - lastFetched < CACHE_DURATION) return;

      setLoading(!etfQuote);
      setError(null);

      try {
        const quote = await getEtfQuote('BTC');
        if (!mounted) return;
        setEtfQuote(quote);

        if (!quote.is_market_open) {
          const btcPrice = await getBtcPriceAtTime(quote.datetime);
          if (!mounted) return;
          setBtcAtClose(btcPrice);
        }

        setLastFetched(Date.now());
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch ETF data');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchEtfData();

    const interval = setInterval(fetchEtfData, CACHE_DURATION);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const projectedPrice = useMemo(() => {
    if (!etfQuote || !btcAtClose || etfQuote.is_market_open) return null;
    if (!currentBtcPrice || !btcAtClose) return null;
    return etfQuote.close * (currentBtcPrice / btcAtClose);
  }, [etfQuote, btcAtClose, currentBtcPrice]);

  const projectedChange = projectedPrice && etfQuote
    ? projectedPrice - etfQuote.close
    : null;

  const projectedChangePercent = projectedChange && etfQuote
    ? (projectedChange / etfQuote.close) * 100
    : null;

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
        <div className="animate-pulse">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-gray-200 dark:bg-zinc-800 rounded-lg" />
            <div className="h-5 w-40 bg-gray-200 dark:bg-zinc-800 rounded" />
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="h-3 w-20 bg-gray-200 dark:bg-zinc-800 rounded mb-2" />
              <div className="h-8 w-24 bg-gray-200 dark:bg-zinc-800 rounded" />
            </div>
            <div>
              <div className="h-3 w-24 bg-gray-200 dark:bg-zinc-800 rounded mb-2" />
              <div className="h-8 w-24 bg-gray-200 dark:bg-zinc-800 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-zinc-900">
            <BarChart3 className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">BTC ETF Projection</h3>
        </div>
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={() => { setLastFetched(null); setError(null); }}
          className="text-sm text-gray-600 dark:text-gray-400 hover:underline mt-1"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!etfQuote) return null;

  const isMarketOpen = etfQuote.is_market_open;
  const displayPrice = isMarketOpen ? etfQuote.close : projectedPrice;
  const displayChange = isMarketOpen ? etfQuote.change : projectedChange;
  const displayChangePercent = isMarketOpen ? etfQuote.percent_change : projectedChangePercent;
  const isPositive = displayChange !== null && displayChange >= 0;

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-zinc-900">
            <BarChart3 className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">BTC ETF Projection</h3>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          isMarketOpen
            ? 'border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
            : 'border border-gray-200 dark:border-zinc-800 text-gray-500 dark:text-gray-400'
        }`}>
          {isMarketOpen ? 'Market Open' : 'Market Closed'}
        </span>
      </div>

      {/* Price columns */}
      <div className="grid grid-cols-2 gap-6 mb-4">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Last ETF Close</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(etfQuote.close)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {etfQuote.datetime}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            {isMarketOpen ? 'Live Price' : 'Projected Price'}
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {displayPrice ? formatCurrency(displayPrice) : '---'}
          </p>
          {displayChangePercent !== null && (
            <div className={`flex items-center gap-1 mt-1 ${
              isPositive ? 'text-green-600' : 'text-red-600'
            }`}>
              {isPositive
                ? <TrendingUp className="w-3 h-3" />
                : <TrendingDown className="w-3 h-3" />}
              <span className="text-sm font-medium">
                {formatPercentage(displayChangePercent)}
              </span>
              {displayChange !== null && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  ({displayChange >= 0 ? '+' : ''}{formatCurrency(displayChange)})
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Context footer */}
      <div className="pt-3 border-t border-gray-100 dark:border-zinc-900">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {isMarketOpen
            ? 'Grayscale Bitcoin Mini Trust ETF (BTC) is currently trading.'
            : `Projection based on BTC/USD movement since close. BTC at close: ${
                btcAtClose ? formatCurrency(btcAtClose) : '---'
              }`}
        </p>
      </div>
    </div>
  );
}
