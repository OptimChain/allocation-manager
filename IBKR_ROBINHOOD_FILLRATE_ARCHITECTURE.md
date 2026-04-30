# IBKR Cross-Reference Architecture for Robinhood Fill-Rate Auditing

## Motivation

The current Allocation Manager pipeline trades through Robinhood and ingests
fills via `SafeCashBot → blob_logger.py → Netlify Blob (state-logs) →
enriched-snapshot.cjs → TradePage.tsx`. Recent live-trading evidence — recorded
in the IWN volatility scalping report (Feb 21–Mar 4, 2026 window, see
`docs/7/iwn_vol_analysis.pdf` in `IamJasonBian/allocation-gym`) — shows the
engine routinely scalping on small price increments where execution quality
materially affects P&L:

| Date  | Symbol | Side | Type       | Qty | Avg Fill | Notional | Engine target |
|-------|--------|------|------------|-----|----------|----------|---------------|
| 02/27 | BTC MT | BUY  | Limit      | 500 | $29.02   | $14,509  | spot +0.5%    |
| 03/02 | BTC MT | SELL | Stop Loss  | 500 | $29.01   | $14,505  | spot –1.25%   |
| 03/02 | BTC MT | SELL | Market     | 400 | $30.69   | $12,277  | n/a           |
| 03/02 | BTC MT | SELL | Limit      | 800 | $31.00   | $24,800  | spot +3%      |
| 03/02 | BTC MT | BUY  | Stop Limit | 204 | $30.65   |  $6,253  | n/a           |
| 03/03 | BTC MT | BUY  | Market     | 200 | $29.99   |  $5,998  | n/a           |
| 02/26 | IWN P  | BUY  | Limit      |  10 | $3.16    |  $3,160  | n/a           |
| 02/27 | IWN P  | SELL | Limit      |  10 | $4.96    |  $4,960  | n/a           |

Round-trip P&L over the window was +$15,770 on BTC Mini Trust and +$4,195 on
options — but Robinhood does not publish a per-fill venue, NBBO snapshot, or
price-improvement metric. We have **no independent baseline** for whether the
engine's market and stop-loss orders are executing at fair prices, or whether
PFOF routing is leaking basis points on every scalp.

This document specifies an architecture to use Interactive Brokers (IBKR) as
that independent baseline.

## Goals

1. For every Robinhood fill, attach an "IBKR-equivalent" reference price so we
   can compute per-order **slippage vs. NBBO** and **realized vs. expected**
   fill quality.
2. Track aggregate fill-rate metrics for the engine's most-used order types:
   limit, stop-loss, stop-limit, market.
3. Surface the comparison in `TradePage.tsx` without changing the order flow —
   IBKR is **read-only / oracle-only** in v1. No order routing changes.
4. Keep the integration optional and additive so the existing Robinhood path
   continues to be the source of truth for positions and P&L.

## Non-Goals (v1)

- Routing live orders through IBKR.
- Margin or short-selling parity (IBKR margin rules differ materially).
- Options Greeks reconciliation — already handled in the IWN report's
  put-call-parity derivation; out of scope here.
- Multi-account aggregation (single RH account, single IBKR paper/live account).

## Architecture

```
                          ┌──────────────────────────────────┐
                          │  Engine (allocation-engine repo) │
                          │  SafeCashBot — places RH orders  │
                          └────────────┬─────────────────────┘
                                       │
                       ┌───────────────┴────────────────┐
                       ▼                                ▼
             ┌──────────────────┐              ┌──────────────────┐
             │  Robinhood API   │              │  IBKR Client     │
             │  (orders, fills) │              │  Portal Gateway  │
             └────────┬─────────┘              │  (REST, no order │
                      │                        │   placement)     │
                      ▼                        └────────┬─────────┘
            ┌──────────────────┐                        │
            │ blob_logger.py   │                        │
            │ → state-logs     │                        ▼
            └────────┬─────────┘            ┌──────────────────────┐
                     │                      │ ibkr_oracle.py       │
                     │                      │ — fetches NBBO snap, │
                     │                      │   trade prints,      │
                     │                      │   open-book depth    │
                     │                      └────────┬─────────────┘
                     │                               │
                     ▼                               ▼
                 ┌───────────────────────────────────────┐
                 │  Netlify Blob: fill-audit             │
                 │  key = <rh_order_id>                  │
                 │  value = { rh_fill, ibkr_ref, diff }  │
                 └────────────────┬──────────────────────┘
                                  │
                                  ▼
                  ┌────────────────────────────────┐
                  │ netlify/functions/             │
                  │   fill-audit.cjs               │
                  └────────────────┬───────────────┘
                                   │
                                   ▼
                       ┌─────────────────────────┐
                       │ TradePage.tsx           │
                       │  — FillAuditPanel       │
                       │  — per-order delta      │
                       │  — daily slippage chart │
                       └─────────────────────────┘
```

