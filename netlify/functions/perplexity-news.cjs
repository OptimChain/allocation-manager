// Perplexity News Netlify Function
// Proxies requests to Perplexity AI search API to fetch recent news for ETF tickers
// Used by the News Straddle strategy tab

const PERPLEXITY_API = 'https://api.perplexity.ai/chat/completions';
const API_KEY = process.env.PERPLEXITY_API_KEY;

const cache = new Map();
const CACHE_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_CACHE_ENTRIES = 20;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'PERPLEXITY_API_KEY not configured' }),
    };
  }

  try {
    const params = event.queryStringParameters || {};
    const ticker = params.ticker || 'IWN';

    const cacheKey = ticker;
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=600',
          'X-Cache': 'HIT',
        },
        body: cached.data,
      };
    }

    const tickerNames = {
      IWN: 'iShares Russell 2000 Value ETF (IWN)',
      CB: 'Chubb Limited (CB)',
      AVDV: 'Avantis International Small Cap Value ETF (AVDV)',
      ISRA: 'VanEck Israel ETF (ISRA)',
    };

    const fullName = tickerNames[ticker] || ticker;

    const response = await fetch(PERPLEXITY_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a financial news analyst. Return ONLY a JSON array of news items. Each item must have: "title" (string), "date" (ISO date string YYYY-MM-DD), "summary" (1-2 sentence summary), "impact" (one of "positive", "negative", "neutral"), "source" (publication name). Return 8-12 recent news items from the last 30 days. No markdown, no explanation, just the JSON array.',
          },
          {
            role: 'user',
            content: `Find the most recent and significant news articles about ${fullName} from the last 30 days. Focus on price-moving events: earnings, macro factors, sector rotation, geopolitical events, fund flows, and analyst upgrades/downgrades. Return as JSON array.`,
          },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Perplexity returned ${response.status}: ${errorText}`);
      return {
        statusCode: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Perplexity API error: ${response.status}`, articles: [] }),
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';
    const citations = data.citations || [];

    // Parse the JSON array from the response
    let articles = [];
    try {
      // Strip markdown code fences if present
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      articles = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse Perplexity response:', parseErr, content);
      articles = [];
    }

    const responseBody = JSON.stringify({ articles, citations, ticker });

    cache.set(cacheKey, { data: responseBody, timestamp: now });
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      cache.delete(oldest[0]);
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600',
        'X-Cache': 'MISS',
      },
      body: responseBody,
    };
  } catch (error) {
    console.error('Perplexity news error:', error);

    const params = event.queryStringParameters || {};
    const cacheKey = params.ticker || 'IWN';
    const cached = cache.get(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Cache': 'STALE',
        },
        body: cached.data,
      };
    }

    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '502 Bad Gateway', articles: [] }),
    };
  }
};
