import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: "src/main.tsx",
      name: "OceanMCPSDK",
      fileName: "sdk",
      formats: ["es"],
    },
    rollupOptions: {
      // Don't externalize React — bundle it for injection into host apps
    },
  },
  server: {
    port: 3000,
    cors: true,
  },
});
