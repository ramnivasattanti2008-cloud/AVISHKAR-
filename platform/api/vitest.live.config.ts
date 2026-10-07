import { defineConfig } from "vitest/config";

/** Live tests call the real public providers. Run on demand: `pnpm test:live`. Never part of CI. */
export default defineConfig({
  test: { include: ["test/live/**/*.test.ts"], environment: "node", testTimeout: 60_000, fileParallelism: false },
});
