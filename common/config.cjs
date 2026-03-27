/**
 * INI-style .cfg parser for endpoints.cfg
 * Zero external dependencies — uses only fs + path.
 * Caches the parsed result per process.
 */

const fs = require('fs');
const path = require('path');

function parseCfg(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const result = {};
  let section = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      section = secMatch[1];
      if (!result[section]) result[section] = {};
      continue;
    }

    const eq = line.indexOf('=');
    if (eq > 0 && section) {
      result[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return result;
}

// Try several candidate paths so this works in local dev, scripts/, and
// Netlify Functions runtime (where __dirname may differ after bundling).
const candidates = [
  path.resolve(__dirname, '..', 'endpoints.cfg'),
  path.resolve(process.cwd(), 'endpoints.cfg'),
];

let _cached = null;

function getConfig() {
  if (_cached) return _cached;

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      _cached = parseCfg(p);
      return _cached;
    }
  }
  throw new Error('endpoints.cfg not found. Searched: ' + candidates.join(', '));
}

module.exports = { getConfig, parseCfg };
