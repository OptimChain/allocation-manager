#!/usr/bin/env node
// plan-nyc-mich MCP server — NYC-area → Michigan weekend flights
// Proxies to the Netlify search-flights function (holds Amadeus creds).
// Override upstream: ROUTE_MANAGER_ENDPOINT env var.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const ENDPOINT =
  process.env.ROUTE_MANAGER_ENDPOINT ||
  'https://route-manager-prod.netlify.app/.netlify/functions/search-flights';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const CACHE_DIR = join(homedir(), '.hermes', 'mcp-cache');
const CACHE_FILE = join(CACHE_DIR, 'plan-nyc-mich.json');

const ROUTES = [
  ['JFK', 'GRR'], ['JFK', 'DTW'],
  ['LGA', 'GRR'], ['LGA', 'DTW'],
  ['NYC', 'GRR'], ['NYC', 'DTW'],
];

const flightsUrl = (o, d, date = null) =>
  `https://www.google.com/travel/flights?q=One-way%20flights%20from%20${o}%20to%20${d}${date ? `%20on%20${date}` : ''}`;

const iso = (d) => d.toISOString().slice(0, 10);
const dayLabel = (s) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(s + 'T00:00:00Z').getUTCDay()];

// --- Cache ---
function loadCache() {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    const now = Date.now();
    // Evict expired entries on load
    return Object.fromEntries(
      Object.entries(raw).filter(([, v]) => now - v.ts < CACHE_TTL_MS)
    );
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch { /* non-fatal */ }
}

// --- Dates ---
function weekendDates(weeks) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysToSat = ((6 - today.getUTCDay() + 7) % 7) || 7;
  const firstSat = new Date(today);
  firstSat.setUTCDate(today.getUTCDate() + daysToSat);
  const dates = [];
  for (let w = 0; w < weeks; w++) {
    const sat = new Date(firstSat);
    sat.setUTCDate(firstSat.getUTCDate() + 7 * w);
    const sun = new Date(sat);
    sun.setUTCDate(sat.getUTCDate() + 1);
    dates.push(iso(sat), iso(sun));
  }
  return dates;
}

// --- Fetch ---
async function fetchOffer(origin, destination, departureDate) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin, destination, departureDate, adults: 1, nonStop: false, maxResults: 5 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { data = [] } = await res.json();
  let best = null;
  for (const offer of data) {
    const price = parseFloat(offer.price?.grandTotal ?? offer.price?.total);
    if (!Number.isFinite(price)) continue;
    if (!best || price < best.price) {
      const seg = offer.itineraries?.[0]?.segments?.[0] ?? {};
      best = { price, carrier: seg.carrierCode ?? null, flightNumber: seg.number ?? null };
    }
  }
  return best;
}

async function fetchAll(weeks) {
  const dates = weekendDates(weeks);
  const tasks = ROUTES.flatMap(([o, d]) => dates.map((date) => ({ o, d, date })));
  const cache = loadCache();
  const logs = [];

  logs.push(`Searching ${tasks.length} route×date combinations (cache TTL 30 min)...\n`);

  const results = await Promise.all(
    tasks.map(async ({ o, d, date }) => {
      const key = `${o}|${d}|${date}`;
      const url = flightsUrl(o, d, date);

      if (cache[key]) {
        const offer = cache[key].offer;
        const priceStr = offer ? `$${offer.price.toFixed(2)}` : '—';
        const tag = offer?.carrier ? ` (${offer.carrier}${offer.flightNumber ?? ''})` : '';
        logs.push(`  ✓ ${o}→${d} ${dayLabel(date)} ${date.slice(5)}: ${priceStr}${tag} [cached]`);
        process.stderr.write(`  [cache] ${o}→${d} ${date.slice(5)}: ${priceStr}\n`);
        return { o, d, date, ...(offer ?? { price: null }) };
      }

      // Log the root search URL before the fetch — visible to stderr immediately
      process.stderr.write(`🔍 ${url}\n`);

      try {
        const offer = await fetchOffer(o, d, date);
        cache[key] = { ts: Date.now(), offer };
        const priceStr = offer ? `$${offer.price.toFixed(2)}` : '—';
        const tag = offer?.carrier ? ` (${offer.carrier}${offer.flightNumber ?? ''})` : '';
        logs.push(`  ✓ ${o}→${d} ${dayLabel(date)} ${date.slice(5)}: ${priceStr}${tag}`);
        process.stderr.write(`  ✓ ${o}→${d} ${date.slice(5)}: ${priceStr}${tag}\n`);
        return { o, d, date, ...(offer ?? { price: null }) };
      } catch (e) {
        logs.push(`  ✗ ${o}→${d} ${date}: ${e.message}`);
        process.stderr.write(`  ✗ ${o}→${d} ${date}: ${e.message}\n`);
        return { o, d, date, price: null };
      }
    })
  );

  saveCache(cache);
  return { dates, results, logs };
}

// --- Render ---
function render({ dates, results, logs }) {
  const best = results.reduce(
    (b, r) => (r.price != null && (!b || r.price < b.price) ? r : b),
    null
  );

  const header = dates.map((d) => `${dayLabel(d)} ${d.slice(5)}`);
  const tableLines = [
    `| Route | ${header.join(' | ')} |`,
    `|---|${dates.map(() => '---').join('|')}|`,
  ];
  for (const [o, d] of ROUTES) {
    const cells = dates.map((date) => {
      const r = results.find((x) => x.o === o && x.d === d && x.date === date);
      const v = r?.price == null ? '—' : `$${r.price.toFixed(2)}`;
      return `[${v}](${flightsUrl(o, d, date)})`;
    });
    tableLines.push(`| [${o}→${d}](${flightsUrl(o, d)}) | ${cells.join(' | ')} |`);
  }

  const serialized = best
    ? (() => {
        const p = new URLSearchParams({ q: `One-way flights from ${best.o} to ${best.d} on ${best.date}` });
        if (best.carrier) p.set('carrier', best.carrier);
        if (best.flightNumber) p.set('flight', `${best.carrier}${best.flightNumber}`);
        return `\nhttps://www.google.com/travel/flights?${p.toString()}`;
      })()
    : '';

  const bestLine = best
    ? `**Best: ${best.o} → ${best.d} — ${dayLabel(best.date)} ${best.date} — $${best.price.toFixed(2)}**${best.carrier ? ` (${best.carrier}${best.flightNumber ?? ''})` : ''}`
    : 'No bookable offers found.';

  return [
    `https://www.google.com/travel/flights?q=One-way%20flights%20from%20NYC%20to%20Michigan`,
    '',
    logs.join('\n'),
    '',
    tableLines.join('\n'),
    '',
    bestLine,
    serialized,
  ].join('\n');
}

// --- Server ---
const server = new Server({ name: 'plan_nyc_mich', version: '0.5.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'nyc_to_michigan_flights',
    description:
      'One-way weekend flights from NYC-area airports (JFK/LGA/NYC) to Michigan (GRR/DTW) for the next N weekends. Fetches in parallel with 30-min file cache. Returns root search link, per-fetch price log (visible to agent), full matrix with Google Flights links, and a serialized best-deal link.',
    inputSchema: {
      type: 'object',
      properties: {
        weeks: { type: 'number', default: 4, description: 'Number of upcoming weekends to check (default 4).' },
      },
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'nyc_to_michigan_flights') throw new Error(`Unknown tool: ${req.params.name}`);
  const weeks = req.params.arguments?.weeks ?? 4;
  return { content: [{ type: 'text', text: render(await fetchAll(weeks)) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
