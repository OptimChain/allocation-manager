#!/usr/bin/env node
/**
 * Archive old order-book blobs to state-logs.
 *
 * Moves blobs older than RETENTION_DAYS from order-book → state-logs,
 * then deletes from order-book.
 *
 * Env vars: NETLIFY_AUTH_TOKEN, NETLIFY_SITE_ID, RETENTION_DAYS (default 7)
 */

const https = require('https');

const BLOBS_BASE = 'https://api.netlify.com/api/v1/blobs';
const SRC_STORE = 'order-book';
const DST_STORE = 'state-logs';
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '7', 10);

const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const SITE_ID = process.env.NETLIFY_SITE_ID;

if (!TOKEN || !SITE_ID) {
  console.error('ERROR: NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID required');
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

async function listBlobs(store) {
  const text = await request('GET', `${BLOBS_BASE}/${SITE_ID}/${store}?prefix=`);
  return JSON.parse(text).blobs.map(b => b.key);
}

async function main() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString().slice(0, 11);
  console.log(`Archiving order-book blobs older than ${RETENTION_DAYS} days (cutoff: ${cutoff})`);

  const keys = await listBlobs(SRC_STORE);
  const oldKeys = keys.filter(k => k < cutoff).sort();

  console.log(`Total blobs in ${SRC_STORE}: ${keys.length}`);
  console.log(`Blobs to archive: ${oldKeys.length}`);

  if (oldKeys.length === 0) {
    console.log('Nothing to archive.');
    return;
  }

  let moved = 0, failed = 0;
  for (const key of oldKeys) {
    try {
      const data = await request('GET', `${BLOBS_BASE}/${SITE_ID}/${SRC_STORE}/${encodeURIComponent(key)}`);
      await request('PUT', `${BLOBS_BASE}/${SITE_ID}/${DST_STORE}/${encodeURIComponent(key)}`, data);
      await request('DELETE', `${BLOBS_BASE}/${SITE_ID}/${SRC_STORE}/${encodeURIComponent(key)}`);
      moved++;
      console.log(`  archived: ${key}`);
    } catch (e) {
      failed++;
      console.error(`  FAILED ${key}: ${e.message}`);
    }
  }

  console.log(`\nDone: ${moved} archived, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
