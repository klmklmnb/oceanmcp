import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Separate build config for the UMD bundle.
 *
 * Produces `sdk.umd.js` (self-contained — CSS is embedded in the JS and
 * injected into the Shadow DOM at mount time, so no external `sdk.css` is
 * needed).
 *
 * Usage:
 *   <script src="sdk.umd.js"></script>
 *   <script>OceanMCPSDK.mount();</script>
 *
 * Run after the main build so it doesn't clear the dist folder.
 */
export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [react(), tailwindcss()],
  build: {
    // CSS is imported as `?inline` in main.tsx — it becomes a JS string
    // constant embedded in the bundle, not a separate CSS asset.
    cssCodeSplit: false,
    cssMinify: true,
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
      name: "OceanMCPSDK",
      formats: ["umd"],
      fileName: () => "sdk.umd.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "sdk.[ext]",
      },
    },
  },
});
