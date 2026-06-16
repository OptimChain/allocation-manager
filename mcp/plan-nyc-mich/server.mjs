#!/usr/bin/env node
// plan-nyc-mich MCP server — NYC-area → Michigan weekend flights
// Proxies to the Netlify search-flights function (holds Amadeus creds).
// Override upstream: ROUTE_MANAGER_ENDPOINT env var.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const ENDPOINT =
  process.env.ROUTE_MANAGER_ENDPOINT ||
  'https://route-manager-prod.netlify.app/.netlify/functions/search-flights';

const ROUTES = [
  ['JFK', 'GRR'], ['JFK', 'DTW'],
  ['LGA', 'GRR'], ['LGA', 'DTW'],
  ['NYC', 'GRR'], ['NYC', 'DTW'],
];

const log = (msg) => process.stderr.write(msg + '\n');

const flightsUrl = (o, d, date = null) =>
  `https://www.google.com/travel/flights?q=One-way%20flights%20from%20${o}%20to%20${d}${date ? `%20on%20${date}` : ''}`;

const iso = (d) => d.toISOString().slice(0, 10);
const dayLabel = (s) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(s + 'T00:00:00Z').getUTCDay()];

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

async function fetchOffer(origin, destination, departureDate) {
  // Log the root search link immediately before the fetch
  log(`🔍 ${flightsUrl(origin, destination, departureDate)}`);

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
      best = {
        price,
        carrier: seg.carrierCode ?? null,
        flightNumber: seg.number ?? null,
        departure: seg.departure?.at ?? null,
        arrival: seg.arrival?.at ?? null,
      };
    }
  }
  return best;
}

async function fetchAll(weeks) {
  const dates = weekendDates(weeks);
  const tasks = ROUTES.flatMap(([o, d]) => dates.map((date) => ({ o, d, date })));

  log(`\nSearching ${tasks.length} route×date combinations in parallel...\n`);

  const results = await Promise.all(
    tasks.map(async ({ o, d, date }) => {
      try {
        const offer = await fetchOffer(o, d, date);
        const priceStr = offer ? `$${offer.price.toFixed(2)}` : '—';
        log(`  ✓ ${o}→${d} ${dayLabel(date)} ${date.slice(5)}: ${priceStr}${offer?.carrier ? ` (${offer.carrier}${offer.flightNumber})` : ''}`);
        return { o, d, date, ...(offer ?? { price: null }) };
      } catch (e) {
        log(`  ✗ ${o}→${d} ${date}: ${e.message}`);
        return { o, d, date, price: null };
      }
    })
  );

  return { dates, results };
}

function render({ dates, results }) {
  const best = results.reduce(
    (b, r) => (r.price != null && (!b || r.price < b.price) ? r : b),
    null
  );

  // Matrix table
  const header = dates.map((d) => `${dayLabel(d)} ${d.slice(5)}`);
  const lines = [
    `| Route | ${header.join(' | ')} |`,
    `|---|${dates.map(() => '---').join('|')}|`,
  ];
  for (const [o, d] of ROUTES) {
    const cells = dates.map((date) => {
      const r = results.find((x) => x.o === o && x.d === d && x.date === date);
      const v = r?.price == null ? '—' : `$${r.price.toFixed(2)}`;
      return `[${v}](${flightsUrl(o, d, date)})`;
    });
    lines.push(`| [${o}→${d}](${flightsUrl(o, d)}) | ${cells.join(' | ')} |`);
  }

  // Serialized best-deal link with all known params
  let serialized = '';
  if (best) {
    const params = new URLSearchParams({
      q: `One-way flights from ${best.o} to ${best.d} on ${best.date}`,
    });
    if (best.carrier) params.set('carrier', best.carrier);
    if (best.flightNumber) params.set('flight', `${best.carrier}${best.flightNumber}`);
    serialized = `\nhttps://www.google.com/travel/flights?${params.toString()}`;
  }

  const rootLink = `https://www.google.com/travel/flights?q=One-way%20flights%20from%20NYC%20to%20Michigan`;
  const bestLine = best
    ? `**Best: ${best.o} → ${best.d} — ${dayLabel(best.date)} ${best.date} — $${best.price.toFixed(2)}**${best.carrier ? ` (${best.carrier}${best.flightNumber ?? ''})` : ''}`
    : 'No bookable offers found.';

  return [
    rootLink,
    '',
    lines.join('\n'),
    '',
    bestLine,
    serialized,
  ].join('\n');
}

const server = new Server({ name: 'plan_nyc_mich', version: '0.4.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'nyc_to_michigan_flights',
    description:
      'One-way weekend flights from NYC-area airports (JFK/LGA/NYC) to Michigan (GRR/DTW) for the next N weekends. Immediately logs each search URL and price as fetches complete. Returns root search link, full price matrix with Google Flights links, and a serialized best-deal link.',
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
