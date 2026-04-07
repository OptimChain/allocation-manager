import { useState, useEffect } from 'react';
import { Calendar, TrendingDown, TrendingUp, ArrowDown, RefreshCw } from 'lucide-react';
import {
  fetchWeekendMomentumData,
  WeekendMomentumResult,
  WeekendMetrics,
  WeekendData,
  HourlyBar,
} from '../services/weekendMomentumService';

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

      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Weekend Drift</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <MetricCard label="Mon opened below Fri close" value={metrics.monBelowFriPct} isNegative={metrics.monBelowFriPct > 50} />
        <MetricCard label="Avg Fri→Sat drift" value={metrics.avgFriToSatDrift} isNegative={metrics.avgFriToSatDrift < 0} />
        <MetricCard label="Avg Sat→Sun drift" value={metrics.avgSatToSunDrift} isNegative={metrics.avgSatToSunDrift < 0} />
        <MetricCard label="Avg Sun→Mon drift" value={metrics.avgSunToMonDrift} isNegative={metrics.avgSunToMonDrift < 0} />
        <MetricCard label="Avg weekend drawdown" value={metrics.avgWeekendDrawdown} isNegative={true} />
        <MetricCard label="Worst weekend drawdown" value={metrics.worstWeekendDrawdown} isNegative={true} />
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
                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Sun→Mon</th>
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

function HourlyTable({ bars }: { bars: HourlyBar[] }) {
  const [page, setPage] = useState(0);
  const perPage = 48;
  const sorted = [...bars].reverse();
  const totalPages = Math.ceil(sorted.length / perPage);
  const slice = sorted.slice(page * perPage, (page + 1) * perPage);

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">BTC Hourly Price History (Last 7 Days)</h3>
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

export default function WeekendMomentum() {
  const [data, setData] = useState<WeekendMomentumResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWeekendMomentumData();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch weekend data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <Calendar className="w-10 h-10 text-gray-300 dark:text-gray-600 animate-pulse mx-auto mb-3" />
          <p className="text-gray-600 dark:text-gray-400">Loading weekend momentum data...</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Fetching BTC + Grayscale Mini Trust history</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-200 mx-auto text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const computeFromWeekends = (weekends: WeekendData[]): WeekendMetrics | null => {
    if (weekends.length === 0) return null;
    const n = weekends.length;
    const avgArr = (a: number[]) => (a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    const friSat = weekends.filter((x) => x.friToSatDrift !== null).map((x) => x.friToSatDrift!);
    const satSun = weekends.filter((x) => x.satToSunDrift !== null).map((x) => x.satToSunDrift!);
    const dd = weekends.map((x) => x.weekendDrawdown);
    return {
      totalWeekends: n,
      monBelowFriPct: (weekends.filter((x) => x.monBelowFri).length / n) * 100,
      avgFriOpenToCloseDrift: avgArr(weekends.map((x) => x.friOpenToCloseDrift)),
      friClosedAboveOpenPct: (weekends.filter((x) => x.friOpenToCloseDrift > 0).length / n) * 100,
      avgFriToSatDrift: avgArr(friSat),
      avgSatToSunDrift: avgArr(satSun),
      avgSunToMonDrift: avgArr(weekends.map((x) => x.sunToMonDrift)),
      avgMonOpenToCloseDrift: avgArr(weekends.map((x) => x.monOpenToCloseDrift)),
      monClosedAboveOpenPct: (weekends.filter((x) => x.monOpenToCloseDrift > 0).length / n) * 100,
      avgWeekendDrawdown: avgArr(dd),
      worstWeekendDrawdown: Math.min(...dd),
      mondayRecoveryPositivePct: (weekends.filter((x) => x.mondayRecoveryPositive).length / n) * 100,
    };
  };

  const last3MonthsMetrics = computeFromWeekends(data.btcMiniTrust.last3Months);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Weekend Momentum</h2>
        <p className="text-gray-500 dark:text-gray-400">
          BTC weekend price behavior — Friday afternoon close, weekend drift, and Monday morning recovery.
        </p>
      </div>

      <MetricsGrid metrics={data.allHistory.metrics} label="All BTC History" />

      <MetricsGrid
        metrics={data.btcMiniTrust.metrics}
        label={`Since BTC Mini Trust Inception (${data.btcMiniTrust.startDate})`}
      />

      {last3MonthsMetrics && (
        <MetricsGrid
          metrics={last3MonthsMetrics}
          label="BTC Mini Trust — Last 3 Months"
        />
      )}

      {data.btcMiniTrust.last3Months.length > 0 && (
        <WeekendTable
          weekends={data.btcMiniTrust.last3Months}
          title="BTC Mini Trust — Last 3 Months Weekend History"
        />
      )}

      <HourlyTable bars={data.hourlyHistory} />
    </div>
  );
}
