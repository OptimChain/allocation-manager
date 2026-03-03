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
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import type { OptionPosition } from '../services/robinhoodService';
import { useTheme } from '../contexts/ThemeContext';

interface PricePoint {
  timestamp: number;
  date: string;
  close: number;
  high: number;
  low: number;
  volume: number;
}

function optionLabel(opt: OptionPosition): string {
  return `${opt.chain_symbol} $${opt.strike} ${opt.option_type.toUpperCase()} ${opt.expiration}`;
}

function optionKey(opt: OptionPosition): string {
  return `${opt.chain_symbol}-${opt.strike}-${opt.option_type}-${opt.expiration}`;
}

async function fetchOptionPriceHistory(opt: OptionPosition): Promise<PricePoint[]> {
  const params = new URLSearchParams({
    symbol: opt.chain_symbol,
    strike: String(opt.strike),
    expiration: opt.expiration,
    optionType: opt.option_type,
  });

  const res = await fetch(`/.netlify/functions/options-price-history?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch options price: ${res.status}`);
  }

  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`No price history for ${data.ticker}`);
  }

  return data.results.map((r: { t: number; c: number; h: number; l: number; v: number }) => ({
    timestamp: r.t,
    date: new Date(r.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    close: r.c,
    high: r.h,
    low: r.l,
    volume: r.v || 0,
  }));
}

export default function OptionsPriceChart({ options }: { options: OptionPosition[] }) {
  const { isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const selectedOpt = options[selectedIdx] || options[0];

  useEffect(() => {
    if (!expanded || !selectedOpt) return;

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchOptionPriceHistory(selectedOpt);
        if (!cancelled) setPriceData(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to fetch');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [expanded, selectedIdx, selectedOpt?.chain_symbol, selectedOpt?.strike, selectedOpt?.expiration]);

  const yDomain = useMemo(() => {
    if (priceData.length === 0) return [0, 10];
    const prices = priceData.flatMap((d) => [d.high, d.low, d.close]);
    const levels = [...prices];
    if (selectedOpt) levels.push(selectedOpt.avg_price);
    const min = Math.min(...levels.filter((v) => v > 0));
    const max = Math.max(...levels);
    const pad = (max - min) * 0.05 || 0.5;
    return [Math.max(0, min - pad), max + pad];
  }, [priceData, selectedOpt]);

  const axisColor = isDark ? '#a1a1aa' : '#a1a1aa';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 border-b border-gray-100 dark:border-zinc-900">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-left">
          <BarChart3 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Contract Price{selectedOpt ? `: ${optionLabel(selectedOpt)}` : ''}
          </h3>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          )}
        </button>

        {expanded && options.length > 1 && (
          <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg overflow-x-auto">
            {options.map((opt, i) => (
              <button
                key={optionKey(opt)}
                onClick={() => setSelectedIdx(i)}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  selectedIdx === i
                    ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {opt.chain_symbol} ${opt.strike} {opt.option_type.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <>
          {loading ? (
            <div className="px-6 py-12 text-center">
              <BarChart3 className="w-8 h-8 text-gray-200 dark:text-gray-700 animate-pulse mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading contract price history...</p>
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-red-500 mb-2">{error}</p>
              <button
                onClick={() => { setError(null); setPriceData([]); }}
                className="text-sm text-gray-600 dark:text-gray-400 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : priceData.length > 0 && selectedOpt ? (
            <>
              {/* Summary row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-3 border-b border-gray-100 dark:border-zinc-900 bg-gray-50 dark:bg-zinc-900">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Last Close</div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    ${priceData[priceData.length - 1].close.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Avg Cost</div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    ${selectedOpt.avg_price.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Mark Price</div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    ${selectedOpt.mark_price.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    P&L ({selectedOpt.unrealized_pl >= 0 ? '+' : ''}{selectedOpt.unrealized_pl_pct.toFixed(1)}%)
                  </div>
                  <div className={`font-medium ${selectedOpt.unrealized_pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ${selectedOpt.unrealized_pl.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Chart */}
              <div className="px-6 pb-6 pt-4">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={priceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts) =>
                        new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      }
                      tick={{ fontSize: 11, fill: axisColor }}
                      axisLine={{ stroke: gridColor }}
                    />
                    <YAxis
                      domain={yDomain}
                      tickFormatter={(v) => `$${v.toFixed(2)}`}
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
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'Contract']}
                    />
                    <ReferenceLine
                      y={selectedOpt.avg_price}
                      stroke="#8B5CF6"
                      strokeDasharray="3 3"
                      label={{
                        value: `Cost $${selectedOpt.avg_price.toFixed(2)}`,
                        position: 'left',
                        fill: '#8B5CF6',
                        fontSize: 11,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="close"
                      stroke="#10b981"
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-gray-400 dark:text-gray-500">
                No contract price data available
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
