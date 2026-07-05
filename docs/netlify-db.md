# Netlify DB Trading Endpoints

Open orders, bot activity, and realized P&L are backed by a free-tier
**Netlify DB** instance (Neon Postgres). Three Netlify functions expose it;
the Robinhood MCP service writes through the same endpoints the frontend
reads from.

```
Robinhood MCP ──POST──▶ db-orders / db-bot-activity ──▶ Netlify DB (Neon)
                                                          │
TradePage / PnLAllocationPage ◀──GET── db-orders / db-bot-activity / db-pnl
```

## Provisioning

```bash
netlify db init          # provisions Neon Postgres, sets NETLIFY_DATABASE_URL
```

Or claim the database from the Netlify dashboard (Site → Extensions → Neon).
The functions read `NETLIFY_DATABASE_URL` (fallbacks:
`NETLIFY_DATABASE_URL_UNPOOLED`, `DATABASE_URL`). Schema is created
automatically on first request — no migration step.

Optional: set `TRADING_DB_TOKEN` in site env vars to require
`Authorization: Bearer <token>` (or `X-Api-Key`) on POST/DELETE.
GET stays open either way.

## Response envelope

Every endpoint returns the same object — branch on `ok`, read the payload
from `data`:

```json
{
  "ok": true,
  "resource": "orders",            // orders | bot-activity | pnl
  "action": "list",                // list | upsert | delete | append | compute
  "source": "netlify-db",
  "as_of": "2026-07-05T07:16:04.585Z",
  "count": 5,
  "data": { ... },
  "error": null                    // or { "code": "DB_NOT_CONFIGURED", "message": "..." }
}
```

Error codes: `DB_NOT_CONFIGURED` (503), `UNAUTHORIZED` (401), `BAD_JSON`,
`NO_ORDERS`, `NO_EVENTS`, `MISSING_PARAM`, `BAD_PERIOD` (400),
`METHOD_NOT_ALLOWED` (405), `DB_ERROR` (500).

## Endpoints

Base: `https://5thstreetcapital.netlify.app/.netlify/functions`

### `GET /db-orders`

Query params: `scope=open|historical|all` (default `all`),
`type=stock|option|all`, `symbol=TSLA`, `limit` (≤1000, default 500).

`data`:

```json
{
  "open_orders":              [ SnapshotOrder... ],
  "open_option_orders":       [ SnapshotOptionOrder... ],
  "historical_orders":        [ SnapshotOrder... ],
  "historical_option_orders": [ SnapshotOptionOrder... ],
  "counts": { "open_orders": 1, "open_option_orders": 1, "historical_orders": 2, "historical_option_orders": 1 }
}
```

Open = state in `queued, unconfirmed, confirmed, pending, partially_filled, new`.

### `POST /db-orders` — MCP write path

Upserts by `order_id` (safe to re-send full order dumps). Accepts **any** of:

```jsonc
{ "orders": [...], "option_orders": [...] }                                  // explicit
{ "open_orders": [...], "recent_orders": [...],
  "open_option_orders": [...], "recent_option_orders": [...] }               // engine-blob portfolio shape
[ ...mixed orders... ]                                                       // options auto-detected via legs/chain_symbol/direction
{ ...single order... }
```

Both field dialects are normalized server-side (per the RH API gotchas):
`order_id`/`id`, `order_type`/`type`, `limit_price`/`price`, `BUY`/`buy`,
`filled_quantity`/`cumulative_quantity`, leg `strike`/`strike_price`,
`expiration`/`expiration_date`. Naive timestamps are treated as UTC.
The original payload is preserved in a `raw` JSONB column.

Returns `data: { "stock_upserted": 3, "option_upserted": 2, "skipped": 0, "order_ids": [...] }`.

### `DELETE /db-orders?order_id=<id>`

Removes the order from both tables. Returns `data: { "deleted": 1, "order_id": "..." }`.

### `GET /db-bot-activity`

Query params: `limit` (≤500, default 50), `type`, `status`, `symbol`, `since=<ISO>`.

`data.events` (newest first):

```json
{
  "events": [{
    "id": 42, "event_id": "evt-1", "event_type": "BUY_ORDER", "status": "submitted",
    "symbol": "TSLA", "quantity": 10, "price": 245.0, "total": 2450.0,
    "message": null, "details": null, "dry_run": false,
    "metadata": null, "created_at": "2026-07-05T06:30:01.000Z"
  }]
}
```

### `POST /db-bot-activity` — MCP write path

Accepts `{ "events": [...] }`, a bare array, or a single event. snake_case or
camelCase (`event_type`/`type`, `dry_run`/`dryRun`, `created_at`/`timestamp`).
`total` is derived from `quantity × price` when omitted. Supplying `event_id`
makes writes idempotent — duplicates are skipped.

Returns `data: { "inserted": 2, "skipped": 0, "ids": [1, 2] }`.

### `GET /db-pnl`

Query params: `period=1W|1M|3M|6M|1Y|5Y|all` (default `all`). Realized P&L is
computed server-side from filled DB orders with the same math as
enriched-snapshot (`computeStockPnl` / `computeOptionPnl`); option P&L is
additionally filtered to the period cutoff.

`data`:

```json
{
  "periods": {
    "1M": {
      "stock":  { "total_realized_pnl": 46.0, "total_buy_volume": 480.0, "total_sell_volume": 526.0,
                  "filled_count": 2, "symbols": [ { "symbol": "NVDA", "realized_pnl": 46.0, ... } ] },
      "option": { "total_realized_pnl": 550.0, "total_buy_volume": 0, "total_sell_volume": 550.0,
                  "filled_count": 1, "symbols": [ { "symbol": "CRWD", "realized_pnl": 550.0, ... } ] },
      "combined_realized_pnl": 596.0
    }
  },
  "open_orders": [ SnapshotOrder... ],
  "open_option_orders": [ SnapshotOptionOrder... ],
  "counts": { "stock_orders": 3, "option_orders": 2, "open_orders": 1, "open_option_orders": 1 }
}
```

## Schema

Created automatically (idempotent) on first request:

| Table | Key | Notes |
|-------|-----|-------|
| `stock_orders` | `order_id` PK | normalized columns + `raw` JSONB of the original payload |
| `option_orders` | `order_id` PK | `legs` JSONB with normalized leg fields |
| `bot_activity` | `id` BIGSERIAL, `event_id` UNIQUE | append-only log |

## Frontend behavior

- **TradePage** — Open Orders and Bot Activity read the DB endpoints first and
  fall back to the blob snapshot / legacy in-memory bot log while the DB is
  empty or unconfigured. A badge on each card shows the active source.
- **PnLAllocationPage** — Order P&L / Realized P&L use `db-pnl` once the DB
  holds filled orders; otherwise the snapshot's `pnl_by_period`.

## Local testing without a database

```bash
TRADING_DB_MEMORY=1 node scripts/local-functions.cjs   # port 9000
curl -s localhost:9000/db-orders | jq
curl -s -X POST localhost:9000/db-orders -H 'Content-Type: application/json' \
  -d '{"orders":[{"id":"o1","symbol":"TSLA","side":"buy","type":"limit","state":"queued","quantity":1,"price":245,"created_at":"2026-07-05T06:30:00"}]}' | jq
curl -s 'localhost:9000/db-pnl?period=1W' | jq
```

`TRADING_DB_MEMORY=1` swaps Neon for an in-process store (lost on restart) —
for endpoint testing only. Backend jest tests
(`tests/backend/trading-db.test.cjs`) run against the same in-memory client:
`npx jest --selectProjects backend`.
