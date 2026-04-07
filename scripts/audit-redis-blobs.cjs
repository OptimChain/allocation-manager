#!/usr/bin/env node
/**
 * Audit: match orders between Redis and latest blob by order_id.
 * Sends a Slack alert if they diverge.
 *
 * Env vars: NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID, REDIS_HOST, REDIS_PASSWORD, SLACK_WEBHOOK_URL
 */

const https = require('https');
const { createClient } = require('redis');

const BLOBS_BASE = 'https://api.netlify.com/api/v1/blobs';

function env(name, required = true) {
  const val = process.env[name];
  if (!val && required) { console.error(`ERROR: ${name} required`); process.exit(1); }
  return val;
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`${res.statusCode}`));
        else resolve(JSON.parse(chunks.join('')));
      });
    }).on('error', reject);
  });
}

function sendSlack(webhookUrl, text) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const body = JSON.stringify({ text });
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getRedisOrders() {
  const hostPort = env('REDIS_HOST');
  const password = env('REDIS_PASSWORD', false);
  const [host, portStr] = hostPort.includes(':') ? hostPort.split(':') : [hostPort, '6379'];

  const client = createClient({
    socket: { host, port: parseInt(portStr, 10) },
    password: password || undefined,
  });
  await client.connect();
  const raw = await client.hGetAll('orders');
  await client.quit();

  const orders = {};
  for (const [key, val] of Object.entries(raw)) {
    if (key === '_meta') continue;
    orders[key] = JSON.parse(val);
  }
  return orders;
}

async function getBlobOrders() {
  const token = env('NETLIFY_AUTH_TOKEN');
  const siteId = env('NETLIFY_SITE_ID');
  const headers = { 'Authorization': `Bearer ${token}` };

  const list = await httpGet(`${BLOBS_BASE}/${siteId}/order-book?prefix=`, headers);
  const keys = (list.blobs || []).map(b => b.key).sort().reverse();
  if (keys.length === 0) throw new Error('No blobs in order-book');

  const blob = await httpGet(`${BLOBS_BASE}/${siteId}/order-book/${encodeURIComponent(keys[0])}`, headers);

  const orders = {};
  for (const o of (blob.recent_orders || [])) {
    orders[o.order_id] = { ...o, _type: 'stock' };
  }
  for (const o of (blob.recent_option_orders || [])) {
    orders[o.order_id] = { ...o, _type: 'option' };
  }
  return { orders, blobKey: keys[0], timestamp: blob.timestamp };
}

async function main() {
  const redisOrders = await getRedisOrders();
  const { orders: blobOrders, blobKey } = await getBlobOrders();

  const redisIds = new Set(Object.keys(redisOrders));
  const blobIds = new Set(Object.keys(blobOrders));

  // Only compare historical orders (Redis has open orders the blob doesn't)
  const redisHistIds = new Set(
    Object.entries(redisOrders)
      .filter(([, o]) => o._status === 'historical')
      .map(([id]) => id)
  );

  const inRedisOnly = [...redisHistIds].filter(id => !blobIds.has(id));
  const inBlobOnly = [...blobIds].filter(id => !redisIds.has(id));

  console.log(`Redis: ${redisIds.size} total (${redisHistIds.size} historical)`);
  console.log(`Blob (${blobKey}): ${blobIds.size} orders`);
  console.log(`Match: ${[...redisHistIds].filter(id => blobIds.has(id)).length} shared`);
  console.log(`In Redis only: ${inRedisOnly.length}`);
  console.log(`In Blob only: ${inBlobOnly.length}`);

  if (inRedisOnly.length > 0) {
    console.log('\nRedis-only orders:');
    for (const id of inRedisOnly.slice(0, 10)) {
      const o = redisOrders[id];
      const sym = o._type === 'option' ? (o.legs?.[0]?.chain_symbol || '?') : o.symbol;
      console.log(`  ${id.slice(0, 8)}... ${sym} ${o._type} ${o.state} ${o.created_at}`);
    }
  }
  if (inBlobOnly.length > 0) {
    console.log('\nBlob-only orders:');
    for (const id of inBlobOnly.slice(0, 10)) {
      const o = blobOrders[id];
      const sym = o._type === 'option' ? (o.legs?.[0]?.chain_symbol || '?') : o.symbol;
      console.log(`  ${id.slice(0, 8)}... ${sym} ${o._type} ${o.state} ${o.created_at}`);
    }
  }

  // Alert if mismatch
  const hasMismatch = inRedisOnly.length > 0 || inBlobOnly.length > 0;
  const webhookUrl = env('SLACK_WEBHOOK_URL', false);

  if (hasMismatch && webhookUrl) {
    const lines = [
      ':warning: *Redis vs Blob Order Mismatch*',
      `Blob: \`${blobKey}\` (${blobIds.size} orders)`,
      `Redis: ${redisHistIds.size} historical orders`,
    ];
    if (inRedisOnly.length > 0) {
      lines.push(`*${inRedisOnly.length} in Redis only:*`);
      for (const id of inRedisOnly.slice(0, 5)) {
        const o = redisOrders[id];
        const sym = o._type === 'option' ? (o.legs?.[0]?.chain_symbol || '?') : o.symbol;
        lines.push(`  \`${id.slice(0, 8)}\` ${sym} ${o._type} ${o.state}`);
      }
    }
    if (inBlobOnly.length > 0) {
      lines.push(`*${inBlobOnly.length} in Blob only:*`);
      for (const id of inBlobOnly.slice(0, 5)) {
        const o = blobOrders[id];
        const sym = o._type === 'option' ? (o.legs?.[0]?.chain_symbol || '?') : o.symbol;
        lines.push(`  \`${id.slice(0, 8)}\` ${sym} ${o._type} ${o.state}`);
      }
    }
    await sendSlack(webhookUrl, lines.join('\n'));
    console.log('\nSlack alert sent.');
  } else if (!hasMismatch) {
    console.log('\nAll orders match. No alert needed.');
  } else {
    console.log('\nMismatch found but SLACK_WEBHOOK_URL not set — skipping alert.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
