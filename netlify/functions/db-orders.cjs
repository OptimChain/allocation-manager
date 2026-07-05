// db-orders.cjs
// Netlify DB (Neon Postgres) backed order store.
//
//   GET    /.netlify/functions/db-orders?scope=open|historical|all&type=stock|option|all&symbol=TSLA&limit=500
//   POST   /.netlify/functions/db-orders          — upsert orders (Robinhood MCP write path)
//   DELETE /.netlify/functions/db-orders?order_id=<id>
//
// POST accepts any of these body shapes, with engine-blob OR raw RH API field
// spellings (id/order_id, type/order_type, price/limit_price, buy/BUY…):
//   { orders: [...], option_orders: [...] }
//   { open_orders: [...], open_option_orders: [...], recent_orders: [...], recent_option_orders: [...] }
//   [ ...mixed orders... ]        — option orders detected by legs/chain_symbol/direction
//   { ...single order... }
//
// All responses use the shared envelope: { ok, resource, action, source, as_of, count, data, error }

'use strict';

const t = require('./lib/tradingDb.cjs');

const RESOURCE = 'orders';

function scopeMatch(scope, isOpen) {
  if (scope === 'open')       return isOpen;
  if (scope === 'historical') return !isOpen;
  return true;
}

async function handleGet(db, event) {
  const params = event.queryStringParameters || {};
  const scope  = (params.scope || 'all').toLowerCase();
  const type   = (params.type  || 'all').toLowerCase();
  const symbol = (params.symbol || '').toUpperCase();
  const limit  = Math.min(Math.max(parseInt(params.limit || '500', 10) || 500, 1), 1000);

  const [stockRows, optionRows] = await Promise.all([
    type === 'option' ? [] : t.fetchStockOrders(db, limit),
    type === 'stock'  ? [] : t.fetchOptionOrders(db, limit),
  ]);

  const data = {
    open_orders: [], open_option_orders: [],
    historical_orders: [], historical_option_orders: [],
  };

  for (const row of stockRows) {
    const order = t.rowToStockOrder(row);
    if (symbol && order.symbol !== symbol) continue;
    const isOpen = t.OPEN_STATES.has(order.state);
    if (!scopeMatch(scope, isOpen)) continue;
    (isOpen ? data.open_orders : data.historical_orders).push(order);
  }

  for (const row of optionRows) {
    const order = t.rowToOptionOrder(row);
    if (symbol && order.chain_symbol !== symbol) continue;
    const isOpen = t.OPEN_STATES.has(order.state);
    if (!scopeMatch(scope, isOpen)) continue;
    (isOpen ? data.open_option_orders : data.historical_option_orders).push(order);
  }

  data.counts = {
    open_orders:              data.open_orders.length,
    open_option_orders:       data.open_option_orders.length,
    historical_orders:        data.historical_orders.length,
    historical_option_orders: data.historical_option_orders.length,
  };

  const count = data.open_orders.length + data.open_option_orders.length
              + data.historical_orders.length + data.historical_option_orders.length;

  return t.respond(200, t.envelope({ resource: RESOURCE, action: 'list', data, count }));
}

const STOCK_KEYS  = ['orders', 'stock_orders', 'open_orders', 'recent_orders'];
const OPTION_KEYS = ['option_orders', 'open_option_orders', 'recent_option_orders'];

function collectOrders(body) {
  const stocks = [], options = [];
  const push = (o) => { if (o && typeof o === 'object') (t.isOptionOrder(o) ? options : stocks).push(o); };

  if (Array.isArray(body)) {
    body.forEach(push);
    return { stocks, options };
  }

  for (const key of STOCK_KEYS)  if (Array.isArray(body[key])) stocks.push(...body[key]);
  for (const key of OPTION_KEYS) if (Array.isArray(body[key])) options.push(...body[key]);
  if (body.order)        stocks.push(body.order);
  if (body.option_order) options.push(body.option_order);

  // Single bare order object
  if (!stocks.length && !options.length && (body.order_id || body.id)) push(body);

  return { stocks, options };
}

async function handlePost(db, event) {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return t.respond(400, t.errorEnvelope(RESOURCE, 'upsert', 'BAD_JSON', 'Request body is not valid JSON'));
  }

  const { stocks, options } = collectOrders(body);
  if (!stocks.length && !options.length) {
    return t.respond(400, t.errorEnvelope(RESOURCE, 'upsert', 'NO_ORDERS',
      'No orders found in body. Send { orders: [...], option_orders: [...] } or an array of orders.'));
  }

  const orderIds = [];
  let stockUpserted = 0, optionUpserted = 0, skipped = 0;

  for (const raw of stocks) {
    const order = t.normalizeStockOrder(raw);
    if (!order) { skipped++; continue; }
    await t.upsertStockOrder(db, order, raw);
    orderIds.push(order.order_id);
    stockUpserted++;
  }
  for (const raw of options) {
    const order = t.normalizeOptionOrder(raw);
    if (!order) { skipped++; continue; }
    await t.upsertOptionOrder(db, order, raw);
    orderIds.push(order.order_id);
    optionUpserted++;
  }

  const data = { stock_upserted: stockUpserted, option_upserted: optionUpserted, skipped, order_ids: orderIds };
  return t.respond(200, t.envelope({ resource: RESOURCE, action: 'upsert', data, count: stockUpserted + optionUpserted }));
}

async function handleDelete(db, event) {
  const orderId = event.queryStringParameters?.order_id;
  if (!orderId) {
    return t.respond(400, t.errorEnvelope(RESOURCE, 'delete', 'MISSING_PARAM', 'order_id query parameter is required'));
  }
  const [stockDeleted, optionDeleted] = await Promise.all([
    db.query(`DELETE FROM stock_orders WHERE order_id = $1 RETURNING order_id`, [orderId]),
    db.query(`DELETE FROM option_orders WHERE order_id = $1 RETURNING order_id`, [orderId]),
  ]);
  const deleted = stockDeleted.length + optionDeleted.length;
  return t.respond(200, t.envelope({ resource: RESOURCE, action: 'delete', data: { deleted, order_id: orderId }, count: deleted }));
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return t.respond(200, '');

  const db = t.getDb();
  if (!db) {
    return t.respond(503, t.errorEnvelope(RESOURCE, 'unavailable', 'DB_NOT_CONFIGURED',
      'NETLIFY_DATABASE_URL is not set. Point it at the Render Postgres (allocation-manager-db) external connection string — see docs/netlify-db.md.'));
  }

  try {
    await t.ensureSchema(db);

    if (event.httpMethod === 'GET') return await handleGet(db, event);

    if (event.httpMethod === 'POST' || event.httpMethod === 'DELETE') {
      const denied = t.checkWriteAuth(event);
      if (denied) return t.respond(401, t.errorEnvelope(RESOURCE, 'write', 'UNAUTHORIZED', denied));
      return event.httpMethod === 'POST' ? await handlePost(db, event) : await handleDelete(db, event);
    }

    return t.respond(405, t.errorEnvelope(RESOURCE, 'unknown', 'METHOD_NOT_ALLOWED', `${event.httpMethod} not supported`));
  } catch (err) {
    console.error('db-orders error:', err);
    return t.respond(500, t.errorEnvelope(RESOURCE, 'error', 'DB_ERROR', err.message || 'Unexpected database error'));
  }
};
