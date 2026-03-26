import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { RefreshCw, AlertTriangle, Radio } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import {
  listOptionSymbols,
  listOptionsChainDates,
  getOptionsChainByDate,
  getLatestOptionsChain,
  type OptionsChainBlob,
  type OptionSnapshot,
} from '../services/blobDataService';

// ── Types ─────────────────────────────────────────────────

interface ParsedContract {
  underlying: string;
  expiry: string;
  type: 'call' | 'put';
  strike: number;
}

interface ExpiryIV {
  expiry: string;
  dte: number;
  avgIV: number;
  atmIV: number | null;
  contractCount: number;
  putCount: number;
}

interface TermStructureSnapshot {
  date: string;
  timestamp: string;
  expiries: ExpiryIV[];
  isInverted: boolean;
  source: 'blob' | 'live';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface RobinhoodChainResponse {
  symbol: string;
  timestamp: string;
  expirationDates: string[];
  expiries: Array<{
    expiry: string;
    contracts: Array<{
      strike: number;
      expiry: string;
      type: string;
      iv: number;
      delta: number | null;
      mark: number | null;
      bid: number;
      ask: number;
      volume: number;
      openInterest: number;
    }>;
  }>;
  totalContracts: number;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type DataSource = 'blob' | 'live';

// ── Helpers ───────────────────────────────────────────────

function parseContractSymbol(sym: string): ParsedContract | null {
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

function daysBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** Extract term structure from a single options chain blob — puts only. */
function extractTermStructure(blob: OptionsChainBlob, snapshotDate: string): ExpiryIV[] {
  const chain = blob.latest_chain || {};

  const byExpiry = new Map<string, { ivs: number[]; strikes: number[] }>();

  for (const [key, val] of Object.entries(chain)) {
    if (key === '_meta') continue;
    const snap = val as OptionSnapshot;
    const parsed = parseContractSymbol(key);
    if (!parsed || parsed.type !== 'put') continue;
    if (snap.impliedVolatility == null || snap.impliedVolatility <= 0) continue;

    if (!byExpiry.has(parsed.expiry)) {
      byExpiry.set(parsed.expiry, { ivs: [], strikes: [] });
    }
    const group = byExpiry.get(parsed.expiry)!;
    group.ivs.push(snap.impliedVolatility * 100);
    group.strikes.push(parsed.strike);
  }

  const allStrikes: number[] = [];
  for (const [key, val] of Object.entries(chain)) {
    if (key === '_meta') continue;
    const snap = val as OptionSnapshot;
    const parsed = parseContractSymbol(key);
    if (!parsed) continue;
    if (snap.latestQuote && snap.latestQuote.bid > 0) {
      allStrikes.push(parsed.strike);
    }
  }
  allStrikes.sort((a, b) => a - b);
  const atmStrike = allStrikes.length > 0 ? allStrikes[Math.floor(allStrikes.length / 2)] : null;

  const result: ExpiryIV[] = [];
  for (const [expiry, group] of byExpiry) {
    const dte = daysBetween(snapshotDate, expiry);
    if (dte <= 0) continue;

    const avgIV = group.ivs.reduce((a, b) => a + b, 0) / group.ivs.length;

    let atmIV: number | null = null;
    if (atmStrike !== null) {
      let bestDist = Infinity;
      for (let i = 0; i < group.strikes.length; i++) {
        const dist = Math.abs(group.strikes[i] - atmStrike);
        if (dist < bestDist) {
          bestDist = dist;
          atmIV = group.ivs[i];
        }
      }
    }

    result.push({
      expiry,
      dte,
      avgIV: Math.round(avgIV * 10) / 10,
      atmIV: atmIV !== null ? Math.round(atmIV * 10) / 10 : null,
      contractCount: group.ivs.length,
      putCount: group.ivs.length,
    });
  }

  result.sort((a, b) => a.dte - b.dte);
  return result;
}

/** Extract term structure from live Robinhood chain response. */
function extractTermStructureLive(data: RobinhoodChainResponse): ExpiryIV[] {
  const today = new Date().toISOString().slice(0, 10);
  const result: ExpiryIV[] = [];

  for (const expiryGroup of data.expiries) {
    const contracts = expiryGroup.contracts;
    if (contracts.length === 0) continue;

    const dte = daysBetween(today, expiryGroup.expiry);
    if (dte <= 0) continue;

    const ivs = contracts.map((c) => c.iv * 100);
    const avgIV = ivs.reduce((a, b) => a + b, 0) / ivs.length;

    // Find ATM: contract with delta closest to -0.50
    let atmIV: number | null = null;
    let bestDist = Infinity;
    for (const c of contracts) {
      if (c.delta === null) continue;
      const dist = Math.abs(Math.abs(c.delta) - 0.5);
      if (dist < bestDist) {
        bestDist = dist;
        atmIV = c.iv * 100;
      }
    }

    result.push({
      expiry: expiryGroup.expiry,
      dte,
      avgIV: Math.round(avgIV * 10) / 10,
      atmIV: atmIV !== null ? Math.round(atmIV * 10) / 10 : null,
      contractCount: contracts.length,
      putCount: contracts.length,
    });
  }

  result.sort((a, b) => a.dte - b.dte);
  return result;
}

function checkInversion(expiries: ExpiryIV[]): boolean {
  if (expiries.length < 2) return false;
  const shortIV = expiries[0].atmIV ?? expiries[0].avgIV;
  const longIV = expiries[expiries.length - 1].atmIV ?? expiries[expiries.length - 1].avgIV;
  return shortIV > longIV;
}

async function fetchLiveChain(symbol: string): Promise<RobinhoodChainResponse> {
  const res = await fetch(
    `/.netlify/functions/robinhood-portfolio?action=chain&symbol=${encodeURIComponent(symbol)}&type=put`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as Record<string, string>).error || `Live chain fetch failed (${res.status})`,
    );
  }
  return res.json();
}

// Colors for overlaid snapshot lines
const SNAPSHOT_COLORS = [
  '#3b82f6', '#f97316', '#22c55e', '#a855f7',
  '#ef4444', '#06b6d4', '#eab308',
];

// Common symbols for live chain queries
const LIVE_SYMBOLS = ['IWN', 'IWM', 'SPY', 'QQQ', 'CRWD', 'AAPL', 'TSLA', 'NVDA'];

// ── Component ─────────────────────────────────────────────

export default function IVTermStructure() {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>('live');

  // Blob state
  const [blobSymbols, setBlobSymbols] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDates, setSelectedDates] = useState<string[]>([]);

