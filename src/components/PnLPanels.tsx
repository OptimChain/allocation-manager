// Allocation pie + realized P&L panels, rendered by PnLAllocationPage.

import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Receipt } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import {
  EnrichedPortfolio,
  StockPnLResult,
  OptionPnLResult,
  SnapshotOrder,
  formatCurrency,
  formatPercent,
  getGainColor,
} from '../services/robinhoodService';

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
];

// ─── PortfolioAllocation ──────────────────────────────────────────────────────

export function PortfolioAllocation({ portfolio }: { portfolio: EnrichedPortfolio }) {
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

// ─── RealizedPnLSummary ───────────────────────────────────────────────────────

export function RealizedPnLSummary({ stock, option, periodLabel, openOrders }: {
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

export function PnLBySymbolTable({ stock, option }: { stock: StockPnLResult; option: OptionPnLResult }) {
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
