// Online alpha calculator. Aggregates raw price ticks into uniform bars and
// evaluates a handful of price-volume alphas from
// https://github.com/jglazar/notes/blob/main/quant_interview/alpha_ideas.md
//
// Alphas implemented here (close-only, since the Twelve Data WS feed is trades):
//   α₁  meanReversion       = -ts_delta(close, 5) / ts_delay(close, 5)
//   α₂  deltaMomentum       =  ts_delta(close, 5)
//   α₃  vwapDeviation       =  (high + low) / 2 - close
//   α₄  volumeRatio         =  volume / adv20
//   α₅  pvInteraction       = -rank(ts_delta(close, 2)) * rank(volume / ts_sum(volume, 30) / 30)
//   α₆  volAdjusted         = |ts_mean(close,20)/ts_mean(close,60) - 1| * -sign(returns)
//   α₇  rankPriceChange     = -rank(ts_delta(close, 1))
//   α₈  closeOpenCorr       =  ts_corr(close, open, 10)
//
// Cross-sectional rank() needs the full universe; the calculator returns a
// per-symbol rank input and the page composes the rank across all symbols.

export interface PriceTick {
  symbol: string;
  timestamp: number; // unix seconds
  price: number;
  dayVolume?: number;
}

export interface Bar {
  timestamp: number; // unix seconds, bar-start
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AlphaSignals {
  meanReversion: number | null;
  deltaMomentum: number | null;
  vwapDeviation: number | null;
  volumeRatio: number | null;
  volAdjusted: number | null;
  closeOpenCorr: number | null;
  rankInputDelta1: number | null; // ts_delta(close, 1) — feeds α₇
  rankInputDelta2: number | null; // ts_delta(close, 2) — feeds α₅ first half
  rankInputVolRel: number | null; // volume / (ts_sum(volume,30)/30) — feeds α₅ second half
}

export const EMPTY_SIGNALS: AlphaSignals = {
  meanReversion: null,
  deltaMomentum: null,
  vwapDeviation: null,
  volumeRatio: null,
  volAdjusted: null,
  closeOpenCorr: null,
  rankInputDelta1: null,
  rankInputDelta2: null,
  rankInputVolRel: null,
};

const MAX_BARS = 120;

// Bucket ticks into uniform bars (default 5 seconds). Each bar tracks OHLC of
// trade prices and the per-bar volume delta inferred from cumulative day
// volume reported by Twelve Data.
export class BarAggregator {
  private bars: Bar[] = [];
  private current: Bar | null = null;
  private lastDayVolume: number | null = null;

  constructor(private bucketSeconds: number = 5) {}

  ingest(tick: PriceTick): Bar | null {
    const bucket = Math.floor(tick.timestamp / this.bucketSeconds) * this.bucketSeconds;
    const volumeDelta = this.computeVolumeDelta(tick.dayVolume);

    if (!this.current || this.current.timestamp !== bucket) {
      const closed = this.current;
      if (closed) {
        this.bars.push(closed);
        if (this.bars.length > MAX_BARS) this.bars.shift();
      }
      this.current = {
        timestamp: bucket,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: volumeDelta,
      };
      return closed;
    }

    this.current.high = Math.max(this.current.high, tick.price);
    this.current.low = Math.min(this.current.low, tick.price);
    this.current.close = tick.price;
    this.current.volume += volumeDelta;
    return null;
  }

  // Snapshot bars including the in-progress bar so the UI shows a live close.
  snapshot(): Bar[] {
    return this.current ? [...this.bars, this.current] : [...this.bars];
  }

