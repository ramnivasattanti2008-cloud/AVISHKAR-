import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // The time zone is pinned so date formatting and day boundaries are the same on every machine and in CI.
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"], include: ["src/**/*.test.{ts,tsx}"], globals: false, env: { TZ: "Asia/Kolkata" } },
});
