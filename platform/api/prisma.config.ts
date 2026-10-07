import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads .env by itself. Load it when present (local development); in CI and production the
// variables come from the environment.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
