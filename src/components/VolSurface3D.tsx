import { useMemo, useRef, useState, useCallback } from 'react';

/**
 * 3D implied-volatility surface.
 *
 * Renders an IV(strike, expiry) grid as a rotatable orthographic mesh in plain
 * SVG — no charting dependency. IV is encoded twice, as mesh height and as a
 * single-hue sequential ramp, which is the convention for surface plots and
 * lets the shape read even where the color is subtle.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VolSurfaceData {
  underlying: string;
  spot: number;
  strikes: number[];
  dtes: number[];
  /** iv[dteIndex][strikeIndex] as a decimal (0.58 = 58%). */
  iv: number[][];
}

export interface SurfaceMarker {
  label: string;
  strike: number;
  dte: number;
  iv: number;
  optionType: 'call' | 'put';
}

// ─── Palette ─────────────────────────────────────────────────────────────────
// Sequential = one hue, light→dark, anchor flipped in dark mode so the low end
// is always the step nearest the surface. Steps are the documented blue ramp,
// bounded at both ends so every cell of the mesh stays visible against its
// surface (the whole grid is one solid object — nothing may recede into it).

const RAMP_LIGHT = [
  '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6',
  '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
];

const RAMP_DARK = [
  '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5',
  '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6',
];

/** Chart chrome, matched to the app's cool-gray scale. */
const CHROME = {
  light: {
    surface: '#ffffff',
    grid: '#e5e7eb',
    axis: '#d1d5db',
    muted: '#9ca3af',
    secondary: '#6b7280',
    primary: '#111827',
  },
  dark: {
    surface: '#18181b',
    grid: '#27272a',
    axis: '#3f3f46',
    muted: '#71717a',
    secondary: '#a1a1aa',
    primary: '#f4f4f5',
  },
} as const;

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Piecewise-linear interpolation across the ramp's documented steps. */
function rampColor(t: number, ramp: string[]): string {
  const clamped = Math.min(1, Math.max(0, t));
  const pos = clamped * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  const f = pos - i;
  const [r1, g1, b1] = hexToRgb(ramp[i]);
  const [r2, g2, b2] = hexToRgb(ramp[i + 1]);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

// ─── Projection ──────────────────────────────────────────────────────────────
// Orthographic: yaw about the vertical axis, then a fixed foreshortening of the
// depth axis by sin(pitch). The viewBox is sized for the worst-case rotation so
// the plot never rescales while the reader is dragging it.

const X_SCALE = 165;
const Y_SCALE = 165;
const Z_SCALE = 115;
export const PITCH_MIN = 0.35;
export const PITCH_MAX = 0.7;

/**
 * Floor-unit offsets for the tick labels, and for the axis names beyond them.
 * Each name is placed colinear with its own row of ticks and past the last one,
 * rather than further out perpendicular — at yaws where an axis projects almost
 * vertically, "further out" lands the name in the middle of its own ticks.
 */
const TICK_RADIUS = 1.15;
const DTE_TICK_X = TICK_RADIUS + 0.05;
const NAME_OFFSET = 0.55;

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Projected {
  x: number;
  y: number;
  depth: number;
}

function project(x: number, y: number, z: number, yaw: number, pitch: number): Projected {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const xr = x * cos - y * sin;
  const yr = x * sin + y * cos;
  return {
    x: xr * X_SCALE,
    y: -yr * Math.sin(pitch) * Y_SCALE - z * Z_SCALE,
    depth: yr,
  };
}

export function clampPitch(p: number): number {
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));
}

/** Yaw range the reader can reach. Beyond it the axis labels read backwards. */
export const YAW_MIN = -1.5;
export const YAW_MAX = 0.4;

export function clampYaw(y: number): number {
  return Math.min(YAW_MAX, Math.max(YAW_MIN, y));
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const EMPTY: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };

