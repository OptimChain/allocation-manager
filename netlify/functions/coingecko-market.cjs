// CoinGecko Market Data Netlify Function
// Proxies market cap and volume requests to CoinGecko API

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

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

  try {
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true`
    );

    if (!response.ok) {
      const errorCode = `${response.status} ${response.statusText}`;
      console.error(`CoinGecko returned ${errorCode}`);
      return {
        statusCode: response.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          error: errorCode,
          market_cap: null,
          total_volume: null,
        }),
      };
    }

    const data = await response.json();
    console.log('CoinGecko response OK — market_cap:', data.bitcoin?.usd_market_cap, 'volume:', data.bitcoin?.usd_24h_vol);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        market_cap: data.bitcoin?.usd_market_cap ?? null,
        total_volume: data.bitcoin?.usd_24h_vol ?? null,
      }),
    };
  } catch (error) {
    console.error('CoinGecko API error:', error);

    return {
      statusCode: 502,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: '502 Bad Gateway',
        market_cap: null,
        total_volume: null,
      }),
    };
  }
};
