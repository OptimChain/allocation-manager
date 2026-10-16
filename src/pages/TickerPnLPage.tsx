// Per-ticker P&L, Sharpe and risk — /ticker/:symbol (defaults to NBIS).
//
// Orders come from the trading DB (every bucket for the ticker), falling back
// to the blob snapshot's recent orders while the DB is empty or unreachable.
// The broker position, option positions and account equity come from the
// enriched snapshot; daily closes from Twelve Data. All math lives in
// utils/tickerPnl.ts.

import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import {
  getEnrichedSnapshot,
  getDbOrdersForSymbol,
  formatCurrency,
  type EnrichedSnapshot,
  type DbOrders,
  type SnapshotOrder,
  type SnapshotOptionOrder,
} from '../services/robinhoodService';
import { getTimeSeries, type NormalizedPriceData } from '../services/twelveDataService';
import {
  buildStockLedger,
  buildOptionLedger,
  buildDailyPnl,
  computeRiskStats,
  realizedVol,
  summarizeExposure,
  analyzeOpenOrders,
  inferOpeningShares,
  findPosition,
  optionPositionsFor,
  optionPositionKey,
  isOpenState,
  etDate,
  MIN_RELIABLE_DAYS,
  VOL_WINDOW,
  type PriceBar,
} from '../utils/tickerPnl';
import {
  Card,
  StatTile,
  CumulativePnlChart,
  PriceFillsChart,
  StockFillsTable,
  OptionFillsTable,
  QueuedOrdersTables,
  OptionPositionsTable,
  DailyPnlTable,
} from '../components/TickerPnLPanels';
import { formatSignedUsd as fmtSigned, formatSignedFraction as fmtPct } from '../utils/formatters';
import { utcMs } from '../utils/time';

const DEFAULT_SYMBOL = 'NBIS';
const PINNED = ['NBIS'];
// Placement stubs (no lifecycle state) older than this are stale, not queued
const STUB_MAX_AGE_MS = 3 * 86_400_000;

type DbResult = DbOrders & { truncated: boolean };

/** Share counts can be fractional; trim float noise for display. */
function shares(q: number): string {
  return String(+q.toFixed(4));
}

function dedupe<T extends { order_id: string }>(orders: T[]): T[] {
  const seen = new Set<string>();
  return orders.filter(o => {
    if (!o.order_id || seen.has(o.order_id)) return !o.order_id;
    seen.add(o.order_id);
    return true;
  });
}

interface OrderSet {
  source: 'db' | 'snapshot' | 'none';
  stock: SnapshotOrder[];
  options: SnapshotOptionOrder[];
  openStock: SnapshotOrder[];
  openOptions: SnapshotOptionOrder[];
  untrackedStock: SnapshotOrder[];
  untrackedOptions: SnapshotOptionOrder[];
}

function pickOrders(symbol: string, db: DbResult | null, snapshot: EnrichedSnapshot | null): OrderSet {
  const dbCount = db
    ? db.open_orders.length + db.historical_orders.length + db.open_option_orders.length + db.historical_option_orders.length
    : 0;
  if (db && dbCount > 0) {
    return {
      source: 'db',
      stock: dedupe([...db.historical_orders, ...db.open_orders]),
      options: dedupe([...db.historical_option_orders, ...db.open_option_orders]),
      openStock: db.open_orders,
      openOptions: db.open_option_orders,
      untrackedStock: db.untracked_orders ?? [],
      untrackedOptions: db.untracked_option_orders ?? [],
    };
  }
  if (snapshot) {
    const sym = symbol.toUpperCase();
    const ofSym = (o: SnapshotOrder) => (o.symbol || '').toUpperCase() === sym;
    const optOfSym = (o: SnapshotOptionOrder) => (o.chain_symbol || o.legs?.[0]?.chain_symbol || '').toUpperCase() === sym;
    const working = dedupe([...snapshot.portfolio.open_orders, ...snapshot.order_book]).filter(ofSym);
    const workingOpts = dedupe([...snapshot.portfolio.open_option_orders, ...snapshot.recent_option_orders]).filter(optOfSym);
    return {
      source: 'snapshot',
      stock: dedupe([...snapshot.recent_orders, ...working]).filter(ofSym),
      options: dedupe([...snapshot.recent_option_orders, ...snapshot.portfolio.open_option_orders]).filter(optOfSym),
      openStock: working.filter(o => isOpenState(o.state)),
      openOptions: workingOpts.filter(o => isOpenState(o.state)),
      untrackedStock: working.filter(o => o.state == null),
      untrackedOptions: workingOpts.filter(o => o.state == null),
    };
  }
  return { source: 'none', stock: [], options: [], openStock: [], openOptions: [], untrackedStock: [], untrackedOptions: [] };
}

