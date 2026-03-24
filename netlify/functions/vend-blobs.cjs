// Generic Netlify Blob Storage vending function
// Usage:
//   GET /.netlify/functions/vend-blobs?store=news-articles&action=list
//   GET /.netlify/functions/vend-blobs?store=news-articles&action=list&prefix=index:
//   GET /.netlify/functions/vend-blobs?store=news-articles&action=get&key=index:coindesk
//   Stores on the allocation-engine site (options-chain, market-quotes) are
//   routed automatically via the ALLOC_ENGINE_SITE_ID env var.

// Stores that live on the allocation-engine Netlify site.
// These were written via the REST API (/api/v1/blobs/) so they must be
// read back through the same REST API — the @netlify/blobs SDK uses a
// different internal storage layer and cannot see them.
const ALLOC_ENGINE_STORES = new Set(['options-chain', 'market-quotes']);

const NETLIFY_API = 'https://api.netlify.com/api/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── REST API helpers for cross-site blob reads ──────────────

async function restListBlobs(siteId, storeName, token, prefix) {
  const allBlobs = [];
  let cursor = null;
  // Paginate (Netlify returns up to 1000 per page)
  do {
    const url = new URL(`${NETLIFY_API}/blobs/${siteId}/${storeName}`);
    if (prefix) url.searchParams.set('prefix', prefix);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Netlify blobs list failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    allBlobs.push(...(data.blobs || []));
    cursor = data.next_cursor || null;
  } while (cursor);
  return allBlobs;
}

async function restGetBlob(siteId, storeName, key, token) {
  // Key may contain slashes (e.g. "CRWD/2026-03-02T20-45-27") that must stay
  // as literal path separators — only encode each segment individually.
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const url = `${NETLIFY_API}/blobs/${siteId}/${storeName}/${encodedKey}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Netlify blobs get failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Handler ─────────────────────────────────────────────────

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

  const action = params.action || 'list';
  const token = process.env.NETLIFY_AUTH_TOKEN;
  const useRestApi = ALLOC_ENGINE_STORES.has(storeName) && process.env.ALLOC_ENGINE_SITE_ID;

  try {
    // ── REST API path (allocation-engine cross-site stores) ──
    if (useRestApi) {
      const siteId = process.env.ALLOC_ENGINE_SITE_ID;

      if (action === 'list') {
        const blobs = await restListBlobs(siteId, storeName, token, params.prefix || '');
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
        const value = await restGetBlob(siteId, storeName, key, token);
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
    }

    // ── SDK path (local stores on this site) ──
    const { getStore } = await import('@netlify/blobs');
    const store = getStore({
      name: storeName,
      siteID: params.siteId || process.env.NETLIFY_SITE_ID,
      token,
    });

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
