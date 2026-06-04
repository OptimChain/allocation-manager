import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Plug, X, Plus, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import {
  getTwelveDataSocket,
  TwelveDataSocket,
  PriceEvent,
  WsStatus,
} from '../services/twelveDataWebSocket';
import {
  AlphaSignals,
  Bar,
  BarAggregator,
  EMPTY_SIGNALS,
  computeAlphas,
  crossSectionalRank,
} from '../services/alphaCalculator';

// ── Alpha equations sourced from alpha_ideas.md ──────────────────────────────
//
// Each equation is rendered through the regex grammar below. The regex itself
// is also shown on the page so the formula language is self-documenting.

const ALPHA_GRAMMAR =
  /(ts_delta|ts_delay|ts_sum|ts_mean|ts_corr|ts_zscore|ts_rank|rank|sign|abs)\(([^)]+)\)/g;

const ALPHA_DEFINITIONS: { id: keyof AlphaSignals | 'rankPriceChange' | 'pvInteraction'; name: string; expr: string; note: string }[] = [
  { id: 'meanReversion',   name: 'α₁ Mean Reversion',       expr: '-ts_delta(close, 5) / ts_delay(close, 5)',                                       note: 'Shorts recent price increases, expecting reversion.' },
  { id: 'deltaMomentum',   name: 'α₂ Delta Momentum',       expr: 'ts_delta(close, 5)',                                                              note: 'Short-term price change indicator.' },
  { id: 'vwapDeviation',   name: 'α₃ VWAP Deviation',       expr: '(high + low) / 2 - close',                                                        note: 'Captures deviation from session VWAP proxy.' },
  { id: 'volumeRatio',     name: 'α₄ Volume Ratio',         expr: 'volume / adv20',                                                                  note: 'Unusual trading activity vs. 20-bar avg.' },
  { id: 'pvInteraction',   name: 'α₅ Price-Volume',         expr: '-rank(ts_delta(close, 2)) * rank(volume / ts_sum(volume, 30) / 30)',              note: 'Mean reversion filtered by relative volume.' },
  { id: 'volAdjusted',     name: 'α₆ Vol-Adjusted',         expr: 'abs(ts_mean(close,20)/ts_mean(close,60)-1) * -sign(returns)',                      note: 'MA divergence scaled by return direction.' },
  { id: 'rankPriceChange', name: 'α₇ Ranked Price Change',  expr: '-rank(ts_delta(close, 1))',                                                        note: 'Cross-sectional reversion on bar-over-bar deltas.' },
  { id: 'closeOpenCorr',   name: 'α₈ Close-Open Corr',      expr: 'ts_corr(close, open, 10)',                                                         note: 'Open→close coupling over the last 10 bars.' },
];

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY'];

// ── Per-symbol streaming state ──────────────────────────────────────────────

interface SymbolState {
  lastPrice: number | null;
  lastTimestamp: number | null;
  bars: Bar[];
  signals: AlphaSignals;
  spark: number[];  // last ~60 closes for tiny sparkline
  ticks: number;
  flash: 'up' | 'down' | null;
}

const EMPTY_STATE: SymbolState = {
  lastPrice: null,
  lastTimestamp: null,
  bars: [],
  signals: EMPTY_SIGNALS,
  spark: [],
  ticks: 0,
  flash: null,
};

