/** Bounce-sleeve + held-call overlays for the volatility-puts price chart. */

export type TargetKind = 'held' | 'proposed' | 'stop' | 'breakeven' | 'sit' | 'spread';

export interface OverlayTarget {
  id: string;
  symbol: string;
  price: number | null;
  label: string;
  kind: TargetKind;
  detail?: string;
}

export interface HeldOption {
  symbol: string;
  strike: number;
  right: 'call' | 'put';
  expiry: string;
  quantity: number;
  avg?: number;
}

export interface ProposedTicket {
  symbol: string;
  action: 'sit' | 'place';
  strike?: number;
  right?: 'call' | 'put';
  expiry?: string;
  limit?: number;
  contracts?: number;
}

export interface SpreadTicket {
  symbol: string;
  expiry: string;
  longStrike: number;
  shortStrike: number;
  right: 'call' | 'put';
  debit: number;
  contracts: number;
  asOf: string;
}

/** Live RH book as of the weekend of 17–18 Oct 2026. */
export const HELD_DEFAULTS: HeldOption[] = [
  { symbol: 'NBIS', strike: 230, right: 'call', expiry: '2026-11-20', quantity: 4, avg: 6.45 },
  { symbol: 'NBIS', strike: 220, right: 'call', expiry: '2026-11-27', quantity: 2, avg: 9.85 },
];

/** Session fence rh:{SYM}:2026-10-19:option_buy. Recipes, not OCC on the bus. */
export const BOUNCE_TICKETS: ProposedTicket[] = [
  { symbol: 'NBIS', action: 'sit' },
  { symbol: 'MU', action: 'place', strike: 1050, right: 'call', expiry: '2026-11-20', limit: 20.65, contracts: 1 },
  { symbol: 'AVGO', action: 'place', strike: 380, right: 'call', expiry: '2026-11-20', limit: 5.5, contracts: 1 },
  { symbol: 'NET', action: 'place', strike: 370, right: 'call', expiry: '2026-11-20', limit: 10.75, contracts: 1 },
];

function tickFloor(px: number): number {
  const tick = px >= 3 ? 0.05 : 0.01;
  return Math.floor(px / tick + 1e-9) * tick;
}

/** Bid-side debit: tick-floor(0.98 × (long last − short last)). Both legs need vol ≥ 50. */
export function spreadDebit(longLast: number, shortLast: number): number {
  return Math.round(tickFloor(0.98 * (longLast - shortLast)) * 100) / 100;
}

/**
 * Call debit verticals. MU/AVGO last from Friday 16 Oct ChartExchange (same book as the
 * naked 0.22Δ tickets). SMCI last from Nasdaq 19 Oct. NET 400C vol 36 — no spread.
 */
export const SPREAD_TICKETS: SpreadTicket[] = [
  {
    symbol: 'MU',
    expiry: '2026-11-20',
    longStrike: 1050,
    shortStrike: 1100,
    right: 'call',
    debit: spreadDebit(21.12, 13.25),
    contracts: 1,
    asOf: '2026-10-16',
  },
  {
    symbol: 'AVGO',
    expiry: '2026-11-20',
    longStrike: 380,
    shortStrike: 400,
    right: 'call',
    debit: spreadDebit(5.64, 2.82),
    contracts: 1,
    asOf: '2026-10-16',
  },
  {
    symbol: 'SMCI',
    expiry: '2026-11-20',
    longStrike: 38,
    shortStrike: 40,
    right: 'call',
    debit: spreadDebit(1.33, 0.97),
    contracts: 1,
    asOf: '2026-10-19',
  },
];

export const OVERLAY_SYMBOLS = [
  ...new Set([
    ...BOUNCE_TICKETS.filter((t) => t.action === 'place').map((t) => t.symbol),
    ...SPREAD_TICKETS.map((t) => t.symbol),
  ]),
];

function occRight(right: string): string {
  return right === 'put' ? 'P' : 'C';
}

