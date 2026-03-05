import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

function parseCfg(filePath: string): Record<string, Record<string, string>> {
  const text = fs.readFileSync(filePath, 'utf-8');
  const result: Record<string, Record<string, string>> = {};
  let section: string | null = null;

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

export default function cfgPlugin(): Plugin {
  const virtualId = 'virtual:endpoints';
  const resolvedId = '\0' + virtualId;
  const cfgPath = path.resolve(__dirname, 'endpoints.cfg');

  return {
    name: 'vite-plugin-cfg',

    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },

    load(id) {
      if (id === resolvedId) {
        const config = parseCfg(cfgPath);
        return `export default ${JSON.stringify(config)};`;
      }
    },

    handleHotUpdate({ file, server }) {
      if (file === cfgPath) {
        const mod = server.moduleGraph.getModuleById(resolvedId);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          return [mod];
        }
      }
    },
  };
}
