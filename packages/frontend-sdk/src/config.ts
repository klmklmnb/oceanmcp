/**
 * Centralised environment configuration.
 *
 * Vite statically replaces `import.meta.env.VITE_*` at build time, so the
 * correct value is baked into the bundle depending on the build mode:
 *   - `vite dev`                → .env.development  (localhost)
 *   - `vite build --mode test`  → .env.test          (test server)
 *   - `vite build`              → .env.production     (prod server)
 *
 * Host apps can still override at runtime via `window.__OCEAN_MCP_SERVER_URL__`.
 */

const runtimeOverride =
  typeof window !== "undefined" &&
  (window as any).__OCEAN_MCP_SERVER_URL__;

/**
 * Base URL of the OceanMCP api-server (no trailing slash).
 *
 * Resolution order:
 * 1. Runtime override: `window.__OCEAN_MCP_SERVER_URL__`
 * 2. Build-time env:   `VITE_API_URL`
 * 3. Fallback:         `http://localhost:4000`
 */
export const API_URL: string =
  runtimeOverride || import.meta.env.VITE_API_URL || "http://localhost:4000";
