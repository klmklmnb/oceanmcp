import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

export default defineConfig(({ command }) => ({
  base: command === "serve" ? "/" : "/ocean-mcp/",
  plugins: [react(), tailwindcss(), cssInjectedByJsPlugin()],
  build: {
    cssCodeSplit: false,
    cssMinify: true,
    rollupOptions: {
      input: {
        sdk: resolve(__dirname, "src/main.tsx"),
        demo: resolve(__dirname, "index.html")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name].[ext]"
      }
    }
  },
  server: {
    port: 3000,
    cors: true
  }
}));
