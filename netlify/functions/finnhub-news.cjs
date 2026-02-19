// Finnhub News Netlify Function
// Proxies market and company news requests to Finnhub API
// Supports general market news, company-specific news, and crypto news
// In-memory cache to avoid rate-limiting (429s)

const FINNHUB_API = 'https://finnhub.io/api/v1';
const API_KEY = process.env.FINNHUB_API_KEY;

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
      body: JSON.stringify({ error: 'FINNHUB_API_KEY not configured' }),
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const symbol = params.symbol || '';
    const category = params.category || 'general'; // general, crypto, forex, merger
    const limit = parseInt(params.limit || '10', 10);

    // Check in-memory cache
    const cacheKey = `${symbol}|${category}|${limit}`;
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

    let url;
    if (symbol) {
      // Company-specific news — fetch last 7 days
      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - 7 * 86400_000).toISOString().split('T')[0];
      url = new URL(`${FINNHUB_API}/company-news`);
      url.searchParams.set('symbol', symbol.toUpperCase());
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
    } else {
      // General/crypto/forex market news
      url = new URL(`${FINNHUB_API}/news`);
      url.searchParams.set('category', category);
    }
    url.searchParams.set('token', API_KEY);

    const response = await fetch(url.toString());

    if (!response.ok) {
      const errorCode = `${response.status} ${response.statusText}`;
      console.error(`Finnhub returned ${errorCode}`);
      return {
        statusCode: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: errorCode, results: [] }),
      };
    }

    const data = await response.json();
    const items = Array.isArray(data) ? data : [];

    // Map to shared NewsArticle shape and limit
    const articles = items.slice(0, limit).map((article) => ({
      id: String(article.id || ''),
      title: article.headline || '',
      author: '',
      published_utc: article.datetime
        ? new Date(article.datetime * 1000).toISOString()
        : '',
      article_url: article.url || '',
      image_url: article.image || null,
      description: article.summary || '',
      tickers: article.related
        ? article.related.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
      publisher: {
        name: article.source || 'Finnhub',
        logo_url: null,
        favicon_url: null,
      },
    }));

    // Update in-memory cache
    const responseBody = JSON.stringify({ results: articles, count: articles.length });
    cache.set(cacheKey, { data: responseBody, timestamp: now });
    // Evict oldest entries if cache grows too large
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      cache.delete(oldest[0]);
    }

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
    console.error('Finnhub news API error:', error);

    // Serve stale cache if available
    const params = event.queryStringParameters || {};
    const cacheKey = `${params.symbol || ''}|${params.category || 'general'}|${parseInt(params.limit || '10', 10)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log('[FINNHUB] Serving stale cache (age:', Math.round((Date.now() - cached.timestamp) / 1000), 's)');
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
