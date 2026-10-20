/** Bounce-sleeve + held-call overlays for the volatility-puts price chart. */

export type TargetKind = 'held' | 'proposed' | 'stop' | 'breakeven' | 'sit' | 'spread';

export interface OverlayTarget {
  id: string;
  symbol: string;
  price: number | null;
  label: string;
  kind: TargetKind;
  detail?: string;
  /** Calendar days to expiry, for "out 32d" chips/lines. */
  dte?: number;
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

/** Calendar days from asOf to the listed expiry (4pm ET ≈ 20:00 UTC). */
export function dteDays(expiry: string, asOf = new Date()): number {
  const end = Date.parse(`${expiry}T20:00:00Z`);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - asOf.getTime()) / 86_400_000));
}

function outLabel(dte: number | undefined): string {
  return dte != null ? ` · ${dte}d` : '';
}

/**
 * Alpaca /api/quotes uses latest *ask*. After hours that can sit 6–15% above
 * last sale. Do not treat that ask as the tape.
 */
export function isSaneEngineQuote(lastSale: number, engine: number, maxDrift = 0.04): boolean {
  if (!(lastSale > 0) || !(engine > 0)) return false;
  return Math.abs(engine - lastSale) / lastSale <= maxDrift;
}

export function overlayTargets({
  symbol,
  stopPrice,
  held = HELD_DEFAULTS,
  proposed = BOUNCE_TICKETS,
  spreads = SPREAD_TICKETS,
  asOf = new Date(),
}: {
  symbol: string;
  stopPrice?: number | null;
  held?: HeldOption[];
  proposed?: ProposedTicket[];
  spreads?: SpreadTicket[];
  asOf?: Date;
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
    const dte = ticket.expiry ? dteDays(ticket.expiry, asOf) : undefined;
    const occ = occLabel(ticket.strike, ticket.right);
    rows.push({
      id: `${sym}-proposed-${ticket.strike}`,
      symbol: sym,
      price: ticket.strike,
      label: `${occ} proposed${outLabel(dte)}`,
      kind: 'proposed',
      dte,
      detail: ticket.expiry
        ? `${shortExpiry(ticket.expiry)} · ${dte}d · limit ${ticket.limit?.toFixed(2)}`
        : undefined,
    });
    if (ticket.limit != null && ticket.limit > 0 && ticket.right === 'call') {
      rows.push({
        id: `${sym}-proposed-be-${ticket.strike}`,
        symbol: sym,
        price: ticket.strike + ticket.limit,
        label: `${occ} BE${outLabel(dte)}`,
        kind: 'breakeven',
        dte,
        detail: `${occ} BE ${ (ticket.strike + ticket.limit).toFixed(2) } · ${dte}d`,
      });
    }
  }

  for (const sp of spreads) {
    if (sp.symbol.toUpperCase() !== sym) continue;
    const dte = dteDays(sp.expiry, asOf);
    const shortOcc = occLabel(sp.shortStrike, sp.right);
    const pair = `${sp.longStrike}/${sp.shortStrike}${occRight(sp.right)}`;
    rows.push({
      id: `${sym}-spread-${sp.longStrike}-${sp.shortStrike}`,
      symbol: sym,
      price: sp.longStrike,
      label: `${pair}${outLabel(dte)}`,
      kind: 'spread',
      dte,
      detail: `${shortExpiry(sp.expiry)} · ${dte}d · debit ${sp.debit.toFixed(2)}`,
    });
    rows.push({
      id: `${sym}-spread-short-${sp.shortStrike}`,
      symbol: sym,
      price: sp.shortStrike,
      label: `${shortOcc} short${outLabel(dte)}`,
      kind: 'spread',
      dte,
      detail: `short ${shortOcc} · ${dte}d`,
    });
    rows.push({
      id: `${sym}-spread-be-${sp.longStrike}-${sp.shortStrike}`,
      symbol: sym,
      price: sp.longStrike + sp.debit,
      label: `${pair} BE${outLabel(dte)}`,
      kind: 'breakeven',
      dte,
      detail: `${pair} BE ${(sp.longStrike + sp.debit).toFixed(2)} · ${dte}d`,
    });
  }

  for (const opt of held) {
    if (opt.symbol.toUpperCase() !== sym) continue;
    const occ = occLabel(opt.strike, opt.right);
    const dte = dteDays(opt.expiry, asOf);
    rows.push({
      id: `${sym}-held-${opt.expiry}-${opt.strike}`,
      symbol: sym,
      price: opt.strike,
      label: `${occ} ×${opt.quantity}${outLabel(dte)}`,
      kind: 'held',
      dte,
      detail: `${shortExpiry(opt.expiry)} · ${dte}d · ${occ} ×${opt.quantity}`,
    });
    if (opt.avg != null && opt.avg > 0 && opt.right === 'call') {
      rows.push({
        id: `${sym}-be-${opt.expiry}-${opt.strike}`,
        symbol: sym,
        price: opt.strike + opt.avg,
        label: `${occ} BE${outLabel(dte)}`,
        kind: 'breakeven',
        dte,
        detail: `${occ} BE ${(opt.strike + opt.avg).toFixed(2)} · ${dte}d`,
      });
    }
  }

  return rows;
}

/**
 * Order overlays always draw (strike + BE pad the Y domain). Sit has no price.
 * Tape-window filtering used to hide 220/230 and squash the 1D scale — we want
 * those lines now.
 */
export function visibleOnChart(rows: OverlayTarget[]): OverlayTarget[] {
  return rows.filter((r) => r.kind === 'sit' || r.price != null);
}
