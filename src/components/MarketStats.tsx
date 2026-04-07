import { DollarSign, BarChart3, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Landmark } from 'lucide-react';
import { formatCurrency, formatLargeNumber, formatPercentage } from '../utils/formatters';
import { BitcoinQuote, CoinGeckoMarketData } from '../services/twelveDataService';

interface MarketStatsProps {
  quoteData: BitcoinQuote;
  geckoData?: CoinGeckoMarketData | null;
  loading?: boolean;
}

export default function MarketStats({ quoteData, geckoData, loading }: MarketStatsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4 animate-pulse">
            <div className="h-4 bg-gray-200 dark:bg-zinc-800 rounded w-3/4 mb-2"></div>
            <div className="h-6 bg-gray-200 dark:bg-zinc-800 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  const isPositive = quoteData.change >= 0;
  const geckoError = geckoData?.error;

  const stats = [
    {
      label: 'Market Cap',
      value: geckoError ? geckoError : geckoData?.market_cap ? formatLargeNumber(geckoData.market_cap) : 'N/A',
      icon: Landmark,
      color: geckoError ? 'text-amber-600' : 'text-gray-700 dark:text-gray-300',
      bgColor: 'bg-gray-50 dark:bg-zinc-900',
    },
    {
      label: '24h Volume',
      value: geckoError ? geckoError : geckoData?.total_volume ? formatLargeNumber(geckoData.total_volume) : formatLargeNumber(quoteData.volume),
      icon: BarChart3,
      color: geckoError ? 'text-amber-600' : 'text-gray-700 dark:text-gray-300',
      bgColor: 'bg-gray-50 dark:bg-zinc-900',
    },
    {
      label: 'Previous Close',
      value: formatCurrency(quoteData.previous_close),
      icon: DollarSign,
      color: 'text-gray-700 dark:text-gray-300',
      bgColor: 'bg-gray-50 dark:bg-zinc-900',
    },
    {
      label: 'Change',
      value: formatPercentage(quoteData.percent_change),
      icon: isPositive ? TrendingUp : TrendingDown,
      color: isPositive ? 'text-green-600' : 'text-red-600',
      bgColor: isPositive ? 'bg-green-50 dark:bg-green-950' : 'bg-red-50 dark:bg-red-950',
    },
    {
      label: 'Day High',
      value: formatCurrency(quoteData.high),
      icon: ArrowUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50 dark:bg-green-950',
    },
    {
      label: 'Day Low',
      value: formatCurrency(quoteData.low),
      icon: ArrowDown,
      color: 'text-red-600',
      bgColor: 'bg-red-50 dark:bg-red-950',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={`p-1.5 rounded-lg ${stat.bgColor}`}>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</span>
          </div>
          <p className={`text-lg font-semibold ${stat.color}`}>{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
