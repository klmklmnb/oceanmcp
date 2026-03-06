import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __SDK_VERSION__: JSON.stringify("0.0.0-test"),
    __SDK_BUILD__: JSON.stringify("demo"),
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "https://sdk.test/chat?room=alpha",
      },
    },
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    restoreMocks: true,
  },
});
