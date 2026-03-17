import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import dts from "vite-plugin-dts";
import packageJson from "./package.json";

/**
 * ESM library build for direct module import:
 *   import OceanMCPSDK from "./lib/ocean-mcp/sdk.esm.js"
 *
 * Also generates a bundled `sdk.esm.d.ts` declaration file so ESM
 * consumers get full TypeScript support out of the box.
 */
export default defineConfig({
  define: {
    __SDK_VERSION__: JSON.stringify(packageJson.version),
    __SDK_BUILD__: JSON.stringify("esm"),
  },
  plugins: [
    react(),
    tailwindcss(),
    dts({
      rollupTypes: true,
      tsconfigPath: resolve(__dirname, "tsconfig.json"),
      include: ["src/**/*"],
      exclude: ["src/**/*.test.*", "src/**/*.spec.*"],
    }),
  ],
  build: {
    cssCodeSplit: false,
    cssMinify: true,
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
      formats: ["es"],
      fileName: () => "sdk.esm.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "sdk.[ext]",
      },
    },
  },
});
