import { useState, useEffect } from 'react';
import { Calendar, TrendingDown, TrendingUp, ArrowDown, RefreshCw } from 'lucide-react';
import {
  fetchWeekendGapData,
  computeMetrics,
  sliceByMonths,
  WeekendGapResult,
  WEEKEND_GAP_TICKERS,
} from '../services/weekendGapService';
import { WeekendMetrics, WeekendData, HourlyBar } from '../services/weekendMomentumService';

const TIMEFRAMES: { id: string; label: string; months: number | null }[] = [
  { id: '1M', label: '1M', months: 1 },
  { id: '3M', label: '3M', months: 3 },
  { id: '6M', label: '6M', months: 6 },
  { id: '1Y', label: '1Y', months: 12 },
  { id: 'ALL', label: 'All', months: null },
];

function MetricCard({
  label,
  value,
  suffix = '%',
  isNegative,
}: {
  label: string;
  value: number;
  suffix?: string;
  isNegative?: boolean;
}) {
  const color =
    isNegative === undefined
      ? 'text-gray-900 dark:text-white'
      : isNegative
        ? 'text-red-600'
        : 'text-green-600';

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>
        {value.toFixed(2)}{suffix}
      </p>
    </div>
  );
}

function DriftCell({ value }: { value: number | null }) {
  if (value === null) return <td className="px-4 py-2.5 text-right text-gray-400 dark:text-gray-500">—</td>;
  const color = value >= 0 ? 'text-green-600' : 'text-red-600';
  const sign = value >= 0 ? '+' : '';
  return (
    <td className={`px-4 py-2.5 text-right font-medium ${color}`}>
      {sign}{value.toFixed(2)}%
    </td>
  );
}

function PriceCell({ value }: { value: number }) {
  return (
    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
      ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </td>
  );
}

function MetricsGrid({ metrics, label }: { metrics: WeekendMetrics; label: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
        {label}
        <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
          ({metrics.totalWeekends} weekends)
        </span>
      </h3>

      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Friday Afternoon</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <MetricCard label="Avg Fri open→close" value={metrics.avgFriOpenToCloseDrift} isNegative={metrics.avgFriOpenToCloseDrift < 0} />
        <MetricCard label="Fri closed above open" value={metrics.friClosedAboveOpenPct} isNegative={metrics.friClosedAboveOpenPct < 50} />
      </div>

      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Weekend Gap</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <MetricCard label="Mon opened below Fri close" value={metrics.monBelowFriPct} isNegative={metrics.monBelowFriPct > 50} />
        <MetricCard label="Avg weekend gap (Fri→Mon open)" value={metrics.avgSunToMonDrift} isNegative={metrics.avgSunToMonDrift < 0} />
        <MetricCard label="Avg gap drawdown" value={metrics.avgWeekendDrawdown} isNegative={true} />
        <MetricCard label="Worst gap drawdown" value={metrics.worstWeekendDrawdown} isNegative={true} />
      </div>

      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Monday Morning</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Avg Mon open→close" value={metrics.avgMonOpenToCloseDrift} isNegative={metrics.avgMonOpenToCloseDrift < 0} />
        <MetricCard label="Mon closed above open" value={metrics.monClosedAboveOpenPct} isNegative={metrics.monClosedAboveOpenPct < 50} />
        <MetricCard label="Monday recovery positive" value={metrics.mondayRecoveryPositivePct} isNegative={metrics.mondayRecoveryPositivePct < 50} />
      </div>
    </div>
  );
}

