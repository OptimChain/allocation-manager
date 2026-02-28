// Redis Holdings — reads from two Redis stores: "stocks" and "orders"
//
// GET /api/redis-holdings?store=stocks          → all stocks + options
// GET /api/redis-holdings?store=stocks&key=AAPL → single stock
// GET /api/redis-holdings?store=orders          → all orders (open + historical)
// GET /api/redis-holdings?store=orders&key={id} → single order

const { createClient } = require('redis');

const STORES = ['stocks', 'orders'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function parseHash(hash) {
  if (!hash) return {};
  const result = {};
  for (const [k, v] of Object.entries(hash)) {
    try { result[k] = JSON.parse(v); } catch { result[k] = v; }
  }
  return result;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const host = process.env.REDIS_HOST;
  const password = process.env.REDIS_PASSWORD;
  const url = process.env.REDIS_URL;

  if (!host && !url) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'REDIS_HOST or REDIS_URL not configured' }),
    };
  }

  let client;
  try {
    if (host) {
      // REDIS_HOST may include port (host:port)
      let redisHost = host;
      let redisPort = 6379;
      if (host.includes(':')) {
        const parts = host.split(':');
        redisPort = parseInt(parts.pop(), 10);
        redisHost = parts.join(':');
      }
      client = createClient({
        socket: { host: redisHost, port: redisPort },
        password: password || undefined,
      });
    } else {
      client = createClient({ url });
    }
    await client.connect();

    const params = event.queryStringParameters || {};
    const store = params.store;

    if (!store || !STORES.includes(store)) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `store parameter required (${STORES.join(', ')})` }),
      };
    }

    let data;
    if (params.key) {
      // Single key lookup
      const val = await client.hGet(store, params.key);
      if (!val) {
        return {
          statusCode: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: `${params.key} not found in ${store}` }),
        };
      }
      try { data = JSON.parse(val); } catch { data = val; }
    } else {
      // All entries
      data = parseHash(await client.hGetAll(store));
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('Redis holdings error:', error);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Failed to fetch from Redis' }),
    };
  } finally {
    if (client) {
      try { await client.disconnect(); } catch {}
    }
  }
};
