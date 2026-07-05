#!/usr/bin/env python3
"""Order-book snapshot refresh job — runs on Render (whose IPs the auth box
allows), pulls live Robinhood data, and publishes:
  1. a fresh state-logs blob (positions, options, cash, equity) via the
     Netlify Blobs API
  2. stock + option orders into the trading DB via POST /db-orders
     (idempotent upsert — doubles as the option-order backfill)

Env (from the host service): AUTH_SERVICE_URL or RH_AUTH_SERVICE_URL,
RH_AUTH_SERVICE_REQUEST_TOKEN or RH_EXEC_TOKEN, NETLIFY_TOKEN.
Optional: FULL=1 (entire order history), DRY=1 (pull + report only).

Usage on Render (one-off job or cron):
  NETLIFY_TOKEN=... sh -c 'curl -s https://5thstreetcapital.org/scripts/rh-snapshot-job.py | python3 -'
"""
import json
import os
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

RH = "https://api.robinhood.com"
SITE_ID = "3d014fc3-e919-4b4d-b374-e8606dee50df"
DB_ORDERS = "https://5thstreetcapital.org/.netlify/functions/db-orders"
FULL = os.environ.get("FULL") == "1"
DRY = os.environ.get("DRY") == "1"
BACKFILL_CUTOFF = "2026-05-01"

errors = []


def http(url, headers=None, data=None, method=None):
    req = urllib.request.Request(url, headers=headers or {}, method=method,
                                 data=json.dumps(data).encode() if data is not None else None)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode()
        return json.loads(body) if body else {}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def r2(v):
    return round(v, 2)


# ── 1. Robinhood token from the auth box ─────────────────────────────────────
AUTH_URL = (os.environ.get("RH_AUTH_SERVICE_URL") or os.environ.get("AUTH_SERVICE_URL") or "").rstrip("/")
EXEC_TOKEN = os.environ.get("RH_EXEC_TOKEN") or os.environ.get("RH_AUTH_SERVICE_REQUEST_TOKEN")
NETLIFY_TOKEN = os.environ.get("NETLIFY_TOKEN")
assert AUTH_URL and EXEC_TOKEN, "auth service env not set"
assert NETLIFY_TOKEN or DRY, "NETLIFY_TOKEN not set"

tok_body = http(f"{AUTH_URL}/token", {"Authorization": f"Bearer {EXEC_TOKEN}"})
RH_TOKEN = tok_body.get("access_token") or tok_body.get("token") or tok_body.get("rh_token")
assert RH_TOKEN, f"no token field in auth box response: {list(tok_body)}"
H = {"Authorization": f"Bearer {RH_TOKEN}", "Accept": "application/json"}

_cache = {}


def rh(path_or_url):
    url = path_or_url if path_or_url.startswith("http") else RH + path_or_url
    if url in _cache:
        return _cache[url]
    out = http(url, H)
    _cache[url] = out
    return out


def rh_safe(url, label):
    try:
        return rh(url)
    except Exception as e:  # noqa: BLE001 — collect, don't abort the run
        errors.append(f"{label}: {e}")
        return {}


def paginate(path, max_pages=20, stop_when=None):
    out, url = [], path
    for _ in range(max_pages):
        if not url:
            break
        page = rh(url)
        results = page.get("results") or []
        out.extend(results)
        if stop_when and results and stop_when(results[-1]):
            break
        url = page.get("next")
    return out


def pool_fetch(urls, label):
    with ThreadPoolExecutor(max_workers=8) as ex:
        for _ in ex.map(lambda u: rh_safe(u, label), urls):
            pass


# ── 2. Pull ───────────────────────────────────────────────────────────────────
account = (rh("/accounts/").get("results") or [{}])[0]
portfolio = (rh("/portfolios/").get("results") or [{}])[0]
positions = paginate("/positions/?nonzero=true")
option_positions = paginate("/options/positions/?nonzero=true")
stock_orders = paginate("/orders/", max_pages=100 if FULL else 5)
option_orders = paginate("/options/orders/", max_pages=100 if FULL else 20,
                         stop_when=lambda o: (o.get("created_at") or "") < BACKFILL_CUTOFF)

