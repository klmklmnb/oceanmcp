import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Separate build config for the UMD bundle.
 *
 * Produces `sdk.umd.js` + `sdk.css`.
 * CSS is output as a standalone file (not injected by JS) so it works
 * correctly inside qiankun / micro-frontend sandboxes.
 *
 * Usage:
 *   <link rel="stylesheet" href="sdk.css" />
 *   <script src="sdk.umd.js"></script>
 *
 * Run after the main build so it doesn't clear the dist folder.
 */
export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [react(), tailwindcss()],
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
    rollupOptions: {
      output: {
        assetFileNames: "sdk.[ext]",
      },
    },
  },
});
