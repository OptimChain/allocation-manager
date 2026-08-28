import { useMemo, useState } from 'react';
import { Box, RotateCcw } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import VolSurface3D, {
  VolColorbar,
  VolSurfaceTable,
  clampPitch,
  clampYaw,
  computeViewExtent,
  viewBoxAt,
  type VolSurfaceData,
  type SurfaceMarker,
} from './VolSurface3D';

export interface VolSurfaceSymbolMeta {
  source: 'mock' | 'blob' | 'alpaca' | 'chain';
  fallback?: boolean;
  requested?: string;
  blobKey?: string;
  timestamp?: string;
  quoteCount?: number;
}

export interface MarketDepthMeta {
  volSurfaceSource: 'mock' | 'blob' | 'alpaca' | 'auto' | 'mixed';
  configuredSource?: string;
  symbols?: string[];
  perSymbol?: Record<string, VolSurfaceSymbolMeta>;
  contractSource?: string;
  contractCount?: number;
  liveContractCount?: number;
  mockSymbols?: string[];
}

interface ContractForMarkers {
  underlying: string;
  strike: number;
  dte: number;
  optionType: 'call' | 'put';
  greeks: { iv: number };
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n: number): string {
  return '$' + fmt(n);
}

const SOURCE_LABELS: Record<string, string> = {
  mock: 'Parametric',
  blob: 'Live · Blobs',
  alpaca: 'Live · Alpaca',
  auto: 'Live · Auto',
  mixed: 'Mixed',
  chain: 'Live · Chain',
};

function sourceBadgeClass(source: string): string {
  if (source === 'mock') {
    return 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
  }
  if (source === 'mixed') {
    return 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800';
  }
  return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
}

function VolSurfaceSourceBadge({ source }: { source: string }) {
  const label = SOURCE_LABELS[source] ?? source;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full border ${sourceBadgeClass(source)}`}>
      {label}
    </span>
  );
}

const DEFAULT_ANGLE = { yaw: -0.55, pitch: 0.55 };

export default function MarketDepthVolSection({
  surfaces,
  contracts,
  meta,
}: {
  surfaces: VolSurfaceData[];
  contracts: ContractForMarkers[];
  meta?: MarketDepthMeta;
}) {
  const { isDark } = useTheme();
  const [view, setView] = useState<'surface' | 'table'>('surface');
  const [angle, setAngle] = useState(DEFAULT_ANGLE);

  const extent = useMemo(() => computeViewExtent(surfaces), [surfaces]);
  const viewBox = useMemo(
    () => viewBoxAt(surfaces, angle.yaw, angle.pitch, extent),
    [surfaces, angle.yaw, angle.pitch, extent],
  );

  const markersFor = useMemo(() => {
    const byUnderlying = new Map<string, SurfaceMarker[]>();
    for (const c of contracts) {
      const list = byUnderlying.get(c.underlying) ?? [];
      list.push({
        label: `${fmt(c.strike, c.strike % 1 === 0 ? 0 : 2)}${c.optionType === 'call' ? 'C' : 'P'}`,
        strike: c.strike,
        dte: c.dte,
        iv: c.greeks.iv,
        optionType: c.optionType,
      });
      byUnderlying.set(c.underlying, list);
    }
    return byUnderlying;
  }, [contracts]);

  const isDefaultAngle =
    Math.abs(angle.yaw - DEFAULT_ANGLE.yaw) < 1e-6 && Math.abs(angle.pitch - DEFAULT_ANGLE.pitch) < 1e-6;

  const gridCols = surfaces.length <= 2
    ? 'grid-cols-1 lg:grid-cols-2'
    : 'grid-cols-1 lg:grid-cols-3';

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          <Box className="w-4 h-4" />
          Implied Volatility Surfaces
          {meta?.volSurfaceSource && (
            <VolSurfaceSourceBadge source={meta.volSurfaceSource} />
          )}
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {view === 'surface' && (
            <>
              <span className="hidden sm:inline text-xs text-gray-400 dark:text-zinc-500">
                Drag a surface to rotate all
              </span>
              <button
                onClick={() => setAngle(DEFAULT_ANGLE)}
                disabled={isDefaultAngle}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg text-gray-600 dark:text-zinc-300 bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 disabled:opacity-40"
              >
                <RotateCcw className="w-3 h-3" />
                Reset view
              </button>
            </>
          )}
          <div
            role="group"
            aria-label="Vol surface view"
            className="flex rounded-lg bg-gray-100 dark:bg-zinc-800 p-0.5"
          >
            {(['surface', 'table'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`px-2.5 py-1 text-xs rounded-md capitalize transition-colors ${
                  view === v
                    ? 'bg-white dark:bg-zinc-900 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`grid gap-4 ${view === 'surface' ? gridCols : 'grid-cols-1'}`}>
        {surfaces.map((s) => {
          const flat = s.iv.flat();
          const lo = Math.min(...flat);
          const hi = Math.max(...flat);
          const atmRow = s.dtes.indexOf(30) >= 0 ? s.dtes.indexOf(30) : 0;
          const atmCol = s.strikes.reduce(
            (best, k, i) => (Math.abs(k - s.spot) < Math.abs(s.strikes[best] - s.spot) ? i : best),
            0,
          );

          return (
            <div
              key={s.underlying}
              className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-gray-100 dark:border-zinc-800 flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {s.underlying}
                  </span>
                  <span className="ml-2 text-xs text-gray-400 dark:text-zinc-500">
                    spot {fmtCurrency(s.spot)}
                  </span>
                  {meta?.perSymbol?.[s.underlying] && (
                    <span className="ml-2">
                      <VolSurfaceSourceBadge source={meta.perSymbol[s.underlying].source} />
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {fmt(s.iv[atmRow][atmCol] * 100, 1)}%
                  </div>
                  <div className="text-[10px] text-gray-400 dark:text-zinc-500">
                    {s.dtes[atmRow]}d ATM
                  </div>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {view === 'surface' ? (
                  <>
                    <VolSurface3D
                      surface={s}
                      viewBox={viewBox}
                      markers={markersFor.get(s.underlying)}
                      yaw={angle.yaw}
                      pitch={angle.pitch}
                      isDark={isDark}
                      onRotate={(next) => setAngle({ yaw: clampYaw(next.yaw), pitch: clampPitch(next.pitch) })}
                    />
                    <VolColorbar min={lo} max={hi} isDark={isDark} />
                  </>
                ) : (
                  <VolSurfaceTable surface={s} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
