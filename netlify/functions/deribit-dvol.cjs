// Deribit DVOL (Volatility Index) Netlify Function
// Proxies BTC implied volatility data from Deribit public API

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const days = parseInt(event.queryStringParameters?.days || '365', 10);
  const now = Date.now();
  const startTs = now - days * 86400000;

  const url =
    'https://www.deribit.com/api/v2/public/get_volatility_index_data' +
    `?currency=BTC&start_timestamp=${startTs}&end_timestamp=${now}&resolution=86400`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'bitcoin-tracker/1.0' },
    });

    if (!response.ok) {
      console.error(`Deribit returned ${response.status}`);
      return {
        statusCode: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Deribit API: ${response.status}`, data: null }),
      };
    }

    const json = await response.json();
    const records = json.result?.data || [];
    // Each record: [timestamp_ms, open, high, low, close]
    const data = records.map((r) => ({
      timestamp: r[0],
      close: r[4],
    }));

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    };
  } catch (error) {
    console.error('Deribit DVOL error:', error);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: '502 Bad Gateway', data: null }),
    };
  }
};