function statusBadge(status: WsStatus) {
  const map: Record<WsStatus, { label: string; cls: string; Icon: typeof Wifi }> = {
    idle:       { label: 'Idle',        cls: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400', Icon: WifiOff },
    connecting: { label: 'Connecting…', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', Icon: Activity },
    open:       { label: 'Live',        cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', Icon: Wifi },
    closed:     { label: 'Closed',      cls: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400', Icon: WifiOff },
    error:      { label: 'Error',       cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', Icon: AlertTriangle },
  };
  return map[status];
}

function fmtPrice(p: number | null): string {
  if (p === null || isNaN(p)) return '—';
  return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtSig(v: number | null, digits = 4): string {
  if (v === null || isNaN(v) || !isFinite(v)) return '—';
  return v.toFixed(digits);
}

// Highlight the alpha DSL expression using the published grammar regex.
function HighlightedExpr({ expr }: { expr: string }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  const regex = new RegExp(ALPHA_GRAMMAR.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(expr)) !== null) {
    if (match.index > cursor) {
      parts.push(<span key={`t-${cursor}`}>{expr.slice(cursor, match.index)}</span>);
    }
    parts.push(
      <span key={`f-${match.index}`} className="text-purple-600 dark:text-purple-300 font-semibold">
        {match[1]}
      </span>,
    );
    parts.push(<span key={`p-${match.index}`}>(</span>);
    parts.push(
      <span key={`a-${match.index}`} className="text-emerald-700 dark:text-emerald-300">
        {match[2]}
      </span>,
    );
    parts.push(<span key={`q-${match.index}`}>)</span>);
    cursor = match.index + match[0].length;
  }
  if (cursor < expr.length) parts.push(<span key={`t-end`}>{expr.slice(cursor)}</span>);
  return <code className="text-[13px] font-mono text-gray-700 dark:text-zinc-300">{parts}</code>;
}

function MiniSpark({ data }: { data: number[] }) {
  if (data.length < 2) {
    return <div className="h-7 w-24 text-[10px] text-gray-400 dark:text-zinc-600 italic">collecting…</div>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 96;
      const y = 28 - ((v - min) / range) * 24 - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = data[data.length - 1];
  const first = data[0];
  const stroke = last >= first ? '#10b981' : '#ef4444';
  return (
    <svg viewBox="0 0 96 28" className="h-7 w-24" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.25" />
    </svg>
  );
}

export default function LiveAlphas() {
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<WsStatus>('idle');
  const [statusInfo, setStatusInfo] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, SymbolState>>(() => {
    const init: Record<string, SymbolState> = {};
    DEFAULT_SYMBOLS.forEach((s) => (init[s] = EMPTY_STATE));
    return init;
  });
  const [missingKey, setMissingKey] = useState<string | null>(null);

  const socketRef = useRef<TwelveDataSocket | null>(null);
  const aggRef = useRef<Record<string, BarAggregator>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Initialize socket lazily so a missing key doesn't blow up the module.
  useEffect(() => {
    try {
      socketRef.current = getTwelveDataSocket();
    } catch (err) {
      setMissingKey((err as Error).message);
      return;
    }
    const sock = socketRef.current;
    const offStatus = sock.onStatus((s, info) => {
      setStatus(s);
      setStatusInfo(info ?? null);
    });
    const offPrice = sock.onPrice((evt: PriceEvent) => {
      setStates((prev) => {
        const cur = prev[evt.symbol] ?? EMPTY_STATE;
        if (!aggRef.current[evt.symbol]) aggRef.current[evt.symbol] = new BarAggregator(5);
        aggRef.current[evt.symbol].ingest({
          symbol: evt.symbol,
          timestamp: evt.timestamp,
          price: evt.price,
          dayVolume: evt.day_volume,
        });
        const bars = aggRef.current[evt.symbol].snapshot();
        const signals = computeAlphas(bars);
        const spark = bars.slice(-60).map((b) => b.close);
        const flash =
          cur.lastPrice === null ? null : evt.price > cur.lastPrice ? 'up' : evt.price < cur.lastPrice ? 'down' : cur.flash;

        if (flashTimers.current[evt.symbol]) clearTimeout(flashTimers.current[evt.symbol]);
        flashTimers.current[evt.symbol] = setTimeout(() => {
          setStates((p) => ({ ...p, [evt.symbol]: { ...(p[evt.symbol] ?? EMPTY_STATE), flash: null } }));
        }, 350);

        return {
          ...prev,
          [evt.symbol]: {
            lastPrice: evt.price,
            lastTimestamp: evt.timestamp,
            bars,
            signals,
            spark,
            ticks: cur.ticks + 1,
            flash,
          },
        };
      });
    });
    return () => {
      offStatus();
      offPrice();
      Object.values(flashTimers.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  // Cross-sectional ranks for α₅ and α₇ using the live universe.
  const ranks = useMemo(() => {
    const delta1: Record<string, number | null> = {};
    const delta2: Record<string, number | null> = {};
    const volRel: Record<string, number | null> = {};
    symbols.forEach((s) => {
      const sig = states[s]?.signals ?? EMPTY_SIGNALS;
      delta1[s] = sig.rankInputDelta1;
      delta2[s] = sig.rankInputDelta2;
      volRel[s] = sig.rankInputVolRel;
    });
    const r1 = crossSectionalRank(delta1);
    const r2 = crossSectionalRank(delta2);
    const rv = crossSectionalRank(volRel);
    const composed: Record<string, { rankPriceChange: number | null; pvInteraction: number | null }> = {};
    symbols.forEach((s) => {
      const a7 = r1[s] !== null ? -r1[s]! : null;
      const a5 = r2[s] !== null && rv[s] !== null ? -r2[s]! * rv[s]! : null;
      composed[s] = { rankPriceChange: a7, pvInteraction: a5 };
    });
    return composed;
  }, [states, symbols]);

  function connect() {
    socketRef.current?.connect();
    socketRef.current?.setSymbols(symbols);
  }
  function disconnect() {
    socketRef.current?.disconnect();
  }
  function addSymbol(raw: string) {
    const sym = raw.trim().toUpperCase();
    if (!sym || symbols.includes(sym)) return;
    const next = [...symbols, sym];
    setSymbols(next);
    setStates((p) => ({ ...p, [sym]: EMPTY_STATE }));
    if (status === 'open') socketRef.current?.subscribe([sym]);
  }
  function removeSymbol(sym: string) {
    const next = symbols.filter((s) => s !== sym);
    setSymbols(next);
    setStates((p) => {
      const { [sym]: _gone, ...rest } = p;
      return rest;
    });
    delete aggRef.current[sym];
    if (status === 'open') socketRef.current?.unsubscribe([sym]);
  }

  const badge = statusBadge(status);
  const StatusIcon = badge.Icon;

  return (
    <div className="space-y-6">
      {/* Header / connection controls */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Live Alpha Stream
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
              Streams real-time trades from the Twelve Data WebSocket and evaluates the
              price-volume alphas from{' '}
              <a
                href="https://github.com/jglazar/notes/blob/main/quant_interview/alpha_ideas.md"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700 dark:hover:text-zinc-200"
              >
                jglazar/quant_interview/alpha_ideas
              </a>
              {' '}on rolling 5-second bars.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium ${badge.cls}`}>
              <StatusIcon className="w-3.5 h-3.5" />
              {badge.label}
              {statusInfo && status === 'error' ? `: ${statusInfo}` : ''}
            </span>
            {status === 'open' || status === 'connecting' ? (
              <button
                onClick={disconnect}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-zinc-700 rounded text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-800"
              >
                <Plug className="w-3.5 h-3.5" />
                Disconnect
              </button>
            ) : (
              <button
                onClick={connect}
                disabled={!!missingKey}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded hover:bg-gray-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plug className="w-3.5 h-3.5" />
                Connect
              </button>
            )}
          </div>
        </div>

        {missingKey && (
          <div className="mt-3 p-2 text-xs rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-amber-700 dark:text-amber-300">
            {missingKey}. Set <code>VITE_TWELVE_DATA_API_KEY</code> in your env to enable streaming.
          </div>
        )}

        {/* Symbol chips + add */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {symbols.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 dark:bg-zinc-800 text-xs font-mono text-gray-700 dark:text-zinc-200"
            >
              {s}
              <button
                onClick={() => removeSymbol(s)}
                className="text-gray-400 hover:text-red-500"
                aria-label={`Remove ${s}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addSymbol(input);
              setInput('');
            }}
            className="flex items-center gap-1"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="add symbol…"
              className="px-2 py-1 text-xs font-mono border border-gray-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-950 text-gray-700 dark:text-zinc-200 w-28 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
            <button
              type="submit"
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-500 dark:text-zinc-400"
              aria-label="Add symbol"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>

      {/* Alpha equation panel — published DSL grammar + per-alpha formulas */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Alpha Grammar</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Each formula below is parsed and highlighted with this regular-expression
          equation, which captures the published DSL function calls used across the
          alpha catalog:
        </p>
        <pre className="bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 rounded px-3 py-2 text-[12px] font-mono overflow-x-auto text-gray-800 dark:text-zinc-200">
{`/(ts_delta|ts_delay|ts_sum|ts_mean|ts_corr|ts_zscore|ts_rank|rank|sign|abs)\\(([^)]+)\\)/g`}
        </pre>

        <div className="mt-4 grid gap-2">
          {ALPHA_DEFINITIONS.map((a) => (
            <div
              key={a.id}
              className="grid grid-cols-12 gap-2 items-start py-1.5 border-b border-gray-100 dark:border-zinc-800 last:border-b-0"
            >
              <div className="col-span-12 md:col-span-3 text-xs font-semibold text-gray-700 dark:text-zinc-200">
                {a.name}
              </div>
              <div className="col-span-12 md:col-span-5">
                <HighlightedExpr expr={a.expr} />
              </div>
              <div className="col-span-12 md:col-span-4 text-[11px] text-gray-500 dark:text-zinc-500">
                {a.note}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live alpha table */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Live Alpha Values</h3>
          <span className="text-[11px] text-gray-400 dark:text-zinc-500 font-mono">
            5s bars · {symbols.length} symbols · ranks computed cross-sectionally
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-zinc-950 text-gray-500 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Symbol</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-left font-medium">Trend</th>
                <th className="px-3 py-2 text-right font-medium" title="α₁">α₁ MR</th>
                <th className="px-3 py-2 text-right font-medium" title="α₂">α₂ Δ5</th>
                <th className="px-3 py-2 text-right font-medium" title="α₃">α₃ VWAPΔ</th>
                <th className="px-3 py-2 text-right font-medium" title="α₄">α₄ V/ADV</th>
                <th className="px-3 py-2 text-right font-medium" title="α₅">α₅ PV</th>
                <th className="px-3 py-2 text-right font-medium" title="α₆">α₆ VolAdj</th>
                <th className="px-3 py-2 text-right font-medium" title="α₇">α₇ -rank Δ</th>
                <th className="px-3 py-2 text-right font-medium" title="α₈">α₈ corr</th>
                <th className="px-3 py-2 text-right font-medium">Ticks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-mono">
              {symbols.map((sym) => {
                const st = states[sym] ?? EMPTY_STATE;
                const sig = st.signals;
                const r = ranks[sym] ?? { rankPriceChange: null, pvInteraction: null };
                const flashCls =
                  st.flash === 'up'
                    ? 'bg-green-50 dark:bg-green-900/20'
                    : st.flash === 'down'
                      ? 'bg-red-50 dark:bg-red-900/20'
                      : '';
                return (
                  <tr key={sym} className={`transition-colors ${flashCls}`}>
                    <td className="px-3 py-2 font-semibold text-gray-900 dark:text-white">{sym}</td>
                    <td className="px-3 py-2 text-right text-gray-800 dark:text-zinc-200">
                      {fmtPrice(st.lastPrice)}
                    </td>
                    <td className="px-3 py-2"><MiniSpark data={st.spark} /></td>
                    <td className="px-3 py-2 text-right">{fmtSig(sig.meanReversion, 6)}</td>
                    <td className="px-3 py-2 text-right">{fmtSig(sig.deltaMomentum, 4)}</td>
                    <td className="px-3 py-2 text-right">{fmtSig(sig.vwapDeviation, 4)}</td>
                    <td className="px-3 py-2 text-right">{fmtSig(sig.volumeRatio, 3)}</td>
                    <td className="px-3 py-2 text-right">{fmtSig(r.pvInteraction, 4)}</td>
                    <td className="px-3 py-2 text-right">{fmtSig(sig.volAdjusted, 6)}</td>
                    <td className="px-3 py-2 text-right">{fmtSig(r.rankPriceChange, 3)}</td>
                    <td className="px-3 py-2 text-right">{fmtSig(sig.closeOpenCorr, 3)}</td>
                    <td className="px-3 py-2 text-right text-gray-500 dark:text-zinc-500">{st.ticks}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-2 border-t border-gray-100 dark:border-zinc-800 text-[11px] text-gray-400 dark:text-zinc-500">
          Notes: α₁ requires ≥ 6 bars · α₆ requires ≥ 60 bars · α₈ requires ≥ 10 bars. Cross-sectional
          ranks are 0–1 percentiles across the live universe.
        </div>
      </div>
    </div>
  );
}
