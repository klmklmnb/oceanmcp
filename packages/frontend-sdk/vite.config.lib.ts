import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * ESM library build for direct module import:
 *   import OceanMCPSDK from "./lib/ocean-mcp/sdk.js"
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    cssCodeSplit: false,
    cssMinify: true,
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
      formats: ["es"],
      fileName: () => "sdk.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "sdk.[ext]",
      },
    },
  },
});
