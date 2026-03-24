import { useState, useEffect, useMemo } from 'react';
import {
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  Legend,
} from 'recharts';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import {
  listOptionSymbols,
  getLatestOptionsChain,
  getLatestMarketQuotes,
  listOptionsChainDates,
  getOptionsChainByDate,
  getMarketQuotesByDate,
  type OptionsChainBlob,
  type MarketQuotesBlob,
  type OptionSnapshot,
  type MarketQuote,
} from '../services/blobDataService';

// ── Parsed types for chart data ───────────────────────────

interface QuoteTimePoint {
  ts: number;
  label: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  spreadBps: number;
  bidSize: number;
  askSize: number;
}

interface IVSmilePoint {
  strike: number;
  iv: number;
  type: 'call' | 'put';
  delta: number;
  mid: number;
  volume: number;
}

interface GreeksRow {
  contract: string;
  strike: number;
  type: 'call' | 'put';
  expiry: string;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  mid: number;
  bid: number;
  ask: number;
}


interface FairPriceSummary {
  midPrice: number | null;
  ivAtm: number | null;
  bidAskSpread: number | null;
  bidAskSpreadBps: number | null;
  putCallParityImplied: number | null;
  confidence: 'high' | 'medium' | 'low';
  fairEstimate: number | null;
}

// ── Parse helpers ─────────────────────────────────────────

function parseContractSymbol(sym: string): { underlying: string; expiry: string; type: 'call' | 'put'; strike: number } | null {
  // OCC format: IWN260418C00205000 → underlying=IWN, expiry=2026-04-18, type=call, strike=205.00
  const m = sym.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, underlying, dateStr, cp, strikeStr] = m;
  const y = 2000 + parseInt(dateStr.slice(0, 2));
  const mo = dateStr.slice(2, 4);
  const d = dateStr.slice(4, 6);
  return {
    underlying,
    expiry: `${y}-${mo}-${d}`,
    type: cp === 'C' ? 'call' : 'put',
    strike: parseInt(strikeStr) / 1000,
  };
}

