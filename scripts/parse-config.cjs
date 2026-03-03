/**
 * parse-config.cjs
 *
 * INI-style .cfg parser. Reads a file with [section] headers and KEY=VALUE
 * pairs, returning a nested object: { section: { key: value } }.
 *
 * Usage:
 *   const { parseConfig, resolveConfig } = require('./parse-config.cjs');
 *   const sections = parseConfig('/path/to/deploy.cfg');
 *   const merged  = resolveConfig(sections, 'gamma'); // common + gamma
 */

const fs = require('fs');
const path = require('path');

/**
 * Parse a .cfg file into { section: { key: value } }.
 * Keys and section names are case-sensitive.
 * @param {string} filePath - Absolute or relative path to .cfg file
 * @returns {Record<string, Record<string, string>>}
 */
function parseConfig(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  return parseConfigString(content);
}

/**
 * Parse raw .cfg content string into { section: { key: value } }.
 * @param {string} content - Raw .cfg file content
 * @returns {Record<string, Record<string, string>>}
 */
function parseConfigString(content) {
  const sections = {};
  let currentSection = 'default';

  for (const raw of content.split('\n')) {
    const line = raw.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Section header: [section_name]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!sections[currentSection]) sections[currentSection] = {};
      continue;
    }

    // Key=Value pair
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();

    if (!key) continue;

    if (!sections[currentSection]) sections[currentSection] = {};
    sections[currentSection][key] = value;
  }

  return sections;
}

/**
 * Merge [common] with a target environment section.
 * Environment-specific values override common values.
 * @param {Record<string, Record<string, string>>} sections
 * @param {string} environment - e.g. "gamma" or "prod"
 * @returns {Record<string, string>}
 */
function resolveConfig(sections, environment) {
  const common = sections['common'] || {};
  const env = sections[environment];

  if (!env && environment !== 'common') {
    const available = Object.keys(sections).filter(s => s !== 'common').join(', ');
    throw new Error(
      `Unknown environment "${environment}". Available: ${available}`
    );
  }

  return { ...common, ...(env || {}) };
}

module.exports = { parseConfig, parseConfigString, resolveConfig };
