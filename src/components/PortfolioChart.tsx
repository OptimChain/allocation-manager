import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { PortfolioReturnData, mergeReturnsForChart, formatReturnPercent } from '../utils/portfolioCalculations';

interface PortfolioChartProps {
  data: PortfolioReturnData[];
  height?: number;
}

function formatPrice(value: number): string {
  if (value >= 1000) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${value.toFixed(2)}`;
}

export function PortfolioChart({ data, height = 400 }: PortfolioChartProps) {
  const chartData = useMemo(() => mergeReturnsForChart(data), [data]);

  // Check if any asset has SMA data
  const hasSMA = useMemo(() => {
    return data.some((asset) =>
      asset.returns.some((r) => r.smaReturnPercent !== undefined)
    );
  }, [data]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatYAxis = (value: number) => `${value >= 0 ? '+' : ''}${value}%`;

  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean;
    payload?: Array<{ color: string; name: string; value: number; dataKey: string }>;
    label?: string;
  }) => {
    if (!active || !payload) return null;

    // Filter out SMA and price entries from the payload - we'll show price inline
    const mainEntries = payload.filter(
      (entry) => !entry.dataKey.endsWith('_sma') && !entry.dataKey.endsWith('_price')
    );

    // Get the full data point for prices
    const dataPoint = chartData.find((d) => d.date === label);

    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="text-sm text-gray-600 mb-2">
          {new Date(label || '').toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
        {mainEntries.map((entry, index) => {
          const priceKey = `${entry.dataKey}_price`;
          const price = dataPoint ? dataPoint[priceKey] : undefined;
          return (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-gray-700">{entry.name}:</span>
              {typeof price === 'number' && (
                <span className="font-medium text-gray-900">
                  {formatPrice(price)}
                </span>
              )}
              <span
                className={`font-medium ${
                  entry.value >= 0 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                ({formatReturnPercent(entry.value)})
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg">
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 12, fill: '#6B7280' }}
            tickLine={{ stroke: '#E5E7EB' }}
            axisLine={{ stroke: '#E5E7EB' }}
          />
          <YAxis
            tickFormatter={formatYAxis}
            tick={{ fontSize: 12, fill: '#6B7280' }}
            tickLine={{ stroke: '#E5E7EB' }}
            axisLine={{ stroke: '#E5E7EB' }}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: '20px' }}
            formatter={(value) => <span className="text-gray-700">{value}</span>}
          />
          <ReferenceLine y={0} stroke="#9CA3AF" strokeDasharray="3 3" />
          {data.map((asset) => (
            <Line
              key={asset.symbol}
              type="monotone"
              dataKey={asset.symbol}
              name={asset.displayName}
              stroke={asset.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
          ))}
          {hasSMA && data.map((asset) => (
            <Line
              key={`${asset.symbol}_sma`}
              type="monotone"
              dataKey={`${asset.symbol}_sma`}
              name={`${asset.displayName} 150d SMA`}
              stroke={asset.color}
              strokeWidth={1.5}
              strokeDasharray="6 3"
              dot={false}
              activeDot={false}
              legendType="plainline"
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
