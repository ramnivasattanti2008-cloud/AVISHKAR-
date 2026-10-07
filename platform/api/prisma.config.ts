import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads .env by itself. Load it when present (local development); in CI and production the
// variables come from the environment.
if (existsSync(".env")) process.loadEnvFile(".env");

// `prisma generate` runs as a postinstall hook, before anyone has a database or an .env, and never connects. Give it a
// placeholder so `pnpm install` works on a clean checkout. Every other command (migrate, studio, ...) still requires the
// real DATABASE_URL and fails loudly without it.
const generating = process.argv.slice(2).includes("generate");
const url = process.env.DATABASE_URL ?? (generating ? "postgresql://placeholder:placeholder@localhost:5432/placeholder" : undefined);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: url ?? env("DATABASE_URL") },
});
