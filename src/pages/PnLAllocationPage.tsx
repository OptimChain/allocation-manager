import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, XCircle } from 'lucide-react';
import {
  getEnrichedSnapshot,
  EnrichedSnapshot,
  PnLPeriod,
} from '../services/robinhoodService';
import {
  PortfolioAllocation,
  RealizedPnLSummary,
  PnLBySymbolTable,
  PNL_PERIODS,
  PERIOD_LABEL,
} from './TradePage';

export default function PnLAllocationPage() {
  const [snapshot,   setSnapshot]   = useState<EnrichedSnapshot | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pnlPeriod,  setPnlPeriod]  = useState<PnLPeriod>('1Y');

  const pnl = snapshot?.pnl_by_period[pnlPeriod] ?? null;

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const s = await getEnrichedSnapshot();
      setSnapshot(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch snapshot');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-64 mb-4" />
          <div className="h-4 bg-gray-200 rounded w-96 mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            {[1,2,3,4,5].map(i => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
          </div>
          <div className="h-96 bg-gray-200 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <XCircle className="w-16 h-16 mx-auto mb-4 text-red-300" />
          <p className="text-lg font-medium text-red-600 mb-2">{error}</p>
          <button onClick={() => fetchData()} className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 text-sm">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">P&amp;L &amp; Asset Allocation</h1>
          <p className="text-gray-500 mt-1">Portfolio breakdown and realized profit &amp; loss</p>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-50 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {snapshot && (
        <>
          {/* ── Asset Allocation ───────────────────────────────────── */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Asset Allocation</h2>
            <PortfolioAllocation portfolio={snapshot.portfolio} />
          </div>

          {/* ── Order P&L with period selector ─────────────────────── */}
          <div className="mt-8 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Order P&amp;L</h2>
              <p className="text-gray-500 mt-1">Realized profit &amp; loss from filled orders</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex bg-gray-100 dark:bg-zinc-800 rounded-xl p-1 overflow-x-auto">
                {PNL_PERIODS.map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => setPnlPeriod(value)}
                    className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                      pnlPeriod === value
                        ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {pnl && (
            <>
              <RealizedPnLSummary
                stock={pnl.stock}
                option={pnl.option}
                periodLabel={PERIOD_LABEL[pnlPeriod]}
                openOrders={
                  snapshot.portfolio.open_orders.length > 0
                    ? snapshot.portfolio.open_orders
                    : snapshot.order_book
                }
              />
              <PnLBySymbolTable stock={pnl.stock} option={pnl.option} />
            </>
          )}
        </>
      )}
    </div>
  );
}