inst_urls = sorted({u for u in ([p.get("instrument") for p in positions]
                                + [o.get("instrument") for o in stock_orders]) if u})
pool_fetch(inst_urls, "instrument")
sym_of = lambda u: (_cache.get(u) or {}).get("symbol")  # noqa: E731

symbols = sorted({s for s in ([sym_of(p.get("instrument")) for p in positions]
                              + [p.get("chain_symbol") for p in option_positions]) if s})
quotes = {}
for i in range(0, len(symbols), 30):
    page = rh_safe(f"/quotes/?symbols={','.join(symbols[i:i+30])}", "quotes")
    for q in page.get("results") or []:
        if q:
            quotes[q["symbol"]] = q


def price_of(sym):
    q = quotes.get(sym) or {}
    return num(q.get("last_extended_hours_trade_price") or q.get("last_trade_price"))


# ── 3. Assemble blob ──────────────────────────────────────────────────────────
blob_positions = []
for p in positions:
    sym = sym_of(p.get("instrument"))
    if not sym:
        continue
    qty, avg = num(p.get("quantity")), num(p.get("average_buy_price"))
    price = price_of(sym)
    equity, cost = r2(qty * price), qty * avg
    q = quotes.get(sym) or {}
    prev = num(q.get("previous_close"))
    inst = _cache.get(p.get("instrument")) or {}
    blob_positions.append({
        "symbol": sym,
        "name": inst.get("simple_name") or inst.get("name") or sym,
        "quantity": qty,
        "avg_buy_price": r2(avg),
        "current_price": r2(price),
        "equity": equity,
        "profit_loss": r2(equity - cost),
        "profit_loss_pct": (equity - cost) / cost if cost > 0 else 0,  # fraction
        "percent_change": r2((price - prev) / prev * 100) if prev > 0 else None,
        "percentage": None,
    })
total_mv = sum(p["equity"] for p in blob_positions)
for p in blob_positions:
    p["percentage"] = r2(p["equity"] / total_mv * 100) if total_mv > 0 else None

opt_inst_urls = sorted({p.get("option") for p in option_positions if p.get("option")})
pool_fetch(opt_inst_urls, "option instrument")
marketdata = {}
for i in range(0, len(opt_inst_urls), 15):
    page = rh_safe("/marketdata/options/?instruments="
                   + urllib.request.quote(",".join(opt_inst_urls[i:i+15]), safe=""), "option marketdata")
    for m in page.get("results") or []:
        if m:
            marketdata[m["instrument"]] = m

blob_options = []
for p in option_positions:
    inst = _cache.get(p.get("option")) or {}
    md = marketdata.get(p.get("option")) or {}
    qty = num(p.get("quantity"))
    short = (p.get("type") or "").lower() == "short"
    sign = -1 if short else 1
    avg = abs(num(p.get("average_price")))          # per contract (×100 included)
    mark = num(md.get("adjusted_mark_price")) * 100
    cost_basis, current_value = r2(sign * avg * qty), r2(sign * mark * qty)
    exp = inst.get("expiration_date")
    dte = max(0, round((datetime.fromisoformat(exp + "T20:00:00+00:00")
                        - datetime.now(timezone.utc)).total_seconds() / 86400)) if exp else None
    theta = num(md.get("theta"))
    blob_options.append({
        "chain_symbol": p.get("chain_symbol"),
        "option_type": inst.get("type") or "call",
        "strike": num(inst.get("strike_price")),
        "expiration": exp,
        "dte": dte,
        "quantity": qty,
        "position_type": "short" if short else "long",
        "avg_price": r2(avg),
        "mark_price": r2(mark),
        "multiplier": 100,
        "cost_basis": cost_basis,
        "current_value": current_value,
        "unrealized_pl": r2(current_value - cost_basis),
        "unrealized_pl_pct": r2((current_value - cost_basis) / (avg * qty) * 100) if avg * qty > 0 else None,
        "underlying_price": price_of(p.get("chain_symbol")) or None,
        "chance_of_profit": num(md.get("chance_of_profit_short" if short else "chance_of_profit_long")) or None,
        "greeks": {"delta": num(md.get("delta")), "gamma": num(md.get("gamma")), "theta": theta,
                   "vega": num(md.get("vega")), "rho": num(md.get("rho")), "iv": num(md.get("implied_volatility"))},
        "expected_pl": {"theta_daily": r2(theta * 100 * qty * sign)},
    })

