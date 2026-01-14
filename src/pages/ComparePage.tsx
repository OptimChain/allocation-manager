import { useState, useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { PortfolioChart } from '../components/PortfolioChart';
import { getPortfolioData, PORTFOLIO_ASSETS, PortfolioAsset } from '../services/twelveDataService';
import { processPortfolioReturns } from '../utils/portfolioCalculations';

const TIME_RANGES = [
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
  { label: '5Y', value: '5Y' },
];

export default function ComparePage() {
  const [portfolioData, setPortfolioData] = useState<PortfolioAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRange, setSelectedRange] = useState('1Y');
  const [fees, setFees] = useState<Record<string, number>>({
    'BTC/USD': 0,
    'QQQ': 0,
    'SPY': 0,
    'AMZN': 0,
  });

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await getPortfolioData(selectedRange);
      setPortfolioData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedRange]);

  const chartData = useMemo(() => {
    if (portfolioData.length === 0) return [];
    return processPortfolioReturns(portfolioData, fees);
  }, [portfolioData, fees]);

  const handleFeeChange = (symbol: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    setFees((prev) => ({ ...prev, [symbol]: numValue }));
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-64 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-96 mb-8"></div>
          <div className="h-12 bg-gray-200 rounded w-full mb-6"></div>
          <div className="h-96 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <p className="text-lg font-medium text-red-600 mb-4">{error}</p>
          <button
            onClick={() => fetchData()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Portfolio Comparison</h1>
          <p className="text-gray-500 mt-1">
            Compare returns across BTC, QQQ, S&P 500, and Amazon with custom fee adjustments
          </p>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Time Range Selector */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-6">
        {TIME_RANGES.map((range) => (
          <button
            key={range.value}
            onClick={() => setSelectedRange(range.value)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              selectedRange === range.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>

      {/* Fee Inputs */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Yearly Fees (%)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PORTFOLIO_ASSETS.map((asset) => (
            <div key={asset.symbol} className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: asset.color }}
              />
              <label className="text-sm text-gray-600 w-24">{asset.displayName}</label>
              <div className="relative flex-1">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={fees[asset.symbol] || ''}
                  onChange={(e) => handleFeeChange(asset.symbol, e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                  %
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chart */}
      <PortfolioChart data={chartData} height={450} />

      {/* Legend with current returns */}
      {chartData.length > 0 && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {chartData.map((asset) => {
            const lastReturn = asset.returns[asset.returns.length - 1]?.returnPercent ?? 0;
            const isPositive = lastReturn >= 0;
            return (
              <div
                key={asset.symbol}
                className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3"
              >
                <div
                  className="w-4 h-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: asset.color }}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{asset.displayName}</p>
                  <p className="text-xs text-gray-500">
                    Fee: {fees[asset.symbol] || 0}% / year
                  </p>
                </div>
                <div className={`text-lg font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                  {isPositive ? '+' : ''}{lastReturn.toFixed(2)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
