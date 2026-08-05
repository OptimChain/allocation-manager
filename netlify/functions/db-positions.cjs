// db-positions.cjs
// Postgres-backed holdings store — the current position book plus the account
// summary that goes with it.
//
//   GET    /.netlify/functions/db-positions?type=stock|option|all&symbol=TSLA
//   POST   /.netlify/functions/db-positions       — replace the whole book
//   DELETE /.netlify/functions/db-positions?symbol=TSLA
//                                                 — or ?position_key=<key>
//
// POST is a REPLACE, not a merge. Positions are a set, not an append-only log:
// whatever the caller sends becomes the entire book, and any symbol absent from
// the payload is deleted. That is what keeps a closed position from lingering.
// Send `{ "positions": [], "option_positions": [] }` to clear the book.
//
// Accepted body (engine broker OR dashboard snapshot field spellings —
// qty/quantity, avg_entry/avg_buy_price, market_value/equity,
// unrealized_pl/profit_loss):
//   { positions: [...], option_positions: [...], account: {...} }
//
// This replaces the Netlify Blobs "engine snapshot", which was written only
// when the engine ran with DRY_RUN=false and therefore went stale.
//
// All responses use the shared envelope: { ok, resource, action, source, as_of, count, data, error }

'use strict';

const t = require('./lib/tradingDb.cjs');

const RESOURCE = 'positions';

async function handleGet(db, event) {
  const params = event.queryStringParameters || {};
  const type   = (params.type || 'all').toLowerCase();
  const symbol = (params.symbol || '').toUpperCase();

  const [stockRows, optionRows, accountRow] = await Promise.all([
    type === 'option' ? [] : t.fetchPositions(db),
    type === 'stock'  ? [] : t.fetchOptionPositions(db),
    t.fetchAccountSnapshot(db),
  ]);

  const positions = stockRows
    .map(t.rowToPosition)
    .filter(p => !symbol || p.symbol === symbol);
  const option_positions = optionRows
    .map(t.rowToOptionPosition)
    .filter(o => !symbol || o.chain_symbol === symbol);

  const account = t.rowToAccount(accountRow);

  // Sum the book so callers do not have to; RH's own equity excludes options.
  const stock_market_value   = positions.reduce((s, p) => s + (p.equity || 0), 0);
  const options_market_value = option_positions.reduce((s, o) => s + (o.current_value || 0), 0);

  const data = {
    positions,
    option_positions,
    account,
    totals: {
      stock_market_value:   t.r2(stock_market_value),
      options_market_value: t.r2(options_market_value),
      market_value:         t.r2(stock_market_value + options_market_value),
    },
    counts: {
      positions:        positions.length,
      option_positions: option_positions.length,
    },
    // When the book was last written by the engine — this is the timestamp the
    // dashboard should show for positions.
    updated_at: account?.updated_at ?? null,
  };

  return t.respond(200, t.envelope({
    resource: RESOURCE, action: 'list', data,
    count: positions.length + option_positions.length,
  }));
}

function collectPositions(body) {
  if (Array.isArray(body)) {
    // A bare array is ambiguous; split it the same way orders are split.
    const stocks = [], options = [];
    for (const p of body) {
      if (p && typeof p === 'object') {
        (t.optionPositionKey(p) ? options : stocks).push(p);
      }
    }
    return { stocks, options, account: null };
  }
  return {
    stocks:  Array.isArray(body.positions) ? body.positions : [],
    options: Array.isArray(body.option_positions) ? body.option_positions
           : Array.isArray(body.options) ? body.options : [],
    account: body.account ?? null,
  };
}

