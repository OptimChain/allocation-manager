import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { Activity, AlertTriangle } from 'lucide-react';
import {
  getOptionPositionHistory,
  type OptionPositionsHistoryBlob,
} from '../services/blobDataService';
import { formatCurrency, getGainColor } from '../services/robinhoodService';

interface ChartRow {
  ts: string;
  label: string;
  cost_basis: number;
  current_value: number;
  unrealized_pl: number;
  count: number;
  any_stale: boolean;
}

function toRow(b: OptionPositionsHistoryBlob): ChartRow {
  let cost = 0;
  let value = 0;
  let pl = 0;
  let stale = false;
  for (const p of b.positions) {
    cost += p.cost_basis ?? 0;
    value += p.current_value ?? 0;
    pl += p.unrealized_pl ?? 0;
    if (p.mark_stale) stale = true;
  }
  const d = new Date(b.timestamp);
  const label = d.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
  return {
    ts: b.timestamp,
    label,
    cost_basis: Math.round(cost * 100) / 100,
    current_value: Math.round(value * 100) / 100,
    unrealized_pl: Math.round(pl * 100) / 100,
    count: b.positions.length,
    any_stale: stale,
  };
}

export default function OptionPositionsHistory({ limit = 96 }: { limit?: number }) {
  const [rows, setRows] = useState<ChartRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOptionPositionHistory(limit)
      .then(snaps => {
        if (cancelled) return;
        setRows(snaps.map(toRow));
        setError(null);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [limit]);

  // Empty / pre-data state — distinct from "loaded but empty array" so the
  // user can tell whether the writer hasn't started yet vs. they actually have
  // no option positions in the window.
  if (loading && rows == null) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6 text-sm text-gray-500">
        Loading option position history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6 text-sm text-gray-500">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-1">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-medium">Option history unavailable</span>
        </div>
        <div className="text-xs">{error}</div>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-6 text-sm text-gray-500">
        No option position history yet. The engine writes a snapshot every
        poll tick; data will appear here once the writer has run.
      </div>
    );
  }

  const latest = rows[rows.length - 1];
  const first = rows[0];
  const plDelta = latest.unrealized_pl - first.unrealized_pl;
  const anyStale = rows.some(r => r.any_stale);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center gap-2">
        <Activity className="w-5 h-5 text-gray-500" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Option Positions — History
        </h3>
        <span className="text-sm text-gray-400 ml-auto">
          {rows.length} snapshot{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800">
        <div>
          <div className="text-xs text-gray-500">Latest count</div>
          <div className="font-medium text-gray-900 dark:text-gray-100">{latest.count}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Cost basis</div>
          <div className="font-medium text-gray-900 dark:text-gray-100">
            {formatCurrency(latest.cost_basis)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Current value</div>
          <div className="font-medium text-gray-900 dark:text-gray-100">
            {formatCurrency(latest.current_value)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Δ Unrealized P&amp;L</div>
          <div className={`font-medium ${getGainColor(plDelta)}`}>
            {formatCurrency(plDelta)}
          </div>
        </div>
      </div>

      {anyStale && (
        <div className="px-4 py-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900">
          Some snapshots have stale marks (mark_price == avg_price) —
          unrealized P&amp;L on those points reflects entry, not market.
        </div>
      )}

      <div className="p-4" style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={32} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v: number) => formatCurrency(v)}
              labelFormatter={(l) => `Tick ${l}`}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="cost_basis" stroke="#6B7280" dot={false} name="Cost basis" />
            <Line type="monotone" dataKey="current_value" stroke="#3B82F6" dot={false} name="Current value" />
            <Line type="monotone" dataKey="unrealized_pl" stroke="#10B981" dot={false} name="Unrealized P&L" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
