import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { getTimeSeries, getRangeConfig } from '../services/twelveDataService';
import type { NormalizedPriceData } from '../services/twelveDataService';
import type { OptionPosition } from '../services/robinhoodService';
import { useTheme } from '../contexts/ThemeContext';

const RANGES = [
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
];

function formatAxis(timestamp: number, range: string): string {
  const date = new Date(timestamp);
  if (range === '1W' || range === '1M') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export default function UnderlyingPriceChart({ options }: { options: OptionPosition[] }) {
  const { isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [selectedRange, setSelectedRange] = useState('3M');
  const [priceData, setPriceData] = useState<NormalizedPriceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uniqueSymbols = useMemo(
    () => Array.from(new Set(options.map((o) => o.chain_symbol))),
    [options],
  );
  const [selectedSymbol, setSelectedSymbol] = useState(uniqueSymbols[0] || '');

  useEffect(() => {
    if (uniqueSymbols.length > 0 && !uniqueSymbols.includes(selectedSymbol)) {
      setSelectedSymbol(uniqueSymbols[0]);
    }
  }, [uniqueSymbols, selectedSymbol]);

  useEffect(() => {
    if (!expanded || !selectedSymbol) return;

    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const data = await getTimeSeries(selectedSymbol, selectedRange);
        if (!cancelled) setPriceData(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to fetch price data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [expanded, selectedSymbol, selectedRange]);

  const visibleData = useMemo(() => {
    const config = getRangeConfig(selectedRange);
    return priceData.slice(-config.visibleSize);
  }, [priceData, selectedRange]);

  const activeOptions = useMemo(
    () => options.filter((o) => o.chain_symbol === selectedSymbol),
    [options, selectedSymbol],
  );

  const yDomain = useMemo(() => {
    if (visibleData.length === 0) return [0, 100];
    const prices = visibleData.map((d) => d.price);
    const levels = [...prices];
    for (const opt of activeOptions) {
      levels.push(opt.strike, opt.break_even);
    }
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    const pad = (max - min) * 0.03 || 1;
    return [min - pad, max + pad];
  }, [visibleData, activeOptions]);

  const axisColor = isDark ? '#a1a1aa' : '#a1a1aa';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 dark:border-zinc-900">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-left">
          <TrendingUp className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Underlying Price{selectedSymbol ? `: ${selectedSymbol}` : ''}
          </h3>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          )}
        </button>

        {expanded && (
          <div className="flex items-center gap-3">
            {uniqueSymbols.length > 1 && (
              <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg">
                {uniqueSymbols.map((sym) => (
                  <button
                    key={sym}
                    onClick={() => setSelectedSymbol(sym)}
                    className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      selectedSymbol === sym
                        ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg overflow-x-auto">
              {RANGES.map((range) => (
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
        )}
      </div>

      {expanded && (
        <>
          {loading ? (
            <div className="px-6 py-12 text-center">
              <TrendingUp className="w-8 h-8 text-gray-200 dark:text-gray-700 animate-pulse mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading {selectedSymbol} price data...</p>
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-red-500 mb-2">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : visibleData.length > 0 ? (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-3 border-b border-gray-100 dark:border-zinc-900 bg-gray-50 dark:bg-zinc-900">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Current</div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    ${visibleData[visibleData.length - 1].price.toFixed(2)}
                  </div>
                </div>
                {activeOptions.map((opt, i) => (
                  <div key={i} className="contents">
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Strike ({opt.option_type.toUpperCase()} ${opt.strike})
                      </div>
                      <div className="font-medium text-gray-900 dark:text-white">${opt.strike.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Break Even</div>
                      <div className="font-medium text-gray-900 dark:text-white">${opt.break_even.toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div className="px-6 pb-6 pt-4">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={visibleData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts) => formatAxis(ts, selectedRange)}
                      tick={{ fontSize: 11, fill: axisColor }}
                      axisLine={{ stroke: gridColor }}
                    />
                    <YAxis
                      domain={yDomain}
                      tickFormatter={(v) => `$${v.toFixed(0)}`}
                      tick={{ fontSize: 11, fill: axisColor }}
                      axisLine={{ stroke: gridColor }}
                      width={55}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? '#09090b' : '#ffffff',
                        border: `1px solid ${isDark ? '#27272a' : '#e5e7eb'}`,
                        borderRadius: '0.5rem',
                        color: isDark ? '#ffffff' : '#111827',
                      }}
                      labelFormatter={(ts) =>
                        new Date(ts as number).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      }
                      formatter={(value: number) => [`$${value.toFixed(2)}`, selectedSymbol]}
                    />
                    {activeOptions.map((opt, i) => (
                      <ReferenceLine
                        key={`strike-${i}`}
                        y={opt.strike}
                        stroke="#ef4444"
                        strokeDasharray="3 3"
                        label={{
                          value: `Strike $${opt.strike}`,
                          position: 'left',
                          fill: '#ef4444',
                          fontSize: 11,
                        }}
                      />
                    ))}
                    {activeOptions.map((opt, i) => (
                      <ReferenceLine
                        key={`be-${i}`}
                        y={opt.break_even}
                        stroke="#f59e0b"
                        strokeDasharray="3 3"
                        label={{
                          value: `B/E $${opt.break_even}`,
                          position: 'left',
                          fill: '#f59e0b',
                          fontSize: 11,
                        }}
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#3B82F6"
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-gray-400 dark:text-gray-500">No price data available for {selectedSymbol}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
