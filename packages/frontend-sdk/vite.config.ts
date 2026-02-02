import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import { resolve } from "path";

export default defineConfig({
  base:  "/hacker-agent-sdk/",
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
      name: "HackerAgentSDK",
      fileName: "sdk",
      formats: ["es", "umd"],
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
      },
    },
    cssCodeSplit: false,
  },
  server: {
    port: 3000,
    cors: true,
    hmr: {
      port: 3000,
    },
  },
});
