// Slack Alert Proxy
// Forwards alert messages to SLACK_WEBHOOK_URL

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent: true }),
    };
  } catch (err) {
    console.error('Slack alert error:', err);
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent: false }),
    };
  }
};