/** Screen-space extent of everything one surface draws at a given angle. */
function contentBounds(s: VolSurfaceData, yaw: number, pitch: number, into: Bounds): Bounds {
  const flat = s.iv.flat();
  const lo = Math.min(...flat);
  const span = Math.max(...flat) - lo || 1;
  const nx = s.strikes.length;
  const ny = s.dtes.length;
  const gx = (i: number) => (nx === 1 ? 0 : (i / (nx - 1)) * 2 - 1);
  const gy = (j: number) => (ny === 1 ? 0 : (j / (ny - 1)) * 2 - 1);

  const see = (pt: Projected) => {
    if (pt.x < into.minX) into.minX = pt.x;
    if (pt.x > into.maxX) into.maxX = pt.x;
    if (pt.y < into.minY) into.minY = pt.y;
    if (pt.y > into.maxY) into.maxY = pt.y;
  };

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      see(project(gx(i), gy(j), (s.iv[j][i] - lo) / span, yaw, pitch));
    }
  }
  for (let i = 0; i < nx; i++) see(project(gx(i), -TICK_RADIUS, 0, yaw, pitch));
  for (let j = 0; j < ny; j++) see(project(DTE_TICK_X, gy(j), 0, yaw, pitch));
  see(project(-1 - NAME_OFFSET, -TICK_RADIUS, 0, yaw, pitch));
  see(project(DTE_TICK_X, 1 + NAME_OFFSET, 0, yaw, pitch));
  return into;
}

// Room for text that hangs off its anchor: tick labels either side, and the
// marker callouts that sit above the mesh.
const PAD_X = 36;
const PAD_Y = 26;

/**
 * The fixed size of the plotting box, big enough to hold every surface on
 * screen at every angle the reader can reach.
 *
 * Size and position are computed separately on purpose. Holding the size
 * constant keeps the scale identical across the small multiples and stops the
 * cards from resizing mid-drag; `viewBoxAt` then re-centres the content inside
 * that box per angle, so the slack never piles up as empty sky above the
 * surface.
 */
export function computeViewExtent(surfaces: VolSurfaceData[]): { w: number; h: number } {
  const YAW_SAMPLES = 24;
  const PITCH_SAMPLES = [PITCH_MIN, (PITCH_MIN + PITCH_MAX) / 2, PITCH_MAX];
  let w = 0;
  let h = 0;

  for (let k = 0; k < YAW_SAMPLES; k++) {
    const yaw = YAW_MIN + ((YAW_MAX - YAW_MIN) * k) / (YAW_SAMPLES - 1);
    for (const pitch of PITCH_SAMPLES) {
      const b = { ...EMPTY };
      for (const s of surfaces) contentBounds(s, yaw, pitch, b);
      w = Math.max(w, b.maxX - b.minX);
      h = Math.max(h, b.maxY - b.minY);
    }
  }
  return { w: w + PAD_X * 2, h: h + PAD_Y * 2 };
}

