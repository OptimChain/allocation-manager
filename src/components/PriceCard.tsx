import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency, formatLargeNumber, formatPercentage } from '../utils/formatters';

interface PriceCardProps {
  name: string;
  symbol: string;
  image: string;
  currentPrice: number;
  priceChange24h: number;
  priceChangePercentage24h: number;
  marketCap: number;
  marketCapError?: string;
  volume24h: number;
  volumeError?: string;
  high24h: number;
  low24h: number;
  sparkline?: number[];
}

export default function PriceCard({
  name,
  symbol,
  image,
  currentPrice,
  priceChange24h,
  priceChangePercentage24h,
  marketCap,
  marketCapError,
  volume24h,
  volumeError,
  high24h,
  low24h,
  sparkline,
}: PriceCardProps) {
  const isPositive = priceChange24h >= 0;

  const renderSparkline = () => {
    if (!sparkline || sparkline.length === 0) return null;

    const min = Math.min(...sparkline);
    const max = Math.max(...sparkline);
    const range = max - min || 1;
    const width = 120;
    const height = 40;
    const padding = 2;

    const points = sparkline.map((price, index) => {
      const x = padding + (index / (sparkline.length - 1)) * (width - padding * 2);
      const y = height - padding - ((price - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={width} height={height} className="ml-auto">
        <polyline
          fill="none"
          stroke={isPositive ? '#22c55e' : '#ef4444'}
          strokeWidth="1.5"
          points={points}
        />
      </svg>
    );
  };

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {image ? (
            <img src={image} alt={name} className="w-10 h-10 rounded-full" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-zinc-900 flex items-center justify-center">
              <span className="text-gray-600 dark:text-gray-300 font-semibold text-sm">{symbol.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 uppercase">{symbol}</p>
          </div>
        </div>
        {renderSparkline()}
      </div>

      <div className="mb-4">
        <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(currentPrice)}</p>
        <div className={`flex items-center gap-1 mt-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
          {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          <span className="font-medium">{formatPercentage(priceChangePercentage24h)}</span>
          <span className="text-gray-500 dark:text-gray-400">
            ({isPositive ? '+' : ''}{formatCurrency(priceChange24h)})
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-100 dark:border-zinc-900">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Volume</p>
          <p className="font-medium text-gray-900 dark:text-white">
            {volumeError ? <span className="text-amber-500 text-sm">{volumeError}</span> : formatLargeNumber(volume24h)}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Market Cap</p>
          <p className="font-medium text-gray-900 dark:text-white">
            {marketCapError ? <span className="text-amber-500 text-sm">{marketCapError}</span> : marketCap ? formatLargeNumber(marketCap) : 'N/A'}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Day High</p>
          <p className="font-medium text-green-600">{formatCurrency(high24h)}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Day Low</p>
          <p className="font-medium text-red-600">{formatCurrency(low24h)}</p>
        </div>
      </div>
    </div>
  );
}
