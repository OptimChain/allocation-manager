import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Bot,
  BarChart3,
  Link,
  Unlink,
  Loader2,
  Shield,
  ArrowUpRight,
  ArrowDownRight,
  Receipt,
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
  getPortfolio,
  getBotActions,
  analyzePortfolio,
  getAuthStatus,
  connectRobinhood,
  checkVerification,
  submitMFA,
  disconnectRobinhood,
  getOrderPnL,
  getOrderBookSnapshot,
  sendSlackAlert,
  Portfolio,
  BotAction,
  BotAnalysis,
  AuthStatus,
  OrderPnL,
  SymbolPnL,
  FilledOrder,
  OrderBookSnapshot,
  SnapshotOrder,
  formatCurrency,
  formatPercent,
  getGainColor,
} from '../services/robinhoodService';

const COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#F97316',
];

type PnLPeriod = '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y';

const PNL_PERIODS: { label: string; value: PnLPeriod }[] = [
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
  { label: '5Y', value: '5Y' },
];

function getPeriodCutoff(period: PnLPeriod): Date {
  const now = new Date();
  switch (period) {
    case '1W': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '1M': return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case '3M': return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case '6M': return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case '1Y': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case '5Y': return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  }
}

function getPeriodLabel(period: PnLPeriod): string {
  switch (period) {
    case '1W': return 'last week';
    case '1M': return 'last month';
    case '3M': return 'last 3 months';
    case '6M': return 'last 6 months';
    case '1Y': return 'last year';
    case '5Y': return 'last 5 years';
  }
}

function filterAndRecalcPnL(pnl: OrderPnL, period: PnLPeriod): OrderPnL {
  const cutoff = getPeriodCutoff(period);
  const filtered = pnl.orders.filter(o => new Date(o.createdAt) >= cutoff);

  const symbolMap: Record<string, {
    symbol: string; name: string; realizedPnL: number;
    totalBought: number; totalSold: number; buyCount: number; sellCount: number;
    totalBuyShares: number; totalSellShares: number; sharesHeld: number; costBasis: number;
  }> = {};

  const sorted = [...filtered].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  for (const order of sorted) {
    if (!symbolMap[order.symbol]) {
      symbolMap[order.symbol] = {
        symbol: order.symbol, name: order.name, realizedPnL: 0,
        totalBought: 0, totalSold: 0, buyCount: 0, sellCount: 0,
        totalBuyShares: 0, totalSellShares: 0, sharesHeld: 0, costBasis: 0,
      };
    }
    const s = symbolMap[order.symbol];
    const total = order.quantity * order.price;

    if (order.side === 'buy') {
      s.sharesHeld += order.quantity;
      s.costBasis += total;
      s.totalBought += total;
      s.totalBuyShares += order.quantity;
      s.buyCount++;
    } else {
      const avgCost = s.sharesHeld > 0 ? s.costBasis / s.sharesHeld : 0;
      s.realizedPnL += (order.price - avgCost) * order.quantity;
      s.costBasis -= avgCost * order.quantity;
      s.sharesHeld -= order.quantity;
      s.totalSold += total;
      s.totalSellShares += order.quantity;
      s.sellCount++;
    }
  }

  const symbols: SymbolPnL[] = Object.values(symbolMap)
    .map(s => ({
      symbol: s.symbol,
      name: s.name,
      realizedPnL: Math.round(s.realizedPnL * 100) / 100,
      totalBought: Math.round(s.totalBought * 100) / 100,
      totalSold: Math.round(s.totalSold * 100) / 100,
      buyCount: s.buyCount,
      sellCount: s.sellCount,
      avgBuyPrice: s.totalBuyShares > 0 ? Math.round((s.totalBought / s.totalBuyShares) * 100) / 100 : 0,
      avgSellPrice: s.totalSellShares > 0 ? Math.round((s.totalSold / s.totalSellShares) * 100) / 100 : 0,
      remainingShares: Math.round(s.sharesHeld * 10000) / 10000,
      remainingCostBasis: Math.round(s.costBasis * 100) / 100,
    }))
    .sort((a, b) => Math.abs(b.realizedPnL) - Math.abs(a.realizedPnL));

  return {
    totalRealizedPnL: Math.round(symbols.reduce((sum, s) => sum + s.realizedPnL, 0) * 100) / 100,
    totalBuyVolume: Math.round(symbols.reduce((sum, s) => sum + s.totalBought, 0) * 100) / 100,
    totalSellVolume: Math.round(symbols.reduce((sum, s) => sum + s.totalSold, 0) * 100) / 100,
    symbols,
    orders: filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  };
}

