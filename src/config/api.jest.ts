/**
 * Jest stand-in for `config/api`.
 *
 * The real module reads `import.meta.env`, which Vite replaces at build time
 * but Jest (CommonJS) cannot parse — importing it from a test throws
 * "Cannot use 'import.meta' outside a module" and takes the whole suite with
 * it. jest.config.cjs maps `config/api` here so tests get the same exports
 * with their default values.
 */

export const API_BASE = '/.netlify/functions';

export const TWELVE_DATA_WS_KEY: string | undefined = 'test-key';
