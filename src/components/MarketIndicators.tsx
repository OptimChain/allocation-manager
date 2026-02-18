import { useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import { Activity, ChevronDown, ChevronUp } from 'lucide-react';
import {
  getMarketIndicators,
  MarketIndicatorData,
} from '../services/marketIndicatorService';
import { formatLargeNumber } from '../utils/formatters';
import { useTheme } from '../contexts/ThemeContext';

const RANGES = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y', days: 365 },
  { label: '3Y', days: 1095 },
];

function zscoreLabel(z: number): string {
  const az = Math.abs(z);
  if (az < 0.5) return 'normal';
  if (az < 1.0) return z > 0 ? 'slightly elevated' : 'slightly depressed';
  if (az < 2.0) return z > 0 ? 'elevated' : 'depressed';
  return z > 0 ? 'extremely elevated' : 'extremely depressed';
}

function zscoreColor(z: number | null): string {
  if (z === null) return 'text-gray-500';
  const az = Math.abs(z);
  if (az < 0.5) return 'text-green-600';
  if (az < 1.0) return 'text-yellow-600';
  if (az < 2.0) return 'text-amber-600';
  return 'text-red-600';
}

function volRegimeColor(regime: string): string {
  if (regime === 'low') return 'text-green-600';
  if (regime === 'high') return 'text-amber-600';
  if (regime === 'extreme') return 'text-red-600';
  return 'text-gray-600';
}

function filterByRange<T extends { timestamp: number }>(data: T[], days: number): T[] {
  const cutoff = Date.now() - days * 86400000;
  return data.filter((d) => d.timestamp >= cutoff);
}

