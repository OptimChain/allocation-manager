// db-bot-activity.cjs
// Postgres-backed bot activity log — replaces the in-memory
// action log in robinhood-bot.cjs that reset on every cold start.
//
//   GET  /.netlify/functions/db-bot-activity?limit=50&type=BUY_ORDER&status=submitted&symbol=TSLA&order_id=<id>&since=<ISO>
//   POST /.netlify/functions/db-bot-activity     — append events (Robinhood MCP write path)
//
// POST accepts { events: [...] }, a bare array, or a single event object.
// Events may use snake_case or camelCase (dry_run/dryRun, event_type/type,
// created_at/timestamp). De-dup: supplying event_id makes the write
// idempotent — duplicates are skipped, not re-inserted. Writers can also
// just pass the Robinhood order_id through: when event_id is absent, it is
// derived as `{order_id}:{status}`, so each order lifecycle transition
// (submitted/filled/cancelled…) logs exactly once across retries.
//
// All responses use the shared envelope: { ok, resource, action, source, as_of, count, data, error }

'use strict';

const t = require('./lib/tradingDb.cjs');

const RESOURCE = 'bot-activity';
const FETCH_CEILING = 500;

async function handleGet(db, event) {
  const params = event.queryStringParameters || {};
  const limit   = Math.min(Math.max(parseInt(params.limit || '50', 10) || 50, 1), FETCH_CEILING);
  const offset  = Math.max(parseInt(params.offset || '0', 10) || 0, 0);
  const type    = params.type   || null;
  const status  = params.status || null;
  const symbol  = (params.symbol || '').toUpperCase() || null;
  const orderId = params.order_id || null;
  const since   = t.toIso(params.since);
  const hasFilters = Boolean(type || status || symbol || orderId || since);

  // Unfiltered: paginate in SQL (arbitrary depth). Filtered: filter in JS over
  // a window starting at offset, so offset still pages through filtered results
  // one FETCH_CEILING window at a time.
  const rows = hasFilters
    ? await t.fetchBotEvents(db, FETCH_CEILING, offset)
    : await t.fetchBotEvents(db, limit, offset);

  const events = rows.map(t.rowToBotEvent).filter(e =>
    (!type    || e.event_type === type) &&
    (!status  || e.status === status) &&
    (!symbol  || e.symbol === symbol) &&
    (!orderId || e.order_id === orderId) &&
    (!since   || (e.created_at && e.created_at >= since))
  ).slice(0, limit);

  return t.respond(200, t.envelope({
    resource: RESOURCE, action: 'list',
    data: { events, page: { limit, offset, has_more: rows.length === (hasFilters ? FETCH_CEILING : limit) } },
    count: events.length,
  }));
}

async function handlePost(db, event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return t.respond(400, t.errorEnvelope(RESOURCE, 'append', 'BAD_JSON', 'Request body is not valid JSON'));
  }

  const rawEvents = Array.isArray(body) ? body
    : Array.isArray(body.events) ? body.events
    : (body.event_type || body.type) ? [body]
    : [];

  if (!rawEvents.length) {
    return t.respond(400, t.errorEnvelope(RESOURCE, 'append', 'NO_EVENTS',
      'No events found in body. Send { events: [...] } or a single event with event_type/type.'));
  }

  const ids = [];
  let inserted = 0, skipped = 0;
  for (const raw of rawEvents) {
    const id = await t.insertBotEvent(db, t.normalizeBotEvent(raw));
    if (id != null) { ids.push(id); inserted++; } else { skipped++; }
  }

  return t.respond(200, t.envelope({
    resource: RESOURCE, action: 'append',
    data: { inserted, skipped, ids }, count: inserted,
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

    if (event.httpMethod === 'POST') {
      const denied = t.checkWriteAuth(event);
      if (denied) return t.respond(401, t.errorEnvelope(RESOURCE, 'write', 'UNAUTHORIZED', denied));
      return await handlePost(db, event);
    }

    return t.respond(405, t.errorEnvelope(RESOURCE, 'unknown', 'METHOD_NOT_ALLOWED', `${event.httpMethod} not supported`));
  } catch (err) {
    console.error('db-bot-activity error:', err);
    return t.respond(500, t.errorEnvelope(RESOURCE, 'error', 'DB_ERROR', err.message || 'Unexpected database error'));
  }
};
