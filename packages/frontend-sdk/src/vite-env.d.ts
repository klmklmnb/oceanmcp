/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the OceanMCP api-server (e.g. http://localhost:4001) */
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// ─── Inline CSS module declaration ───────────────────────────────────────────
// Vite's `?inline` suffix imports CSS as a raw string instead of injecting it
// into the document <head>. This allows us to programmatically inject the CSS
// into a Shadow DOM.
declare module "*.css?inline" {
  const css: string;
  export default css;
}

declare const __SDK_BUILD__: "demo" | "esm" | "umd";
declare const __SDK_VERSION__: string;