function extractQuoteTimeSeries(blob: MarketQuotesBlob, symbol: string): QuoteTimePoint[] {
  const points: QuoteTimePoint[] = [];

  // From history entries
  for (const entry of blob.history || []) {
    const raw = entry as unknown as Record<string, unknown>;
    // History entries may be flat quote objects or {timestamp, quotes: {...}}
    const ts = raw.timestamp as string;
    const quotes = (raw.quotes || raw) as Record<string, unknown>;
    const q = quotes[symbol] as MarketQuote | undefined;
    if (!q || typeof q.mid !== 'number') continue;
    const time = new Date(ts || q.timestamp).getTime();
    if (isNaN(time)) continue;
    points.push({
      ts: time,
      label: new Date(time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      bid: q.bid,
      ask: q.ask,
      mid: q.mid,
      spread: q.spread,
      spreadBps: q.spreadBps,
      bidSize: q.bidSize || 0,
      askSize: q.askSize || 0,
    });
  }

  // Latest quote
  const latest = blob.latest_quotes[symbol] as MarketQuote | undefined;
  if (latest && typeof latest.mid === 'number') {
    const time = new Date(latest.timestamp).getTime();
    if (!isNaN(time)) {
      points.push({
        ts: time,
        label: new Date(time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        bid: latest.bid,
        ask: latest.ask,
        mid: latest.mid,
        spread: latest.spread,
        spreadBps: latest.spreadBps,
        bidSize: latest.bidSize || 0,
        askSize: latest.askSize || 0,
      });
    }
  }

  points.sort((a, b) => a.ts - b.ts);
  return points;
}

function extractIVSmile(blob: OptionsChainBlob): IVSmilePoint[] {
  const points: IVSmilePoint[] = [];
  const chain = blob.latest_chain || {};

  for (const [key, val] of Object.entries(chain)) {
    if (key === '_meta') continue;
    const snap = val as OptionSnapshot;
    const parsed = parseContractSymbol(key);
    if (!parsed || snap.impliedVolatility == null) continue;
    const mid = snap.latestQuote ? (snap.latestQuote.bid + snap.latestQuote.ask) / 2 : 0;
    const vol = snap.latestTrade ? snap.latestTrade.size : 0;
    points.push({
      strike: parsed.strike,
      iv: snap.impliedVolatility * 100,
      type: parsed.type,
      delta: snap.greeks?.delta || 0,
      mid,
      volume: vol,
    });
  }

  points.sort((a, b) => a.strike - b.strike);
  return points;
}

function extractGreeksTable(blob: OptionsChainBlob): GreeksRow[] {
  const rows: GreeksRow[] = [];
  const chain = blob.latest_chain || {};

  for (const [key, val] of Object.entries(chain)) {
    if (key === '_meta') continue;
    const snap = val as OptionSnapshot;
    const parsed = parseContractSymbol(key);
    if (!parsed || !snap.greeks) continue;
    const bid = snap.latestQuote?.bid || 0;
    const ask = snap.latestQuote?.ask || 0;
    rows.push({
      contract: key,
      strike: parsed.strike,
      type: parsed.type,
      expiry: parsed.expiry,
      delta: snap.greeks.delta || 0,
      gamma: snap.greeks.gamma || 0,
      theta: snap.greeks.theta || 0,
      vega: snap.greeks.vega || 0,
      iv: (snap.impliedVolatility || 0) * 100,
      mid: (bid + ask) / 2,
      bid,
      ask,
    });
  }

  rows.sort((a, b) => a.strike - b.strike || (a.type === 'call' ? -1 : 1));
  return rows;
}

function computeFairPriceSummary(
  quotes: QuoteTimePoint[],
  ivSmile: IVSmilePoint[],
  greeks: GreeksRow[],
): FairPriceSummary {
  const lastQuote = quotes.length > 0 ? quotes[quotes.length - 1] : null;
  const midPrice = lastQuote?.mid ?? null;
  const bidAskSpread = lastQuote?.spread ?? null;
  const bidAskSpreadBps = lastQuote?.spreadBps ?? null;

  // ATM IV: find options closest to 0.50 delta
  const atmCalls = ivSmile.filter((p) => p.type === 'call' && Math.abs(Math.abs(p.delta) - 0.5) < 0.15);
  const ivAtm = atmCalls.length > 0
    ? atmCalls.reduce((sum, p) => sum + p.iv, 0) / atmCalls.length
    : null;

  // Put-call parity implied price: for matched strike pairs
  // C - P = S - K * e^(-rT), simplified: S ≈ C - P + K
  let putCallParityImplied: number | null = null;
  const callsByStrike = new Map<number, GreeksRow>();
  const putsByStrike = new Map<number, GreeksRow>();
  for (const g of greeks) {
    if (g.type === 'call') callsByStrike.set(g.strike, g);
    else putsByStrike.set(g.strike, g);
  }
  const parityEstimates: number[] = [];
  for (const [strike, call] of callsByStrike) {
    const put = putsByStrike.get(strike);
    if (put && call.mid > 0 && put.mid > 0) {
      parityEstimates.push(call.mid - put.mid + strike);
    }
  }
  if (parityEstimates.length > 0) {
    putCallParityImplied = parityEstimates.reduce((a, b) => a + b, 0) / parityEstimates.length;
  }

  // Confidence based on data availability
  const dataPoints = [midPrice, putCallParityImplied].filter((v) => v !== null).length;
  const confidence: 'high' | 'medium' | 'low' = dataPoints >= 2 ? 'high' : dataPoints === 1 ? 'medium' : 'low';

  // Fair estimate: weighted average of available prices
  const estimates: { value: number; weight: number }[] = [];
  if (midPrice !== null) estimates.push({ value: midPrice, weight: 3 });
  if (putCallParityImplied !== null) estimates.push({ value: putCallParityImplied, weight: 2 });
  const fairEstimate = estimates.length > 0
    ? estimates.reduce((sum, e) => sum + e.value * e.weight, 0) / estimates.reduce((sum, e) => sum + e.weight, 0)
    : null;

  return { midPrice, ivAtm, bidAskSpread, bidAskSpreadBps, putCallParityImplied, confidence, fairEstimate };
}

// ── Level badge helper ─────────────────────────────────────

type DataLevel = 'L1' | 'L2' | 'L3';

const LEVEL_META: Record<DataLevel, { color: string; desc: string }> = {
  L1: { color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400', desc: 'NBBO — best bid/ask, last trade' },
  L2: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400', desc: 'Market depth — full order book' },
  L3: { color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400', desc: 'Full order log — individual orders' },
};

function LevelBadge({ level }: { level: DataLevel }) {
  const m = LEVEL_META[level];
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${m.color}`}
      title={m.desc}
    >
      {level}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────

export default function MarketDepth() {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [optionsBlob, setOptionsBlob] = useState<OptionsChainBlob | null>(null);
  const [quotesBlob, setQuotesBlob] = useState<MarketQuotesBlob | null>(null);
  const [greeksExpanded, setGreeksExpanded] = useState(false);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('latest');

  const chartHeight = 280;
  const axisColor = isDark ? '#a1a1aa' : '#a1a1aa';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';

  // Load available symbols on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const syms = await listOptionSymbols();
        if (!cancelled && syms.length > 0) {
          setSymbols(syms);
          setSelectedSymbol(syms[0]);
        }
      } catch {
        // Symbols might not be available yet
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Load available dates when symbol changes
  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;
    async function load() {
      try {
        const dates = await listOptionsChainDates(selectedSymbol);
        if (!cancelled) {
          setAvailableDates(dates);
          setSelectedDate('latest');
        }
      } catch {
        // Dates might not be available
      }
    }
    load();
    return () => { cancelled = true; };
  }, [selectedSymbol]);

  // Load data when symbol or date changes
  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        let options: OptionsChainBlob | null;
        let quotes: MarketQuotesBlob | null;

        if (selectedDate === 'latest') {
          [options, quotes] = await Promise.all([
            getLatestOptionsChain(selectedSymbol),
            getLatestMarketQuotes(),
          ]);
        } else {
          [options, quotes] = await Promise.all([
            getOptionsChainByDate(selectedSymbol, selectedDate),
            getMarketQuotesByDate(selectedDate),
          ]);
        }
        if (!cancelled) {
          setOptionsBlob(options);
          setQuotesBlob(quotes);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [selectedSymbol, selectedDate]);

  // Derived chart data
  const quoteTimeSeries = useMemo(() => {
    if (!quotesBlob) return [];
    // Try the selected symbol, then BTC/USD, then BTC
    for (const sym of [selectedSymbol, 'BTC/USD', 'BTC']) {
      const pts = extractQuoteTimeSeries(quotesBlob, sym);
      if (pts.length > 0) return pts;
    }
    return [];
  }, [quotesBlob, selectedSymbol]);

  const ivSmile = useMemo(() => {
    if (!optionsBlob) return [];
    return extractIVSmile(optionsBlob);
  }, [optionsBlob]);

  const greeksTable = useMemo(() => {
    if (!optionsBlob) return [];
    return extractGreeksTable(optionsBlob);
  }, [optionsBlob]);

  const summary = useMemo(() => {
    return computeFairPriceSummary(quoteTimeSeries, ivSmile, greeksTable);
  }, [quoteTimeSeries, ivSmile, greeksTable]);

  // Find unique expiries for display
  const expiries = useMemo(() => {
    const set = new Set(greeksTable.map((g) => g.expiry));
    return Array.from(set).sort();
  }, [greeksTable]);

  const tooltipStyle = {
    backgroundColor: isDark ? '#09090b' : '#ffffff',
    border: `1px solid ${isDark ? '#27272a' : '#e5e7eb'}`,
    borderRadius: '0.5rem',
    color: isDark ? '#ffffff' : '#111827',
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading market data from blob stores...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-4">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <p className="text-xs text-red-500 dark:text-red-500 mt-2">
            Ensure the ALLOC_ENGINE_SITE_ID env var is set in the Netlify site settings.
          </p>
        </div>
      </div>
    );
  }

  const hasOptions = optionsBlob !== null && ivSmile.length > 0;
  const hasQuotes = quoteTimeSeries.length > 0;

  return (
    <div className="space-y-6">
      {/* Data level legend */}
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Data levels:</p>
        <div className="flex items-center gap-1.5">
          <LevelBadge level="L1" />
          <span className="text-xs text-gray-500 dark:text-gray-400">NBBO — best bid/ask, last trade, top-of-book size</span>
        </div>
        <div className="flex items-center gap-1.5">
          <LevelBadge level="L2" />
          <span className="text-xs text-gray-400 dark:text-gray-500">Market depth — not yet available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <LevelBadge level="L3" />
          <span className="text-xs text-gray-400 dark:text-gray-500">Full order log — not yet available</span>
        </div>
      </div>

      {/* Symbol selector + date picker + summary */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Underlying</label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-md text-sm text-gray-900 dark:text-white"
          >
            {symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Date</label>
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-md text-sm text-gray-900 dark:text-white"
          >
            <option value="latest">Latest (end-of-day)</option>
            {availableDates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        {optionsBlob && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Snapshot: {new Date(optionsBlob.timestamp).toLocaleString()} &middot;{' '}
            {Object.keys(optionsBlob.latest_chain || {}).filter((k) => k !== '_meta').length} contracts &middot;{' '}
            {optionsBlob.history_count} history entries
          </p>
        )}
      </div>

      {/* Fair Price Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Fair Estimate"
          value={summary.fairEstimate !== null ? `$${summary.fairEstimate.toFixed(2)}` : '—'}
          sub={`Confidence: ${summary.confidence}`}
          highlight
          confidence={summary.confidence}
        />
        <SummaryCard
          label="Mid Price"
          value={summary.midPrice !== null ? `$${summary.midPrice.toFixed(2)}` : '—'}
          sub={summary.bidAskSpread !== null ? `Spread: ${summary.bidAskSpreadBps?.toFixed(1)} bps` : ''}
        />
        <SummaryCard
          label="ATM IV"
          value={summary.ivAtm !== null ? `${summary.ivAtm.toFixed(1)}%` : '—'}
          sub="Near-money calls"
        />
        <SummaryCard
          label="Put-Call Parity"
          value={summary.putCallParityImplied !== null ? `$${summary.putCallParityImplied.toFixed(2)}` : '—'}
          sub="Implied underlying"
        />
      </div>

      {/* Row 1: Quote microstructure + IV Smile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bid-Ask Time Series */}
        <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <LevelBadge level="L1" />
            Quote Microstructure — Bid / Ask / Mid
          </h4>
          {hasQuotes ? (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <AreaChart data={quoteTimeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => `$${v.toLocaleString()}`}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                  width={70}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
                  formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name]}
                />
                <defs>
                  <linearGradient id="bidAskGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="ask" stroke="#ef4444" fill="none" strokeWidth={1} dot={false} name="Ask" />
                <Area type="monotone" dataKey="bid" stroke="#22c55e" fill="none" strokeWidth={1} dot={false} name="Bid" />
                <Line type="monotone" dataKey="mid" stroke="#3b82f6" strokeWidth={2} dot={false} name="Mid" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart height={chartHeight} message="No quote data available" />
          )}
        </div>

        {/* IV Smile */}
        <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
            <LevelBadge level="L1" />
            Implied Volatility Smile
          </h4>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            IV by strike — calls (blue) and puts (orange)
            {expiries.length > 0 && ` — Expiries: ${expiries.join(', ')}`}
          </p>
          {hasOptions ? (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="strike"
                  name="Strike"
                  type="number"
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => `$${v}`}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                />
                <YAxis
                  dataKey="iv"
                  name="IV"
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                  width={50}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, name: string) => {
                    if (name === 'IV') return [`${value.toFixed(1)}%`, name];
                    if (name === 'Strike') return [`$${value.toFixed(2)}`, name];
                    return [value, name];
                  }}
                />
                <Legend />
                <Scatter
                  name="Calls"
                  data={ivSmile.filter((p) => p.type === 'call')}
                  fill="#3b82f6"
                  fillOpacity={0.7}
                />
                <Scatter
                  name="Puts"
                  data={ivSmile.filter((p) => p.type === 'put')}
                  fill="#f97316"
                  fillOpacity={0.7}
                />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart height={chartHeight} message="No options chain data" />
          )}
        </div>
      </div>

      {/* Row 2: Spread + Delta + Imbalance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Spread (bps) over time */}
        <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
            <LevelBadge level="L1" />
            Bid-Ask Spread Over Time
          </h4>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            Wider spreads indicate lower liquidity and greater uncertainty in fair value
          </p>
          {hasQuotes ? (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <AreaChart data={quoteTimeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                />
                <YAxis
                  tickFormatter={(v) => `${v.toFixed(0)} bps`}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                  width={60}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
                  formatter={(value: number) => [`${value.toFixed(1)} bps`, 'Spread']}
                />
                <defs>
                  <linearGradient id="spreadGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="spreadBps"
                  stroke="#f59e0b"
                  fill="url(#spreadGrad)"
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart height={chartHeight} message="No spread data" />
          )}
        </div>

        {/* Delta by strike */}
        <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
            <LevelBadge level="L1" />
            Delta Exposure by Strike
          </h4>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            Shows directional sensitivity — where the market is positioned
          </p>
          {hasOptions ? (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={greeksTable.filter((g) => g.type === 'call').slice(0, 40)}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="strike"
                  tickFormatter={(v) => `$${v}`}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                />
                <YAxis
                  tickFormatter={(v) => v.toFixed(2)}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                  width={45}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, name: string) => [value.toFixed(4), name]}
                />
                <ReferenceLine y={0} stroke={axisColor} />
                <Bar dataKey="delta" name="Delta">
                  {greeksTable.filter((g) => g.type === 'call').slice(0, 40).map((entry, i) => (
                    <Cell key={i} fill={entry.delta >= 0 ? '#22c55e' : '#ef4444'} fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart height={chartHeight} message="No greeks data" />
          )}
        </div>

        {/* Bid/Ask size imbalance */}
        <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
            <LevelBadge level="L1" />
            Bid/Ask Size Imbalance
          </h4>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            Top-of-book size only (L2 depth not available). Positive = bid &gt; ask size, Negative = ask &gt; bid
          </p>
          {hasQuotes ? (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <BarChart data={quoteTimeSeries.map((q) => ({
                ...q,
                imbalance: q.bidSize - q.askSize,
                imbalanceRatio: q.bidSize + q.askSize > 0
                  ? ((q.bidSize - q.askSize) / (q.bidSize + q.askSize)) * 100
                  : 0,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="ts"
                  tickFormatter={(ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                />
                <YAxis
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                  width={45}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(ts) => new Date(ts as number).toLocaleString()}
                  formatter={(value: number) => [`${value.toFixed(1)}%`, 'Imbalance']}
                />
                <ReferenceLine y={0} stroke={axisColor} />
                <Bar dataKey="imbalanceRatio" name="Imbalance">
                  {quoteTimeSeries.map((q, i) => (
                    <Cell
                      key={i}
                      fill={q.bidSize >= q.askSize ? '#22c55e' : '#ef4444'}
                      fillOpacity={0.6}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart height={chartHeight} message="No quote size data" />
          )}
        </div>
      </div>

      {/* Greeks Table (collapsible) */}
      <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg">
        <button
          onClick={() => setGreeksExpanded(!greeksExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <LevelBadge level="L1" />
            Full Greeks Table ({greeksTable.length} contracts)
          </h4>
          {greeksExpanded ? (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          )}
        </button>
        {greeksExpanded && greeksTable.length > 0 && (
          <div className="overflow-x-auto border-t border-gray-100 dark:border-zinc-900">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-zinc-900 text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2 text-left font-medium">Contract</th>
                  <th className="px-3 py-2 text-right font-medium">Strike</th>
                  <th className="px-3 py-2 text-center font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Expiry</th>
                  <th className="px-3 py-2 text-right font-medium">Bid</th>
                  <th className="px-3 py-2 text-right font-medium">Ask</th>
                  <th className="px-3 py-2 text-right font-medium">Mid</th>
                  <th className="px-3 py-2 text-right font-medium">IV</th>
                  <th className="px-3 py-2 text-right font-medium">Delta</th>
                  <th className="px-3 py-2 text-right font-medium">Gamma</th>
                  <th className="px-3 py-2 text-right font-medium">Theta</th>
                  <th className="px-3 py-2 text-right font-medium">Vega</th>
                </tr>
              </thead>
              <tbody>
                {greeksTable.map((g) => (
                  <tr key={g.contract} className="border-b border-gray-50 dark:border-zinc-900/50 hover:bg-gray-50 dark:hover:bg-zinc-900/50">
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 font-mono">{g.contract}</td>
                    <td className="px-3 py-1.5 text-right text-gray-900 dark:text-white">${g.strike.toFixed(2)}</td>
                    <td className={`px-3 py-1.5 text-center font-medium ${g.type === 'call' ? 'text-blue-600' : 'text-orange-500'}`}>
                      {g.type === 'call' ? 'C' : 'P'}
                    </td>
                    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{g.expiry}</td>
                    <td className="px-3 py-1.5 text-right text-green-600">${g.bid.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right text-red-500">${g.ask.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-900 dark:text-white">${g.mid.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-900 dark:text-white">{g.iv.toFixed(1)}%</td>
                    <td className={`px-3 py-1.5 text-right ${g.delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>{g.delta.toFixed(4)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-400">{g.gamma.toFixed(4)}</td>
                    <td className="px-3 py-1.5 text-right text-red-500">{g.theta.toFixed(4)}</td>
                    <td className="px-3 py-1.5 text-right text-purple-600">{g.vega.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Methodology note */}
      <div className="bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Methodology &amp; Data Levels</h4>
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <p className="font-medium text-gray-600 dark:text-gray-300">Data classification:</p>
          <p><strong>L1 (NBBO)</strong> — Best bid/ask price + size, last trade price + size, mid, spread. All panels currently use L1 data from Alpaca snapshots polled every 3s (quotes) and 30s (options).</p>
          <p><strong>L2 (Market Depth)</strong> — Full order book with multiple price levels. Not yet available in our feed.</p>
          <p><strong>L3 (Full Order Log)</strong> — Individual order events (new, cancel, modify). Not yet available.</p>
          <p className="font-medium text-gray-600 dark:text-gray-300 mt-2">Fair price estimation:</p>
          <p><strong>Fair Estimate</strong> = weighted average of mid-price (3x), VWAP (2x), and put-call parity implied price (1x).</p>
          <p><strong>Mid Price</strong> = (bid + ask) / 2 from the latest L1 quote snapshot.</p>
          <p><strong>VWAP</strong> = volume-weighted average price from option minute bars (L1 trade aggregates).</p>
          <p><strong>Put-Call Parity</strong> = C - P + K for matched call/put strike pairs, averaged across all pairs.</p>
          <p><strong>ATM IV</strong> = average implied volatility of calls with |delta| near 0.50 (derived from L1 option snapshots).</p>
          <p><strong>Confidence</strong> = high (3 signals), medium (2), low (1 or fewer).</p>
          <p className="mt-2 italic">Data sourced from Alpaca via Redis, archived to Netlify Blobs every ~8 minutes.</p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────

function SummaryCard({ label, value, sub, highlight, confidence }: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  confidence?: 'high' | 'medium' | 'low';
}) {
  const confColor = confidence === 'high' ? 'text-green-600' : confidence === 'medium' ? 'text-yellow-600' : 'text-red-500';
  return (
    <div className={`rounded-lg p-3 ${highlight ? 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900' : 'bg-gray-50 dark:bg-zinc-900'}`}>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
        {value}
      </p>
      {sub && (
        <p className={`text-xs mt-0.5 ${confidence ? confColor : 'text-gray-400 dark:text-gray-500'}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

function EmptyChart({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500"
      style={{ height }}
    >
      {message}
    </div>
  );
}