function shortExpiry(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function occLabel(strike: number, right: string): string {
  return `${strike}${occRight(right)}`;
}

export function overlayTargets({
  symbol,
  stopPrice,
  held = HELD_DEFAULTS,
  proposed = BOUNCE_TICKETS,
  spreads = SPREAD_TICKETS,
}: {
  symbol: string;
  stopPrice?: number | null;
  held?: HeldOption[];
  proposed?: ProposedTicket[];
  spreads?: SpreadTicket[];
}): OverlayTarget[] {
  const sym = symbol.toUpperCase();
  const rows: OverlayTarget[] = [];

  if (stopPrice != null && stopPrice > 0) {
    rows.push({
      id: `${sym}-stop`,
      symbol: sym,
      price: stopPrice,
      label: 'trail stop',
      kind: 'stop',
    });
  }

  const ticket = proposed.find((p) => p.symbol.toUpperCase() === sym);
  if (ticket?.action === 'sit') {
    rows.push({
      id: `${sym}-sit`,
      symbol: sym,
      price: null,
      label: 'sit',
      kind: 'sit',
      detail: 'already long 6 calls',
    });
  } else if (ticket?.action === 'place' && ticket.strike != null && ticket.right) {
    rows.push({
      id: `${sym}-proposed-${ticket.strike}`,
      symbol: sym,
      price: ticket.strike,
      label: `${occLabel(ticket.strike, ticket.right)} proposed`,
      kind: 'proposed',
      detail: ticket.expiry
        ? `${shortExpiry(ticket.expiry)} · limit ${ticket.limit?.toFixed(2)}`
        : undefined,
    });
  }

  for (const sp of spreads) {
    if (sp.symbol.toUpperCase() !== sym) continue;
    const shortOcc = occLabel(sp.shortStrike, sp.right);
    const pair = `${sp.longStrike}/${sp.shortStrike}${occRight(sp.right)}`;
    rows.push({
      id: `${sym}-spread-${sp.longStrike}-${sp.shortStrike}`,
      symbol: sym,
      price: sp.longStrike,
      label: `${pair}`,
      kind: 'spread',
      detail: `${shortExpiry(sp.expiry)} · debit ${sp.debit.toFixed(2)}`,
    });
    rows.push({
      id: `${sym}-spread-short-${sp.shortStrike}`,
      symbol: sym,
      price: sp.shortStrike,
      label: `${shortOcc} short`,
      kind: 'spread',
      detail: `short ${shortOcc}`,
    });
    rows.push({
      id: `${sym}-spread-be-${sp.longStrike}-${sp.shortStrike}`,
      symbol: sym,
      price: sp.longStrike + sp.debit,
      label: `${pair} BE`,
      kind: 'breakeven',
      detail: `${pair} BE`,
    });
  }

  for (const opt of held) {
    if (opt.symbol.toUpperCase() !== sym) continue;
    const occ = occLabel(opt.strike, opt.right);
    rows.push({
      id: `${sym}-held-${opt.expiry}-${opt.strike}`,
      symbol: sym,
      price: opt.strike,
      label: `${occ} ×${opt.quantity}`,
      kind: 'held',
      detail: `${shortExpiry(opt.expiry)} ${occ} ×${opt.quantity}`,
    });
    if (opt.avg != null && opt.avg > 0) {
      rows.push({
        id: `${sym}-be-${opt.expiry}-${opt.strike}`,
        symbol: sym,
        price: opt.strike + opt.avg,
        label: `${occ} BE`,
        kind: 'breakeven',
        detail: `${occ} BE`,
      });
    }
  }

  return rows;
}

/** Lines that fit the visible price window. Sit has no price. Stop always draws. */
export function visibleOnChart(
  rows: OverlayTarget[],
  range: { min: number; max: number },
): OverlayTarget[] {
  const pad = Math.max((range.max - range.min) * 0.25, range.max * 0.03);
  return rows.filter((r) => {
    if (r.kind === 'stop' && r.price != null) return true;
    if (r.price == null) return false;
    return r.price >= range.min - pad && r.price <= range.max + pad;
  });
}
