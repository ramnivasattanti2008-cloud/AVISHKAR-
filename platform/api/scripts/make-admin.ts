/**
 * Grants or removes the administrator role from an existing account. The only way to make an administrator: no web route does it,
 * so no request, however it is forged, can. The change is written to the audit log.
 *
 *   pnpm -C platform/api db:make-admin you@example.com            grant
 *   pnpm -C platform/api db:make-admin you@example.com --revoke   remove
 */
import { existsSync } from "node:fs";
import { setRole } from "../src/admin/service.js";
import { createDb } from "../src/db.js";

if (existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
if (!email) {
  console.error("Usage: db:make-admin <email> [--revoke]"); // eslint-disable-line no-console
  process.exit(2);
}

const db = createDb(url);
try {
  const u = await setRole(db, email, args.includes("--revoke") ? "USER" : "ADMIN");
  console.log(`${u.email} is now ${u.role}.`); // eslint-disable-line no-console
} catch (e) {
  console.error(e instanceof Error ? e.message : e); // eslint-disable-line no-console
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
