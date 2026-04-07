import { useState, useEffect } from 'react';
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Customized,
} from 'recharts';
import { getBitcoinPriceHistory } from '../services/twelveDataService';
import type { OHLCVPriceData } from '../services/twelveDataService';
import { formatCurrency } from '../utils/formatters';
import { useTheme } from '../contexts/ThemeContext';

interface BitcoinPriceChartProps {
  days?: number;
  height?: number;
  showGrid?: boolean;
}

const formatVolume = (vol: number) => {
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return vol.toFixed(0);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CandlestickRenderer({ xAxisMap, yAxisMap, data }: any) {
  if (!xAxisMap || !yAxisMap) return null;

  const xAxis = Object.values(xAxisMap)[0] as any;
  const yAxis = yAxisMap?.price as any;

  if (!xAxis?.scale || !yAxis?.scale) return null;

  const bandWidth = xAxis.bandSize || 10;
  const candleWidth = Math.max(1, bandWidth * 0.7);

  return (
    <g>
      {(data as OHLCVPriceData[]).map((d, i) => {
        const xPos = xAxis.scale(d.timestamp) + bandWidth / 2;
        const yHigh = yAxis.scale(d.high);
        const yLow = yAxis.scale(d.low);
        const yOpen = yAxis.scale(d.open);
        const yClose = yAxis.scale(d.close);
        const isUp = d.close >= d.open;
        const color = isUp ? '#22c55e' : '#ef4444';

        const bodyTop = isUp ? yClose : yOpen;
        const bodyBottom = isUp ? yOpen : yClose;
        const bodyHeight = Math.max(1, bodyBottom - bodyTop);

        return (
          <g key={i}>
            <line
              x1={xPos}
              y1={yHigh}
              x2={xPos}
              y2={yLow}
              stroke={color}
              strokeWidth={1}
            />
            <rect
              x={xPos - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              fill={color}
              stroke={color}
              strokeWidth={1}
            />
          </g>
        );
      })}
    </g>
  );
}

export default function BitcoinPriceChart({
  days = 30,
  height = 400,
  showGrid = true,
}: BitcoinPriceChartProps) {
  const { isDark } = useTheme();
  const [priceData, setPriceData] = useState<OHLCVPriceData[]>([]);
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

  const estOpts: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York' };

  const formatXAxis = (timestamp: number) => {
    const date = new Date(timestamp);
    if (selectedRange <= 1) {
      return date.toLocaleTimeString('en-US', { ...estOpts, hour: '2-digit', minute: '2-digit' });
    }
    if (selectedRange <= 7) {
      return date.toLocaleDateString('en-US', { ...estOpts, weekday: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { ...estOpts, month: 'short', day: 'numeric' });
  };

  const formatTooltipDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
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

  const minLow = Math.min(...priceData.map(d => d.low));
  const maxHigh = Math.max(...priceData.map(d => d.high));
  const maxVolume = Math.max(...priceData.map(d => d.volume));
  const priceChange = priceData.length > 0
    ? ((priceData[priceData.length - 1].close - priceData[0].close) / priceData[0].close) * 100
    : 0;
  const isPositive = priceChange >= 0;

  const pricePadding = (maxHigh - minLow) * 0.03;

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
        <ComposedChart data={priceData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}
          <XAxis
            dataKey="timestamp"
            type="category"
            tickFormatter={formatXAxis}
            tick={{ fontSize: 11, fill: axisColor }}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
            interval={Math.max(0, Math.floor(priceData.length / 7) - 1)}
          />
          <YAxis
            yAxisId="price"
            domain={[minLow - pricePadding, maxHigh + pricePadding]}
            tickFormatter={(value) => formatCurrency(value)}
            tick={{ fontSize: 11, fill: axisColor }}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
            width={80}
          />
          <YAxis
            yAxisId="volume"
            orientation="right"
            hide
            domain={[0, maxVolume * 5]}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const d = payload[0].payload as OHLCVPriceData;
                const isUp = d.close >= d.open;
                return (
                  <div className="bg-white dark:bg-zinc-900 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-800 text-xs">
                    <p className="text-gray-500 dark:text-gray-400 mb-2">{formatTooltipDate(d.timestamp)}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-gray-500 dark:text-gray-400">Open</span>
                      <span className="text-right font-medium text-gray-900 dark:text-white">{formatCurrency(d.open)}</span>
                      <span className="text-gray-500 dark:text-gray-400">High</span>
                      <span className="text-right font-medium text-gray-900 dark:text-white">{formatCurrency(d.high)}</span>
                      <span className="text-gray-500 dark:text-gray-400">Low</span>
                      <span className="text-right font-medium text-gray-900 dark:text-white">{formatCurrency(d.low)}</span>
                      <span className="text-gray-500 dark:text-gray-400">Close</span>
                      <span className={`text-right font-semibold ${isUp ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(d.close)}</span>
                      <span className="text-gray-500 dark:text-gray-400">Volume</span>
                      <span className="text-right font-medium text-gray-900 dark:text-white">{formatVolume(d.volume)}</span>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          {/* Volume bars rendered behind candlesticks */}
          <Bar dataKey="volume" yAxisId="volume" isAnimationActive={false}>
            {priceData.map((d, i) => (
              <Cell
                key={i}
                fill={d.close >= d.open
                  ? (isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.25)')
                  : (isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.25)')
                }
              />
            ))}
          </Bar>
          {/* Candlestick shapes rendered via Customized */}
          <Customized component={<CandlestickRenderer data={priceData} />} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