async function handlePost(db, event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return t.respond(400, t.errorEnvelope(RESOURCE, 'replace', 'BAD_JSON',
      'Request body is not valid JSON'));
  }

  const { stocks, options, account } = collectPositions(body);

  // Guard against a malformed body silently wiping the book: an intentional
  // clear must say so explicitly with a present-but-empty array.
  const declaresStocks  = Array.isArray(body) || Array.isArray(body.positions);
  const declaresOptions = Array.isArray(body) || Array.isArray(body.option_positions)
                       || Array.isArray(body.options);
  if (!declaresStocks && !declaresOptions && !account) {
    return t.respond(400, t.errorEnvelope(RESOURCE, 'replace', 'NO_POSITIONS',
      'No position book in body. Send { positions: [...], option_positions: [...] }; ' +
      'send an explicit empty array to clear.'));
  }

  let skipped = 0;

  // Normalize first, then write in batches — same reason as db-orders.
  const stockRows = [], optionRows = [];
  for (const raw of stocks) {
    const value = t.normalizePosition(raw);
    value ? stockRows.push({ value, raw }) : skipped++;
  }
  for (const raw of options) {
    const value = t.normalizeOptionPosition(raw);
    value ? optionRows.push({ value, raw }) : skipped++;
  }

  const positionsUpserted = await t.upsertPositions(db, stockRows);
  const optionsUpserted   = await t.upsertOptionPositions(db, optionRows);

  const symbols    = stockRows.map(r => r.value.symbol);
  const optionKeys = optionRows.map(r => r.value.position_key);

  // Whole-book replace — only prune a table the caller actually declared, so a
  // stock-only sync cannot wipe the option book.
  const pruned_positions = declaresStocks
    ? await t.pruneMissing(db, 'positions', 'symbol', symbols) : 0;
  const pruned_option_positions = declaresOptions
    ? await t.pruneMissing(db, 'option_positions', 'position_key', optionKeys) : 0;

  const normalizedAccount = t.normalizeAccount(account);
  if (normalizedAccount) {
    await t.upsertAccountSnapshot(db, normalizedAccount, account);
  }

  const data = {
    positions_upserted:        positionsUpserted,
    option_positions_upserted: optionsUpserted,
    pruned_positions,
    pruned_option_positions,
    account_updated:           Boolean(normalizedAccount),
    skipped,
    symbols,
  };
  return t.respond(200, t.envelope({
    resource: RESOURCE, action: 'replace', data,
    count: symbols.length + optionKeys.length,
  }));
}

async function handleDelete(db, event) {
  const params      = event.queryStringParameters || {};
  const symbol      = (params.symbol || '').toUpperCase();
  const positionKey = params.position_key;

  if (!symbol && !positionKey) {
    return t.respond(400, t.errorEnvelope(RESOURCE, 'delete', 'MISSING_PARAM',
      'symbol or position_key query parameter is required'));
  }

  const deleted = positionKey
    ? (await db.query(
        `DELETE FROM option_positions WHERE position_key = $1 RETURNING position_key`,
        [positionKey])).length
    : (await db.query(
        `DELETE FROM positions WHERE symbol = $1 RETURNING symbol`,
        [symbol])).length;

  return t.respond(200, t.envelope({
    resource: RESOURCE, action: 'delete',
    data: { deleted, symbol: symbol || null, position_key: positionKey || null },
    count: deleted,
  }));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return t.respond(200, '');

  const db = t.getDb();
  if (!db) {
    return t.respond(503, t.errorEnvelope(RESOURCE, 'unavailable', 'DB_NOT_CONFIGURED',
      'NETLIFY_DATABASE_URL is not set. Point it at the Render Postgres (allocation-manager-db) external connection string — see docs/db.md.'));
  }

  try {
    await t.ensureSchema(db);

    if (event.httpMethod === 'GET') return await handleGet(db, event);

    if (event.httpMethod === 'POST' || event.httpMethod === 'DELETE') {
      const denied = t.checkWriteAuth(event);
      if (denied) return t.respond(401, t.errorEnvelope(RESOURCE, 'write', 'UNAUTHORIZED', denied));
      return event.httpMethod === 'POST' ? await handlePost(db, event) : await handleDelete(db, event);
    }

    return t.respond(405, t.errorEnvelope(RESOURCE, 'unknown', 'METHOD_NOT_ALLOWED',
      `${event.httpMethod} not supported`));
  } catch (err) {
    console.error('db-positions error:', err);
    return t.respond(500, t.errorEnvelope(RESOURCE, 'error', 'DB_ERROR',
      err.message || 'Unexpected database error'));
  }
};
