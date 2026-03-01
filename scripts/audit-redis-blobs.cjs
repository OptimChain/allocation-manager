#!/usr/bin/env node
/**
 * Audit: compare Redis state against latest blob snapshot.
 *
 * Checks:
 * 1. Redis is reachable and has data
 * 2. Latest blob exists and is recent (< 15 min old)
 * 3. Stock order counts match between Redis and blob
 * 4. Option order counts match between Redis and blob
 * 5. Position counts match between Redis stocks hash and blob portfolio
 *
 * Env vars: NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID, REDIS_HOST, REDIS_PASSWORD
 */

const https = require('https');
const { createClient } = require('redis');

const BLOBS_BASE = 'https://api.netlify.com/api/v1/blobs';
const SITE_ID = process.env.NETLIFY_SITE_ID;
const TOKEN = process.env.NETLIFY_AUTH_TOKEN;

function requiredEnv(name) {
  const val = process.env[name];
  if (!val) { console.error(`ERROR: ${name} required`); process.exit(1); }
  return val;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Authorization': `Bearer ${TOKEN}` } }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`GET ${url} -> ${res.statusCode}`));
        else resolve(JSON.parse(chunks.join('')));
      });
    }).on('error', reject);
  });
}

async function getRedisData() {
  const hostPort = requiredEnv('REDIS_HOST');
  const password = process.env.REDIS_PASSWORD;
  const [host, portStr] = hostPort.includes(':') ? hostPort.split(':') : [hostPort, '6379'];
  const port = parseInt(portStr, 10);

  const client = createClient({
    socket: { host, port },
    password: password || undefined,
  });

  await client.connect();

  const orders = await client.hGetAll('orders');
  const stocks = await client.hGetAll('stocks');
  await client.quit();

  return { orders, stocks };
}

async function getLatestBlob() {
  const list = await httpGet(`${BLOBS_BASE}/${SITE_ID}/order-book?prefix=`);
  const keys = (list.blobs || []).map(b => b.key).sort().reverse();
  if (keys.length === 0) throw new Error('No blobs in order-book store');

  const blob = await httpGet(`${BLOBS_BASE}/${SITE_ID}/order-book/${encodeURIComponent(keys[0])}`);
  return { key: keys[0], totalBlobs: keys.length, blob };
}

function parseRedisOrders(raw) {
  const result = { stock: { open: 0, historical: 0 }, option: { open: 0, historical: 0 }, total: 0 };
  for (const [key, val] of Object.entries(raw)) {
    if (key === '_meta') continue;
    result.total++;
    const order = JSON.parse(val);
    const type = order._type === 'option' ? 'option' : 'stock';
    const status = order._status === 'open' ? 'open' : 'historical';
    result[type][status]++;
  }
  const meta = raw._meta ? JSON.parse(raw._meta) : {};
  return { ...result, meta };
}

function parseRedisStocks(raw) {
  let positions = 0, options = 0;
  for (const key of Object.keys(raw)) {
    if (key === '_meta') continue;
    if (key.startsWith('OPT:')) options++;
    else positions++;
  }
  const meta = raw._meta ? JSON.parse(raw._meta) : {};
  return { positions, options, meta };
}

async function main() {
  requiredEnv('NETLIFY_AUTH_TOKEN');
  requiredEnv('NETLIFY_SITE_ID');

  const issues = [];
  let redisOrders, redisStocks, blobData;

  // 1. Check Redis
  console.log('=== Redis ===');
  try {
    const redis = await getRedisData();
    redisOrders = parseRedisOrders(redis.orders);
    redisStocks = parseRedisStocks(redis.stocks);
    console.log(`  Orders: ${redisOrders.total} total (${redisOrders.stock.open} open stock, ${redisOrders.stock.historical} hist stock, ${redisOrders.option.open} open opt, ${redisOrders.option.historical} hist opt)`);
    console.log(`  Stocks: ${redisStocks.positions} positions, ${redisStocks.options} option positions`);
    console.log(`  Last updated: ${redisOrders.meta.updated_at || 'unknown'}`);
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    issues.push(`Redis unreachable: ${e.message}`);
  }

  // 2. Check latest blob
  console.log('\n=== Blob Store ===');
  try {
    const { key, totalBlobs, blob } = await getLatestBlob();
    blobData = blob;
    const blobTime = new Date(blob.timestamp);
    const ageMin = Math.round((Date.now() - blobTime.getTime()) / 60000);
    console.log(`  Latest blob: ${key} (${ageMin} min ago)`);
    console.log(`  Total blobs in order-book: ${totalBlobs}`);

    const blobStockOrders = (blob.recent_orders || []).length;
    const blobOptionOrders = (blob.recent_option_orders || []).length;
    const blobPositions = (blob.portfolio?.positions || []).length;
    const blobOptions = (blob.portfolio?.options || []).length;
    console.log(`  Stock orders: ${blobStockOrders}`);
    console.log(`  Option orders: ${blobOptionOrders}`);
    console.log(`  Positions: ${blobPositions}, Option positions: ${blobOptions}`);

    if (ageMin > 15) {
      issues.push(`Blob is stale: ${ageMin} min old (expected < 15 min)`);
    }
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    issues.push(`Blob store error: ${e.message}`);
  }

  // 3. Cross-check
  if (redisOrders && blobData) {
    console.log('\n=== Cross-Check ===');
    const blobStockOrders = (blobData.recent_orders || []).length;
    const blobOptionOrders = (blobData.recent_option_orders || []).length;

    const stockDiff = Math.abs(redisOrders.stock.historical - blobStockOrders);
    const optionDiff = Math.abs(redisOrders.option.historical - blobOptionOrders);

    console.log(`  Historical stock orders: Redis=${redisOrders.stock.historical} Blob=${blobStockOrders} (diff=${stockDiff})`);
    console.log(`  Historical option orders: Redis=${redisOrders.option.historical} Blob=${blobOptionOrders} (diff=${optionDiff})`);

    if (redisStocks) {
      const blobPositions = (blobData.portfolio?.positions || []).length;
      const posDiff = Math.abs(redisStocks.positions - blobPositions);
      console.log(`  Positions: Redis=${redisStocks.positions} Blob=${blobPositions} (diff=${posDiff})`);

      if (posDiff > 2) {
        issues.push(`Position count mismatch: Redis=${redisStocks.positions} Blob=${blobPositions}`);
      }
    }

    if (stockDiff > 5) {
      issues.push(`Stock order count diverged: Redis=${redisOrders.stock.historical} Blob=${blobStockOrders}`);
    }
    if (optionDiff > 2) {
      issues.push(`Option order count diverged: Redis=${redisOrders.option.historical} Blob=${blobOptionOrders}`);
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  if (issues.length === 0) {
    console.log('  All checks passed.');
  } else {
    console.log(`  ${issues.length} issue(s):`);
    issues.forEach(i => console.log(`    - ${i}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
