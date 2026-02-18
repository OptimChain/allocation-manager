import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { getBitcoinPriceHistory, NormalizedPriceData } from '../services/twelveDataService';
import { formatCurrency } from '../utils/formatters';
import { useTheme } from '../contexts/ThemeContext';

interface BitcoinPriceChartProps {
  days?: number;
  height?: number;
  showGrid?: boolean;
  chartType?: 'line' | 'area';
}

export default function BitcoinPriceChart({
  days = 30,
  height = 400,
  showGrid = true,
  chartType = 'area',
}: BitcoinPriceChartProps) {
  const { isDark } = useTheme();
  const [priceData, setPriceData] = useState<NormalizedPriceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState(days);

  const ranges = [
    { label: '24H', value: 1 },
    { label: '7D', value: 7 },
    { label: '30D', value: 30 },
    { label: '90D', value: 90 },
    { label: '1Y', value: 365 },
    { label: '3Y', value: 1095 },
  ];

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const data = await getBitcoinPriceHistory(selectedRange);
        setPriceData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch price data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [selectedRange]);

  const formatXAxis = (timestamp: number) => {
    const date = new Date(timestamp);
    if (selectedRange <= 1) {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    if (selectedRange <= 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTooltipDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const axisColor = isDark ? '#a1a1aa' : '#71717a';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-zinc-800 rounded w-1/4 mb-4"></div>
          <div className="h-[400px] bg-gray-100 dark:bg-zinc-900 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
        <div className="text-red-500 text-center py-8">
          <p className="text-sm font-medium">Error loading chart</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{error}</p>
          <button
            onClick={() => setSelectedRange(selectedRange)}
            className="mt-4 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-200 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const minPrice = Math.min(...priceData.map(d => d.price));
  const maxPrice = Math.max(...priceData.map(d => d.price));
  const priceChange = priceData.length > 0
    ? ((priceData[priceData.length - 1].price - priceData[0].price) / priceData[0].price) * 100
    : 0;
  const isPositive = priceChange >= 0;

  const ChartComponent = chartType === 'area' ? AreaChart : LineChart;
  const chartColor = isPositive ? '#22c55e' : '#ef4444';

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Price History</h3>
          <p className={`text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? '+' : ''}{priceChange.toFixed(2)}% in {selectedRange} day{selectedRange > 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg overflow-x-auto">
          {ranges.map((range) => (
            <button
              key={range.value}
              onClick={() => setSelectedRange(range.value)}
              className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                selectedRange === range.value
                  ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ChartComponent data={priceData}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatXAxis}
            tick={{ fontSize: 12, fill: axisColor }}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
          />
          <YAxis
            domain={[minPrice * 0.99, maxPrice * 1.01]}
            tickFormatter={(value) => formatCurrency(value)}
            tick={{ fontSize: 12, fill: axisColor }}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
            width={80}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="bg-white dark:bg-zinc-900 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-800">
                    <p className="text-sm text-gray-500 dark:text-gray-400">{formatTooltipDate(data.timestamp)}</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(data.price)}</p>
                  </div>
                );
              }
              return null;
            }}
          />
          {chartType === 'area' ? (
            <>
              <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="price"
                stroke={chartColor}
                strokeWidth={2}
                fill="url(#colorPrice)"
              />
            </>
          ) : (
            <Line
              type="monotone"
              dataKey="price"
              stroke={chartColor}
              strokeWidth={2}
              dot={false}
            />
          )}
        </ChartComponent>
      </ResponsiveContainer>
    </div>
  );
}
