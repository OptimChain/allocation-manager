// CoinDesk News Netlify Function
// Proxies BTC/crypto news requests to CoinDesk data API
// Supports filtering for specific keywords like "microstrategy", "strategy"
// In-memory cache to avoid rate-limiting (429s)

const COINDESK_API = 'https://data-api.coindesk.com/news/v1/article/list';
const BLOB_STORE = 'news-articles';
const API_KEY = process.env.COINDESK_API_KEY;

// Cache keyed by query params, lives across invocations within the same Lambda container
const cache = new Map(); // key -> { data, timestamp }
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_CACHE_ENTRIES = 20;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Check if article matches any of the filter keywords
const matchesFilter = (article, keywords) => {
  if (!keywords || keywords.length === 0) return true;

  const searchText = [
    article.TITLE || article.title || '',
    article.SUBTITLE || article.subtitle || '',
    article.BODY || article.body || '',
    article.KEYWORDS || '',
  ].join(' ').toLowerCase();

  return keywords.some(keyword => searchText.includes(keyword.toLowerCase()));
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
      body: JSON.stringify({ error: 'COINDESK_API_KEY not configured' }),
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const requestedLimit = parseInt(params.limit || '10', 10);
    const filter = params.filter || ''; // comma-separated keywords like "microstrategy,strategy,mstr"
    const categories = params.categories || 'BTC'; // default to BTC, can be overridden

    // Check in-memory cache
    const cacheKey = `${categories}|${filter}|${requestedLimit}`;
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

    // Parse filter keywords
    const filterKeywords = filter ? filter.split(',').map(k => k.trim()).filter(Boolean) : [];

    // If filtering, fetch more articles to ensure we get enough matches
    const fetchLimit = filterKeywords.length > 0 ? Math.max(50, requestedLimit * 5) : requestedLimit;

    const url = new URL(COINDESK_API);
    url.searchParams.set('lang', 'EN');
    url.searchParams.set('limit', String(fetchLimit));
    // Only set categories if not "ALL"
    if (categories.toUpperCase() !== 'ALL') {
      url.searchParams.set('categories', categories);
    }
    url.searchParams.set('api_key', API_KEY);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorCode = `${response.status} ${response.statusText}`;
      console.error(`CoinDesk returned ${errorCode}`);
      return {
        statusCode: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: errorCode, results: [] }),
      };
    }

    const data = await response.json();
    const items = data.Data || data.data || data.results || [];

    // Filter articles if keywords provided
    const filteredItems = filterKeywords.length > 0
      ? items.filter(article => matchesFilter(article, filterKeywords))
      : items;

    // Limit to requested count
    const limitedItems = filteredItems.slice(0, requestedLimit);

    const articles = limitedItems.map((article) => {
      // Extract categories from article
      const articleCategories = (article.CATEGORY_DATA || []).map(c => c.CATEGORY || c.NAME);

      return {
        id: String(article.ID || article.id || ''),
        title: article.TITLE || article.title || '',
        author: article.AUTHORS || article.AUTHOR || article.author || '',
        published_utc: article.PUBLISHED_ON
          ? new Date(article.PUBLISHED_ON * 1000).toISOString()
          : article.published_on || article.published_utc || '',
        article_url: article.URL || article.url || '',
        image_url: article.IMAGE_URL || article.image_url || null,
        description: article.SUBTITLE || article.subtitle || article.BODY?.slice(0, 200) || '',
        categories: articleCategories,
        keywords: article.KEYWORDS || '',
        tickers: articleCategories.includes('BTC') ? ['BTC'] : [],
        publisher: {
          name: article.SOURCE_DATA?.NAME || article.source_info?.name || 'CoinDesk',
          logo_url: null,
          favicon_url: null,
        },
      };
    });

    // Update in-memory cache
    const responseBody = JSON.stringify({
      results: articles,
      count: articles.length,
      filter: filterKeywords.length > 0 ? filterKeywords : null,
      total_fetched: items.length,
    });
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

        // Use date-based path: coindesk/YYYY/MM/DD/
        const now = new Date();
        const datePath = `coindesk/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`;
        const indexKey = `${datePath}/index`;

        const existingIndex = await store.get(indexKey, { type: 'json' }) || { articleIds: [] };
        const existingIds = new Set(existingIndex.articleIds);

        for (const article of articles) {
          if (!article.id) continue;
          await store.setJSON(`${datePath}/${article.id}`, {
            ...article,
            _source: 'coindesk',
            _storedAt: now.toISOString(),
          });
          existingIds.add(article.id);
        }

        const allIds = Array.from(existingIds).slice(-200);
        await store.setJSON(indexKey, {
          articleIds: allIds,
          lastUpdated: now.toISOString(),
          source: 'coindesk',
          datasetDate: datePath,
        });

        console.log(`[COINDESK] Stored ${articles.length} articles to ${datePath}`);
      } catch (err) {
        console.error('[COINDESK] Blob storage error:', err.message);
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
    console.error('CoinDesk news API error:', error);

    // Serve stale cache if available
    if (cached) {
      console.log('[COINDESK] Serving stale cache (age:', Math.round((now - cached.timestamp) / 1000), 's)');
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