export default function TickerPnLPage() {
  const params = useParams<{ symbol?: string }>();
  const navigate = useNavigate();
  const symbol = (params.symbol || DEFAULT_SYMBOL).toUpperCase();

  const [snapshot, setSnapshot] = useState<EnrichedSnapshot | null>(null);
  const [db, setDb] = useState<DbResult | null>(null);
  const [series, setSeries] = useState<NormalizedPriceData[]>([]);
  const [errors, setErrors] = useState<{ snapshot?: string; db?: string; prices?: string }>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [tickerInput, setTickerInput] = useState('');
  // Only the latest request may write state — switching tickers mid-load must
  // not render the previous ticker's prices under the new one
  const requestRef = useRef(0);

  const fetchData = useCallback(async (sym: string, isRefresh = false) => {
    const request = ++requestRef.current;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const [snap, orders, prices] = await Promise.allSettled([
      getEnrichedSnapshot(),
      getDbOrdersForSymbol(sym),
      getTimeSeries(sym, '1Y', isRefresh),
    ]);
    if (request !== requestRef.current) return;
    const msg = (r: PromiseSettledResult<unknown>) =>
      r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : undefined;
    setSnapshot(snap.status === 'fulfilled' ? snap.value : null);
    setDb(orders.status === 'fulfilled' ? orders.value : null);
    setSeries(prices.status === 'fulfilled' ? prices.value : []);
    setErrors({ snapshot: msg(snap), db: msg(orders), prices: msg(prices) });
    setAsOf(Date.now());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchData(symbol); }, [fetchData, symbol]);

  const model = useMemo(() => {
    const today = etDate(Date.now());
    const orders = pickOrders(symbol, db, snapshot);
    const bars: PriceBar[] = series
      .map(b => ({ date: b.date.slice(0, 10), close: b.price }))
      .filter(b => Number.isFinite(b.close) && b.close > 0);

    const position = findPosition(snapshot?.portfolio.positions, symbol);
    const brokerQty = snapshot ? (position?.quantity ?? 0) : null;
    const marketPrice = snapshot?.market_data?.symbols?.[symbol]?.metrics?.current_price;
    const lastClose = bars.length ? bars[bars.length - 1].close : null;
    const livePrice = position?.current_price || marketPrice || lastClose || null;
    const priceSource = position?.current_price ? 'Robinhood' : marketPrice ? 'market data' : lastClose ? 'last close' : null;

    // Shares held before the first tracked order, marked at the prior close
    const base = buildStockLedger(orders.stock, symbol);
    const opening = inferOpeningShares(orders.stock, symbol, brokerQty);
    let ledger = base;
    if (opening > 0) {
      const firstDate = base.fills[0]?.date ?? today;
      const prior = [...bars].reverse().find(b => b.date < firstDate);
      ledger = buildStockLedger(orders.stock, symbol, { shares: opening, mark: prior?.close ?? null });
    }

    const optionPositions = optionPositionsFor(snapshot?.portfolio.options, symbol);
    const optionLedger = buildOptionLedger(orders.options, symbol, {
      openContractKeys: new Set(optionPositions.map(optionPositionKey)),
      today,
    });

    const points = buildDailyPnl(ledger, bars, { livePrice, today });
    const risk = computeRiskStats(points);
    const vol = realizedVol(bars);
    const exposure = summarizeExposure({
      shares: brokerQty ?? ledger.shares_held,
      price: livePrice,
      options: optionPositions,
      equity: snapshot?.portfolio.equity ?? null,
      annVol: vol,
    });
    const now = Date.now();
    const fresh = (o: { created_at: string | null; updated_at: string | null }) =>
      now - utcMs(o.created_at ?? o.updated_at) < STUB_MAX_AGE_MS;
    const untrackedStock = orders.untrackedStock.filter(fresh);
    const untrackedOptions = orders.untrackedOptions.filter(fresh);
    const staleStubs = orders.untrackedStock.length + orders.untrackedOptions.length - untrackedStock.length - untrackedOptions.length;
    const queue = analyzeOpenOrders({
      stockOrders: orders.openStock,
      optionOrders: orders.openOptions,
      untrackedStock,
      untrackedOptions,
      symbol,
      shares: ledger.shares_held,
      avgCost: ledger.avg_cost,
      livePrice,
      today,
    });

    const trackedShares = ledger.shares_held - ledger.unknown_basis_shares;
    const unrealized = livePrice != null && trackedShares > 0 ? trackedShares * (livePrice - ledger.avg_cost) : 0;
    const stockPnl = ledger.realized_pnl + unrealized;
    const optionPnl = optionLedger.realized_pnl + exposure.option_unrealized;
    const closedTrades = ledger.wins + ledger.losses;

    const warnings: string[] = [];
    if (orders.source === 'snapshot') warnings.push('The trading DB has no orders for this ticker, so this view uses the last blob snapshot, which only covers recent orders.');
    if (orders.source === 'none') warnings.push('No order data could be loaded.');
    if (db?.truncated) warnings.push('Order history hit the 10-page fetch cap, so the oldest orders are missing.');
    if (brokerQty != null && ledger.shares_held - brokerQty > 1e-6) {
      warnings.push(`The fill history leaves ${shares(ledger.shares_held)} shares but Robinhood reports ${shares(brokerQty)}. Recent fills may not have synced to the DB yet.`);
    }
    if (ledger.opening_shares > 0) {
      warnings.push(ledger.opening_mark != null
        ? `${shares(ledger.opening_shares)} shares were held before the first tracked order. They're valued at the prior close (${formatCurrency(ledger.opening_mark)}), so their P&L counts from then.`
        : `${shares(ledger.opening_shares)} shares were held before the first tracked order and have no known cost basis; sales of them are left out of realized P&L.`);
    }
    if (ledger.unmatched_quantity > 0 && ledger.opening_mark == null) {
      warnings.push(`${shares(ledger.unmatched_quantity)} shares sold had no tracked cost basis and are left out of realized P&L (marked *).`);
    }
    if (ledger.skipped_fills > 0) warnings.push(`${ledger.skipped_fills} filled orders had no fill price and were skipped.`);
    if (errors.prices) warnings.push(`Price history is unavailable (${errors.prices}), so the daily P&L, Sharpe and VaR can't be computed.`);

    return {
      today, orders, bars, position, brokerQty, livePrice, priceSource, ledger, optionLedger,
      optionPositions, points, risk, vol, exposure, queue, staleStubs, unrealized, stockPnl, optionPnl,
      totalPnl: stockPnl + optionPnl, closedTrades, warnings,
    };
  }, [symbol, db, snapshot, series, errors.prices]);

  // Tickers worth one click: pinned, held, or with working orders
  const tickerChips = useMemo(() => {
    const set = new Set<string>(PINNED);
    for (const p of snapshot?.portfolio.positions ?? []) {
      if (!p.shadow && p.asset_type !== 'crypto' && p.symbol) set.add(p.symbol.toUpperCase());
    }
    for (const o of snapshot?.portfolio.open_orders ?? []) if (o.symbol) set.add(o.symbol.toUpperCase());
    for (const o of snapshot?.portfolio.options ?? []) if (o.chain_symbol) set.add(o.chain_symbol.toUpperCase());
    for (const o of snapshot?.portfolio.open_option_orders ?? []) if (o.chain_symbol) set.add(o.chain_symbol.toUpperCase());
    set.add(symbol);
    return [...set].sort((a, b) => (PINNED.includes(b) ? 1 : 0) - (PINNED.includes(a) ? 1 : 0) || a.localeCompare(b));
  }, [snapshot, symbol]);

  const goTo = (e: FormEvent) => {
    e.preventDefault();
    const next = tickerInput.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
    if (next) navigate(`/ticker/${next}`);
    setTickerInput('');
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 dark:bg-zinc-800 rounded w-64 mb-4" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-24 bg-gray-200 dark:bg-zinc-800 rounded-xl" />)}
          </div>
          <div className="h-72 bg-gray-200 dark:bg-zinc-800 rounded-xl" />
        </div>
      </div>
    );
  }

  const { ledger, optionLedger, risk, exposure, queue, livePrice } = model;
  const winRate = model.closedTrades > 0 ? ledger.wins / model.closedTrades : null;
  const profitFactor = ledger.gross_loss > 0 ? ledger.gross_win / ledger.gross_loss : null;
  const lowSample = !risk.reliable ? `${risk.days} days, low sample` : `${risk.days} days`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{symbol} P&amp;L &amp; risk</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            {livePrice != null ? <>Last {formatCurrency(livePrice)} <span className="text-xs">({model.priceSource})</span> · </> : null}
            Orders from <span className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-zinc-800 rounded">{model.orders.source}</span>
            {asOf && <> · as of {new Date(asOf).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {tickerChips.map(t => (
              <Link
                key={t}
                to={`/ticker/${t}`}
                className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium border transition-colors ${
                  t === symbol
                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white'
                    : 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800'
                }`}
              >
                {t}
              </Link>
            ))}
          </div>
          <form onSubmit={goTo} className="flex">
            <input
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value)}
              placeholder="Ticker"
              aria-label="Go to ticker"
              className="w-20 px-2 py-1 text-xs font-mono uppercase rounded-l-md border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100"
            />
            <button type="submit" className="px-2 py-1 text-xs rounded-r-md border border-l-0 border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800">Go</button>
          </form>
          <button
            onClick={() => fetchData(symbol, true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {model.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2 font-medium mb-1"><AlertTriangle className="w-4 h-4" /> Data notes</div>
          <ul className="list-disc ml-6 space-y-0.5">{model.warnings.map(w => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {/* ── P&L ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Total P&L" value={fmtSigned(model.totalPnl)} tone={model.totalPnl} sub="Stock + options, realized + open" />
        <StatTile label="Realized (stock)" value={fmtSigned(ledger.realized_pnl)} tone={ledger.realized_pnl} sub={`${ledger.sell_count} sells · ${ledger.buy_count} buys`} />
        <StatTile
          label="Unrealized (stock)"
          value={fmtSigned(model.unrealized)}
          tone={model.unrealized}
          sub={ledger.shares_held > 0 ? `${shares(ledger.shares_held)} sh @ ${ledger.avg_cost > 0 ? formatCurrency(ledger.avg_cost) : '—'} avg` : 'Flat'}
        />
        <StatTile
          label="Options P&L"
          value={fmtSigned(model.optionPnl)}
          tone={model.optionPnl}
          sub={`${fmtSigned(optionLedger.realized_pnl)} realized · ${fmtSigned(exposure.option_unrealized)} open`}
        />
        <StatTile
          label="Win rate"
          value={winRate != null ? `${Math.round(winRate * 100)}%` : '—'}
          sub={model.closedTrades ? `${ledger.wins}W / ${ledger.losses}L · PF ${profitFactor != null ? profitFactor.toFixed(2) : '∞'}` : 'No closing sells yet'}
        />
        <StatTile
          label="Turnover"
          value={formatCurrency(ledger.total_bought + ledger.total_sold)}
          sub={`${formatCurrency(ledger.total_bought)} bought · ${formatCurrency(ledger.total_sold)} sold`}
        />
      </div>

      {/* ── Risk ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile
          label="Sharpe (ann.)"
          value={risk.sharpe != null ? risk.sharpe.toFixed(2) : '—'}
          sub={lowSample}
          title={`Mean ÷ σ of daily dollar P&L × √252, risk-free rate 0. Below ${MIN_RELIABLE_DAYS} days the estimate is noisy.`}
        />
        <StatTile
          label="Sortino (ann.)"
          value={risk.sortino != null ? risk.sortino.toFixed(2) : '—'}
          sub={`${risk.up_days} up / ${risk.down_days} down days`}
        />
        <StatTile
          label="Max drawdown"
          value={risk.max_drawdown > 0 ? `−${formatCurrency(risk.max_drawdown)}` : formatCurrency(0)}
          tone={risk.max_drawdown > 0 ? -1 : undefined}
          sub={risk.current_drawdown > 0 ? `${formatCurrency(risk.current_drawdown)} below peak now` : 'At peak'}
        />
        <StatTile
          label="P&L volatility"
          value={formatCurrency(risk.ann_vol_pnl)}
          sub={`annualized · best ${fmtSigned(risk.best_day)} / worst ${fmtSigned(risk.worst_day)}`}
        />
        <StatTile
          label="1-day VaR 95%"
          value={exposure.var95_param != null ? formatCurrency(exposure.var95_param) : '—'}
          sub={`on current delta · hist. ${risk.var95_hist != null ? formatCurrency(risk.var95_hist) : '—'}`}
          title={`Parametric: 1.645 × ${symbol} ${VOL_WINDOW}-day realized vol ÷ √252 × net delta dollars. Historical: 5th percentile of daily P&L.`}
        />
        <StatTile
          label="Exposure"
          value={formatCurrency(exposure.net_delta_dollars)}
          sub={`${exposure.pct_of_equity != null ? `${(exposure.pct_of_equity * 100).toFixed(1)}% of equity · ` : ''}${symbol} vol ${model.vol != null ? `${(model.vol * 100).toFixed(0)}%` : '—'}`}
          title={`Net delta dollars: ${formatCurrency(exposure.stock_value)} stock + ${formatCurrency(exposure.option_delta_dollars)} option delta`}
        />
      </div>

      {/* ── Charts ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card
          title="Cumulative P&L (stock)"
          subtitle={`Daily mark-to-market since the first fill · ${risk.days} trading days${risk.return_on_peak != null ? ` · ${fmtPct(risk.return_on_peak)} on peak exposure (${formatCurrency(risk.peak_exposure)})` : ''}`}
        >
          <CumulativePnlChart points={model.points} />
          <DailyPnlTable points={model.points} />
        </Card>
        <Card title={`${symbol} price, average cost and fills`} subtitle="Each marker is a fill at its price and time">
          <PriceFillsChart symbol={symbol} bars={model.bars} fills={ledger.fills} livePrice={livePrice} />
        </Card>
      </div>

      {/* ── Queue ──────────────────────────────────────────────────── */}
      <Card
        title="Working orders"
        subtitle={
          queue.stock.length || queue.options.length
            ? `Buys ${formatCurrency(queue.buy_notional)} · sells ${formatCurrency(queue.sell_notional)} · ${shares(queue.shares_if_filled)} sh if all fill · option premium at risk ${formatCurrency(queue.option_premium_at_risk)}${
                snapshot?.portfolio.equity ? ` (${((queue.option_premium_at_risk / snapshot.portfolio.equity) * 100).toFixed(2)}% of equity)` : ''
              }${model.staleStubs ? ` · ${model.staleStubs} stale unconfirmed stubs hidden` : ''}`
            : model.staleStubs ? `${model.staleStubs} stale unconfirmed stubs hidden` : undefined
        }
      >
        <QueuedOrdersTables queue={queue} livePrice={livePrice} />
      </Card>

      {/* ── Positions & ledgers ────────────────────────────────────── */}
      <Card title="Open option positions" subtitle={model.optionPositions.length ? `${formatCurrency(exposure.option_market_value)} value · ${formatCurrency(exposure.option_delta_dollars)} delta dollars` : undefined}>
        <OptionPositionsTable positions={model.optionPositions} />
      </Card>

      <Card title="Stock fills" subtitle="Average-cost basis · newest first">
        <StockFillsTable fills={ledger.fills} />
      </Card>

      <Card
        title="Option fills"
        subtitle={optionLedger.filled_count ? `${formatCurrency(optionLedger.premium_paid)} paid · ${formatCurrency(optionLedger.premium_received)} received` : undefined}
      >
        <OptionFillsTable fills={optionLedger.fills} />
      </Card>

      {errors.snapshot && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Snapshot unavailable: {errors.snapshot}. Broker position, option marks and equity are missing.</p>
      )}
      {errors.db && model.orders.source !== 'db' && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Trading DB unavailable: {errors.db}</p>
      )}
    </div>
  );
}
