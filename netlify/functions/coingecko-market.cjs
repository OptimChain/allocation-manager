// Market Cap & Volume Netlify Function
// Primary: CoinCap (free, no key, generous rate limits)
// Fallback: CoinGecko

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

async function fetchFromCoinCap() {
  const response = await fetch('https://api.coincap.io/v2/assets/bitcoin');
  if (!response.ok) throw new Error(`CoinCap ${response.status}`);
  const { data } = await response.json();
  return {
    market_cap: data.marketCapUsd ? parseFloat(data.marketCapUsd) : null,
    total_volume: data.volumeUsd24Hr ? parseFloat(data.volumeUsd24Hr) : null,
  };
}

async function fetchFromCoinGecko() {
  const response = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true'
  );
  if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
  const data = await response.json();
  return {
    market_cap: data.bitcoin?.usd_market_cap ?? null,
    total_volume: data.bitcoin?.usd_24h_vol ?? null,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Try CoinCap first, fall back to CoinGecko
  let result = null;
  let source = 'coincap';

  try {
    result = await fetchFromCoinCap();
    console.log('CoinCap OK — market_cap:', result.market_cap, 'volume:', result.total_volume);
  } catch (err) {
    console.warn('CoinCap failed, trying CoinGecko:', err.message);
    source = 'coingecko';
    try {
      result = await fetchFromCoinGecko();
      console.log('CoinGecko fallback OK — market_cap:', result.market_cap, 'volume:', result.total_volume);
    } catch (err2) {
      console.error('Both sources failed:', err2.message);
      return {
        statusCode: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: '502 Both sources unavailable', market_cap: null, total_volume: null }),
      };
    }
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Data-Source': source },
    body: JSON.stringify(result),
  };
};