### Component breakdown

| Component               | New / Existing | Repo                         | Responsibility                                                  |
|-------------------------|----------------|------------------------------|-----------------------------------------------------------------|
| `SafeCashBot`           | existing       | allocation-engine            | Places RH orders                                                |
| `blob_logger.py`        | existing       | allocation-engine            | Writes RH state to `state-logs` blob                            |
| `ibkr_oracle.py`        | **new**        | allocation-engine            | Polls IBKR Client Portal for NBBO + trade prints around RH fills |
| `fill_auditor.py`       | **new**        | allocation-engine            | Joins RH fill ↔ IBKR snap ↔ writes `fill-audit` blob            |
| `fill-audit.cjs`        | **new**        | allocation-manager (this PR) | Netlify function exposing audit blob to the frontend            |
| `FillAuditPanel.tsx`    | **new**        | allocation-manager (this PR) | UI surface in TradePage                                          |

## IBKR Integration Choice

Three IBKR options, ranked:

| Option                    | Pros                                                  | Cons                                                                                | Verdict     |
|---------------------------|-------------------------------------------------------|-------------------------------------------------------------------------------------|-------------|
| **Client Portal Web API** | REST/JSON, OAuth, no TWS process required             | 5-min idle session expiry; needs a keepalive ping                                   | **Pick**    |
| TWS / IB Gateway + ibapi  | Full FIX-grade access, lowest latency                 | Requires a long-running headless TWS process; brittle on serverless                 | Skip for v1 |
| Third-party (Tradier/Polygon) | Easier auth, no IBKR account                       | Not the same liquidity / not the venue we want to benchmark against                 | Skip        |

The Client Portal Web API gives us:

- `/iserver/marketdata/snapshot` — bid, ask, last, NBBO at a millisecond
  resolution (sufficient for the 10-minute rebalance cadence noted in the IWN
  report at §8.3).
- `/iserver/marketdata/history` — 1-second bars for backfill.
- `/trsrv/secdef` — symbol → conid mapping (needed for IWN, BTC Mini Trust, and
  single-stock tickers like CRWD that the engine traded in the window).

A paper account is sufficient for the oracle role since we only consume
quotes — no orders are placed.

## Data Model

New blob store: `fill-audit` (keyed by Robinhood order id).

```jsonc
{
  "rh_order_id": "abc-123",
  "symbol": "IWN",
  "side": "BUY",
  "type": "limit",            // RH raw 'type' field
  "qty": 10,
  "rh_filled_at": "2026-02-26T14:31:07.412Z",
  "rh_avg_price": 3.16,
  "rh_limit_price": 3.18,
  "ibkr_snapshot_at": "2026-02-26T14:31:07.500Z",
  "ibkr_bid": 3.14,
  "ibkr_ask": 3.18,
  "ibkr_mid": 3.16,
  "ibkr_last": 3.17,
  "delta_vs_mid_bps": 0,      // (rh_avg - ibkr_mid) / ibkr_mid * 1e4, signed by side
  "delta_vs_far_bps": -63,    // vs. the side that costs you (ask for buys, bid for sells)
  "price_improvement_bps": 63,
  "ingested_at": "2026-02-26T14:31:09.001Z"
}
```

Aggregations rolled up daily into `fill-audit-daily/<YYYY-MM-DD>`:

```jsonc
{
  "date": "2026-02-26",
  "n_fills": 14,
  "n_with_ibkr_ref": 13,
  "median_delta_vs_mid_bps": 1.2,
  "p95_delta_vs_mid_bps": 18.4,
  "by_order_type": {
    "market":    { "n": 3, "median_bps":  4.1 },
    "limit":     { "n": 8, "median_bps":  0.3 },
    "stop_loss": { "n": 2, "median_bps": 11.7 },
    "stop_limit":{ "n": 1, "median_bps":  2.8 }
  }
}
```

### Field name reconciliation

The existing repo's CLAUDE.md documents that engine blob and raw RH API use
different field names. The auditor must read raw RH API form (since it's
joining at fill time, before `blob_logger.py` normalizes), and emit the
normalized form to be consumed by the frontend:

