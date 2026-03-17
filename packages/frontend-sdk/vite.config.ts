import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import packageJson from "./package.json";

export default defineConfig(({ command }) => {
  return {
    base: command === "serve" ? "/" : "/ocean-mcp/",
    define: {
      __SDK_VERSION__: JSON.stringify(packageJson.version),
      __SDK_BUILD__: JSON.stringify("demo"),
    },
    plugins: [react(), tailwindcss()],
    build: {
      // CSS is imported as a raw string via `?inline` in main.tsx and injected
      // into the Shadow DOM at runtime — no separate CSS file needed.
      cssCodeSplit: false,
      cssMinify: true,
      sourcemap: true,
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
  };
});
