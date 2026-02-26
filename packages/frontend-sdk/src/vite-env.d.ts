/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the OceanMCP api-server (e.g. http://localhost:4000) */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