| Concept     | Raw RH (auditor input) | Engine blob / audit output |
|-------------|------------------------|----------------------------|
| Order id    | `id`                   | `order_id` / `rh_order_id` |
| Order type  | `type`                 | `order_type`               |
| Limit price | `price`                | `limit_price`              |
| Side        | lowercase              | UPPERCASE                  |
| Symbol      | `null` (instrument URL)| resolved string            |

## Join Strategy

Per-fill join window: **±2 seconds** around `rh_filled_at`. The auditor takes
the IBKR snapshot whose timestamp minimizes `|t_ibkr - t_rh_fill|` within the
window. If no snapshot exists in window (e.g. IBKR Client Portal session
dropped), record `ibkr_*` fields as null and surface the gap in the daily
aggregate's `n_with_ibkr_ref` count.

For symbols where the engine trades during after-hours (the IWN report flags
BTC Mini Trust slippage outside RTH at §2.1), the auditor must check IBKR's
extended-hours flag on the snapshot before using it as a benchmark — and the
frontend should label after-hours rows distinctly.

## Slippage Math

For a BUY of qty `q` filled at `p_rh`, with IBKR mid `m` and ask `a`:

```
delta_vs_mid_bps  = (p_rh - m) / m * 1e4
delta_vs_far_bps  = (p_rh - a) / a * 1e4    # negative = price improvement
price_improvement_bps = -delta_vs_far_bps   # positive = better than ask
```

For a SELL, swap `a` for the bid `b` and flip signs so a negative
`delta_vs_mid_bps` always means "worse than mid" regardless of side.

This matches FINRA Rule 605 conventions and is comparable across symbols.

## Frontend: `FillAuditPanel.tsx`

New panel inside `TradePage.tsx`, rendered below the existing fills table.

- Header row: today's `n_fills`, `median_delta_vs_mid_bps`,
  `p95_delta_vs_mid_bps`, `n_with_ibkr_ref / n_fills` coverage.
- Per-order-type breakdown (Recharts bar chart).
- Click-through table: each row is one fill with RH price, IBKR mid,
  delta in bps, after-hours flag.
- Empty state when the auditor hasn't backfilled yet.

The component reads from a new endpoint:

```
GET /.netlify/functions/fill-audit?date=2026-04-30
```

which the new `netlify/functions/fill-audit.cjs` serves by reading the
`fill-audit-daily/<date>` blob, with the same auth/CORS pattern as
`enriched-snapshot.cjs`.

## Rollout

1. **Phase 1 — Oracle only.** Ship `ibkr_oracle.py` and `fill_auditor.py` in
   the engine repo. Backfill 30 days of historical RH fills against IBKR
   1-second bars to seed the `fill-audit` blob. No frontend change.
2. **Phase 2 — UI.** Land this PR (fill-audit.cjs + FillAuditPanel.tsx) so the
   panel renders against the seeded blob. Default to today's view, allow date
   picker.
3. **Phase 3 — Alerting.** When a daily aggregate's
   `median_delta_vs_mid_bps > 5` for any order type, post a notification
   (Slack webhook or `windsurf_deployment.yaml`-style alert).

## Open Questions

- **IBKR account funding.** Paper account works for quote access if
  market-data subscriptions are attached; otherwise a small funded live
  account is required for real-time NBBO on US equities/options. Confirm
  before Phase 1 starts.
- **Crypto (BTC Mini Trust).** IBKR carries the Grayscale trust ticker but
  not spot BTC; for the engine's BTC scalping the oracle benchmarks against
  the listed trust, which is what we want — Robinhood is also trading the
  trust, not spot.
- **Options chain coverage.** IBKR options data requires the OPRA bundle
  subscription. Without it, we get delayed (15-min) quotes which are useless
  for fill-quality scoring on the engine's intraday IWN/CRWD scalps.

## Next Steps

1. Provision an IBKR Client Portal account (paper first) and confirm the
   market-data subscriptions cover IWN, CRWD, and the BTC trust ticker.
2. Implement `ibkr_oracle.py` and `fill_auditor.py` in the engine repo and
   backfill against the Feb 21 – Mar 4, 2026 window from the IWN report so we
   have a known-good reference dataset.
3. Land this PR's `fill-audit.cjs` + `FillAuditPanel.tsx` once the blob is
   populated.
4. Decide alert thresholds after one full week of live audit data.
