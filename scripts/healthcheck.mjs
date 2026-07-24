#!/usr/bin/env node
// Post-deploy healthcheck: pings each Netlify function and reports status.
// Usage:
//   node scripts/healthcheck.mjs                       # check prod
//   node scripts/healthcheck.mjs --url https://...     # check a preview URL
//   node scripts/healthcheck.mjs --json                # machine-readable output

import { readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = join(__dirname, '..', 'netlify', 'functions');
const DEFAULT_BASE = 'https://5thstreetcapital.org';
const TIMEOUT_MS = 8000;

// Functions that should NOT be hit by an unauthenticated GET (would mutate state,
// require a body, or burn rate-limited upstream credits). We still verify they
// are reachable — a 4xx response proves the function is wired up and alive.
const EXPECTED_NON_200 = new Set([
  'plaid-link',          // POST-only, requires public_token
  'robinhood-auth',      // POST-only, requires credentials
  'robinhood-bot',       // POST-only, side effects
  'vend-blobs',          // POST-only
  'alert-slack',         // POST-only, would actually send a Slack message
  'order-book-snapshot', // requires query params
  'scheduled-news-fetch',// scheduled function, not invokable via HTTP
  'news-cache',          // internal helper
  'redis-holdings',      // requires query params (returns 400 without)
  'robinhood-portfolio', // requires auth (returns 401 without session)
]);

// Functions excluded entirely (e.g. internal libs, scheduled-only)
const SKIP = new Set(['lib', 'scheduled-news-fetch']);

function parseArgs(argv) {
  const args = { url: DEFAULT_BASE, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--url' && argv[i + 1]) { args.url = argv[++i]; }
    else if (argv[i] === '--json') { args.json = true; }
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('usage: healthcheck.mjs [--url <site-url>] [--json]');
      process.exit(0);
    }
  }
  return args;
}

function discoverFunctions() {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(n => /\.(c?js|m?ts|m?js)$/.test(n))
    .map(n => basename(n).replace(/\.(c?js|m?ts|m?js)$/, ''))
    .filter(n => !SKIP.has(n));
}

async function ping(baseUrl, fn) {
  const url = `${baseUrl.replace(/\/$/, '')}/.netlify/functions/${fn}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    const ms = Date.now() - start;
    const ok = res.status < 500 && (res.status === 200 || EXPECTED_NON_200.has(fn));
    return { fn, url, status: res.status, ms, ok };
  } catch (err) {
    return { fn, url, status: 0, ms: Date.now() - start, ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const functions = discoverFunctions();

  if (!args.json) {
    console.log(`\nHealthcheck: ${args.url}`);
    console.log(`Functions:   ${functions.length}\n`);
  }

  const results = await Promise.all(functions.map(fn => ping(args.url, fn)));
  results.sort((a, b) => a.fn.localeCompare(b.fn));

  if (args.json) {
    console.log(JSON.stringify({ baseUrl: args.url, results }, null, 2));
  } else {
    for (const r of results) {
      const mark = r.ok ? 'OK  ' : 'FAIL';
      const code = r.error ? r.error : String(r.status);
      const note = EXPECTED_NON_200.has(r.fn) && r.status >= 400 && r.status < 500
        ? ' (expected non-200)'
        : '';
      console.log(`  [${mark}] ${r.fn.padEnd(25)} ${code.padEnd(6)} ${String(r.ms).padStart(5)}ms${note}`);
    }
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} healthy`);
    if (failed.length) {
      console.log(`FAILURES: ${failed.map(f => f.fn).join(', ')}`);
    }
  }

  process.exit(results.some(r => !r.ok) ? 1 : 0);
}

main().catch(err => {
  console.error('healthcheck crashed:', err);
  process.exit(2);
});
