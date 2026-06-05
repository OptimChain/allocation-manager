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
  Legend,
} from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { getTimeSeries, NormalizedPriceData } from '../services/twelveDataService';
import { listOptionSymbols } from '../services/blobDataService';

// S&P 500 benchmark used to measure relative momentum.
const BENCHMARK = { symbol: 'SPY', label: 'S&P 500 (SPY)', color: '#9ca3af' };

// Fallback underlyings if the blob symbol list is unavailable.
const FALLBACK_SYMBOLS = ['IWN', 'CRWD'];

// Cap the number of underlyings fetched so we stay within TwelveData rate limits.
const MAX_SYMBOLS = 7;

// Distinct line colors cycled across underlyings.
const PALETTE = ['#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#EC4899', '#14B8A6'];

interface UnderlyingRow {
  symbol: string;
  color: string;
  spot: number | null;
  dayChangePct: number | null;
  relativePct: number | null; // vs S&P 500
  series: NormalizedPriceData[];
}

interface ChartRow {
  ts: number;
  label: string;
  [symbol: string]: number | string;
}

function pctFromOpen(series: NormalizedPriceData[]): number | null {
  if (series.length < 1) return null;
  const base = series[0].price;
  if (!base) return null;
  return (series[series.length - 1].price / base - 1) * 100;
}

export default function UnderlyingsMomentum() {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<UnderlyingRow[]>([]);
  const [benchmark, setBenchmark] = useState<NormalizedPriceData[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const chartHeight = 340;
  const axisColor = '#a1a1aa';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Underlyings = option symbols tracked in the blob stores.
        let symbols: string[] = [];
        try {
          symbols = await listOptionSymbols();
        } catch {
          symbols = [];
        }
        if (symbols.length === 0) symbols = FALLBACK_SYMBOLS;
        symbols = symbols.slice(0, MAX_SYMBOLS);

        // Fetch 1-day intraday series for the benchmark + each underlying.
        const benchSeries = await getTimeSeries(BENCHMARK.symbol, '1D');
        const benchPct = pctFromOpen(benchSeries);

        const underlyings = await Promise.all(
          symbols.map(async (symbol, i) => {
            try {
              const series = await getTimeSeries(symbol, '1D');
              const dayChangePct = pctFromOpen(series);
              return {
                symbol,
                color: PALETTE[i % PALETTE.length],
                spot: series.length > 0 ? series[series.length - 1].price : null,
                dayChangePct,
                relativePct:
                  dayChangePct !== null && benchPct !== null ? dayChangePct - benchPct : null,
                series,
              } as UnderlyingRow;
            } catch {
              return {
                symbol,
                color: PALETTE[i % PALETTE.length],
                spot: null,
                dayChangePct: null,
                relativePct: null,
                series: [],
              } as UnderlyingRow;
            }
          }),
        );

        if (!cancelled) {
          setBenchmark(benchSeries);
          setRows(underlyings);
          setLastUpdated(new Date().toLocaleTimeString());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load underlyings data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // Build normalized (% from day open) multi-line chart, aligned by timestamp.
  const chartData = useMemo<ChartRow[]>(() => {
    const byTs = new Map<number, ChartRow>();

    const addSeries = (key: string, series: NormalizedPriceData[]) => {
      if (series.length === 0) return;
      const base = series[0].price;
      if (!base) return;
      for (const p of series) {
        let row = byTs.get(p.timestamp);
        if (!row) {
          row = {
            ts: p.timestamp,
            label: new Date(p.timestamp).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          };
          byTs.set(p.timestamp, row);
        }
        row[key] = (p.price / base - 1) * 100;
      }
    };

    addSeries(BENCHMARK.symbol, benchmark);
    for (const r of rows) addSeries(r.symbol, r.series);

    return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
  }, [rows, benchmark]);

  const tooltipStyle = {
    backgroundColor: isDark ? '#09090b' : '#ffffff',
    border: `1px solid ${isDark ? '#27272a' : '#e5e7eb'}`,
    borderRadius: '0.5rem',
    color: isDark ? '#ffffff' : '#111827',
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3">
        <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Loading underlying spot prices…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-4">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        <p className="text-xs text-red-500 dark:text-red-500 mt-2">
          Ensure VITE_TWELVE_DATA_API_KEY is configured.
        </p>
      </div>
    );
  }

  const hasChart = chartData.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Underlyings — Spot &amp; Relative Momentum
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            Live spot price per underlying with a 1-day intraday series tracking momentum relative
            to the S&amp;P 500.
          </p>
        </div>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-zinc-800 text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Spot / momentum table */}
      <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-zinc-900 text-gray-500 dark:text-gray-400">
              <th className="px-4 py-3 text-left font-medium">Underlying</th>
              <th className="px-4 py-3 text-right font-medium">Spot</th>
              <th className="px-4 py-3 text-right font-medium">1D Change</th>
              <th className="px-4 py-3 text-right font-medium">vs S&amp;P 500</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.symbol}
                className="border-b border-gray-50 dark:border-zinc-900/50 hover:bg-gray-50 dark:hover:bg-zinc-900/50"
              >
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: r.color }}
                    />
                    {r.symbol}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-gray-900 dark:text-white">
                  {r.spot !== null ? `$${r.spot.toFixed(2)}` : '—'}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium ${
                    r.dayChangePct === null
                      ? 'text-gray-400'
                      : r.dayChangePct >= 0
                        ? 'text-green-600'
                        : 'text-red-500'
                  }`}
                >
                  {r.dayChangePct !== null
                    ? `${r.dayChangePct >= 0 ? '+' : ''}${r.dayChangePct.toFixed(2)}%`
                    : '—'}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium ${
                    r.relativePct === null
                      ? 'text-gray-400'
                      : r.relativePct >= 0
                        ? 'text-green-600'
                        : 'text-red-500'
                  }`}
                >
                  <span className="inline-flex items-center justify-end gap-1">
                    {r.relativePct !== null &&
                      (r.relativePct >= 0 ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      ))}
                    {r.relativePct !== null
                      ? `${r.relativePct >= 0 ? '+' : ''}${r.relativePct.toFixed(2)}%`
                      : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Relative momentum chart */}
      <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
          1-Day Momentum vs S&amp;P 500
        </h4>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
          Intraday % change from the day&apos;s open. The dashed gray line is the S&amp;P 500 —
          lines above it are outperforming, below are lagging.
        </p>
        {hasChart ? (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="ts"
                tickFormatter={(ts) =>
                  new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                }
                tick={{ fontSize: 11, fill: axisColor }}
                axisLine={{ stroke: gridColor }}
              />
              <YAxis
                tickFormatter={(v) => `${v.toFixed(1)}%`}
                tick={{ fontSize: 11, fill: axisColor }}
                axisLine={{ stroke: gridColor }}
                width={55}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
                formatter={(value: number, name: string) => [`${value.toFixed(2)}%`, name]}
              />
              <Legend />
              <ReferenceLine y={0} stroke={axisColor} />
              <Line
                type="monotone"
                dataKey={BENCHMARK.symbol}
                name={BENCHMARK.label}
                stroke={BENCHMARK.color}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
              />
              {rows.map((r) => (
                <Line
                  key={r.symbol}
                  type="monotone"
                  dataKey={r.symbol}
                  name={r.symbol}
                  stroke={r.color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div
            className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500"
            style={{ height: chartHeight }}
          >
            No intraday data available
          </div>
        )}
        {lastUpdated && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
            Spot prices via TwelveData · updated {lastUpdated}
          </p>
        )}
      </div>
    </div>
  );
}