  // Live state
  const [liveSymbol, setLiveSymbol] = useState<string>('IWN');
  const [customSymbol, setCustomSymbol] = useState<string>('');

  // Shared
  const [snapshots, setSnapshots] = useState<TermStructureSnapshot[]>([]);

  const chartHeight = 340;
  const axisColor = isDark ? '#a1a1aa' : '#a1a1aa';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';
  const tooltipStyle = {
    backgroundColor: isDark ? '#09090b' : '#ffffff',
    border: `1px solid ${isDark ? '#27272a' : '#e5e7eb'}`,
    borderRadius: '0.5rem',
    color: isDark ? '#ffffff' : '#111827',
  };

  // ── Blob: load symbols ──
  useEffect(() => {
    if (dataSource !== 'blob') return;
    let cancelled = false;
    async function load() {
      try {
        const syms = await listOptionSymbols();
        if (!cancelled && syms.length > 0) {
          setBlobSymbols(syms);
          setSelectedSymbol(syms[0]);
        }
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
  }, [dataSource]);

  // ── Blob: load dates ──
  useEffect(() => {
    if (dataSource !== 'blob' || !selectedSymbol) return;
    let cancelled = false;
    async function load() {
      try {
        const dates = await listOptionsChainDates(selectedSymbol);
        if (!cancelled) {
          setAvailableDates(dates);
          const autoSelect = dates.slice(0, Math.min(5, dates.length));
          setSelectedDates(autoSelect);
        }
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
  }, [dataSource, selectedSymbol]);

  // ── Blob: load snapshots ──
  useEffect(() => {
    if (dataSource !== 'blob' || !selectedSymbol || selectedDates.length === 0) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const results: TermStructureSnapshot[] = [];

        for (const date of selectedDates) {
          let blob: OptionsChainBlob | null;
          if (date === 'latest') {
            blob = await getLatestOptionsChain(selectedSymbol);
          } else {
            blob = await getOptionsChainByDate(selectedSymbol, date);
          }
          if (cancelled) return;
          if (!blob) continue;

          const snapshotDate = blob.timestamp.slice(0, 10);
          const expiries = extractTermStructure(blob, snapshotDate);
          if (expiries.length === 0) continue;

          results.push({
            date,
            timestamp: blob.timestamp,
            expiries,
            isInverted: checkInversion(expiries),
            source: 'blob',
          });
        }

        if (!cancelled) setSnapshots(results);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [dataSource, selectedSymbol, selectedDates]);

  // ── Live: fetch chain ──
  const fetchLive = useCallback(async (symbol: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLiveChain(symbol);
      const expiries = extractTermStructureLive(data);
      if (expiries.length === 0) {
        setError(`No put IV data returned for ${symbol}`);
        setSnapshots([]);
        return;
      }
      setSnapshots([{
        date: 'Live',
        timestamp: data.timestamp,
        expiries,
        isInverted: checkInversion(expiries),
        source: 'live',
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch live chain');
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dataSource !== 'live') return;
    fetchLive(liveSymbol);
  }, [dataSource, liveSymbol, fetchLive]);

  // Build chart data
  const chartData = useMemo(() => {
    if (snapshots.length === 0) return [];

    const dteSet = new Set<number>();
    for (const snap of snapshots) {
      for (const e of snap.expiries) dteSet.add(e.dte);
    }
    const dtes = Array.from(dteSet).sort((a, b) => a - b);

    return dtes.map((dte) => {
      const point: Record<string, number | string> = { dte, dteLabel: `${dte}d` };
      for (let i = 0; i < snapshots.length; i++) {
        const snap = snapshots[i];
        const match = snap.expiries.find((e) => e.dte === dte);
        if (match) {
          point[`iv_${i}`] = match.atmIV ?? match.avgIV;
          point[`avg_${i}`] = match.avgIV;
        }
      }
      return point;
    });
  }, [snapshots]);

  const invertedSnapshots = snapshots.filter((s) => s.isInverted);

  const toggleDate = (date: string) => {
    setSelectedDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    );
  };

  const handleCustomSymbol = () => {
    const sym = customSymbol.trim().toUpperCase();
    if (sym) {
      setLiveSymbol(sym);
      setCustomSymbol('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Data source toggle + controls */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-zinc-800 rounded-md p-0.5">
            <button
              onClick={() => setDataSource('live')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                dataSource === 'live'
                  ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Radio className="w-3 h-3 inline mr-1" />
              Live (Robinhood)
            </button>
            <button
              onClick={() => setDataSource('blob')}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                dataSource === 'blob'
                  ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              Historical Snapshots
            </button>
          </div>

          {dataSource === 'live' && (
            <div className="flex items-center gap-2 flex-wrap">
              {LIVE_SYMBOLS.map((sym) => (
                <button
                  key={sym}
                  onClick={() => setLiveSymbol(sym)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    liveSymbol === sym
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {sym}
                </button>
              ))}
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={customSymbol}
                  onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleCustomSymbol()}
                  placeholder="Other..."
                  className="px-2 py-1 w-20 bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded text-xs text-gray-900 dark:text-white"
                />
                <button
                  onClick={handleCustomSymbol}
                  className="px-2 py-1 bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-gray-300 rounded text-xs hover:bg-gray-300 dark:hover:bg-zinc-600"
                >
                  Go
                </button>
              </div>
              {loading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
            </div>
          )}

          {dataSource === 'blob' && (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Underlying</label>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-md text-sm text-gray-900 dark:text-white"
              >
                {blobSymbols.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              {loading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
            </div>
          )}
        </div>
      </div>

      {/* Blob: date multi-select */}
      {dataSource === 'blob' && (
        <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Compare Snapshots
          </h4>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            Select multiple dates to overlay term structure curves and spot shifts in IV across tenors.
          </p>
          <div className="flex flex-wrap gap-2">
            {availableDates.map((date, i) => (
              <button
                key={date}
                onClick={() => toggleDate(date)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  selectedDates.includes(date)
                    ? 'text-white'
                    : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-700'
                }`}
                style={
                  selectedDates.includes(date)
                    ? { backgroundColor: SNAPSHOT_COLORS[selectedDates.indexOf(date) % SNAPSHOT_COLORS.length] }
                    : undefined
                }
              >
                {date}
                {i === 0 && ' (latest)'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-4">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          {error.includes('authenticated') && (
            <p className="text-xs text-red-500 mt-1">
              Connect to Robinhood via the Trade tab first, or switch to Historical Snapshots.
            </p>
          )}
        </div>
      )}

      {/* Inversion Alert */}
      {invertedSnapshots.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Inverted Term Structure Detected
              </h4>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Near-term put IV exceeds longer-dated put IV
                {invertedSnapshots[0].source === 'blob' && (
                  <> on <strong>{invertedSnapshots.map((s) => s.date).join(', ')}</strong></>
                )}.
                This suggests elevated short-term fear — a calendar put spread
                (sell short-dated, buy long-dated) may capture the reversion.
              </p>
              <div className="mt-2 space-y-1">
                {invertedSnapshots.map((s) => {
                  const short = s.expiries[0];
                  const long = s.expiries[s.expiries.length - 1];
                  const shortIV = short.atmIV ?? short.avgIV;
                  const longIV = long.atmIV ?? long.avgIV;
                  return (
                    <p key={s.date} className="text-xs text-amber-600 dark:text-amber-500">
                      {s.source === 'live' ? `${liveSymbol}` : s.date}: {short.dte}d IV = {shortIV.toFixed(1)}% vs {long.dte}d IV = {longIV.toFixed(1)}%
                      {' '}(spread: {(shortIV - longIV).toFixed(1)}pp)
                    </p>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Term Structure Chart */}
      {!loading && (
        <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Put IV Term Structure
            {dataSource === 'live' && snapshots.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                {liveSymbol} — {snapshots[0].expiries.length} expiries, {new Date(snapshots[0].timestamp).toLocaleString()}
              </span>
            )}
          </h4>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
            ATM put implied volatility by days to expiration. Normal term structure slopes upward;
            inversion (downward slope) signals short-term stress.
          </p>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={chartHeight}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="dte"
                  tickFormatter={(v) => `${v}d`}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                  label={{ value: 'Days to Expiration', position: 'insideBottom', offset: -5, fontSize: 11, fill: axisColor }}
                />
                <YAxis
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 11, fill: axisColor }}
                  axisLine={{ stroke: gridColor }}
                  width={50}
                  domain={['auto', 'auto']}
                  label={{ value: 'IV (%)', angle: -90, position: 'insideLeft', fontSize: 11, fill: axisColor }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(dte) => `${dte} DTE`}
                  formatter={(value: number, name: string) => {
                    const idx = parseInt(name.split('_')[1]);
                    const snap = snapshots[idx];
                    const label = snap?.source === 'live' ? liveSymbol : snap?.date ?? name;
                    return [`${value.toFixed(1)}%`, label];
                  }}
                />
                {dataSource === 'blob' && (
                  <Legend
                    formatter={(value) => {
                      const idx = parseInt(value.split('_')[1]);
                      return snapshots[idx]?.date ?? value;
                    }}
                  />
                )}
                {snapshots.map((_, i) => (
                  <Line
                    key={i}
                    type="monotone"
                    dataKey={`iv_${i}`}
                    stroke={SNAPSHOT_COLORS[i % SNAPSHOT_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3, fill: SNAPSHOT_COLORS[i % SNAPSHOT_COLORS.length] }}
                    connectNulls
                    name={`iv_${i}`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500" style={{ height: chartHeight }}>
              {error ? 'No data — see error above' : 'No put IV data available'}
            </div>
          )}
        </div>
      )}

      {/* Detail Table */}
      {snapshots.length > 0 && snapshots.some((s) => s.expiries.length > 0) && (
        <div className="bg-white dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-900">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Term Structure Detail
              {dataSource === 'live' && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {snapshots.reduce((s, snap) => s + snap.expiries.reduce((t, e) => t + e.putCount, 0), 0)} contracts across {snapshots.reduce((s, snap) => s + snap.expiries.length, 0)} expiries
                </span>
              )}
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-zinc-900 text-gray-500 dark:text-gray-400">
                  {dataSource === 'blob' && <th className="px-3 py-2 text-left font-medium">Snapshot</th>}
                  <th className="px-3 py-2 text-left font-medium">Expiry</th>
                  <th className="px-3 py-2 text-right font-medium">DTE</th>
                  <th className="px-3 py-2 text-right font-medium">ATM IV</th>
                  <th className="px-3 py-2 text-right font-medium">Avg IV</th>
                  <th className="px-3 py-2 text-right font-medium">Puts</th>
                  <th className="px-3 py-2 text-center font-medium">Shape</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snap, si) => (
                  snap.expiries.map((exp, ei) => (
                    <tr
                      key={`${snap.date}-${exp.expiry}`}
                      className="border-b border-gray-50 dark:border-zinc-900/50 hover:bg-gray-50 dark:hover:bg-zinc-900/50"
                    >
                      {dataSource === 'blob' && ei === 0 ? (
                        <td
                          className="px-3 py-1.5 font-medium"
                          rowSpan={snap.expiries.length}
                          style={{ color: SNAPSHOT_COLORS[si % SNAPSHOT_COLORS.length] }}
                        >
                          {snap.date}
                          {snap.isInverted && (
                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                              INVERTED
                            </span>
                          )}
                        </td>
                      ) : dataSource === 'blob' && ei !== 0 ? null : null}
                      <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300">{exp.expiry}</td>
                      <td className="px-3 py-1.5 text-right text-gray-900 dark:text-white">{exp.dte}d</td>
                      <td className="px-3 py-1.5 text-right text-gray-900 dark:text-white font-medium">
                        {exp.atmIV !== null ? `${exp.atmIV.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-400">
                        {exp.avgIV.toFixed(1)}%
                      </td>
                      <td className="px-3 py-1.5 text-right text-gray-600 dark:text-gray-400">
                        {exp.putCount}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {ei === 0 && snap.expiries.length > 1 && (
                          <span className={`text-xs font-medium ${
                            snap.isInverted
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-green-600 dark:text-green-400'
                          }`}>
                            {snap.isInverted ? 'Backwardation' : 'Contango'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Methodology */}
      <div className="bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Strategy Notes</h4>
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <p><strong>Inverted term structure</strong> = near-term put IV &gt; longer-dated put IV. This is unusual and typically signals near-term fear or event risk (earnings, FOMC, etc.).</p>
          <p><strong>Calendar put spread opportunity:</strong> When the curve is inverted, sell the expensive short-dated puts and buy the cheaper long-dated puts. You profit as short-dated IV mean-reverts down faster than long-dated IV.</p>
          <p><strong>ATM IV</strong> — Live mode uses the put with delta closest to -0.50. Historical mode uses the put closest to the median traded strike.</p>
          <p><strong>Data sources:</strong> Live pulls all expiry dates from Robinhood options chain API. Historical uses Alpaca snapshots (2 expiries per blob) via Netlify Blobs.</p>
        </div>
      </div>
    </div>
  );
}