function formatAxis(timestamp: number, days: number): string {
  const date = new Date(timestamp);
  if (days <= 30) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function formatFlowAxis(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function MarketIndicators() {
  const { isDark } = useTheme();
  const [data, setData] = useState<MarketIndicatorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState(1095);
  const [expanded, setExpanded] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!expanded || fetched) return;

    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const result = await getMarketIndicators();
        if (!cancelled) {
          setData(result);
          setFetched(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch indicators');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [expanded, fetched]);

  const chartHeight = 250;
  const axisColor = isDark ? '#a1a1aa' : '#a1a1aa';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-900">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left"
        >
          <Activity className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Market Indicators</h3>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          )}
        </button>

        {expanded && data && (
          <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg">
            {RANGES.map((range) => (
              <button
                key={range.days}
                onClick={() => setSelectedRange(range.days)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  selectedRange === range.days
                    ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <>
          {loading || (!fetched && !error) ? (
            <div className="px-6 py-12 text-center">
              <Activity className="w-8 h-8 text-gray-200 dark:text-gray-700 animate-pulse mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading market indicators...</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Fetching BTC, ETF, and volatility data...</p>
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-red-500 mb-2">{error}</p>
              <button
                onClick={() => { setError(null); setFetched(false); }}
                className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : data ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4">
                {/* IV Z-Score */}
                <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">IV Z-Score</p>
                  {data.iv.zscore !== null ? (
                    <>
                      <p className={`text-xl font-bold ${zscoreColor(data.iv.zscore)}`}>
                        {data.iv.zscore >= 0 ? '+' : ''}
                        {data.iv.zscore.toFixed(2)}&sigma;
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {zscoreLabel(data.iv.zscore)} &middot; {data.iv.source}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500">Unavailable</p>
                  )}
                </div>

                {/* ETF Net Flow */}
                <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">ETF Net Flow (30d)</p>
                  {data.flows.etfCount > 0 ? (
                    <>
                      <p
                        className={`text-xl font-bold ${
                          data.flows.recent30d >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {data.flows.recent30d >= 0 ? '+' : '-'}
                        {formatLargeNumber(Math.abs(data.flows.recent30d))}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {data.flows.etfCount} ETFs &middot; 7d:{' '}
                        {data.flows.recent7d >= 0 ? '+' : '-'}
                        {formatLargeNumber(Math.abs(data.flows.recent7d))}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500">No ETF data</p>
                  )}
                </div>

                {/* 200-Week MA */}
                <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Price / 200W MA</p>
                  {data.ma.ratio !== null ? (
                    <>
                      <p
                        className={`text-xl font-bold ${
                          data.ma.pctAbove! >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {data.ma.ratio.toFixed(2)}x
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {data.ma.pctAbove! >= 0 ? '+' : ''}
                        {data.ma.pctAbove!.toFixed(1)}% above MA
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500">Insufficient data</p>
                  )}
                </div>

                {/* Historical Vol */}
                <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">30d Vol (Yang-Zhang)</p>
                  {data.vol.windows.length > 0 ? (
                    <>
                      <p className={`text-xl font-bold ${volRegimeColor(data.vol.windows[0].regime)}`}>
                        {(data.vol.windows[0].vol * 100).toFixed(1)}%
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        Regime: {data.vol.windows[0].regime}
                        {data.vol.windows.length > 1 &&
                          ` \u00b7 60d: ${(data.vol.windows[1].vol * 100).toFixed(1)}%`}
                        {data.vol.windows.length > 3 &&
                          ` \u00b7 1Y: ${(data.vol.windows[3].vol * 100).toFixed(1)}%`}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 dark:text-gray-500">Insufficient data</p>
                  )}
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 px-6 pb-6">
                {/* IV Z-Score */}
                <div className="border border-gray-100 dark:border-zinc-900 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    IV Z-Score{data.iv.source ? ` (${data.iv.source})` : ''}
                  </h4>
                  {data.iv.series.length > 0 ? (
                    <ResponsiveContainer width="100%" height={chartHeight}>
                      <LineChart data={filterByRange(data.iv.series, selectedRange)}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(ts) => formatAxis(ts, selectedRange)}
                          tick={{ fontSize: 11, fill: axisColor }}
                          axisLine={{ stroke: gridColor }}
                        />
                        <YAxis
                          tickFormatter={(v) => `${v.toFixed(0)}%`}
                          tick={{ fontSize: 11, fill: axisColor }}
                          axisLine={{ stroke: gridColor }}
                          width={50}
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
                          formatter={(value: number) => [`${value.toFixed(1)}%`, 'IV']}
                        />
                        {data.iv.mean !== null && (
                          <ReferenceLine y={data.iv.mean} stroke={axisColor} strokeDasharray="3 3" />
                        )}
                        {data.iv.mean !== null && data.iv.std !== null && (
                          <ReferenceLine y={data.iv.mean + data.iv.std} stroke="#ef4444" strokeDasharray="3 3" />
                        )}
                        {data.iv.mean !== null && data.iv.std !== null && (
                          <ReferenceLine y={data.iv.mean - data.iv.std} stroke="#22c55e" strokeDasharray="3 3" />
                        )}
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#8B5CF6"
                          strokeWidth={1.5}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500"
                      style={{ height: chartHeight }}
                    >
                      IV data unavailable
                    </div>
                  )}
                </div>

                {/* ETF Inflows / Outflows */}
                <div className="border border-gray-100 dark:border-zinc-900 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    BTC ETF Daily Flows
                  </h4>
                  {data.flows.dailyFlows.length > 0 ? (
                    <ResponsiveContainer width="100%" height={chartHeight}>
                      <BarChart data={filterByRange(data.flows.dailyFlows, selectedRange)}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(ts) => formatAxis(ts, selectedRange)}
                          tick={{ fontSize: 11, fill: axisColor }}
                          axisLine={{ stroke: gridColor }}
                        />
                        <YAxis
                          tickFormatter={formatFlowAxis}
                          tick={{ fontSize: 11, fill: axisColor }}
                          axisLine={{ stroke: gridColor }}
                          width={60}
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
                          formatter={(value: number) => [
                            `${value >= 0 ? '+' : '-'}${formatLargeNumber(Math.abs(value))}`,
                            value >= 0 ? 'Inflow' : 'Outflow',
                          ]}
                        />
                        <ReferenceLine y={0} stroke={axisColor} strokeWidth={0.5} />
                        <Bar dataKey="flow">
                          {filterByRange(data.flows.dailyFlows, selectedRange).map((entry, index) => (
                            <Cell
                              key={index}
                              fill={entry.flow >= 0 ? '#22c55e' : '#ef4444'}
                              fillOpacity={0.8}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500"
                      style={{ height: chartHeight }}
                    >
                      No ETF flow data
                    </div>
                  )}
                </div>

                {/* Historical Volatility */}
                <div className="border border-gray-100 dark:border-zinc-900 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                    Historical Volatility (30d rolling, annualised)
                  </h4>
                  {data.vol.rollingSeries.length > 0 ? (
                    <ResponsiveContainer width="100%" height={chartHeight}>
                      <AreaChart data={filterByRange(data.vol.rollingSeries, selectedRange)}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(ts) => formatAxis(ts, selectedRange)}
                          tick={{ fontSize: 11, fill: axisColor }}
                          axisLine={{ stroke: gridColor }}
                        />
                        <YAxis
                          tickFormatter={(v) => `${v.toFixed(0)}%`}
                          tick={{ fontSize: 11, fill: axisColor }}
                          axisLine={{ stroke: gridColor }}
                          width={45}
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
                          formatter={(value: number) => [`${value.toFixed(1)}%`, 'Vol']}
                        />
                        <ReferenceLine y={50} stroke={axisColor} strokeDasharray="3 3" strokeWidth={0.7} />
                        <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={0.7} />
                        <defs>
                          <linearGradient id="volGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <Area
                          type="monotone"
                          dataKey="vol"
                          stroke="#64748b"
                          fill="url(#volGradient)"
                          strokeWidth={1.5}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500"
                      style={{ height: chartHeight }}
                    >
                      Insufficient data
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