  private computeVolumeDelta(dayVolume: number | undefined): number {
    if (dayVolume === undefined || dayVolume === null || isNaN(dayVolume)) return 0;
    if (this.lastDayVolume === null) {
      this.lastDayVolume = dayVolume;
      return 0;
    }
    // Cumulative day volume resets overnight; treat decreases as session reset.
    const delta = dayVolume - this.lastDayVolume;
    this.lastDayVolume = dayVolume;
    return delta > 0 ? delta : 0;
  }
}

// ── Time-series primitives over a bar history ────────────────────────────

function tsDelta(values: number[], n: number): number | null {
  if (values.length < n + 1) return null;
  const cur = values[values.length - 1];
  const prev = values[values.length - 1 - n];
  return cur - prev;
}

function tsDelay(values: number[], n: number): number | null {
  if (values.length < n + 1) return null;
  return values[values.length - 1 - n];
}

function tsMean(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i += 1) sum += values[i];
  return sum / n;
}

function tsSum(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i += 1) sum += values[i];
  return sum;
}

function tsCorr(a: number[], b: number[], n: number): number | null {
  if (a.length < n || b.length < n) return null;
  const aw = a.slice(-n);
  const bw = b.slice(-n);
  const meanA = aw.reduce((s, v) => s + v, 0) / n;
  const meanB = bw.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = aw[i] - meanA;
    const db = bw[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den === 0) return null;
  return num / den;
}

export function computeAlphas(bars: Bar[]): AlphaSignals {
  if (bars.length < 2) return { ...EMPTY_SIGNALS };

  const closes = bars.map((b) => b.close);
  const opens = bars.map((b) => b.open);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  const lastClose = closes[closes.length - 1];
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const lastVolume = volumes[volumes.length - 1];

  const delta5 = tsDelta(closes, 5);
  const delay5 = tsDelay(closes, 5);
  const delta1 = tsDelta(closes, 1);
  const delta2 = tsDelta(closes, 2);

  const meanReversion =
    delta5 !== null && delay5 !== null && delay5 !== 0 ? -delta5 / delay5 : null;

  const deltaMomentum = delta5;

  const vwapDeviation = (lastHigh + lastLow) / 2 - lastClose;

  const adv20 = tsMean(volumes, 20);
  const volumeRatio = adv20 !== null && adv20 > 0 ? lastVolume / adv20 : null;

  const sum30 = tsSum(volumes, 30);
  const rankInputVolRel = sum30 !== null && sum30 > 0 ? lastVolume / (sum30 / 30) : null;

  const mean20 = tsMean(closes, 20);
  const mean60 = tsMean(closes, 60);
  let volAdjusted: number | null = null;
  if (mean20 !== null && mean60 !== null && mean60 !== 0 && delta1 !== null) {
    const signal = Math.abs(mean20 / mean60 - 1);
    const sign = delta1 > 0 ? 1 : delta1 < 0 ? -1 : 0;
    volAdjusted = -signal * sign;
  }

  const closeOpenCorr = tsCorr(closes, opens, 10);

  return {
    meanReversion,
    deltaMomentum,
    vwapDeviation,
    volumeRatio,
    volAdjusted,
    closeOpenCorr,
    rankInputDelta1: delta1,
    rankInputDelta2: delta2,
    rankInputVolRel,
  };
}

// Convert raw values to a cross-sectional percentile rank in [0,1]. Symbols
// without a value are skipped and receive null in the output.
export function crossSectionalRank(
  values: Record<string, number | null>,
): Record<string, number | null> {
  const entries = Object.entries(values).filter(
    (entry): entry is [string, number] => entry[1] !== null && !isNaN(entry[1] as number),
  );
  const n = entries.length;
  if (n <= 1) {
    const out: Record<string, number | null> = {};
    Object.keys(values).forEach((k) => {
      out[k] = n === 1 && values[k] !== null ? 0.5 : null;
    });
    return out;
  }
  const sorted = [...entries].sort((a, b) => a[1] - b[1]);
  const ranks = new Map<string, number>();
  sorted.forEach(([sym], idx) => ranks.set(sym, idx / (n - 1)));
  const out: Record<string, number | null> = {};
  Object.keys(values).forEach((k) => {
    out[k] = ranks.has(k) ? (ranks.get(k) as number) : null;
  });
  return out;
}
