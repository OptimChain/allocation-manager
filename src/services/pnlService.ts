// P&L engine — average-open-price (avg-cost) method.
//
// Port of btc_pnl_calc.py: replays a fill stream trade by trade, blending
// buys into an average open price and realizing P&L on reducing trades
// against that average. Handles longs and shorts symmetrically, including
// close-and-open (a trade larger than the open position flips it and
// re-opens at the traded price).
//
// Pure module — no I/O. Used by the btc-pnl Netlify function and available
// to frontend components that want to compute P&L client-side from fills.
//
// Methodology reference: BTC_PNL_METHODOLOGY.md in the apollo workspace.

export interface Fill {
  /** ISO timestamp of the fill (order created_at). */
  t: string;
  side: 'BUY' | 'SELL';
  /** Shares filled (positive). */
  qty: number;
  /** Per-share fill price (order average_price). */
  px: number;
}

export interface PnlState {
  netPosition: number;
  avgOpenPrice: number;
  /** Peak open cost over the life of the stream. */
  netInvestment: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
}

export interface PnlSummary extends PnlState {
  fills: number;
  firstFill: string | null;
  lastFill: string | null;
  boughtQty: number;
  soldQty: number;
  buyNotional: number;
  sellNotional: number;
  openCost: number;
  mark: number;
  crossChecks: {
    /** netPosition must equal boughtQty - soldQty. */
    position: boolean;
    /** realized must equal sellNotional - (buyNotional - openCost). */
    realized: boolean;
    closedFormRealized: number;
  };
}

export interface LotWindow {
  start: string;
  end: string;
  fills: number;
  boughtQty: number;
  soldQty: number;
  realizedPnl: number;
  endPosition: number;
  endAvgOpenPrice: number;
}

export class PnlCalculator {
  netPosition = 0;
  avgOpenPrice = 0;
  netInvestment = 0;
  realizedPnl = 0;
  unrealizedPnl = 0;
  totalPnl = 0;

  /** Apply one fill to the running position. */
  updateByTradefeed(side: 'BUY' | 'SELL', tradedPrice: number, tradedQuantity: number): void {
    const qtyWithDirection = side === 'BUY' ? tradedQuantity : -tradedQuantity;
    const isStillOpen = this.netPosition * qtyWithDirection >= 0;
    this.netInvestment = Math.max(
      this.netInvestment,
      Math.abs(this.netPosition * this.avgOpenPrice),
    );
    if (!isStillOpen) {
      // Realize against the average, capped at the open position size,
      // signed by the side of the position being reduced.
      this.realizedPnl +=
        (tradedPrice - this.avgOpenPrice) *
        Math.min(Math.abs(qtyWithDirection), Math.abs(this.netPosition)) *
        (Math.abs(this.netPosition) / this.netPosition);
    }
    this.totalPnl = this.realizedPnl + this.unrealizedPnl;
    if (isStillOpen) {
      this.avgOpenPrice =
        (this.avgOpenPrice * this.netPosition + tradedPrice * qtyWithDirection) /
        (this.netPosition + qtyWithDirection);
    } else if (tradedQuantity > Math.abs(this.netPosition)) {
      // Close-and-open: the remainder opens at the traded price.
      this.avgOpenPrice = tradedPrice;
    }
    this.netPosition += qtyWithDirection;
  }

  /** Mark the open position and refresh total P&L. */
  updateByMarketdata(lastPrice: number): void {
    this.unrealizedPnl = (lastPrice - this.avgOpenPrice) * this.netPosition;
    this.totalPnl = this.realizedPnl + this.unrealizedPnl;
  }

  state(): PnlState {
    return {
      netPosition: this.netPosition,
      avgOpenPrice: this.avgOpenPrice,
      netInvestment: this.netInvestment,
      realizedPnl: this.realizedPnl,
      unrealizedPnl: this.unrealizedPnl,
      totalPnl: this.totalPnl,
    };
  }
}

function sortedByTime(fills: Fill[]): Fill[] {
  return [...fills].sort((a, b) => a.t.localeCompare(b.t));
}

/**
 * Replay all fills and mark at `mark`, returning totals plus the two
 * closed-form cross-checks that every run must satisfy.
 */
export function computeSummary(fills: Fill[], mark: number): PnlSummary {
  const ordered = sortedByTime(fills);
  const calc = new PnlCalculator();
  let boughtQty = 0;
  let soldQty = 0;
  let buyNotional = 0;
  let sellNotional = 0;
  for (const f of ordered) {
    calc.updateByTradefeed(f.side, f.px, f.qty);
    if (f.side === 'BUY') {
      boughtQty += f.qty;
      buyNotional += f.qty * f.px;
    } else {
      soldQty += f.qty;
      sellNotional += f.qty * f.px;
    }
  }
  calc.updateByMarketdata(mark);
  const openCost = calc.netPosition * calc.avgOpenPrice;
  const closedFormRealized = sellNotional - (buyNotional - openCost);
  return {
    ...calc.state(),
    fills: ordered.length,
    firstFill: ordered.length ? ordered[0].t : null,
    lastFill: ordered.length ? ordered[ordered.length - 1].t : null,
    boughtQty,
    soldQty,
    buyNotional,
    sellNotional,
    openCost,
    mark,
    crossChecks: {
      position: Math.abs(boughtQty - soldQty - calc.netPosition) < 1e-6,
      realized: Math.abs(closedFormRealized - calc.realizedPnl) < 0.01,
      closedFormRealized,
    },
  };
}

/**
 * Bucket realized P&L into fixed `days`-long windows anchored at the first
 * fill (not calendar months, not trailing windows). Every window size
 * reconciles to the same total realized P&L; only the split moves.
 * Empty windows are omitted.
 */
export function computeLots(fills: Fill[], days: number): LotWindow[] {
  const ordered = sortedByTime(fills);
  if (!ordered.length) return [];
  const calc = new PnlCalculator();
  const windowMs = days * 86_400_000;
  const t0 = new Date(ordered[0].t).getTime();
  const windows: LotWindow[] = [];
  let i = 0;
  let w = 0;
  while (i < ordered.length) {
    const start = t0 + w * windowMs;
    const end = start + windowMs;
    const realizedBefore = calc.realizedPnl;
    let n = 0;
    let boughtQty = 0;
    let soldQty = 0;
    while (i < ordered.length && new Date(ordered[i].t).getTime() < end) {
      const f = ordered[i];
      calc.updateByTradefeed(f.side, f.px, f.qty);
      n += 1;
      if (f.side === 'BUY') boughtQty += f.qty;
      else soldQty += f.qty;
      i += 1;
    }
    if (n > 0) {
      windows.push({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        fills: n,
        boughtQty,
        soldQty,
        realizedPnl: calc.realizedPnl - realizedBefore,
        endPosition: calc.netPosition,
        endAvgOpenPrice: calc.avgOpenPrice,
      });
    }
    w += 1;
  }
  return windows;
}
