// Generic Netlify Blob Storage vending function
// Usage:
//   GET /.netlify/functions/vend-blobs?store=news-articles&action=list
//   GET /.netlify/functions/vend-blobs?store=news-articles&action=list&prefix=index:
//   GET /.netlify/functions/vend-blobs?store=news-articles&action=get&key=index:coindesk
//   Stores on the allocation-engine site (options-chain, market-quotes) are
//   routed automatically via the ALLOC_ENGINE_SITE_ID env var.

// Stores that live on the allocation-engine Netlify site
const ALLOC_ENGINE_STORES = new Set(['options-chain', 'market-quotes']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const params = event.queryStringParameters || {};
  const storeName = params.store;

  if (!storeName) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing "store" query parameter' }),
    };
  }

  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({
      name: storeName,
      siteID: params.siteId
        || (ALLOC_ENGINE_STORES.has(storeName) && process.env.ALLOC_ENGINE_SITE_ID)
        || process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN,
    });

    const action = params.action || 'list';

    if (action === 'list') {
      const prefix = params.prefix || '';
      const { blobs } = await store.list({ prefix });
      const keys = blobs.map((b) => b.key);

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: storeName, count: keys.length, keys }),
      };
    }

    if (action === 'get') {
      const key = params.key;
      if (!key) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Missing "key" query parameter' }),
        };
      }

      const value = await store.get(key, { type: 'json' });
      if (value === null) {
        return {
          statusCode: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Key not found', store: storeName, key }),
        };
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: storeName, key, value }),
      };
    }

    return {
      statusCode: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unknown action. Use "list" or "get".' }),
    };
  } catch (error) {
    console.error('[VEND_BLOBS] Error:', error.message);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
