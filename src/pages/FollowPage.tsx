import { useState, useEffect } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Receipt,
  User,
} from 'lucide-react';
import {
  getOrderBookSnapshot,
  sendSlackAlert,
  OrderBookSnapshot,
  formatCurrency,
  formatPercent,
  getGainColor,
} from '../services/robinhoodService';

const USERS = [
  { id: 'jasonzipb', label: 'jasonzipb' },
];

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
          <h2 className="text-xl font-bold text-gray-900">Order Book Snapshot</h2>
          <p className="text-xs text-gray-400">
            Last updated: {new Date(timestamp).toLocaleString()}
          </p>
        </div>
        {btcState && (
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 text-xs font-medium rounded bg-indigo-100 text-indigo-800">
              BTC Signal: {btcState.last_signal.signal}
            </span>
            {hasBtcMetrics && (
              <span className="text-xs text-gray-500">
                ${btcMetrics.current_price.toFixed(2)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <DollarSign className="w-4 h-4" />
            Equity
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {formatCurrency(portfolio.equity)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <BarChart3 className="w-4 h-4" />
            Market Value
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {formatCurrency(portfolio.market_value)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
            <Activity className="w-4 h-4" />
            Buying Power
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {formatCurrency(portfolio.cash.buying_power)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
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

      {/* BTC metrics bar */}
      {hasBtcMetrics && (
        <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4">
          <div className="flex items-center gap-6 text-sm">
            <span className="text-gray-500">BTC Intraday</span>
            {btcMetrics.intraday_low != null && (
              <span>
                <span className="text-gray-400">Low </span>
                <span className="font-medium">${btcMetrics.intraday_low.toFixed(2)}</span>
              </span>
            )}
            {btcMetrics.intraday_high != null && (
              <span>
                <span className="text-gray-400">High </span>
                <span className="font-medium">${btcMetrics.intraday_high.toFixed(2)}</span>
              </span>
            )}
            {btcMetrics.intraday_volatility != null && (
              <span>
                <span className="text-gray-400">Vol </span>
                <span className="font-medium">{btcMetrics.intraday_volatility.toFixed(1)}%</span>
              </span>
            )}
            {btcMetrics['30d_low'] != null && btcMetrics['30d_high'] != null && (
              <span>
                <span className="text-gray-400">30d Range </span>
                <span className="font-medium">${btcMetrics['30d_low'].toFixed(2)} – ${btcMetrics['30d_high'].toFixed(2)}</span>
              </span>
            )}
            {marketDataStale && market_data && (
              <span className="text-gray-400 ml-auto text-xs">
                as of {new Date(market_data.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Positions table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <h3 className="text-lg font-semibold text-gray-900">Positions</h3>
            <span className="text-sm text-gray-400 ml-auto">{portfolio.positions.length} holdings</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Symbol</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Cost</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sortedPositions.map((pos, index) => (
                  <tr key={pos.symbol} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 font-medium text-gray-900">{pos.symbol}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{pos.quantity.toFixed(4)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatCurrency(pos.current_price)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(pos.avg_buy_price)}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(pos.equity)}</td>
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

        {/* Open orders */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-orange-500" />
            <h3 className="text-lg font-semibold text-gray-900">Open Orders</h3>
            <span className="text-sm text-gray-400 ml-auto">{openOrders.length}</span>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {openOrders.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <Receipt className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">No open orders</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {openOrders.map((order) => (
                  <div key={order.order_id} className="px-4 py-3 hover:bg-gray-50">
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
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {order.side}
                          </span>
                          <span className="font-medium text-gray-900">{order.symbol}</span>
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                            {order.state}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          {order.quantity} @ {formatCurrency(order.limit_price)}
                          {order.stop_price ? ` (stop: ${formatCurrency(order.stop_price)})` : ''}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
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

export default function FollowPage() {
  const [snapshot, setSnapshot] = useState<OrderBookSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedUser, setSelectedUser] = useState(USERS[0].id);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await getOrderBookSnapshot();
      setSnapshot(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch data';
      setError(msg);
      if (err instanceof TypeError) {
        sendSlackAlert('TypeError in Follow page snapshot', msg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedUser]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-64 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-96 mb-8"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-xl"></div>
            ))}
          </div>
          <div className="h-96 bg-gray-200 rounded-xl"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Follow</h1>
          <p className="text-gray-500 mt-1">
            Track positions and open orders from followed traders
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* User dropdown */}
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400" />
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              {USERS.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {snapshot ? (
        <OrderBookSnapshotView snapshot={snapshot} />
      ) : (
        !error && (
          <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-200">
            <BarChart3 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium text-gray-600 mb-2">No snapshot available</p>
            <p className="text-gray-500">Order book data will appear here once available.</p>
          </div>
        )
      )}
    </div>
  );
}
