import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // The time zone is pinned so date formatting and day boundaries are the same on every machine and in CI.
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
    env: { TZ: "Asia/Kolkata" },
    // The accessibility file runs axe-core over whole rendered pages, which is heavy and CPU-bound. On a machine with few cores it
    // starves the workers beside it, and correct tests elsewhere then fail on vitest's 5 s default. The limit is there to catch a
    // hang, and 20 s still does that.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
