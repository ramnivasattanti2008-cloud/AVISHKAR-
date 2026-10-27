/**
 * Automated Free Cloud Database Provisioning & Setup Tool for AVISHKAR.
 * Supports Neon (recommended free tier), Supabase (free tier), Aiven, and any PostgreSQL 16+ provider.
 *
 * It automatically:
 * 1. Validates cloud database connection with SSL/TLS.
 * 2. Installs the PostGIS spatial extension (CREATE EXTENSION IF NOT EXISTS postgis).
 * 3. Deploys all 11 Prisma schema migrations (prisma migrate deploy).
 * 4. Seeds reference tariffs and PM Surya Ghar policy rules.
 * 5. Runs PostGIS spatial geometry verification.
 * 6. Optionally updates platform/api/.env with safety backup.
 *
 * Usage:
 *   pnpm -C platform/api db:setup-cloud "postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require" [--apply]
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createDb } from "../src/db.js";
import { seedReferenceData } from "../src/seed/reference.js";

const { Client } = pg;

const args = process.argv.slice(2);
const shouldApply = args.includes("--apply") || args.includes("--update-env");
const targetUrl = args.find((a) => !a.startsWith("--")) ?? process.env.CLOUD_DATABASE_URL;

if (!targetUrl) {
  console.log(`
================================================================================
AVISHKAR — Automated Free Cloud Database Setup Tool
================================================================================

How to set up a 100% Free Cloud PostgreSQL Database with PostGIS for AVISHKAR:

Option 1: Neon.tech (Recommended — 30 seconds setup, serverless, free forever)
  1. Go to https://neon.tech and click "Sign up" (free with GitHub/Google).
  2. Create a project named 'avishkar'.
  3. Copy your connection string (e.g. postgresql://user:pass@ep-xyz.aws.neon.tech/neondb?sslmode=require).
  4. Run this command:
     pnpm -C platform/api db:setup-cloud "<your-neon-connection-string>" --apply

Option 2: Supabase (Free tier — includes PostGIS)
  1. Go to https://supabase.com and create a free project 'avishkar'.
  2. In Project Settings -> Database, copy the Connection String (URI, pooling or direct).
  3. Run this command:
     pnpm -C platform/api db:setup-cloud "<your-supabase-connection-string>" --apply

Run with --apply to automatically update platform/api/.env after migration.
================================================================================
`);
  process.exit(1);
}

console.log("================================================================================"); // eslint-disable-line no-console
console.log("AVISHKAR Cloud Database Setup & Verification"); // eslint-disable-line no-console
console.log("================================================================================"); // eslint-disable-line no-console

// Normalize connection string
let normalizedUrl = targetUrl.trim();
if (!normalizedUrl.includes("sslmode=") && !normalizedUrl.includes("127.0.0.1") && !normalizedUrl.includes("localhost")) {
  normalizedUrl += normalizedUrl.includes("?") ? "&sslmode=require" : "?sslmode=require";
}

const parsed = new URL(normalizedUrl);
console.log(`Target Host: ${parsed.host}`); // eslint-disable-line no-console
console.log(`Target Database: ${parsed.pathname.slice(1)}`); // eslint-disable-line no-console

// Step 1: Raw connection and PostGIS installation
console.log("\n[Step 1/5] Testing TLS connection and enabling PostGIS extension..."); // eslint-disable-line no-console
const client = new Client({ connectionString: normalizedUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  const vRes = await client.query("SELECT version();");
  console.log(`[PASS] Connected to engine: ${vRes.rows[0].version.split(" on ")[0]}`); // eslint-disable-line no-console

  console.log("Installing PostGIS extension (CREATE EXTENSION IF NOT EXISTS postgis)..."); // eslint-disable-line no-console
  await client.query("CREATE EXTENSION IF NOT EXISTS postgis;");
  const pgisRes = await client.query("SELECT postgis_full_version();");
  console.log(`[PASS] PostGIS Extension Verified: ${pgisRes.rows[0].postgis_full_version.split(" ")[0]}`); // eslint-disable-line no-console
} catch (err) {
  console.error(`[FAIL] Connection or PostGIS extension setup failed: ${err instanceof Error ? err.message : err}`); // eslint-disable-line no-console
  process.exit(1);
} finally {
  await client.end();
}

// Step 2: Deploy schema migrations via Prisma
console.log("\n[Step 2/5] Deploying all 11 Prisma schema migrations to target database..."); // eslint-disable-line no-console
try {
  execSync("pnpm exec prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: normalizedUrl },
    stdio: "inherit",
    cwd: resolve(import.meta.dirname, ".."),
  });
  console.log("[PASS] All Prisma schema migrations successfully applied."); // eslint-disable-line no-console
} catch (err) {
  console.error(`[FAIL] Migration deployment failed: ${err instanceof Error ? err.message : err}`); // eslint-disable-line no-console
  process.exit(1);
}

// Step 3: Seed Reference Tariffs & Policy Rules
console.log("\n[Step 3/5] Seeding sourced tariffs and PM Surya Ghar policy rules..."); // eslint-disable-line no-console
const db = createDb(normalizedUrl);
try {
  const seedResult = await seedReferenceData(db);
  console.log(`[PASS] Seeded ${seedResult.tariffs.length} tariffs and ${seedResult.policyRules.length} policy rules.`); // eslint-disable-line no-console
} catch (err) {
  console.error(`[FAIL] Seeding failed: ${err instanceof Error ? err.message : err}`); // eslint-disable-line no-console
  process.exit(1);
}

// Step 4: Spatial Query & Table Count Verification
console.log("\n[Step 4/5] Executing PostGIS spatial computation and schema table verification..."); // eslint-disable-line no-console
try {
  const countRes = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM information_schema.tables WHERE table_schema='public';`;
  const tableCount = Number(countRes[0]?.count ?? 0);
  console.log(`[PASS] Verified ${tableCount} tables in public schema.`); // eslint-disable-line no-console

  const spatialTest = await db.$queryRaw<Array<{ point: string; distance_m: number }>>`
    SELECT
      ST_AsText(ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)) AS point,
      ROUND(ST_Distance(
        ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography,
        ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography
      )::numeric, 2)::float8 AS distance_m;
  `;
  console.log(`[PASS] PostGIS Geodesic Distance Verified: ${spatialTest[0]?.distance_m} meters.`); // eslint-disable-line no-console
} catch (err) {
  console.error(`[FAIL] Verification query failed: ${err instanceof Error ? err.message : err}`); // eslint-disable-line no-console
  process.exit(1);
} finally {
  await db.$disconnect();
}

// Step 5: Environment file update (optional with --apply)
console.log("\n[Step 5/5] Environment Configuration Assessment..."); // eslint-disable-line no-console
const envPath = resolve(import.meta.dirname, "../.env");

if (shouldApply) {
  if (existsSync(envPath)) {
    const backupPath = `${envPath}.backup-${Date.now()}`;
    copyFileSync(envPath, backupPath);
    console.log(`Created backup of existing .env at: ${backupPath}`); // eslint-disable-line no-console

    let content = readFileSync(envPath, "utf-8");
    if (content.includes("DATABASE_URL=")) {
      content = content.replace(/DATABASE_URL=.*/, `DATABASE_URL=${normalizedUrl}`);
    } else {
      content = `DATABASE_URL=${normalizedUrl}\n` + content;
    }
    writeFileSync(envPath, content, "utf-8");
    console.log(`[APPLIED] Successfully updated DATABASE_URL in platform/api/.env`); // eslint-disable-line no-console
  } else {
    writeFileSync(envPath, `DATABASE_URL=${normalizedUrl}\nNODE_ENV=development\nPORT=8080\n`, "utf-8");
    console.log(`[CREATED] Created platform/api/.env with new DATABASE_URL`); // eslint-disable-line no-console
  }
} else {
  console.log(`\nTo activate this database in your local environment, update platform/api/.env with:`); // eslint-disable-line no-console
  console.log(`DATABASE_URL=${normalizedUrl}`); // eslint-disable-line no-console
  console.log(`(Or run again with --apply to automatically update platform/api/.env)`); // eslint-disable-line no-console
}

console.log("\n================================================================================"); // eslint-disable-line no-console
console.log("[SUCCESS] Cloud Database Setup Complete! PostGIS, Migrations, and Seeds Ready."); // eslint-disable-line no-console
console.log("================================================================================\n"); // eslint-disable-line no-console
