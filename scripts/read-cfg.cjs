#!/usr/bin/env node
/**
 * Read values from endpoints.cfg and output for GitHub Actions.
 *
 * Usage:
 *   node scripts/read-cfg.cjs redis.gamma_host redis.prod_host
 *
 * In workflows the values are available as step outputs:
 *   ${{ steps.<id>.outputs.redis_gamma_host }}
 */

const fs = require('fs');
const { getConfig } = require('../common/config.cjs');

const config = getConfig();
const outputFile = process.env.GITHUB_OUTPUT;
const args = process.argv.slice(2);

for (const arg of args) {
  const [section, key] = arg.split('.');
  const value = config[section]?.[key];
  if (value === undefined) {
    console.error(`WARNING: ${arg} not found in endpoints.cfg`);
    continue;
  }
  const outputKey = arg.replace(/\./g, '_');
  if (outputFile) {
    fs.appendFileSync(outputFile, `${outputKey}=${value}\n`);
  }
  console.log(`${outputKey}=${value}`);
}