stock_orders_out = [dict(o, symbol=o.get("symbol") or sym_of(o.get("instrument"))) for o in stock_orders]

leg_urls = sorted({leg.get("option") for o in option_orders
                   if FULL or (o.get("created_at") or "") >= BACKFILL_CUTOFF
                   for leg in o.get("legs") or [] if leg.get("option")})
pool_fetch(leg_urls, "leg instrument")
option_orders_out = []
for o in option_orders:
    legs = []
    for leg in o.get("legs") or []:
        inst = _cache.get(leg.get("option")) or {}
        legs.append({"chain_symbol": o.get("chain_symbol"), "strike_price": inst.get("strike_price"),
                     "expiration_date": inst.get("expiration_date"), "option_type": inst.get("type"),
                     "side": leg.get("side"), "position_effect": leg.get("position_effect")})
    option_orders_out.append(dict(o, legs=legs))

OPEN = {"queued", "unconfirmed", "confirmed", "pending", "partially_filled", "new"}
equity = num(portfolio.get("extended_hours_equity") or portfolio.get("equity"))
cash = num(account.get("portfolio_cash") if account.get("portfolio_cash") is not None else account.get("cash"))
blob = {
    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "source": "rh-snapshot-job",
    "portfolio": {
        "cash": {"cash": r2(cash), "cash_available_for_withdrawal": num(account.get("cash_available_for_withdrawal")),
                 "buying_power": num(account.get("buying_power")), "tradeable_cash": r2(cash)},
        "equity": r2(equity),
        "market_value": r2(num(portfolio.get("market_value"))),
        "positions": blob_positions,
        "options": blob_options,
        "open_orders": [o for o in stock_orders_out if o.get("state") in OPEN],
        "open_option_orders": [o for o in option_orders_out if o.get("state") in OPEN],
    },
    "order_book": [],
    "recent_orders": stock_orders_out,
    "recent_option_orders": option_orders_out,
}

summary = {"positions": len(blob_positions), "option_positions": len(blob_options),
           "stock_orders": len(stock_orders_out), "option_orders": len(option_orders_out),
           "open_orders": len(blob["portfolio"]["open_orders"]), "equity": r2(equity), "dry": DRY}

# ── 4. Publish ────────────────────────────────────────────────────────────────
if not DRY:
    key = blob["timestamp"].replace(":", "-").split(".")[0]
    # Write the timestamped key AND the 'latest' pointer (engine convention —
    # the snapshot reader prefers whichever payload is newest)
    for k in (key, "latest"):
        http(f"https://api.netlify.com/api/v1/blobs/{SITE_ID}/state-logs/{k}",
             {"Authorization": f"Bearer {NETLIFY_TOKEN}"}, data=blob, method="PUT")
    summary["blob_key"] = key

    upserted = {"stock": 0, "option": 0}
    for i in range(0, len(stock_orders_out), 40):
        res = http(DB_ORDERS, data={"orders": stock_orders_out[i:i+40]}, method="POST")
        upserted["stock"] += (res.get("data") or {}).get("stock_upserted", 0)
    for i in range(0, len(option_orders_out), 40):
        res = http(DB_ORDERS, data={"option_orders": option_orders_out[i:i+40]}, method="POST")
        upserted["option"] += (res.get("data") or {}).get("option_upserted", 0)
    summary["db_upserts"] = upserted

summary["errors"] = errors[:20]
print(json.dumps(summary, indent=1))