/** Place the fixed-size box so the current view sits centred in it. */
export function viewBoxAt(
  surfaces: VolSurfaceData[],
  yaw: number,
  pitch: number,
  extent: { w: number; h: number },
): ViewBox {
  const b = { ...EMPTY };
  for (const s of surfaces) contentBounds(s, yaw, pitch, b);
  return {
    x: (b.minX + b.maxX) / 2 - extent.w / 2,
    y: (b.minY + b.maxY) / 2 - extent.h / 2,
    w: extent.w,
    h: extent.h,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const pct = (iv: number, decimals = 1) => `${(iv * 100).toFixed(decimals)}%`;

function strikeLabel(strike: number): string {
  if (strike >= 10000) return `${(strike / 1000).toFixed(0)}k`;
  return Number.isInteger(strike) ? String(strike) : strike.toFixed(2);
}

/** Fractional index of `value` within a sorted ascending grid. */
function fractionalIndex(grid: number[], value: number): number | null {
  if (grid.length === 0) return null;
  if (value <= grid[0]) return value === grid[0] ? 0 : null;
  if (value >= grid[grid.length - 1]) return value === grid[grid.length - 1] ? grid.length - 1 : null;
  for (let i = 0; i < grid.length - 1; i++) {
    if (value >= grid[i] && value <= grid[i + 1]) {
      const span = grid[i + 1] - grid[i];
      return span === 0 ? i : i + (value - grid[i]) / span;
    }
  }
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface HoverCell {
  strikeLo: number;
  strikeHi: number;
  dte: number;
  iv: number;
  px: number;
  py: number;
}

interface Props {
  surface: VolSurfaceData;
  viewBox: ViewBox;
  markers?: SurfaceMarker[];
  yaw: number;
  pitch: number;
  isDark: boolean;
  onRotate: (next: { yaw: number; pitch: number }) => void;
}

export default function VolSurface3D({
  surface,
  viewBox,
  markers = [],
  yaw,
  pitch,
  isDark,
  onRotate,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<HoverCell | null>(null);

  const ink = isDark ? CHROME.dark : CHROME.light;
  const ramp = isDark ? RAMP_DARK : RAMP_LIGHT;

  // A surface-colored halo behind axis text. Labels sit outside the mesh
  // footprint but the surface silhouette can still pass behind them at some
  // rotations, and a tick nobody can read is worse than one drawn out of depth.
  const halo: React.CSSProperties = {
    paintOrder: 'stroke',
    stroke: ink.surface,
    strokeWidth: 3,
    strokeLinejoin: 'round',
  };

  const { strikes, dtes, iv } = surface;
  const nx = strikes.length;
  const ny = dtes.length;

  const { ivMin, ivMax } = useMemo(() => {
    const flat = iv.flat();
    return { ivMin: Math.min(...flat), ivMax: Math.max(...flat) };
  }, [iv]);

  const ivSpan = ivMax - ivMin || 1;
  const norm = useCallback((v: number) => (v - ivMin) / ivSpan, [ivMin, ivSpan]);

  // Grid coordinates normalised to [-1, 1] on both floor axes.
  const gx = useCallback((i: number) => (nx === 1 ? 0 : (i / (nx - 1)) * 2 - 1), [nx]);
  const gy = useCallback((j: number) => (ny === 1 ? 0 : (j / (ny - 1)) * 2 - 1), [ny]);

  const p = useCallback(
    (x: number, y: number, z: number) => project(x, y, z, yaw, pitch),
    [yaw, pitch],
  );

  /** Mesh cells, sorted far-to-near so nearer cells paint over farther ones. */
  const cells = useMemo(() => {
    const out: {
      key: string;
      d: string;
      fill: string;
      depth: number;
      strikeLo: number;
      strikeHi: number;
      dte: number;
      iv: number;
    }[] = [];

    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const corners: [number, number][] = [
          [i, j],
          [i + 1, j],
          [i + 1, j + 1],
          [i, j + 1],
        ];
        const pts = corners.map(([ci, cj]) => project(gx(ci), gy(cj), norm(iv[cj][ci]), yaw, pitch));
        const mean = corners.reduce((s, [ci, cj]) => s + iv[cj][ci], 0) / 4;
        out.push({
          key: `${i}-${j}`,
          d: `M ${pts.map((q) => `${q.x.toFixed(2)} ${q.y.toFixed(2)}`).join(' L ')} Z`,
          fill: rampColor(norm(mean), ramp),
          depth: pts.reduce((s, q) => s + q.depth, 0) / 4,
          strikeLo: strikes[i],
          strikeHi: strikes[i + 1],
          dte: dtes[j],
          iv: mean,
        });
      }
    }
    return out.sort((a, b) => b.depth - a.depth);
  }, [nx, ny, iv, strikes, dtes, gx, gy, norm, ramp, yaw, pitch]);

  /** Floor gridlines at z = 0. */
  const floor = useMemo(() => {
    const lines: string[] = [];
    for (let i = 0; i < nx; i++) {
      const a = p(gx(i), -1, 0);
      const b = p(gx(i), 1, 0);
      lines.push(`M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
    }
    for (let j = 0; j < ny; j++) {
      const a = p(-1, gy(j), 0);
      const b = p(1, gy(j), 0);
      lines.push(`M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`);
    }
    return lines.join(' ');
  }, [nx, ny, gx, gy, p]);

  /** Mesh wireframe, drawn over the fills so the strike/expiry grid stays readable. */
  const wire = useMemo(() => {
    const lines: string[] = [];
    for (let j = 0; j < ny; j++) {
      const row = strikes
        .map((_, i) => p(gx(i), gy(j), norm(iv[j][i])))
        .map((q) => `${q.x.toFixed(2)} ${q.y.toFixed(2)}`);
      lines.push(`M ${row.join(' L ')}`);
    }
    for (let i = 0; i < nx; i++) {
      const col = dtes
        .map((_, j) => p(gx(i), gy(j), norm(iv[j][i])))
        .map((q) => `${q.x.toFixed(2)} ${q.y.toFixed(2)}`);
      lines.push(`M ${col.join(' L ')}`);
    }
    return lines.join(' ');
  }, [nx, ny, strikes, dtes, iv, gx, gy, norm, p]);

  /** Markers for contracts actually held, interpolated onto the mesh. */
  const placed = useMemo(() => {
    return markers
      .map((m) => {
        const fi = fractionalIndex(strikes, m.strike);
        const fj = fractionalIndex(dtes, m.dte);
        if (fi === null || fj === null) return null;
        const x = (fi / (nx - 1)) * 2 - 1;
        const y = (fj / (ny - 1)) * 2 - 1;
        const top = p(x, y, norm(m.iv));
        const foot = p(x, y, 0);
        return { marker: m, top, foot };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => b.top.depth - a.top.depth);
  }, [markers, strikes, dtes, nx, ny, norm, p]);

  // ─── Rotation ──────────────────────────────────────────────────────────────

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, yaw, pitch };
    setDragging(true);
    setHover(null);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const start = dragRef.current;
    if (!start) return;
    onRotate({
      yaw: clampYaw(start.yaw + (e.clientX - start.x) * 0.009),
      pitch: clampPitch(start.pitch - (e.clientY - start.y) * 0.006),
    });
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  const onCellEnter = (cell: (typeof cells)[number], e: React.PointerEvent) => {
    if (dragRef.current) return;
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({
      strikeLo: cell.strikeLo,
      strikeHi: cell.strikeHi,
      dte: cell.dte,
      iv: cell.iv,
      px: e.clientX - box.left,
      py: e.clientY - box.top,
    });
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const meshOpacity = dragging ? 0.92 : 1;

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className={`w-full h-auto select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ touchAction: 'none' }}
        role="img"
        aria-label={`Implied volatility surface for ${surface.underlying}, ${pct(ivMin)} to ${pct(ivMax)} across ${strikes.length} strikes and ${dtes.length} expiries. Drag to rotate.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
      >
        {/* Floor grid */}
        <path d={floor} fill="none" stroke={ink.grid} strokeWidth={1} />

        {/* Mesh */}
        <g opacity={meshOpacity}>
          {cells.map((c) => (
            <path
              key={c.key}
              d={c.d}
              fill={c.fill}
              stroke={c.fill}
              strokeWidth={0.75}
              onPointerEnter={(e) => onCellEnter(c, e)}
            />
          ))}
        </g>
        <path
          d={wire}
          fill="none"
          stroke={isDark ? 'rgba(255,255,255,0.20)' : 'rgba(17,24,39,0.18)'}
          strokeWidth={1}
          strokeLinejoin="round"
          pointerEvents="none"
        />

        {/* Floor axis ticks */}
        {strikes.map((s, i) => {
          const q = p(gx(i), -TICK_RADIUS, 0);
          return (
            <text
              key={`sx-${s}`}
              x={q.x}
              y={q.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={13}
              fill={ink.muted}
              style={{ ...halo, fontVariantNumeric: 'tabular-nums' }}
            >
              {strikeLabel(s)}
            </text>
          );
        })}
        {dtes.map((d, j) => {
          const q = p(DTE_TICK_X, gy(j), 0);
          return (
            <text
              key={`dy-${d}`}
              x={q.x}
              y={q.y}
              textAnchor="start"
              dominantBaseline="middle"
              fontSize={13}
              fill={ink.muted}
              style={{ ...halo, fontVariantNumeric: 'tabular-nums' }}
            >
              {d}d
            </text>
          );
        })}

        {/* Axis names */}
        <text
          x={p(-1 - NAME_OFFSET, -TICK_RADIUS, 0).x}
          y={p(-1 - NAME_OFFSET, -TICK_RADIUS, 0).y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={13}
          fill={ink.secondary}
          style={halo}
        >
          Strike
        </text>
        <text
          x={p(DTE_TICK_X, 1 + NAME_OFFSET, 0).x}
          y={p(DTE_TICK_X, 1 + NAME_OFFSET, 0).y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={13}
          fill={ink.secondary}
          style={halo}
        >
          Expiry
        </text>
        {/* Held-position markers, drawn last so their callouts always read */}
        {placed.map(({ marker, top, foot }) => (
          <g key={marker.label} pointerEvents="none">
            <line
              x1={foot.x}
              y1={foot.y}
              x2={top.x}
              y2={top.y}
              stroke={ink.secondary}
              strokeWidth={1}
              opacity={0.55}
            />
            <circle cx={top.x} cy={top.y} r={7} fill={ink.surface} />
            <circle cx={top.x} cy={top.y} r={5} fill={ink.primary} />
            <text
              x={top.x}
              y={top.y - 14}
              textAnchor="middle"
              fontSize={13}
              fontWeight={600}
              fill={ink.primary}
              style={halo}
            >
              {marker.label}
            </text>
          </g>
        ))}

      </svg>

      {/* Hover tooltip — enhances; every value is also in the table view */}
      {hover && !dragging && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 shadow-lg"
          style={{
            left: Math.max(0, hover.px - 70),
            top: Math.max(0, hover.py - 76),
          }}
        >
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
            {pct(hover.iv)} IV
          </div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400 tabular-nums whitespace-nowrap">
            ${strikeLabel(hover.strikeLo)}–${strikeLabel(hover.strikeHi)} · {hover.dte}d
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Colorbar ────────────────────────────────────────────────────────────────

export function VolColorbar({
  min,
  max,
  isDark,
}: {
  min: number;
  max: number;
  isDark: boolean;
}) {
  const ramp = isDark ? RAMP_DARK : RAMP_LIGHT;
  const gradient = ramp
    .map((c, i) => `${c} ${((i / (ramp.length - 1)) * 100).toFixed(1)}%`)
    .join(', ');

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[10px] text-gray-400 dark:text-zinc-500">
        <span>Implied volatility</span>
        <span>encoded as height &amp; color</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 dark:text-zinc-500 tabular-nums">{pct(min, 0)}</span>
        <div
          className="h-2 flex-1 rounded-full"
          style={{ background: `linear-gradient(to right, ${gradient})` }}
        />
        <span className="text-xs text-gray-400 dark:text-zinc-500 tabular-nums">{pct(max, 0)}</span>
      </div>
    </div>
  );
}

// ─── Table view ──────────────────────────────────────────────────────────────

export function VolSurfaceTable({ surface }: { surface: VolSurfaceData }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs font-mono tabular-nums">
        <caption className="sr-only">
          Implied volatility for {surface.underlying} by strike and days to expiry
        </caption>
        <thead>
          <tr className="text-gray-400 dark:text-zinc-500 border-b border-gray-100 dark:border-zinc-800">
            <th scope="col" className="px-2 py-2 text-left font-medium">
              DTE
            </th>
            {surface.strikes.map((s) => (
              <th key={s} scope="col" className="px-3 py-2 text-right font-medium">
                {strikeLabel(s)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-zinc-800">
          {surface.dtes.map((d, j) => (
            <tr key={d} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
              <th scope="row" className="px-2 py-1.5 text-left font-semibold text-gray-900 dark:text-gray-100">
                {d}d
              </th>
              {surface.strikes.map((s, i) => (
                <td key={s} className="px-3 py-1.5 text-right text-gray-700 dark:text-gray-300">
                  {pct(surface.iv[j][i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
