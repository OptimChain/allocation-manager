// Slack Alert Proxy
// Forwards alert messages to SLACK_WEBHOOK_URL

const { CORS, json, fetchWithTimeout } = require('./lib/http.cjs');

const corsHeaders = { ...CORS, 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const respond = (statusCode, body) => json(statusCode, body, corsHeaders);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method not allowed' };
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('SLACK_WEBHOOK_URL not configured');
    return { statusCode: 200, headers: corsHeaders, body: '{}' };
  }

  try {
    const { message, source, error: errorMsg } = JSON.parse(event.body);

    const text = [
      `:warning: *${source || 'Trade Page'}*`,
      message,
      errorMsg ? `\`\`\`${errorMsg}\`\`\`` : null,
    ].filter(Boolean).join('\n');

    const res = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`Slack webhook returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return respond(200, { sent: false, status: res.status });
    }

    return respond(200, { sent: true });
  } catch (err) {
    console.error('Slack alert error:', err);
    return respond(200, { sent: false });
  }
};
