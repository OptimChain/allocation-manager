import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { API_BASE } from '../config/api';
import {
  RefreshCw,
  Activity,
  Clock,
  Target,
  Layers,
} from 'lucide-react';
import type { VolSurfaceData } from '../components/VolSurface3D';
import MarketDepthVolSection, { type MarketDepthMeta } from '../components/MarketDepthVolSection';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OptionGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
}

interface DepthLevel {
  price: number;
  size: number;
  exchange: string;
  timestamp: string;
}

interface OptionContract {
  symbol: string;
  underlying: string;
  optionType: 'call' | 'put';
  strike: number;
  expiration: string;
  dte: number;
  spot: number;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  openInterest: number;
  quotedAt?: string | null;
  dataSource?: 'live' | 'mock';
  greeks: OptionGreeks;
  bidDepth: DepthLevel[];
  askDepth: DepthLevel[];
  thetaDecayCurve: { dte: number; value: number }[];
}

interface MarketDepthResponse {
  timestamp: string;
  contracts: OptionContract[];
  volSurfaces?: VolSurfaceData[];
  meta?: MarketDepthMeta;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n: number): string {
  return '$' + fmt(n);
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + fmt(n * 100) + '%';
}

function fmtDate(iso: string): string {
  return new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function greekColor(value: number, invert = false): string {
  const positive = invert ? value < 0 : value > 0;
  return positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';
}

function sortContractsLatestDesc(contracts: OptionContract[]): OptionContract[] {
  return [...contracts].sort((a, b) => {
    const byExpiry = b.expiration.localeCompare(a.expiration);
    if (byExpiry !== 0) return byExpiry;
    const byUnderlying = a.underlying.localeCompare(b.underlying);
    if (byUnderlying !== 0) return byUnderlying;
    if (a.strike !== b.strike) return a.strike - b.strike;
    const ta = a.quotedAt ? Date.parse(a.quotedAt) : 0;
    const tb = b.quotedAt ? Date.parse(b.quotedAt) : 0;
    return tb - ta;
  });
}

type DataSourceFilter = 'all' | 'live' | 'mock';
type OptionTypeFilter = 'all' | 'call' | 'put';

function contractDataSource(c: OptionContract, meta?: MarketDepthMeta): 'live' | 'mock' {
  if (c.dataSource) return c.dataSource;
  if (meta?.mockSymbols?.includes(c.underlying)) return 'mock';
  return meta?.contractSource === 'chain' ? 'live' : 'mock';
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
        active
          ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 border-gray-900 dark:border-gray-100'
          : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-700 hover:border-gray-300 dark:hover:border-zinc-600'
      }`}
    >
      {children}
    </button>
  );
}

function MarketDepthFilters({
  symbols,
  symbol,
  onSymbol,
  dataSource,
  onDataSource,
  optionType,
  onOptionType,
  counts,
}: {
  symbols: string[];
  symbol: string;
  onSymbol: (s: string) => void;
  dataSource: DataSourceFilter;
  onDataSource: (d: DataSourceFilter) => void;
  optionType: OptionTypeFilter;
  onOptionType: (t: OptionTypeFilter) => void;
  counts: { contracts: number; surfaces: number };
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 w-14 shrink-0">Symbol</span>
        <FilterChip active={symbol === 'ALL'} onClick={() => onSymbol('ALL')}>All</FilterChip>
        {symbols.map((s) => (
          <FilterChip key={s} active={symbol === s} onClick={() => onSymbol(s)}>{s}</FilterChip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 w-14 shrink-0">Source</span>
        {(['all', 'live', 'mock'] as const).map((s) => (
          <FilterChip key={s} active={dataSource === s} onClick={() => onDataSource(s)}>
            {s === 'all' ? 'All' : s === 'live' ? 'Live · Chain' : 'Parametric'}
          </FilterChip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 w-14 shrink-0">Type</span>
        {(['all', 'call', 'put'] as const).map((t) => (
          <FilterChip key={t} active={optionType === t} onClick={() => onOptionType(t)}>
            {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1) + 's'}
          </FilterChip>
        ))}
        <span className="ml-auto text-xs text-gray-400 dark:text-zinc-500 font-mono">
          {counts.contracts} contracts · {counts.surfaces} surfaces
        </span>
      </div>
    </div>
  );
}

// ─── DepthLadder ─────────────────────────────────────────────────────────────

function DepthLadder({ bids, asks, mid }: { bids: DepthLevel[]; asks: DepthLevel[]; mid: number }) {
  const maxSize = Math.max(
    ...bids.map(b => b.size),
    ...asks.map(a => a.size),
    1,
  );

  return (
    <div className="space-y-1 text-xs font-mono">
      <div className="grid grid-cols-3 text-gray-400 dark:text-zinc-500 pb-1 border-b border-gray-100 dark:border-zinc-800">
        <span>Size</span>
        <span className="text-center">Price</span>
        <span className="text-right">Exch</span>
      </div>
      {asks.slice().reverse().map((a, i) => (
        <div key={`ask-${i}`} className="grid grid-cols-3 relative">
          <div
            className="absolute inset-0 bg-red-500/10 dark:bg-red-500/15 rounded-sm"
            style={{ width: `${(a.size / maxSize) * 100}%`, marginLeft: 'auto' }}
          />
          <span className="relative text-red-600 dark:text-red-400">{a.size}</span>
          <span className="relative text-center text-red-600 dark:text-red-400">{fmt(a.price)}</span>
          <span className="relative text-right text-gray-400 dark:text-zinc-500">{a.exchange}</span>
        </div>
      ))}
      <div className="text-center font-bold text-gray-900 dark:text-gray-100 py-1 border-y border-gray-200 dark:border-zinc-700">
        {fmt(mid)} mid
      </div>
      {bids.map((b, i) => (
        <div key={`bid-${i}`} className="grid grid-cols-3 relative">
          <div
            className="absolute inset-0 bg-emerald-500/10 dark:bg-emerald-500/15 rounded-sm"
            style={{ width: `${(b.size / maxSize) * 100}%` }}
          />
          <span className="relative text-emerald-600 dark:text-emerald-400">{b.size}</span>
          <span className="relative text-center text-emerald-600 dark:text-emerald-400">{fmt(b.price)}</span>
          <span className="relative text-right text-gray-400 dark:text-zinc-500">{b.exchange}</span>
        </div>
      ))}
    </div>
  );
}

// ─── ThetaDecayChart (pure CSS) ──────────────────────────────────────────────

function ThetaDecayChart({ curve, currentDte }: { curve: { dte: number; value: number }[]; currentDte: number }) {
  if (!curve.length) return null;
  const maxVal = Math.max(...curve.map(c => Math.abs(c.value)));
  const maxDte = Math.max(...curve.map(c => c.dte));

  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-400 dark:text-zinc-500 mb-2">
        Theta Decay · {curve.length} points
      </div>
      <div className="flex items-end gap-[2px] h-20">
        {curve.map((point, i) => {
          const height = maxVal > 0 ? (Math.abs(point.value) / maxVal) * 100 : 0;
          const isCurrent = point.dte === currentDte;
          return (
            <div
              key={i}
              className="flex-1 relative group"
              title={`DTE ${point.dte}: $${fmt(point.value)}`}
            >
              <div
                className={`w-full rounded-t-sm ${isCurrent ? 'bg-amber-500' : 'bg-red-400/60 dark:bg-red-500/40'}`}
                style={{ height: `${Math.max(height, 2)}%` }}
              />
              {isCurrent && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-1 h-1 bg-amber-500 rounded-full" />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 dark:text-zinc-500">
        <span>{maxDte}d</span>
        <span>0d</span>
      </div>
    </div>
  );
}

// ─── ContractCard ────────────────────────────────────────────────────────────

function ContractCard({ contract, dataSource }: { contract: OptionContract; dataSource: 'live' | 'mock' }) {
  const spread = contract.ask - contract.bid;
  const spreadBps = contract.mid > 0 ? (spread / contract.mid) * 10000 : 0;
  const intrinsic = contract.optionType === 'call'
    ? Math.max(contract.spot - contract.strike, 0)
    : Math.max(contract.strike - contract.spot, 0);
  const extrinsic = Math.max(contract.mid - intrinsic, 0);
  const moneyness = contract.optionType === 'call'
    ? ((contract.spot - contract.strike) / contract.strike) * 100
    : ((contract.strike - contract.spot) / contract.spot) * 100;
  const itm = moneyness > 0;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{contract.underlying}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              dataSource === 'live'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
            }`}>
              {dataSource === 'live' ? 'Live' : 'Parametric'}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
              contract.optionType === 'call'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
            }`}>
              {contract.optionType.toUpperCase()}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              itm
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                : 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-400'
            }`}>
              {itm ? 'ITM' : 'OTM'} {fmt(Math.abs(moneyness), 1)}%
            </span>
          </div>
          <div className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            ${fmt(contract.strike)} strike · {fmtDate(contract.expiration)} · {contract.dte} DTE
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {fmtCurrency(contract.mid)}
          </div>
          <div className="text-xs text-gray-400 dark:text-zinc-500">
            {fmtCurrency(contract.bid)} × {fmtCurrency(contract.ask)}
            <span className="ml-1 text-gray-300 dark:text-zinc-600">
              ({fmt(spreadBps, 0)} bps)
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-100 dark:divide-zinc-800">
        {/* Greeks & Spot */}
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
            <Activity className="w-4 h-4" />
            Greeks & Pricing
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">Spot</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{fmtCurrency(contract.spot)}</div>
            </div>
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">IV</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{fmt(contract.greeks.iv * 100, 1)}%</div>
            </div>
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">Delta</div>
              <div className={`font-semibold ${greekColor(contract.greeks.delta)}`}>
                {fmtPct(contract.greeks.delta)}
              </div>
            </div>
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">Gamma</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{fmt(contract.greeks.gamma, 4)}</div>
            </div>
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">Theta</div>
              <div className={`font-semibold ${greekColor(contract.greeks.theta, true)}`}>
                {fmtCurrency(contract.greeks.theta)}/day
              </div>
            </div>
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">Vega</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{fmtCurrency(contract.greeks.vega)}</div>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-100 dark:border-zinc-800 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">Intrinsic</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{fmtCurrency(intrinsic)}</div>
            </div>
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">Extrinsic</div>
              <div className="font-semibold text-amber-600 dark:text-amber-400">{fmtCurrency(extrinsic)}</div>
            </div>
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">Volume</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{contract.volume.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-400 dark:text-zinc-500 text-xs">Open Int.</div>
              <div className="font-semibold text-gray-900 dark:text-gray-100">{contract.openInterest.toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Depth Ladder */}
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
            <Layers className="w-4 h-4" />
            Market Depth
          </div>
          <DepthLadder bids={contract.bidDepth} asks={contract.askDepth} mid={contract.mid} />
        </div>

        {/* Theta Decay */}
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
            <Clock className="w-4 h-4" />
            Time Decay
          </div>
          <ThetaDecayChart curve={contract.thetaDecayCurve} currentDte={contract.dte} />
          <div className="text-xs text-gray-500 dark:text-zinc-400 space-y-1 mt-2">
            <div className="flex justify-between">
              <span>Daily theta burn</span>
              <span className="text-red-500 font-medium">{fmtCurrency(contract.greeks.theta)}</span>
            </div>
            <div className="flex justify-between">
              <span>Weekly theta burn</span>
              <span className="text-red-500 font-medium">{fmtCurrency(contract.greeks.theta * 7)}</span>
            </div>
            <div className="flex justify-between">
              <span>Value at expiry (intrinsic)</span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{fmtCurrency(intrinsic)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── RawFeed ─────────────────────────────────────────────────────────────────

function RawFeed({ contracts, meta }: { contracts: OptionContract[]; meta?: MarketDepthMeta }) {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-zinc-800 flex items-center gap-2">
        <Target className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Raw Feed</span>
        <span className="text-xs text-gray-400 dark:text-zinc-500 ml-auto font-mono">
          {new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' })}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-gray-400 dark:text-zinc-500 text-left border-b border-gray-100 dark:border-zinc-800">
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Contract</th>
              <th className="px-4 py-2 text-right">Spot</th>
              <th className="px-4 py-2 text-right">Bid</th>
              <th className="px-4 py-2 text-right">Ask</th>
              <th className="px-4 py-2 text-right">Mid</th>
              <th className="px-4 py-2 text-right">Last</th>
              <th className="px-4 py-2 text-right">Vol</th>
              <th className="px-4 py-2 text-right">OI</th>
              <th className="px-4 py-2 text-right">IV</th>
              <th className="px-4 py-2 text-right">Delta</th>
              <th className="px-4 py-2 text-right">Theta</th>
              <th className="px-4 py-2 text-right">Gamma</th>
              <th className="px-4 py-2 text-right">Vega</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-zinc-800">
            {contracts.map((c, i) => {
              const src = contractDataSource(c, meta);
              return (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                <td className="px-4 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    src === 'live'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                  }`}>
                    {src === 'live' ? 'live' : 'mock'}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-900 dark:text-gray-100 font-semibold">
                  {c.underlying} {fmt(c.strike)} {c.optionType.charAt(0).toUpperCase()} {c.expiration.slice(5)}
                </td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{fmt(c.spot)}</td>
                <td className="px-4 py-2 text-right text-emerald-600 dark:text-emerald-400">{fmt(c.bid)}</td>
                <td className="px-4 py-2 text-right text-red-500 dark:text-red-400">{fmt(c.ask)}</td>
                <td className="px-4 py-2 text-right text-gray-900 dark:text-gray-100 font-semibold">{fmt(c.mid)}</td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{fmt(c.last)}</td>
                <td className="px-4 py-2 text-right text-gray-500 dark:text-zinc-400">{c.volume.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-gray-500 dark:text-zinc-400">{c.openInterest.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{fmt(c.greeks.iv * 100, 1)}%</td>
                <td className={`px-4 py-2 text-right ${greekColor(c.greeks.delta)}`}>{fmt(c.greeks.delta, 3)}</td>
                <td className={`px-4 py-2 text-right ${greekColor(c.greeks.theta, true)}`}>{fmt(c.greeks.theta)}</td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{fmt(c.greeks.gamma, 4)}</td>
                <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{fmt(c.greeks.vega)}</td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── MarketDepthPage ─────────────────────────────────────────────────────────

export default function MarketDepthPage() {
  const [data, setData] = useState<MarketDepthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const [symbolFilter, setSymbolFilter] = useState('ALL');
  const [dataSourceFilter, setDataSourceFilter] = useState<DataSourceFilter>('all');
  const [optionTypeFilter, setOptionTypeFilter] = useState<OptionTypeFilter>('all');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/market-depth`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: MarketDepthResponse = await res.json();
      setData(json);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const contracts = useMemo(
    () => (data?.contracts ? sortContractsLatestDesc(data.contracts) : []),
    [data?.contracts],
  );

  const symbols = useMemo(() => {
    const fromMeta = data?.meta?.symbols;
    if (fromMeta?.length) return fromMeta;
    return [...new Set([
      ...(data?.volSurfaces?.map((s) => s.underlying) ?? []),
      ...contracts.map((c) => c.underlying),
    ])].sort();
  }, [data?.meta?.symbols, data?.volSurfaces, contracts]);

  const filteredContracts = useMemo(() => {
    return contracts.filter((c) => {
      if (symbolFilter !== 'ALL' && c.underlying !== symbolFilter) return false;
      const src = contractDataSource(c, data?.meta);
      if (dataSourceFilter === 'live' && src !== 'live') return false;
      if (dataSourceFilter === 'mock' && src !== 'mock') return false;
      if (optionTypeFilter !== 'all' && c.optionType !== optionTypeFilter) return false;
      return true;
    });
  }, [contracts, symbolFilter, dataSourceFilter, optionTypeFilter, data?.meta]);

  const filteredSurfaces = useMemo(() => {
    const surfaces = data?.volSurfaces ?? [];
    if (symbolFilter === 'ALL') return surfaces;
    return surfaces.filter((s) => s.underlying === symbolFilter);
  }, [data?.volSurfaces, symbolFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Market Depth</h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-0.5">
            Options pricing, greeks & order book depth
            {data?.meta?.contractSource && data.meta.contractCount ? (
              <span className="block text-xs mt-1 font-mono">
                {data.meta.contractCount} contracts
                {data.meta.liveContractCount != null && data.meta.mockSymbols?.length
                  ? ` (${data.meta.liveContractCount} live · ${data.meta.mockSymbols.length} parametric symbols)`
                  : ''}
                {' · '}{data.meta.volSurfaceSource ?? 'mock'} surfaces
                {data.timestamp ? ` · ${new Date(data.timestamp).toLocaleString()}` : ''}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-gray-400 dark:text-zinc-500">
              {lastRefresh.toLocaleTimeString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' })}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-zinc-800 rounded-lg text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="text-center py-20 text-gray-400 dark:text-zinc-500">Loading contracts...</div>
      ) : data && data.contracts.length === 0 ? (
        <div className="text-center py-20 text-gray-500 dark:text-zinc-400 space-y-2">
          <p>No options chain data in blob store yet.</p>
          <p className="text-xs font-mono">allocation-feed → Redis → unload cron → Netlify Blobs</p>
        </div>
      ) : data ? (
        <div className="space-y-6">
          <MarketDepthFilters
            symbols={symbols}
            symbol={symbolFilter}
            onSymbol={setSymbolFilter}
            dataSource={dataSourceFilter}
            onDataSource={setDataSourceFilter}
            optionType={optionTypeFilter}
            onOptionType={setOptionTypeFilter}
            counts={{ contracts: filteredContracts.length, surfaces: filteredSurfaces.length }}
          />

          {filteredSurfaces.length > 0 && (
            <MarketDepthVolSection
              surfaces={filteredSurfaces}
              contracts={filteredContracts}
              meta={data.meta}
            />
          )}

          {filteredContracts.length > 0 ? (
            <>
              <RawFeed contracts={filteredContracts} meta={data.meta} />

              {filteredContracts.map((contract, i) => (
                <ContractCard
                  key={`${contract.symbol}-${i}`}
                  contract={contract}
                  dataSource={contractDataSource(contract, data.meta)}
                />
              ))}
            </>
          ) : (
            <div className="text-center py-12 text-gray-500 dark:text-zinc-400">
              No contracts match the current filters.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
