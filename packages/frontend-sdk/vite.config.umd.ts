import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

/**
 * Separate build config for the UMD bundle.
 *
 * Produces a single self-contained `sdk.umd.js` that can be loaded via
 * a <script> tag — no module bundler required on the consumer side.
 *
 * Run after the main build so it doesn't clear the dist folder.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), cssInjectedByJsPlugin()],
  build: {
    cssCodeSplit: false,
    cssMinify: true,
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
      name: "OceanMCPSDK",
      formats: ["umd"],
      fileName: () => "sdk.umd.js",
    },
  },
});
