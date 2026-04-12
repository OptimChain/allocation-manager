import { useState, useEffect, useCallback } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  CheckCircle,
  XCircle,
  Bot,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Receipt,
  Clock,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import {
  getEnrichedSnapshot,
  getBotActions,
  EnrichedSnapshot,
  EnrichedPortfolio,
  StockPnLResult,
  OptionPnLResult,
  BotAction,
  SnapshotOrder,
  OptionPosition,
  PnLPeriod,
  formatCurrency,
  formatPercent,
  getGainColor,
} from '../services/robinhoodService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safe number coercion — returns 0 for null/undefined/NaN. */
function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function fmtTime(dateStr: string, timeOnly = false): string {
  // Treat naive timestamps (no Z / offset) as UTC
  const normalized = dateStr && !dateStr.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(dateStr)
    ? dateStr + 'Z'
    : dateStr;
  const d = new Date(normalized);
  const opts: Intl.DateTimeFormatOptions = timeOnly
    ? { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }
    : { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' };
  return d.toLocaleString('en-US', opts);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
];

const PNL_PERIODS: { label: string; value: PnLPeriod }[] = [
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
  { label: '5Y', value: '5Y' },
];

const PERIOD_LABEL: Record<PnLPeriod, string> = {
  '1W': 'last week', '1M': 'last month', '3M': 'last 3 months',
  '6M': 'last 6 months', '1Y': 'last year', '5Y': 'last 5 years',
};

// ─── PortfolioSummary ─────────────────────────────────────────────────────────

function PortfolioSummary({ portfolio }: { portfolio: EnrichedPortfolio }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
          <DollarSign className="w-4 h-4" />
          Portfolio Value
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(portfolio.equity)}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          RH {formatCurrency(portfolio.reconciliation.rh_equity)}
          {' · '}
          Engine {formatCurrency(portfolio.reconciliation.computed_equity)}
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
          {portfolio.total_pl >= 0
            ? <TrendingUp className="w-4 h-4 text-gray-700 dark:text-gray-300" />
            : <TrendingDown className="w-4 h-4 text-gray-700 dark:text-gray-300" />}
          Total P&amp;L
        </div>
        <div className={`text-2xl font-bold ${getGainColor(portfolio.total_pl)}`}>
          {formatCurrency(portfolio.total_pl)} ({formatPercent(portfolio.total_pl_pct)})
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
          <Activity className="w-4 h-4" />
          Buying Power
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(portfolio.cash.buying_power)}
        </div>
        {portfolio.margin_used > 0 && (
          <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">
            Margin used: {formatCurrency(portfolio.margin_used)}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
          <BarChart3 className="w-4 h-4" />
          Positions
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {portfolio.positions.length}
        </div>
        {portfolio.options.length > 0 && (
          <div className="text-xs text-gray-400 mt-1">
            + {portfolio.options.length} option position{portfolio.options.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PortfolioAllocation ──────────────────────────────────────────────────────

function PortfolioAllocation({ portfolio }: { portfolio: EnrichedPortfolio }) {
  const pieData = portfolio.positions.map((pos, i) => ({
    name: pos.symbol,
    value: pos.equity,
    color: COLORS[i % COLORS.length],
  }));

  const bp = portfolio.cash.buying_power;
  if (bp > 0) pieData.push({ name: 'Cash', value: bp, color: '#9CA3AF' });

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    const total = pieData.reduce((s, x) => s + x.value, 0);
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-lg p-3">
        <p className="font-medium text-gray-900 dark:text-gray-100">{d.name}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">{formatCurrency(d.value)}</p>
        <p className="text-sm text-gray-500">{(total > 0 ? (d.value / total) * 100 : 0).toFixed(1)}%</p>
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Portfolio Allocation</h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
            {pieData.map((entry, i) => <Cell key={`cell-${i}`} fill={entry.color} />)}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── PositionsTable ───────────────────────────────────────────────────────────

function PositionsTable({ portfolio }: { portfolio: EnrichedPortfolio }) {
  // Positions arrive pre-sorted by abs(profit_loss) from the backend
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Holdings</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-zinc-800">
            <tr>
              {['Symbol','Shares','Price','Avg Cost','Value','Total Gain'].map(h => (
                <th key={h} className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${h === 'Symbol' ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-zinc-700">
            {portfolio.positions.map((pos, i) => (
              <tr key={pos.symbol} className={i % 2 === 0 ? 'bg-white dark:bg-zinc-900' : 'bg-gray-50 dark:bg-zinc-800'}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 dark:text-gray-100">{pos.symbol}</div>
                  {pos.name && <div className="text-sm text-gray-500 truncate max-w-[150px]">{pos.name}</div>}
                </td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{num(pos.quantity).toFixed(4)}</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{formatCurrency(pos.current_price)}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{formatCurrency(pos.avg_buy_price)}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{formatCurrency(pos.equity)}</td>
                <td className="px-4 py-3 text-right">
                  <div className={`font-medium ${getGainColor(pos.profit_loss)}`}>{formatCurrency(pos.profit_loss)}</div>
                  <div className={`text-sm ${getGainColor(pos.profit_loss_pct)}`}>{formatPercent(pos.profit_loss_pct)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── BotActionsLog ────────────────────────────────────────────────────────────

function BotActionsLog({ actions }: { actions: BotAction[] }) {
  const statusIcon = (s: string) => {
    if (s === 'completed' || s === 'submitted') return <CheckCircle className="w-4 h-4 text-gray-700 dark:text-gray-300" />;
    if (s === 'failed' || s === 'error')        return <XCircle    className="w-4 h-4 text-gray-700 dark:text-gray-300" />;
    return <Activity className="w-4 h-4 text-gray-500" />;
  };

  const typeColor = (t: string) => {
    if (t === 'BUY_ORDER')  return 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300';
    if (t === 'SELL_ORDER') return 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300';
    return 'bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-gray-200';
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center gap-2">
        <Bot className="w-5 h-5 text-gray-500" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Bot Activity</h3>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {actions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Bot className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No bot actions yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-zinc-700">
            {actions.map(action => (
              <div key={action.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800">
                <div className="flex items-start gap-3">
                  {statusIcon(action.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${typeColor(action.type)}`}>
                        {action.type.replace('_', ' ')}
                      </span>
                      {action.symbol && <span className="font-medium text-gray-900 dark:text-gray-100">{action.symbol}</span>}
                      {action.dryRun && (
                        <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 rounded">DRY RUN</span>
                      )}
                    </div>
                    {action.quantity && action.price && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {action.quantity} shares @ {formatCurrency(action.price)} = {formatCurrency(action.total || 0)}
                      </p>
                    )}
                    {(action.message || action.details) && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{action.message || action.details}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{fmtTime(action.timestamp)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── OptionsPositions ─────────────────────────────────────────────────────────
// Unchanged — receives OptionPosition[] same as before

function formatExpiration(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function OptionsPositions({ options, summary }: {
  options: OptionPosition[];
  summary: EnrichedPortfolio['options_summary'];
}) {
  if (!options.length || !summary) return null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center gap-2">
        <Activity className="w-5 h-5 text-gray-500" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Options</h3>
        <span className="text-sm text-gray-400 ml-auto">{summary.count} position{summary.count !== 1 ? 's' : ''}</span>
      </div>

      {/* Summary bar — pre-aggregated by backend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800">
        {[
          ['Cost Basis',      summary.total_cost_basis,    false],
          ['Current Value',   summary.total_current_value, false],
          ['Unrealized P&L',  summary.total_unrealized_pl, true],
          ['Theta/Day',       summary.total_theta_daily,   true],
        ].map(([label, val, colored]) => (
          <div key={label as string}>
            <div className="text-xs text-gray-500">{label as string}</div>
            <div className={`font-medium ${colored ? getGainColor(val as number) : 'text-gray-900 dark:text-gray-100'}`}>
              {formatCurrency(val as number)}
            </div>
          </div>
        ))}
      </div>

      <div className="divide-y divide-gray-200 dark:divide-zinc-700">
        {options.map(opt => (
          <div key={`${opt.chain_symbol ?? opt.symbol}-${opt.option_type}-${opt.strike ?? opt.strike_price}-${opt.expiration ?? opt.expiration_date}`} className="p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="font-semibold text-gray-900 dark:text-gray-100">{opt.chain_symbol ?? opt.symbol}</span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${opt.option_type === 'call' ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300'}`}>
                {opt.option_type.toUpperCase()}
              </span>
              <span className="text-sm text-gray-600 dark:text-gray-400">${opt.strike ?? opt.strike_price} strike</span>
              <span className="text-sm text-gray-500">exp {opt.expiration ?? opt.expiration_date}</span>
              {opt.dte != null && (
                <span className={`px-2 py-0.5 text-xs rounded ${opt.dte <= 7 ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : opt.dte <= 21 ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 dark:text-gray-400'}`}>
                  {opt.dte}d
                </span>
              )}
              <span className="text-xs text-gray-500">{opt.quantity} × {opt.position_type ?? opt.option_type}</span>
              {opt.recommended_action && (
                <span className={`ml-auto px-2 py-0.5 text-xs font-medium rounded ${opt.recommended_action.action === 'CLOSE' || opt.recommended_action.action === 'SELL' ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : opt.recommended_action.action === 'HOLD' ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300'}`}>
                  {opt.recommended_action.action}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              {opt.underlying_price != null && (
                <div><div className="text-xs text-gray-400">Underlying</div><div className="text-sm text-gray-900 dark:text-gray-100">${num(opt.underlying_price).toFixed(2)}</div></div>
              )}
              {opt.break_even != null && (
                <div><div className="text-xs text-gray-400">Break Even</div><div className="text-sm text-gray-900 dark:text-gray-100">${num(opt.break_even).toFixed(2)}</div></div>
              )}
              <div>
                <div className="text-xs text-gray-400">P&amp;L</div>
                <div className={`text-sm font-medium ${getGainColor(opt.unrealized_pl)}`}>{formatCurrency(opt.unrealized_pl)}{opt.unrealized_pl_pct != null ? ` (${formatPercent(opt.unrealized_pl_pct)})` : ''}</div>
              </div>
              {opt.chance_of_profit != null && (
                <div><div className="text-xs text-gray-400">Prob. of Profit</div><div className="text-sm text-gray-900 dark:text-gray-100">{(num(opt.chance_of_profit) * 100).toFixed(1)}%</div></div>
              )}
            </div>

            {opt.greeks && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
                {(['delta','gamma','theta','vega','iv','rho'] as const).map(greek => (
                  opt.greeks![greek] != null && (
                    <div key={greek} className="bg-gray-50 dark:bg-zinc-800 rounded p-2">
                      <div className="text-[10px] text-gray-400 uppercase">{greek}</div>
                      <div className={`text-xs font-mono ${greek === 'theta' ? getGainColor(opt.greeks![greek]) : 'text-gray-900 dark:text-gray-100'}`}>
                        {greek === 'iv' ? `${(num(opt.greeks![greek]) * 100).toFixed(1)}%` : num(opt.greeks![greek]).toFixed(greek === 'gamma' || greek === 'rho' ? 4 : 3)}
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}

            {opt.expected_pl && (
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-gray-400">Scenario P&amp;L:</span>
                {Object.entries(opt.expected_pl).filter(([k]) => k !== 'theta_daily').map(([scenario, pl]) => (
                  <span key={scenario} className={`font-mono ${getGainColor(pl)}`}>{scenario}: {formatCurrency(pl)}</span>
                ))}
              </div>
            )}

            {(opt.recommended_action?.reasons?.length ?? 0) > 0 && (
              <div className="mt-2 text-xs text-gray-500">{opt.recommended_action!.reasons!.join(' · ')}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── OrderBookSnapshotView ────────────────────────────────────────────────────

function OrderBookSnapshotView({ snapshot }: { snapshot: EnrichedSnapshot }) {
  const { portfolio, market_data, timestamp, recent_orders, recent_option_orders } = snapshot;

  const openOrders       = (portfolio?.open_orders || []).length > 0 ? portfolio.open_orders : (snapshot.order_book || []);
  const openOptionOrders = portfolio?.open_option_orders || [];

  // Pre-computed by backend — no client-side math
  const recentPnl = snapshot.recent_pnl;
  const optionPnl = snapshot.option_pnl;

  const btcState   = market_data?.symbols['BTC'];
  const btcMetrics = btcState?.metrics;
  const hasBtc     = btcMetrics?.current_price != null;
  const marketDataStale = market_data && market_data.timestamp !== timestamp;

  const stateBadge = (state: string) =>
    state === 'filled'    ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' :
    state === 'cancelled' ? 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-400' :
                            'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300';

  return (
    <div className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Order Book Snapshot</h2>
          <p className="text-xs text-gray-400">Last updated: {fmtTime(timestamp)}</p>
        </div>
        {btcState && (
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 text-xs font-medium rounded bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-gray-200">
              BTC Signal: {btcState.last_signal?.signal}
            </span>
            {hasBtc && <span className="text-xs text-gray-500">${num(btcMetrics!.current_price).toFixed(2)}</span>}
          </div>
        )}
      </div>

      {/* Summary cards — all values from backend */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Equity',        icon: <DollarSign className="w-4 h-4" />, val: portfolio?.equity ?? 0 },
          { label: 'Market Value',  icon: <BarChart3   className="w-4 h-4" />, val: portfolio?.market_value ?? 0 },
          { label: 'Buying Power',  icon: <Activity    className="w-4 h-4" />, val: portfolio?.cash?.buying_power ?? 0 },
        ].map(({ label, icon, val }) => (
          <div key={label} className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">{icon}{label}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(val)}</div>
          </div>
        ))}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            {(portfolio?.total_pl ?? 0) >= 0 ? <TrendingUp className="w-4 h-4 text-gray-700 dark:text-gray-300" /> : <TrendingDown className="w-4 h-4 text-gray-700 dark:text-gray-300" />}
            Total P&amp;L
          </div>
          <div className={`text-2xl font-bold ${getGainColor(portfolio?.total_pl ?? 0)}`}>
            {formatCurrency(portfolio?.total_pl ?? 0)} ({formatPercent(portfolio?.total_pl_pct ?? 0)})
          </div>
        </div>
      </div>

      {hasBtc && (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-3 mb-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-500">BTC Intraday</span>
            {[['Low', btcMetrics!.intraday_low], ['High', btcMetrics!.intraday_high]].map(([label, val]) => (
              val != null && <span key={label as string}><span className="text-gray-400">{label} </span><span className="font-medium text-gray-900 dark:text-gray-100">${num(val as number).toFixed(2)}</span></span>
            ))}
            {btcMetrics!.intraday_volatility != null && (
              <span><span className="text-gray-400">Vol </span><span className="font-medium text-gray-900 dark:text-gray-100">{num(btcMetrics!.intraday_volatility).toFixed(1)}%</span></span>
            )}
            {marketDataStale && market_data && (
              <span className="text-gray-400 ml-auto text-xs">as of {fmtTime(market_data.timestamp, true)}</span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Positions table — arrives pre-sorted */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-gray-500" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Positions</h3>
            <span className="text-sm text-gray-400 ml-auto">{(portfolio?.positions || []).length} holdings</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-zinc-800">
                <tr>
                  {['Symbol','Qty','Price','Day','Avg Cost','Value','Alloc','P&L'].map(h => (
                    <th key={h} className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${h === 'Symbol' ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-zinc-700">
                {(portfolio?.positions || []).map((pos, i) => (
                  <tr key={pos.symbol} className={i % 2 === 0 ? 'bg-white dark:bg-zinc-900' : 'bg-gray-50 dark:bg-zinc-800'}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{pos.symbol}</div>
                      {pos.name && <div className="text-xs text-gray-500 truncate max-w-[120px]">{pos.name}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{num(pos.quantity).toFixed(4)}</td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{formatCurrency(pos.current_price)}</td>
                    <td className="px-4 py-3 text-right">
                      {pos.percent_change != null
                        ? <span className={`text-sm font-medium ${getGainColor(pos.percent_change)}`}>{num(pos.percent_change) >= 0 ? '+' : ''}{num(pos.percent_change).toFixed(2)}%</span>
                        : <span className="text-sm text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{formatCurrency(pos.avg_buy_price)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{formatCurrency(pos.equity)}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400">
                      {pos.percentage != null ? `${num(pos.percentage).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className={`font-medium ${getGainColor(pos.profit_loss)}`}>{formatCurrency(pos.profit_loss)}</div>
                      <div className={`text-sm ${getGainColor(pos.profit_loss_pct)}`}>{formatPercent(pos.profit_loss_pct)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column: open orders + 7d P&L + history */}
        <div className="space-y-6">
          {/* Open orders */}
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-gray-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Open Orders</h3>
              <span className="text-sm text-gray-400 ml-auto">{openOrders.length + openOptionOrders.length}</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {openOrders.length === 0 && openOptionOrders.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  <Receipt className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">No open orders</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-zinc-700">
                  {openOrders.map(order => (
                    <div key={order.order_id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800">
                      <div className="flex items-start gap-3">
                        {order.side === 'BUY' ? <ArrowUpRight className="w-4 h-4 text-gray-700 dark:text-gray-300 mt-0.5" /> : <ArrowDownRight className="w-4 h-4 text-gray-700 dark:text-gray-300 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 text-xs font-medium rounded ${order.side === 'BUY' ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300'}`}>{order.side}</span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">{order.symbol}</span>
                            <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 dark:text-gray-400 rounded">{order.state}</span>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{order.quantity} @ {formatCurrency(order.limit_price)}{order.stop_price ? ` (stop: ${formatCurrency(order.stop_price)})` : ''}</p>
                          <p className="text-xs text-gray-400 mt-1">{order.order_type} / {order.trigger} — {fmtTime(order.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {openOptionOrders.length > 0 && (
                    <>
                      {openOrders.length > 0 && (
                        <div className="px-4 py-2 bg-gray-50 dark:bg-zinc-800">
                          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Option Orders</span>
                        </div>
                      )}
                      {openOptionOrders.map(order => {
                        const leg   = order.legs?.[0];
                        const side  = (leg?.side || '').toUpperCase();
                        const isBuy = side === 'BUY';
                        const ticker = order.chain_symbol || leg?.chain_symbol || '?';
                        return (
                          <div key={order.order_id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800">
                            <div className="flex items-start gap-3">
                              {isBuy ? <ArrowUpRight className="w-4 h-4 text-gray-700 dark:text-gray-300 mt-0.5" /> : <ArrowDownRight className="w-4 h-4 text-gray-700 dark:text-gray-300 mt-0.5" />}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${isBuy ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300'}`}>{side}</span>
                                  <span className="font-medium text-gray-900 dark:text-gray-100">{ticker}</span>
                                  {leg?.option_type && (
                                    <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${leg.option_type === 'call' ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300'}`}>{leg.option_type.toUpperCase()}</span>
                                  )}
                                  <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 dark:text-gray-400 rounded">{order.state}</span>
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                  {order.quantity}x ${leg?.strike ?? leg?.strike_price} · {(leg?.expiration ?? leg?.expiration_date) && (leg?.expiration ?? leg?.expiration_date) !== 'N/A' ? formatExpiration((leg?.expiration ?? leg?.expiration_date)!) : 'N/A'} @ {formatCurrency(order.price ?? 0)}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">
                                  {order.order_type} / {order.direction} · {order.opening_strategy && order.opening_strategy !== 'N/A' ? order.opening_strategy : leg?.position_effect} — {fmtTime(order.created_at)}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 7d P&L — pre-computed by backend */}
          {(recentPnl.filled_count > 0 || optionPnl.filled_count > 0) && (
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                  <span className="text-gray-500 font-semibold">7d P&amp;L</span>
                  <span className={`text-lg font-bold ${getGainColor(snapshot.combined_7d_pnl)}`}>{formatCurrency(snapshot.combined_7d_pnl)}</span>
                  <span><span className="text-gray-400">Buy Vol </span><span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(recentPnl.total_buy_volume + optionPnl.total_buy_volume)}</span></span>
                  <span><span className="text-gray-400">Fills </span><span className="font-medium text-gray-900 dark:text-gray-100">{recentPnl.filled_count + optionPnl.filled_count}</span></span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200 dark:divide-zinc-700">
                {recentPnl.filled_count > 0 && (
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">Orders</span>
                      <span className={`font-semibold ${getGainColor(recentPnl.total_realized_pnl)}`}>{formatCurrency(recentPnl.total_realized_pnl)}</span>
                    </div>
                    <div className="text-gray-400 text-xs">{recentPnl.symbols.map(s => `${s.symbol}: ${formatCurrency(s.realized_pnl)}`).join(' · ')}</div>
                  </div>
                )}
                {optionPnl.filled_count > 0 && (
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">Options</span>
                      <span className={`font-semibold ${getGainColor(optionPnl.total_realized_pnl)}`}>{formatCurrency(optionPnl.total_realized_pnl)}</span>
                    </div>
                    <div className="text-gray-400 text-xs">{optionPnl.symbols.map(s => `${s.symbol}: ${formatCurrency(s.realized_pnl)}`).join(' · ')}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Historical stock orders */}
          {recent_orders.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center gap-2">
                <Clock className="w-5 h-5 text-gray-500" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Historical Orders</h3>
                <span className="text-sm text-gray-400 ml-auto">{recent_orders.length}</span>
              </div>
              <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-100 dark:divide-zinc-700">
                {recent_orders.map(order => (
                  <div key={order.order_id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800">
                    <div className="flex items-start gap-3">
                      {order.side === 'BUY' ? <ArrowUpRight className="w-4 h-4 text-gray-700 dark:text-gray-300 mt-0.5" /> : <ArrowDownRight className="w-4 h-4 text-gray-700 dark:text-gray-300 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${order.side === 'BUY' ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300'}`}>{order.side}</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{order.symbol}</span>
                          <span className={`px-2 py-0.5 text-xs rounded ${stateBadge(order.state)}`}>{order.state}</span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {order.filled_quantity ?? order.quantity} @ {formatCurrency(order.average_price ?? order.limit_price)}
                          {order.average_price && order.filled_quantity ? ` = ${formatCurrency(order.average_price * order.filled_quantity)}` : ''}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">{order.order_type} / {order.trigger} — {fmtTime(order.created_at)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Historical option orders */}
          {recent_option_orders.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center gap-2">
                <Clock className="w-5 h-5 text-gray-500" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Historical Option Orders</h3>
                <span className="text-sm text-gray-400 ml-auto">{recent_option_orders.length}</span>
              </div>
              <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-100 dark:divide-zinc-700">
                {recent_option_orders.map(order => {
                  const leg    = order.legs?.[0];
                  const side   = (leg?.side || '').toUpperCase();
                  const isBuy  = side === 'BUY';
                  const ticker = order.chain_symbol || leg?.chain_symbol || '?';
                  return (
                    <div key={order.order_id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800">
                      <div className="flex items-start gap-3">
                        {isBuy ? <ArrowUpRight className="w-4 h-4 text-gray-700 dark:text-gray-300 mt-0.5" /> : <ArrowDownRight className="w-4 h-4 text-gray-700 dark:text-gray-300 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 text-xs font-medium rounded ${isBuy ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300'}`}>{side}</span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">{ticker}</span>
                            {leg?.option_type && (
                              <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${leg.option_type === 'call' ? 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300' : 'bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300'}`}>{leg.option_type.toUpperCase()}</span>
                            )}
                            <span className={`px-2 py-0.5 text-xs rounded ${stateBadge(order.state)}`}>{order.state}</span>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {order.quantity}x ${leg?.strike ?? leg?.strike_price} · {(leg?.expiration ?? leg?.expiration_date) && (leg?.expiration ?? leg?.expiration_date) !== 'N/A' ? formatExpiration((leg?.expiration ?? leg?.expiration_date)!) : 'N/A'} @ {formatCurrency(order.price ?? 0)}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">{order.order_type} / {order.direction} — {fmtTime(order.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {(portfolio?.options || []).length > 0 && (
        <div className="mt-6">
          <OptionsPositions options={portfolio.options} summary={portfolio?.options_summary ?? null} />
        </div>
      )}
    </div>
  );
}

// ─── RealizedPnLSummary ───────────────────────────────────────────────────────

function RealizedPnLSummary({ stock, option, periodLabel, openOrders }: {
  stock: StockPnLResult;
  option: OptionPnLResult;
  periodLabel: string;
  openOrders: SnapshotOrder[];
}) {
  const totalPnl    = stock.total_realized_pnl + option.total_realized_pnl;
  const totalBuyVol = stock.total_buy_volume   + option.total_buy_volume;
  const totalFills  = stock.filled_count        + option.filled_count;
  const totalTrades = stock.symbols.reduce((s, x) => s + x.buy_count + x.sell_count, 0);
  const pnlPct      = totalBuyVol > 0 ? (totalPnl / totalBuyVol) * 100 : 0;
  const openNotional = openOrders.reduce((s, o) => s + o.quantity * o.limit_price, 0);

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {[
          { label: 'Realized P&L', val: totalPnl,              sub: formatPercent(pnlPct), colored: true, icon: totalPnl >= 0 ? <TrendingUp className="w-4 h-4 text-gray-700 dark:text-gray-300" /> : <TrendingDown className="w-4 h-4 text-gray-700 dark:text-gray-300" /> },
          { label: 'Buy Volume',   val: totalBuyVol,           sub: null, colored: false, icon: <ArrowUpRight className="w-4 h-4 text-gray-700 dark:text-gray-300" /> },
          { label: 'Sell Volume',  val: stock.total_sell_volume + option.total_sell_volume, sub: null, colored: false, icon: <ArrowDownRight className="w-4 h-4 text-gray-700 dark:text-gray-300" /> },
          { label: 'Filled Trades',val: totalTrades,           sub: `${totalFills} fills`, colored: false, icon: <Receipt className="w-4 h-4" />, currency: false },
          { label: 'Open Orders',  val: openOrders.length,     sub: `${formatCurrency(openNotional)} notional`, colored: false, icon: <Receipt className="w-4 h-4 text-gray-400" />, currency: false },
        ].map(({ label, val, sub, colored, icon, currency = true }) => (
          <div key={label} className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">{icon}{label}</div>
            <div className={`text-2xl font-bold ${colored ? getGainColor(val as number) : 'text-gray-900 dark:text-gray-100'}`}>
              {currency ? `${formatCurrency(val as number)} ${sub ? `(${sub})` : ''}` : val}
            </div>
            {!currency && sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-2">
        Based on filled orders from the {periodLabel}. Positions held before this window may show incomplete cost basis.
      </p>
    </div>
  );
}

// ─── PnLBySymbolTable ─────────────────────────────────────────────────────────

function PnLBySymbolTable({ stock, option }: { stock: StockPnLResult; option: OptionPnLResult }) {
  if (!stock.symbols.length && !option.symbols.length) return null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-700 flex items-center gap-2">
        <Receipt className="w-5 h-5 text-gray-500" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Realized P&amp;L by Symbol</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-zinc-800">
            <tr>
              {['Symbol','Type','Buys','Sells','Buy Vol','Sell Vol','Realized P&L'].map(h => (
                <th key={h} className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${h === 'Symbol' || h === 'Type' ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-zinc-700">
            {stock.symbols.map((s, i) => (
              <tr key={s.symbol} className={i % 2 === 0 ? 'bg-white dark:bg-zinc-900' : 'bg-gray-50 dark:bg-zinc-800'}>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{s.symbol}</td>
                <td className="px-4 py-3 text-xs text-gray-500">Stock</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{s.buy_count}</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{s.sell_count}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{formatCurrency(s.total_bought)}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{formatCurrency(s.total_sold)}</td>
                <td className="px-4 py-3 text-right">
                  <div className={`font-medium ${getGainColor(s.realized_pnl)}`}>{formatCurrency(s.realized_pnl)}</div>
                </td>
              </tr>
            ))}
            {option.symbols.map((s, i) => (
              <tr key={`opt-${s.symbol}`} className={(stock.symbols.length + i) % 2 === 0 ? 'bg-white dark:bg-zinc-900' : 'bg-gray-50 dark:bg-zinc-800'}>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{s.symbol}</td>
                <td className="px-4 py-3 text-xs text-gray-500">Option</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{s.buy_count}</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-gray-100">{s.sell_count}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{formatCurrency(s.total_bought)}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{formatCurrency(s.total_sold)}</td>
                <td className="px-4 py-3 text-right">
                  <div className={`font-medium ${getGainColor(s.realized_pnl)}`}>{formatCurrency(s.realized_pnl)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TradePage ────────────────────────────────────────────────────────────────

export default function TradePage() {
  const [snapshot,   setSnapshot]   = useState<EnrichedSnapshot | null>(null);
  const [botActions, setBotActions] = useState<BotAction[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pnlPeriod,  setPnlPeriod]  = useState<PnLPeriod>('1Y');

  // Period switch is a key lookup — no recomputation
  const pnl = snapshot?.pnl_by_period[pnlPeriod] ?? null;

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);

    const [snapshotResult, actionsResult] = await Promise.allSettled([
      getEnrichedSnapshot(),
      getBotActions(50),
    ]);

    if (snapshotResult.status === 'fulfilled') setSnapshot(snapshotResult.value);
    if (actionsResult.status  === 'fulfilled') setBotActions(actionsResult.value.actions);

    if (snapshotResult.status === 'rejected') {
      setError(snapshotResult.reason instanceof Error ? snapshotResult.reason.message : 'Failed to fetch snapshot');
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-64 mb-4" />
          <div className="h-4 bg-gray-200 rounded w-96 mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
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
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Trade</h1>
          <p className="text-gray-500 mt-1">Configured agents</p>
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

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-gray-200 rounded-xl text-gray-700 dark:text-gray-300">
          {error}
        </div>
      )}

      {!snapshot && (
        <div className="text-center py-12 mb-6 bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700">
          <Bot className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2">No snapshot available</p>
          <p className="text-gray-500 max-w-md mx-auto">
            <RouterLink to="/configure" className="text-gray-600 dark:text-gray-400 hover:underline font-medium">Configure your agent</RouterLink>{' '}to start publishing snapshots.
          </p>
        </div>
      )}

      {snapshot && (
        <>
          <OrderBookSnapshotView snapshot={snapshot} />

          <PortfolioSummary portfolio={snapshot.portfolio} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <PortfolioAllocation portfolio={snapshot.portfolio} />
            <BotActionsLog actions={botActions} />
          </div>

          <PositionsTable portfolio={snapshot.portfolio} />

          {/* Realized P&L with period selector */}
          <div className="mt-8 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Order P&amp;L</h2>
              <p className="text-gray-500 mt-1">Realized profit &amp; loss from filled orders</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => fetchData(true)} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-zinc-700 rounded-xl hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <div className="flex bg-gray-100 dark:bg-zinc-800 rounded-xl p-1 overflow-x-auto">
                {PNL_PERIODS.map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => setPnlPeriod(value)}
                    className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${pnlPeriod === value ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
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
                openOrders={(snapshot.portfolio?.open_orders || []).length > 0 ? snapshot.portfolio.open_orders : (snapshot.order_book || [])}
              />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <PnLBySymbolTable stock={pnl.stock} option={pnl.option} />
                </div>
                <div>
                  {/* Historical orders shown inline in OrderBookSnapshotView above */}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
