/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the sync API; falls back to a placeholder in lib/config.ts. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
