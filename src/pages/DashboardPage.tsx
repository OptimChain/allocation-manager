import { useState, useEffect } from 'react';
import { RefreshCw, Bitcoin } from 'lucide-react';
import PriceCard from '../components/PriceCard';
import BtcEtfProjection from '../components/BtcEtfProjection';
import BitcoinPriceChart from '../components/BitcoinPriceChart';
import MarketStats from '../components/MarketStats';
import NewsSummary from '../components/NewsSummary';
import MarketIndicators from '../components/MarketIndicators';
import {
  getBitcoinQuote,
  BitcoinQuote,
  getCoinGeckoMarketData,
  CoinGeckoMarketData,
} from '../services/twelveDataService';

export default function DashboardPage() {
  const [quoteData, setQuoteData] = useState<BitcoinQuote | null>(null);
  const [geckoData, setGeckoData] = useState<CoinGeckoMarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [quote, gecko] = await Promise.all([
        getBitcoinQuote(),
        getCoinGeckoMarketData(),
      ]);
      setQuoteData(quote);
      setGeckoData(gecko);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();

    const interval = setInterval(() => fetchData(true), 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center">
        <div className="text-center">
          <Bitcoin className="w-10 h-10 text-gray-300 dark:text-gray-600 animate-pulse mx-auto mb-4" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Loading Bitcoin data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-medium text-red-600 mb-4">{error}</p>
          <button
            onClick={() => fetchData()}
            className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-200 text-sm"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Overview</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Real-time price tracking and market analysis
          </p>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdated && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-zinc-900 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Price Card */}
      {quoteData && (
        <div className="mb-8">
          <PriceCard
            name={quoteData.name}
            symbol={quoteData.symbol}
            image=""
            currentPrice={quoteData.close}
            priceChange24h={quoteData.change}
            priceChangePercentage24h={quoteData.percent_change}
            marketCap={geckoData?.market_cap ?? 0}
            marketCapError={geckoData?.error}
            volume24h={geckoData?.total_volume ?? quoteData.volume}
            volumeError={geckoData?.error}
            high24h={quoteData.high}
            low24h={quoteData.low}
          />
        </div>
      )}

      {/* BTC ETF Projection */}
      {quoteData && (
        <div className="mb-8">
          <BtcEtfProjection currentBtcPrice={quoteData.close} />
        </div>
      )}

      {/* Market Stats */}
      {quoteData && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Market Statistics</h2>
          <MarketStats quoteData={quoteData} geckoData={geckoData} />
        </div>
      )}

      {/* Price Chart */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Price Chart</h2>
        <BitcoinPriceChart days={30} height={400} />
      </div>

      {/* Market Indicators */}
      <div className="mb-8">
        <MarketIndicators />
      </div>

      {/* News Summary */}
      <div className="mb-8">
        <NewsSummary />
      </div>
    </div>
  );
}
