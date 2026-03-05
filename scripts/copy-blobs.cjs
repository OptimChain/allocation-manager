#!/usr/bin/env node
/**
 * Copy all blobs from one store to another within the same Netlify site.
 *
 * Usage:
 *   SRC_STORE=state-logs DST_STORE=order-book-prod node scripts/copy-blobs.cjs
 *   SRC_STORE=order-book DST_STORE=order-book-gamma node scripts/copy-blobs.cjs
 *
 * Env vars: NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID, SRC_STORE, DST_STORE
 */

const https = require('https');
const { getConfig } = require('../common/config.cjs');

const config = getConfig();
const BLOBS_BASE = config.netlify.blobs_api_base;

const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const SITE_ID = process.env.NETLIFY_SITE_ID;
const SRC_STORE = process.env.SRC_STORE;
const DST_STORE = process.env.DST_STORE;

if (!TOKEN || !SITE_ID || !SRC_STORE || !DST_STORE) {
  console.error('ERROR: NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID, SRC_STORE, and DST_STORE required');
  process.exit(1);
}

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const headers = { 'Authorization': `Bearer ${TOKEN}` };
    if (body) headers['Content-Type'] = 'application/json';

    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = chunks.join('');
        if (res.statusCode >= 400) {
          reject(new Error(`${method} ${url} -> ${res.statusCode}: ${text.slice(0, 200)}`));
        } else {
          resolve(text);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function listAllBlobs(store) {
  const allKeys = [];
  let url = `${BLOBS_BASE}/${SITE_ID}/${store}?prefix=`;

  while (url) {
    const text = await request('GET', url);
    const data = JSON.parse(text);
    for (const b of (data.blobs || [])) {
      allKeys.push(b.key);
    }
    url = data.next_cursor
      ? `${BLOBS_BASE}/${SITE_ID}/${store}?cursor=${encodeURIComponent(data.next_cursor)}`
      : null;
  }

  return allKeys;
}

async function main() {
  console.log(`Copying blobs: ${SRC_STORE} → ${DST_STORE}`);

  const keys = await listAllBlobs(SRC_STORE);
  console.log(`Found ${keys.length} blobs in ${SRC_STORE}`);

  if (keys.length === 0) {
    console.log('Nothing to copy.');
    return;
  }

  let copied = 0, failed = 0;
  for (const key of keys) {
    try {
      const data = await request('GET', `${BLOBS_BASE}/${SITE_ID}/${SRC_STORE}/${encodeURIComponent(key)}`);
      await request('PUT', `${BLOBS_BASE}/${SITE_ID}/${DST_STORE}/${encodeURIComponent(key)}`, data);
      copied++;
      if (copied % 10 === 0) console.log(`  copied ${copied}/${keys.length}...`);
    } catch (e) {
      failed++;
      console.error(`  FAILED ${key}: ${e.message}`);
    }
  }

  console.log(`\nDone: ${copied} copied, ${failed} failed out of ${keys.length} total`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
