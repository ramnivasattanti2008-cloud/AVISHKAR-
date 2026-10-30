import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // The time zone is pinned so date formatting and day boundaries are the same on every machine and in CI.
  test: {
    pool: "forks",
    // Each file gets its own module registry. With `isolate: false` the files that share a worker share their `vi.mock`s and
    // module state, so results depended on how files were spread over workers (64 failures on one worker, 12 on two).
    isolate: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    globals: false,
    env: { TZ: "Asia/Kolkata" },
    // Cap worker forks to prevent worker IPC timeouts during heavy jsdom suite instantiation on multi-core environments
    maxWorkers: 4,
    // The accessibility file runs axe-core over whole rendered pages, which is heavy and CPU-bound. On a machine with few cores it
    // starves the workers beside it, and correct tests elsewhere then fail on vitest's 5 s default. The limit is there to catch a
    // hang, and 20 s still does that.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
