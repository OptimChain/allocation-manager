/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TWELVE_DATA_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'virtual:endpoints' {
  const endpoints: {
    redis: Record<string, string>;
    netlify: Record<string, string>;
    blob_stores: Record<string, string>;
    blob_store_archive_pairs: Record<string, string>;
    apis: Record<string, string>;
    environments: Record<string, string>;
  };
  export default endpoints;
}