function WeekendTable({ weekends, title }: { weekends: WeekendData[]; title: string }) {
  const [page, setPage] = useState(0);
  const perPage = 20;
  const totalPages = Math.ceil(weekends.length / perPage);

  const sorted = [...weekends].reverse();
  const slice = sorted.slice(page * perPage, (page + 1) * perPage);

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{title}</h3>
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800">
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Friday</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Fri Open</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Fri Close</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Fri O→C</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Fri→Sat</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Sat→Sun</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Weekend Gap</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Mon Open</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Mon Close</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Mon O→C</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Drawdown</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Mon&lt;Fri</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Recovery</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((w) => (
                <tr key={w.fridayDate} className="border-b border-gray-100 dark:border-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-900">
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{w.fridayDate}</td>
                  <PriceCell value={w.fridayOpen} />
                  <PriceCell value={w.fridayClose} />
                  <DriftCell value={w.friOpenToCloseDrift} />
                  <DriftCell value={w.friToSatDrift} />
                  <DriftCell value={w.satToSunDrift} />
                  <DriftCell value={w.sunToMonDrift} />
                  <PriceCell value={w.mondayOpen} />
                  <PriceCell value={w.mondayClose} />
                  <DriftCell value={w.monOpenToCloseDrift} />
                  <td className="px-4 py-2.5 text-right font-medium text-red-600">
                    {w.weekendDrawdown.toFixed(2)}%
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {w.monBelowFri ? (
                      <ArrowDown className="w-4 h-4 text-red-500 inline" />
                    ) : (
                      <TrendingUp className="w-4 h-4 text-green-500 inline" />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {w.mondayRecoveryPositive ? (
                      <TrendingUp className="w-4 h-4 text-green-500 inline" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-500 inline" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Page {page + 1} of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getDayLabel(datetime: string): string {
  const d = new Date(datetime.replace(' ', 'T'));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}

function HourlyTable({ bars, symbol }: { bars: HourlyBar[]; symbol: string }) {
  const [page, setPage] = useState(0);
  const perPage = 48;
  const sorted = [...bars].reverse();
  const totalPages = Math.ceil(sorted.length / perPage);
  const slice = sorted.slice(page * perPage, (page + 1) * perPage);

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{symbol} Hourly Price History (Last 7 Days)</h3>
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800">
                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Datetime</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Day</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Open</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">High</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Low</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Close</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Change</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((bar) => {
                const day = getDayLabel(bar.datetime);
                const isWeekend = day === 'Sat' || day === 'Sun';
                return (
                  <tr
                    key={bar.datetime}
                    className={`border-b border-gray-100 dark:border-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-900 ${isWeekend ? 'bg-gray-50/60 dark:bg-zinc-900/40' : ''}`}
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{bar.datetime}</td>
                    <td className={`px-4 py-2.5 text-center text-xs font-semibold ${isWeekend ? 'text-gray-700 dark:text-gray-300 font-bold' : 'text-gray-500 dark:text-gray-400'}`}>
                      {day}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      ${bar.open.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      ${bar.high.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      ${bar.low.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">
                      ${bar.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium ${bar.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {bar.change >= 0 ? '+' : ''}{bar.change.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">Page {page + 1} of {totalPages}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Pills<T extends string>({
  options,
  active,
  onSelect,
}: {
  options: { id: T; label: string }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onSelect(opt.id)}
          className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-colors ${
            active === opt.id
              ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100'
              : 'bg-white dark:bg-zinc-950 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-900'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function WeekendGap() {
  const [symbol, setSymbol] = useState<string>(WEEKEND_GAP_TICKERS[0].symbol);
  const [timeframe, setTimeframe] = useState<string>('3M');
  const [cache, setCache] = useState<Record<string, WeekendGapResult>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = cache[symbol];

  const fetchData = async (sym: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWeekendGapData(sym);
      setCache((prev) => ({ ...prev, [sym]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to fetch ${sym} data`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cache[symbol]) {
      fetchData(symbol);
    } else {
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const tickerLabel =
    WEEKEND_GAP_TICKERS.find((t) => t.symbol === symbol)?.label ?? symbol;
  const tfLabel = TIMEFRAMES.find((t) => t.id === timeframe)?.label ?? timeframe;
  const tfMonths = TIMEFRAMES.find((t) => t.id === timeframe)?.months ?? null;

  const weekends = data ? sliceByMonths(data.weekends, tfMonths) : [];
  const metrics = computeMetrics(weekends);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Weekend Gap</h2>
        <p className="text-gray-500 dark:text-gray-400">
          Weekend overnight behavior — Friday close, the Friday→Monday gap, and Monday recovery.
          These tickers trade weekdays only, so there is no Saturday/Sunday data.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Ticker</p>
          <Pills
            options={WEEKEND_GAP_TICKERS.map((t) => ({ id: t.symbol, label: t.label }))}
            active={symbol}
            onSelect={setSymbol}
          />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Timeframe</p>
          <Pills
            options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))}
            active={timeframe}
            onSelect={setTimeframe}
          />
        </div>
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Calendar className="w-10 h-10 text-gray-300 dark:text-gray-600 animate-pulse mx-auto mb-3" />
            <p className="text-gray-600 dark:text-gray-400">Loading {symbol} weekend gap data...</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Fetching {symbol} price history</p>
          </div>
        </div>
      )}

      {error && !data && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => fetchData(symbol)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-200 mx-auto text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      )}

      {data && (
        <>
          {weekends.length > 0 ? (
            <>
              <MetricsGrid metrics={metrics} label={`${tickerLabel} — ${tfLabel}`} />
              <WeekendTable
                weekends={weekends}
                title={`${symbol} — ${tfLabel} Weekend Gap History`}
              />
            </>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">
              No weekend data for {symbol} in the {tfLabel} window.
            </p>
          )}

          <HourlyTable bars={data.hourlyHistory} symbol={symbol} />
        </>
      )}
    </div>
  );
}
