/**
 * configService.ts
 *
 * Reads deployment config values that were injected at build time via
 * Vite's import.meta.env (VITE_* prefixed) or fetches them from the
 * local config/.env.deploy file through a Netlify function.
 *
 * This allows the same .cfg parameters used by GitHub Actions during
 * deployment to be consumed by the running application.
 */

export interface DeployConfig {
  nodeVersion: string;
  buildCommand: string;
  publishDir: string;
  functionsDir: string;
  deployUrl: string;
  deployAlias: string;
  enablePreview: boolean;
  logLevel: string;
  environment: string;
  [key: string]: string | boolean;
}

const ENV_PREFIX = 'VITE_DEPLOY_';

/**
 * Build a DeployConfig from VITE_DEPLOY_* environment variables that
 * were set at build time. Vite statically replaces import.meta.env
 * references, so this works without any runtime fetch.
 */
export function getDeployConfig(): DeployConfig {
  const raw: Record<string, string> = {};

  // Vite exposes VITE_* env vars on import.meta.env
  for (const [key, value] of Object.entries(import.meta.env)) {
    if (key.startsWith(ENV_PREFIX) && typeof value === 'string') {
      // VITE_DEPLOY_NODE_VERSION -> nodeVersion (camelCase)
      const suffix = key.slice(ENV_PREFIX.length);
      const camel = suffix
        .toLowerCase()
        .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      raw[camel] = value;
    }
  }

  return {
    nodeVersion: raw.nodeVersion ?? '20',
    buildCommand: raw.buildCommand ?? 'npm run build',
    publishDir: raw.publishDir ?? 'dist',
    functionsDir: raw.functionsDir ?? 'netlify/functions',
    deployUrl: raw.deployUrl ?? '',
    deployAlias: raw.deployAlias ?? '',
    enablePreview: raw.enablePreview === 'true',
    logLevel: raw.logLevel ?? 'warn',
    environment: raw.environment ?? 'unknown',
    ...raw,
  };
}

/**
 * Parse a raw .cfg string (same format used by the Node scripts).
 * Useful if the config is fetched at runtime from an API.
 */
export function parseCfgString(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let currentSection = 'default';

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!sections[currentSection]) sections[currentSection] = {};
      continue;
    }

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
 * Merge [common] with a specific environment section.
 */
export function resolveCfg(
  sections: Record<string, Record<string, string>>,
  environment: string
): Record<string, string> {
  const common = sections['common'] ?? {};
  const env = sections[environment] ?? {};
  return { ...common, ...env };
}
