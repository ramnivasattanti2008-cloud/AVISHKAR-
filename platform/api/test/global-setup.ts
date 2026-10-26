import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Integration tests need a real PostgreSQL with PostGIS (never a mock). Point DATABASE_URL_TEST at a throwaway database;
 * this applies the migrations to it once per run. Without it, database tests are skipped with a clear message.
 */
export default function setup(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    console.warn("DATABASE_URL_TEST is not set: database integration tests will be skipped."); // eslint-disable-line no-console
    return;
  }
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}