function AuthPanel({
  authStatus,
  onAuthChange,
}: {
  authStatus: AuthStatus | null;
  onAuthChange: () => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [authState, setAuthState] = useState<'idle' | 'device' | 'mfa'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await connectRobinhood();

      if (result.authenticated) {
        setMessage(result.message);
        setAuthState('idle');
        onAuthChange();
      } else if (result.requiresVerification) {
        setAuthState('device');
        setMessage(result.message || 'Approve in Robinhood app');
      } else if (result.requiresMFA) {
        setAuthState('mfa');
        setMessage(result.message || 'Enter MFA code');
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);

    try {
      const result = await checkVerification();

      if (result.authenticated) {
        setMessage(result.message || 'Connected!');
        setAuthState('idle');
        onAuthChange();
      } else if (result.status === 'pending') {
        setMessage(`Waiting for approval... (${result.elapsedSeconds}s)`);
      } else {
        setError(result.message || 'Verification failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleMFA = async () => {
    if (!mfaCode.trim()) return;

    setConnecting(true);
    setError(null);

    try {
      const result = await submitMFA(mfaCode.trim());

      if (result.authenticated) {
        setMessage(result.message || 'Connected!');
        setAuthState('idle');
        setMfaCode('');
        onAuthChange();
      } else {
        setError(result.error || 'MFA failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setConnecting(true);
    try {
      await disconnectRobinhood();
      setAuthState('idle');
      setMessage(null);
      onAuthChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setConnecting(false);
    }
  };

  const isConnected = authStatus?.authenticated;

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isConnected ? 'bg-green-100 dark:bg-green-950' : 'bg-gray-100 dark:bg-zinc-900'}`}>
            <Shield className={`w-5 h-5 ${isConnected ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}`} />
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white">Robinhood Connection</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isConnected
                ? `Connected • Expires in ${Math.floor((authStatus?.expiresIn || 0) / 3600)}h`
                : 'Not connected'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {authState === 'idle' && (
            <>
              {isConnected ? (
                <button
                  onClick={handleDisconnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2 text-red-600 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
                >
                  <Unlink className="w-4 h-4" />
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 text-sm"
                >
                  {connecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Link className="w-4 h-4" />
                  )}
                  Connect
                </button>
              )}
            </>
          )}

          {authState === 'device' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-yellow-600">Approve in Robinhood app</span>
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 dark:bg-gray-600 text-white rounded hover:bg-gray-600 dark:hover:bg-gray-500 disabled:opacity-50 text-sm"
              >
                {verifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Check
              </button>
              <button
                onClick={() => setAuthState('idle')}
                className="px-3 py-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          )}

          {authState === 'mfa' && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="MFA Code"
                className="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-center bg-white dark:bg-zinc-900 text-gray-900 dark:text-white"
                maxLength={6}
              />
              <button
                onClick={handleMFA}
                disabled={connecting || !mfaCode.trim()}
                className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-zinc-900 disabled:opacity-50 text-sm"
              >
                {connecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Submit
              </button>
              <button
                onClick={() => {
                  setAuthState('idle');
                  setMfaCode('');
                }}
                className="px-3 py-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div className="mt-3 p-2 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded text-sm text-green-700 dark:text-green-400">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-3 p-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

function PortfolioSummary({ portfolio }: { portfolio: Portfolio }) {
  const dayGainPercent = portfolio.portfolioValue > 0
    ? (portfolio.totalGain / (portfolio.portfolioValue - portfolio.totalGain)) * 100
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
          <DollarSign className="w-4 h-4" />
          Portfolio Value
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatCurrency(portfolio.portfolioValue)}
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
          {portfolio.totalGain >= 0 ? (
            <TrendingUp className="w-4 h-4 text-green-500" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-500" />
          )}
          Day's Change
        </div>
        <div className={`text-2xl font-bold ${getGainColor(portfolio.totalGain)}`}>
          {formatCurrency(portfolio.totalGain)} ({formatPercent(dayGainPercent)})
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
          <Activity className="w-4 h-4" />
          Buying Power
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatCurrency(portfolio.buyingPower)}
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
          <BarChart3 className="w-4 h-4" />
          Positions
        </div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white">
          {portfolio.positions.length}
        </div>
      </div>
    </div>
  );
}

function PortfolioAllocation({ portfolio }: { portfolio: Portfolio }) {
  const pieData = portfolio.positions.map((pos, index) => ({
    name: pos.symbol,
    value: pos.currentValue,
    color: COLORS[index % COLORS.length],
  }));

  if (portfolio.buyingPower > 0) {
    pieData.push({
      name: 'Cash',
      value: portfolio.buyingPower,
      color: '#9CA3AF',
    });
  }

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0];
    const total = pieData.reduce((sum, item) => sum + item.value, 0);
    const percent = ((data.value / total) * 100).toFixed(1);
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg shadow-lg p-3">
        <p className="font-medium text-gray-900 dark:text-white">{data.name}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">{formatCurrency(data.value)}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{percent}%</p>
      </div>
    );
  };

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Portfolio Allocation</h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {pieData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function PositionsTable({ portfolio }: { portfolio: Portfolio }) {
  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Holdings</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Symbol</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Shares</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Price</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Cost</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Value</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total Gain</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-zinc-800">
            {portfolio.positions.map((position, index) => (
              <tr key={position.symbol} className={index % 2 === 0 ? 'bg-white dark:bg-zinc-950' : 'bg-gray-50 dark:bg-zinc-900'}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 dark:text-white">{position.symbol}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[150px]">{position.name}</div>
                </td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{position.quantity.toFixed(4)}</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrency(position.currentPrice)}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{formatCurrency(position.averageCost)}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(position.currentValue)}</td>
                <td className="px-4 py-3 text-right">
                  <div className={`font-medium ${getGainColor(position.gain)}`}>
                    {formatCurrency(position.gain)}
                  </div>
                  <div className={`text-sm ${getGainColor(position.gainPercent)}`}>
                    {formatPercent(position.gainPercent)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BotActionsLog({ actions }: { actions: BotAction[] }) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'submitted':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'simulated':
        return <Bot className="w-4 h-4 text-gray-500 dark:text-gray-400" />;
      default:
        return <Activity className="w-4 h-4 text-gray-500 dark:text-gray-400" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'BUY_ORDER':
        return 'bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-400';
      case 'SELL_ORDER':
        return 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-400';
      case 'ANALYSIS':
        return 'bg-gray-100 dark:bg-zinc-900 text-gray-800 dark:text-gray-300';
      case 'ERROR':
        return 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-400';
      default:
        return 'bg-gray-100 dark:bg-zinc-900 text-gray-800 dark:text-gray-300';
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800 flex items-center gap-2">
        <Bot className="w-5 h-5 text-gray-500 dark:text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bot Activity</h3>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {actions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <Bot className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p>No bot actions yet</p>
            <p className="text-sm">Run an analysis to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-zinc-900">
            {actions.map((action) => (
              <div key={action.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-900">
                <div className="flex items-start gap-3">
                  {getStatusIcon(action.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${getTypeColor(action.type)}`}>
                        {action.type.replace('_', ' ')}
                      </span>
                      {action.symbol && (
                        <span className="font-medium text-gray-900 dark:text-white">{action.symbol}</span>
                      )}
                      {action.dryRun && (
                        <span className="px-2 py-0.5 text-xs bg-yellow-100 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-400 rounded">
                          DRY RUN
                        </span>
                      )}
                    </div>
                    {action.quantity && action.price && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {action.quantity} shares @ {formatCurrency(action.price)} = {formatCurrency(action.total || 0)}
                      </p>
                    )}
                    {action.message && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{action.message}</p>
                    )}
                    {action.details && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{action.details}</p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {new Date(action.timestamp).toLocaleString()}
                    </p>
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

function AnalysisSuggestions({ analysis }: { analysis: BotAnalysis | null }) {
  if (!analysis) return null;

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-yellow-500" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bot Suggestions</h3>
      </div>
      {analysis.suggestions.length === 0 ? (
        <div className="p-6 text-center text-gray-500 dark:text-gray-400">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-300 dark:text-green-700" />
          <p>No action needed</p>
          <p className="text-sm">Your portfolio looks balanced</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-zinc-900">
          {analysis.suggestions.map((suggestion, index) => (
            <div key={index} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                  suggestion.type === 'TAKE_PROFIT' ? 'bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-400' :
                  suggestion.type === 'STOP_LOSS' ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-400' :
                  'bg-gray-100 dark:bg-zinc-900 text-gray-800 dark:text-gray-300'
                }`}>
                  {suggestion.type.replace('_', ' ')}
                </span>
                <span className="font-medium text-gray-900 dark:text-white">{suggestion.symbol}</span>
                <span className={`ml-auto px-2 py-0.5 text-xs rounded ${
                  suggestion.priority === 'high' ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-400' :
                  suggestion.priority === 'medium' ? 'bg-yellow-100 dark:bg-yellow-950 text-yellow-800 dark:text-yellow-400' :
                  'bg-gray-100 dark:bg-zinc-900 text-gray-800 dark:text-gray-300'
                }`}>
                  {suggestion.priority}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{suggestion.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderBookSnapshotView({ snapshot }: { snapshot: OrderBookSnapshot }) {
  const { portfolio, order_book, market_data, timestamp } = snapshot;
  const openOrders = portfolio.open_orders.length > 0 ? portfolio.open_orders : order_book;
  const totalPnL = portfolio.positions.reduce((sum, p) => sum + p.profit_loss, 0);
  const totalCost = portfolio.positions.reduce((sum, p) => sum + p.avg_buy_price * p.quantity, 0);
  const pnlPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const sortedPositions = [...portfolio.positions].sort(
    (a, b) => Math.abs(b.profit_loss) - Math.abs(a.profit_loss)
  );

  const btcState = market_data?.symbols['BTC'];
  const btcMetrics = btcState?.metrics;
  const hasBtcMetrics = btcMetrics && btcMetrics.current_price != null;
  const marketDataStale = market_data && market_data.timestamp !== timestamp;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Order Book Snapshot</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Last updated: {new Date(timestamp).toLocaleString()}
          </p>
        </div>
        {btcState && (
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 text-xs font-medium rounded bg-gray-100 dark:bg-zinc-900 text-gray-800 dark:text-gray-300">
              BTC Signal: {btcState.last_signal.signal}
            </span>
            {hasBtcMetrics && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ${btcMetrics.current_price.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <DollarSign className="w-4 h-4" />
            Equity
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(portfolio.equity)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <BarChart3 className="w-4 h-4" />
            Market Value
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(portfolio.market_value)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <Activity className="w-4 h-4" />
            Buying Power
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(portfolio.cash.buying_power)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            {totalPnL >= 0 ? (
              <TrendingUp className="w-4 h-4 text-green-500" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500" />
            )}
            Total P&L
          </div>
          <div className={`text-2xl font-bold ${getGainColor(totalPnL)}`}>
            {formatCurrency(totalPnL)} ({formatPercent(pnlPercent)})
          </div>
        </div>
      </div>

      {hasBtcMetrics && (
        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-3 mb-4">
          <div className="flex items-center gap-6 text-sm">
            <span className="text-gray-500 dark:text-gray-400">BTC Intraday</span>
            {btcMetrics.intraday_low != null && (
              <span>
                <span className="text-gray-400 dark:text-gray-500">Low </span>
                <span className="font-medium text-gray-900 dark:text-white">${btcMetrics.intraday_low.toFixed(2)}</span>
              </span>
            )}
            {btcMetrics.intraday_high != null && (
              <span>
                <span className="text-gray-400 dark:text-gray-500">High </span>
                <span className="font-medium text-gray-900 dark:text-white">${btcMetrics.intraday_high.toFixed(2)}</span>
              </span>
            )}
            {btcMetrics.intraday_volatility != null && (
              <span>
                <span className="text-gray-400 dark:text-gray-500">Vol </span>
                <span className="font-medium text-gray-900 dark:text-white">{btcMetrics.intraday_volatility.toFixed(1)}%</span>
              </span>
            )}
            {btcMetrics['30d_low'] != null && btcMetrics['30d_high'] != null && (
              <span>
                <span className="text-gray-400 dark:text-gray-500">30d Range </span>
                <span className="font-medium text-gray-900 dark:text-white">${btcMetrics['30d_low'].toFixed(2)} – ${btcMetrics['30d_high'].toFixed(2)}</span>
              </span>
            )}
            {marketDataStale && market_data && (
              <span className="text-gray-400 dark:text-gray-500 ml-auto text-xs">
                as of {new Date(market_data.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Positions</h3>
            <span className="text-sm text-gray-400 dark:text-gray-500 ml-auto">{portfolio.positions.length} holdings</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Symbol</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Price</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Cost</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Value</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-zinc-800">
                {sortedPositions.map((pos, index) => (
                  <tr key={pos.symbol} className={index % 2 === 0 ? 'bg-white dark:bg-zinc-950' : 'bg-gray-50 dark:bg-zinc-900'}>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{pos.symbol}</td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{pos.quantity.toFixed(4)}</td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrency(pos.current_price)}</td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{formatCurrency(pos.avg_buy_price)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(pos.equity)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className={`font-medium ${getGainColor(pos.profit_loss)}`}>
                        {formatCurrency(pos.profit_loss)}
                      </div>
                      <div className={`text-sm ${getGainColor(pos.profit_loss_pct)}`}>
                        {formatPercent(pos.profit_loss_pct)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Open Orders</h3>
            <span className="text-sm text-gray-400 dark:text-gray-500 ml-auto">{openOrders.length}</span>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {openOrders.length === 0 ? (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                <Receipt className="w-10 h-10 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p className="text-sm">No open orders</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-zinc-900">
                {openOrders.map((order) => (
                  <div key={order.order_id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-900">
                    <div className="flex items-start gap-3">
                      {order.side === 'BUY' ? (
                        <ArrowUpRight className="w-4 h-4 text-green-500 mt-0.5" />
                      ) : (
                        <ArrowDownRight className="w-4 h-4 text-red-500 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                            order.side === 'BUY'
                              ? 'bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-400'
                              : 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-400'
                          }`}>
                            {order.side}
                          </span>
                          <span className="font-medium text-gray-900 dark:text-white">{order.symbol}</span>
                          <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-zinc-900 text-gray-600 dark:text-gray-400 rounded">
                            {order.state}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {order.quantity} @ {formatCurrency(order.limit_price)}
                          {order.stop_price ? ` (stop: ${formatCurrency(order.stop_price)})` : ''}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {order.order_type} / {order.trigger} — {new Date(order.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RealizedPnLSummary({ pnl, periodLabel, openOrders }: { pnl: OrderPnL; periodLabel: string; openOrders: SnapshotOrder[] }) {
  const totalTrades = pnl.symbols.reduce((sum, s) => sum + s.buyCount + s.sellCount, 0);
  const pnlPercent = pnl.totalBuyVolume > 0
    ? (pnl.totalRealizedPnL / pnl.totalBuyVolume) * 100
    : 0;

  return (
    <div className="mb-6">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            {pnl.totalRealizedPnL >= 0 ? (
              <TrendingUp className="w-4 h-4 text-green-500" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500" />
            )}
            Realized P&L
          </div>
          <div className={`text-2xl font-bold ${getGainColor(pnl.totalRealizedPnL)}`}>
            {formatCurrency(pnl.totalRealizedPnL)} ({formatPercent(pnlPercent)})
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <ArrowUpRight className="w-4 h-4 text-green-500" />
            Buy Volume
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(pnl.totalBuyVolume)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <ArrowDownRight className="w-4 h-4 text-red-500" />
            Sell Volume
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(pnl.totalSellVolume)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <Receipt className="w-4 h-4" />
            Filled Trades
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {totalTrades}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <Receipt className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            Open Orders
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {openOrders.length}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {formatCurrency(openOrders.reduce((sum, o) => sum + o.quantity * o.limit_price, 0))} notional
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Based on filled orders from the {periodLabel}. Positions held before this window may show incomplete cost basis.</p>
    </div>
  );
}

function PnLBySymbolTable({ symbols }: { symbols: SymbolPnL[] }) {
  if (symbols.length === 0) return null;

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800 flex items-center gap-2">
        <Receipt className="w-5 h-5 text-gray-500 dark:text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Realized P&L by Symbol</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Symbol</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Buys</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sells</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Buy</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Sell</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Realized P&L</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-zinc-800">
            {symbols.map((sym, index) => {
              const pnlPercent = sym.totalBought > 0
                ? (sym.realizedPnL / sym.totalBought) * 100
                : 0;
              return (
                <tr key={sym.symbol} className={index % 2 === 0 ? 'bg-white dark:bg-zinc-950' : 'bg-gray-50 dark:bg-zinc-900'}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">{sym.symbol}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[150px]">{sym.name}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-gray-900 dark:text-white">{sym.buyCount}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{formatCurrency(sym.totalBought)}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-gray-900 dark:text-white">{sym.sellCount}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{formatCurrency(sym.totalSold)}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrency(sym.avgBuyPrice)}</td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                    {sym.sellCount > 0 ? formatCurrency(sym.avgSellPrice) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className={`font-medium ${getGainColor(sym.realizedPnL)}`}>
                      {formatCurrency(sym.realizedPnL)}
                    </div>
                    {sym.sellCount > 0 && (
                      <div className={`text-sm ${getGainColor(pnlPercent)}`}>
                        {formatPercent(pnlPercent)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                    {sym.remainingShares > 0
                      ? `${sym.remainingShares.toFixed(4)} shares`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderHistoryList({ orders }: { orders: FilledOrder[] }) {
  if (orders.length === 0) return null;

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800 flex items-center gap-2">
        <Activity className="w-5 h-5 text-gray-500 dark:text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Filled Orders</h3>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        <div className="divide-y divide-gray-100 dark:divide-zinc-900">
          {orders.map((order) => (
            <div key={order.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-900">
              <div className="flex items-start gap-3">
                {order.side === 'buy' ? (
                  <ArrowUpRight className="w-4 h-4 text-green-500 mt-0.5" />
                ) : (
                  <ArrowDownRight className="w-4 h-4 text-red-500 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                      order.side === 'buy'
                        ? 'bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-400'
                        : 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-400'
                    }`}>
                      {order.side.toUpperCase()}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">{order.symbol}</span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {order.quantity.toFixed(4)} shares @ {formatCurrency(order.price)} = {formatCurrency(order.total)}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TradePage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [orderPnL, setOrderPnL] = useState<OrderPnL | null>(null);
  const [snapshot, setSnapshot] = useState<OrderBookSnapshot | null>(null);
  const [botActions, setBotActions] = useState<BotAction[]>([]);
  const [analysis, setAnalysis] = useState<BotAnalysis | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [pnlPeriod, setPnlPeriod] = useState<PnLPeriod>('1Y');

  const filteredPnL = useMemo(() => {
    if (!orderPnL) return null;
    return filterAndRecalcPnL(orderPnL, pnlPeriod);
  }, [orderPnL, pnlPeriod]);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      setAuthStatus(status);
      return status.authenticated;
    } catch (err) {
      console.error('Failed to fetch auth status:', err);
      return false;
    }
  }, []);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      getOrderBookSnapshot()
        .then(setSnapshot)
        .catch((err) => {
          console.error('Failed to fetch order book snapshot:', err);
          if (err instanceof TypeError) {
            sendSlackAlert('TypeError in order book snapshot', err.message);
          }
        });

      const isAuthenticated = await fetchAuthStatus();

      if (!isAuthenticated) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const [portfolioData, actionsData, pnlData] = await Promise.all([
        getPortfolio(),
        getBotActions(50),
        getOrderPnL(),
      ]);
      setPortfolio(portfolioData);
      setBotActions(actionsData.actions);
      setOrderPnL(pnlData);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch data';
      if (!errorMsg.includes('Not authenticated') && !errorMsg.includes('expired')) {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const analysisData = await analyzePortfolio();
      setAnalysis(analysisData);
      const actionsData = await getBotActions(50);
      setBotActions(actionsData.actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 dark:bg-zinc-800 rounded w-64 mb-4"></div>
          <div className="h-4 bg-gray-200 dark:bg-zinc-800 rounded w-96 mb-8"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-200 dark:bg-zinc-800 rounded-xl"></div>
            ))}
          </div>
          <div className="h-96 bg-gray-200 dark:bg-zinc-800 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (!authStatus?.authenticated && !loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Trade</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Connect to Robinhood to view your portfolio
            </p>
          </div>
        </div>

        <AuthPanel authStatus={authStatus} onAuthChange={fetchData} />

        {snapshot && <OrderBookSnapshotView snapshot={snapshot} />}

        <div className="text-center py-12 bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
          <Shield className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <p className="text-lg font-medium text-gray-600 dark:text-gray-400 mb-2">Connect to Robinhood</p>
          <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Click the Connect button above to link your Robinhood account.
            You'll need to approve the connection in the Robinhood app.
          </p>
        </div>
      </div>
    );
  }

  if (error && !portfolio) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AuthPanel authStatus={authStatus} onAuthChange={fetchData} />
        <div className="text-center py-12">
          <XCircle className="w-16 h-16 mx-auto mb-4 text-red-300" />
          <p className="text-lg font-medium text-red-600 mb-2">{error}</p>
          <button
            onClick={() => fetchData()}
            className="px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-200 text-sm"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Trade</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Robinhood portfolio and trading bot activity
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runAnalysis}
            disabled={analyzing}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50 text-sm"
          >
            <Bot className={`w-4 h-4 ${analyzing ? 'animate-pulse' : ''}`} />
            {analyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-zinc-900 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <AuthPanel authStatus={authStatus} onAuthChange={fetchData} />

      {snapshot && <OrderBookSnapshotView snapshot={snapshot} />}

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {portfolio && (
        <>
          <PortfolioSummary portfolio={portfolio} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <PortfolioAllocation portfolio={portfolio} />
            <AnalysisSuggestions analysis={analysis} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <PositionsTable portfolio={portfolio} />
            </div>
            <div>
              <BotActionsLog actions={botActions} />
            </div>
          </div>

          {filteredPnL && (
            <>
              <div className="mt-8 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Order P&L</h2>
                  <p className="text-gray-500 dark:text-gray-400 mt-1">Realized profit & loss from filled orders</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchData(true)}
                    disabled={refreshing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-zinc-800 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-900 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                  <div className="flex bg-gray-100 dark:bg-zinc-900 rounded-lg p-1 overflow-x-auto">
                    {PNL_PERIODS.map(({ label, value }) => (
                      <button
                        key={value}
                        onClick={() => setPnlPeriod(value)}
                        className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                          pnlPeriod === value
                            ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <RealizedPnLSummary
                pnl={filteredPnL}
                periodLabel={getPeriodLabel(pnlPeriod)}
                openOrders={snapshot ? (snapshot.portfolio.open_orders.length > 0 ? snapshot.portfolio.open_orders : snapshot.order_book) : []}
              />

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <PnLBySymbolTable symbols={filteredPnL.symbols} />
                </div>
                <div>
                  <OrderHistoryList orders={filteredPnL.orders} />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
