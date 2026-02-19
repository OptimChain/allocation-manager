// Polygon.io News Netlify Function
// Proxies market news requests to Polygon.io API
// In-memory cache to avoid rate-limiting (429s)

const POLYGON_API = 'https://api.polygon.io/v2/reference/news';
const BLOB_STORE = 'news-articles';
const API_KEY = process.env.POLYGON_API_KEY;

// Cache keyed by query params, lives across invocations within the same Lambda container
const cache = new Map(); // key -> { data, timestamp }
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_CACHE_ENTRIES = 20;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'POLYGON_API_KEY not configured' }),
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const ticker = params.ticker || '';
    const limit = params.limit || '10';

    // Check in-memory cache
    const cacheKey = `${ticker}|${limit}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'X-Cache': 'HIT',
        },
        body: cached.data,
      };
    }

    const url = new URL(POLYGON_API);
    if (ticker) url.searchParams.set('ticker', ticker);
    url.searchParams.set('limit', limit);
    url.searchParams.set('order', 'desc');
    url.searchParams.set('sort', 'published_utc');
    url.searchParams.set('apiKey', API_KEY);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorCode = `${response.status} ${response.statusText}`;
      console.error(`Polygon.io returned ${errorCode}`);
      return {
        statusCode: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: errorCode, results: [] }),
      };
    }

    const data = await response.json();

    const articles = (data.results || []).map((article) => ({
      id: article.id,
      title: article.title,
      author: article.author,
      published_utc: article.published_utc,
      article_url: article.article_url,
      image_url: article.image_url,
      description: article.description,
      tickers: article.tickers || [],
      publisher: article.publisher ? {
        name: article.publisher.name,
        logo_url: article.publisher.logo_url,
        favicon_url: article.publisher.favicon_url,
      } : null,
    }));

    // Update in-memory cache
    const responseBody = JSON.stringify({ results: articles, count: articles.length });
    cache.set(cacheKey, { data: responseBody, timestamp: now });
    // Evict oldest entries if cache grows too large
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      cache.delete(oldest[0]);
    }

    // Store articles to blob storage (fire-and-forget, don't block response)
    (async () => {
      try {
        const { getStore } = await import('@netlify/blobs');
        const store = getStore({
          name: BLOB_STORE,
          siteID: process.env.NETLIFY_SITE_ID,
          token: process.env.NETLIFY_AUTH_TOKEN,
        });

        // Use date-based path: polygon/YYYY/MM/DD/ (with optional ticker subfolder)
        const now = new Date();
        const dateStr = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`;
        const datePath = ticker
          ? `polygon/${ticker.toLowerCase()}/${dateStr}`
          : `polygon/${dateStr}`;
        const indexKey = `${datePath}/index`;

        const existingIndex = await store.get(indexKey, { type: 'json' }) || { articleIds: [] };
        const existingIds = new Set(existingIndex.articleIds);

        for (const article of articles) {
          if (!article.id) continue;
          await store.setJSON(`${datePath}/${article.id}`, {
            ...article,
            _source: 'polygon',
            _storedAt: now.toISOString(),
          });
          existingIds.add(article.id);
        }

        const allIds = Array.from(existingIds).slice(-200);
        await store.setJSON(indexKey, {
          articleIds: allIds,
          lastUpdated: now.toISOString(),
          source: 'polygon',
          ticker: ticker || null,
          datasetDate: datePath,
        });

        console.log(`[POLYGON] Stored ${articles.length} articles to ${datePath}`);
      } catch (err) {
        console.error('[POLYGON] Blob storage error:', err.message);
      }
    })();

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-Cache': 'MISS',
      },
      body: responseBody,
    };
  } catch (error) {
    console.error('Polygon.io news API error:', error);

    // Serve stale cache if available
    if (cached) {
      console.log('[POLYGON] Serving stale cache (age:', Math.round((now - cached.timestamp) / 1000), 's)');
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'X-Cache': 'STALE',
        },
        body: cached.data,
      };
    }

    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '502 Bad Gateway', results: [] }),
    };
  }
};
