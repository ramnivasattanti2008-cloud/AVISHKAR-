import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/live/**"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ["test/global-setup.ts"],
    // Integration tests share one real database, so files run one after another.
    fileParallelism: false,
  },
});
