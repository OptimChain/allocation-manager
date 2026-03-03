#!/usr/bin/env node
/**
 * load-remote-config.cjs
 *
 * Fetches a .cfg file from a remote GitHub repo and writes the resolved
 * key-value pairs to a local file (default: config/.env.deploy).
 *
 * Usage:
 *   node scripts/load-remote-config.cjs --env gamma
 *   node scripts/load-remote-config.cjs --env prod --ref v1.2.0
 *   node scripts/load-remote-config.cjs --local config/deploy.cfg --env gamma
 *
 * Environment variables (or .env):
 *   CONFIG_REPO       - owner/repo  (e.g. "IamJasonBian/platform-config")
 *   CONFIG_PATH       - file path   (e.g. "services/allocation-manager/deploy.cfg")
 *   CONFIG_REF        - branch/tag  (default: "main")
 *   GITHUB_TOKEN      - PAT with repo read access (not needed for public repos)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseConfig, parseConfigString, resolveConfig } = require('./parse-config.cjs');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const environment = getArg('--env', process.env.DEPLOY_ENV || 'gamma');
const ref         = getArg('--ref', process.env.CONFIG_REF || 'main');
const localFile   = getArg('--local', '');
const outputPath  = getArg('--out', path.join(__dirname, '..', 'config', '.env.deploy'));
const repo        = process.env.CONFIG_REPO || getArg('--repo', '');
const cfgPath     = process.env.CONFIG_PATH || getArg('--path', '');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        } else {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
  });
}

async function fetchRemoteConfig() {
  if (!repo || !cfgPath) {
    console.error(
      'Error: CONFIG_REPO and CONFIG_PATH must be set (env vars or --repo / --path flags).\n' +
      'Example:\n' +
      '  CONFIG_REPO=IamJasonBian/platform-config CONFIG_PATH=services/allocation-manager/deploy.cfg \\\n' +
      '    node scripts/load-remote-config.cjs --env gamma'
    );
    process.exit(1);
  }

  const url = `https://api.github.com/repos/${repo}/contents/${cfgPath}?ref=${ref}`;
  const headers = {
    'User-Agent': 'allocation-manager-config-loader',
    'Accept': 'application/vnd.github.v3.raw',
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  console.log(`Fetching config from ${repo}@${ref} / ${cfgPath} ...`);
  const content = await httpsGet(url, headers);
  return parseConfigString(content);
}

function loadLocalConfig() {
  console.log(`Loading local config from ${localFile} ...`);
  return parseConfig(localFile);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  try {
    const sections = localFile ? loadLocalConfig() : await fetchRemoteConfig();
    const config = resolveConfig(sections, environment);

    // Write resolved config to output file
    const lines = Object.entries(config)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, lines + '\n');

    console.log(`\nResolved config for [${environment}] written to ${outputPath}:`);
    for (const [k, v] of Object.entries(config)) {
      const display = (k.includes('SECRET') || k.includes('TOKEN') || k.includes('PASSWORD'))
        ? '***' : v;
      console.log(`  ${k}=${display}`);
    }

    // Also print as JSON for piping
    if (args.includes('--json')) {
      console.log(JSON.stringify(config, null, 2));
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
