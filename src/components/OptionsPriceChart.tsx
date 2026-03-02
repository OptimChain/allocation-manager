import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  Customized,
} from 'recharts';
import { Activity, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { getStockPriceHistory } from '../services/twelveDataService';
import type { OHLCVPriceData } from '../services/twelveDataService';
import type { OptionPosition } from '../services/robinhoodService';
import { formatCurrency } from '../utils/formatters';
import { useTheme } from '../contexts/ThemeContext';

const RANGES = [
  { label: '30D', value: 30 },
  { label: '90D', value: 90 },
  { label: '1Y', value: 365 },
];

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
              x1={xPos} y1={yHigh} x2={xPos} y2={yLow}
              stroke={color} strokeWidth={1}
            />
            <rect
              x={xPos - candleWidth / 2} y={bodyTop}
              width={candleWidth} height={bodyHeight}
              fill={color} stroke={color} strokeWidth={1}
            />
          </g>
        );
      })}
    </g>
  );
}

interface OptionsPriceChartProps {
  options: OptionPosition[];
}

export default function OptionsPriceChart({ options }: OptionsPriceChartProps) {
  const { isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [priceData, setPriceData] = useState<OHLCVPriceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState(90);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');

  // Group options by underlying symbol
  const underlyings = useMemo(() => {
    const map = new Map<string, OptionPosition[]>();
    for (const opt of options) {
      const existing = map.get(opt.chain_symbol) || [];
      existing.push(opt);
      map.set(opt.chain_symbol, existing);
    }
    return map;
  }, [options]);

  const symbols = useMemo(() => Array.from(underlyings.keys()).sort(), [underlyings]);

  // Default to first symbol
  useEffect(() => {
    if (symbols.length > 0 && !selectedSymbol) {
      setSelectedSymbol(symbols[0]);
    }
  }, [symbols, selectedSymbol]);

  const currentOptions = underlyings.get(selectedSymbol) || [];

  // Fetch price data when expanded and symbol/range changes
  useEffect(() => {
    if (!expanded || !selectedSymbol) return;

    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const data = await getStockPriceHistory(selectedSymbol, selectedRange);
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

  const handleRefresh = () => {
    setError(null);
    setPriceData([]);
    // Trigger re-fetch by toggling a dep — simplest: just set loading
    setLoading(true);
    getStockPriceHistory(selectedSymbol, selectedRange)
      .then(setPriceData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to fetch'))
      .finally(() => setLoading(false));
  };

  if (options.length === 0) return null;

  const estOpts: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York' };

  const formatXAxis = (timestamp: number) => {
    const date = new Date(timestamp);
    if (selectedRange <= 7) {
      return date.toLocaleDateString('en-US', { ...estOpts, weekday: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { ...estOpts, month: 'short', day: 'numeric' });
  };

  const formatTooltipDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  };

  const axisColor = isDark ? '#a1a1aa' : '#71717a';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';
  const chartHeight = 350;

  // Price domain with padding
  const allPrices = priceData.length > 0
    ? [...priceData.map(d => d.low), ...priceData.map(d => d.high), ...currentOptions.map(o => o.strike)]
    : [];
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) : 0;
  const maxPrice = allPrices.length > 0 ? Math.max(...allPrices) : 100;
  const pricePadding = (maxPrice - minPrice) * 0.05;
  const maxVolume = priceData.length > 0 ? Math.max(...priceData.map(d => d.volume)) : 1;

  // Expiry timestamps for vertical reference lines
  const expiryTimestamps = useMemo(() => {
    const seen = new Set<string>();
    return currentOptions
      .filter((o) => {
        if (seen.has(o.expiration)) return false;
        seen.add(o.expiration);
        return true;
      })
      .map((o) => ({
        timestamp: new Date(o.expiration).getTime(),
        label: o.expiration,
      }));
  }, [currentOptions]);

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 dark:border-zinc-900">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left"
        >
          <Activity className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Options Price History</h3>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          )}
        </button>

        {expanded && (
          <div className="flex items-center gap-2">
            {/* Underlying selector */}
            {symbols.length > 1 && (
              <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg">
                {symbols.map((sym) => (
                  <button
                    key={sym}
                    onClick={() => setSelectedSymbol(sym)}
                    className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
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

            {/* Range selector */}
            <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg">
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

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-zinc-800 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-900 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <>
          {loading ? (
            <div className="px-6 py-12 text-center">
              <Activity className="w-8 h-8 text-gray-200 dark:text-gray-700 animate-pulse mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Loading {selectedSymbol} price history...
              </p>
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-red-500 mb-2">{error}</p>
              <button
                onClick={handleRefresh}
                className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : priceData.length > 0 ? (
            <div className="px-6 pb-6 pt-4">
              {/* Option summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {currentOptions.map((opt) => (
                  <div
                    key={`${opt.option_type}-${opt.strike}-${opt.expiration}`}
                    className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        opt.option_type === 'call'
                          ? 'bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-400'
                      }`}>
                        {opt.option_type.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{opt.dte}d</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      ${opt.strike} strike
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      exp {opt.expiration}
                    </p>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <ResponsiveContainer width="100%" height={chartHeight}>
                <ComposedChart data={priceData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
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
                    domain={[minPrice - pricePadding, maxPrice + pricePadding]}
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
                            {/* Show distance from strikes */}
                            {currentOptions.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-gray-200 dark:border-zinc-800">
                                {currentOptions.map((opt) => {
                                  const diff = ((d.close - opt.strike) / opt.strike) * 100;
                                  return (
                                    <div key={`${opt.option_type}-${opt.strike}`} className="flex justify-between gap-2">
                                      <span className="text-gray-400">${opt.strike} {opt.option_type}</span>
                                      <span className={diff >= 0 ? 'text-green-600' : 'text-red-600'}>
                                        {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />

                  {/* Volume bars */}
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

                  {/* Strike price reference lines */}
                  {currentOptions.map((opt) => (
                    <ReferenceLine
                      key={`strike-${opt.option_type}-${opt.strike}`}
                      yAxisId="price"
                      y={opt.strike}
                      stroke={opt.option_type === 'call' ? '#22c55e' : '#ef4444'}
                      strokeDasharray="6 3"
                      strokeWidth={1.5}
                      label={{
                        value: `$${opt.strike} ${opt.option_type.toUpperCase()}`,
                        position: 'right',
                        fill: opt.option_type === 'call' ? '#22c55e' : '#ef4444',
                        fontSize: 10,
                      }}
                    />
                  ))}

                  {/* Expiry date vertical reference lines */}
                  {expiryTimestamps
                    .filter((e) => {
                      const first = priceData[0]?.timestamp ?? 0;
                      const last = priceData[priceData.length - 1]?.timestamp ?? 0;
                      return e.timestamp >= first && e.timestamp <= last;
                    })
                    .map((e) => (
                      <ReferenceLine
                        key={`expiry-${e.label}`}
                        xAxisId={0}
                        x={e.timestamp}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        strokeWidth={1}
                        label={{
                          value: `EXP ${e.label}`,
                          position: 'top',
                          fill: '#f59e0b',
                          fontSize: 10,
                        }}
                      />
                    ))}

                  {/* Candlesticks */}
                  <Customized component={<CandlestickRenderer data={priceData} />} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
