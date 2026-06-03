#!/usr/bin/env node
/**
 * Restore blobs from state-logs-historical back to state-logs.
 * Copies (does NOT delete from historical) so historical remains intact.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BLOBS_BASE = 'https://api.netlify.com/api/v1/blobs';
const SITE_ID = '3d014fc3-e919-4b4d-b374-e8606dee50df';

// Get token from Netlify CLI config
const cfgPath = path.join(require('os').homedir(), 'Library/Preferences/netlify/config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const TOKEN = cfg.users[cfg.userId].auth.token;

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const headers = { 'Authorization': `Bearer ${TOKEN}` };
    if (body) headers['Content-Type'] = 'application/json';

    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
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

async function main() {
  console.log('Listing blobs in state-logs-historical...');
  const listText = await request('GET', `${BLOBS_BASE}/${SITE_ID}/state-logs-historical?prefix=`);
  const blobs = JSON.parse(listText).blobs.map(b => b.key);
  console.log(`Found ${blobs.length} blobs to restore`);

  let copied = 0, failed = 0;
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  for (const key of blobs) {
    try {
      const data = await request('GET', `${BLOBS_BASE}/${SITE_ID}/state-logs-historical/${encodeURIComponent(key)}`);
      await request('PUT', `${BLOBS_BASE}/${SITE_ID}/state-logs/${encodeURIComponent(key)}`, data);
      copied++;
      if (copied % 50 === 0) console.log(`  Progress: ${copied}/${blobs.length}`);
    } catch (e) {
      failed++;
      console.error(`  FAILED ${key}: ${e.message}`);
    }
    await delay(200); // rate limit
  }

  console.log(`\nDone: ${copied} copied, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
