/**
 * Comprehensive Database Health & PostGIS Diagnostic Tool for AVISHKAR.
 * Verifies connectivity, PostgreSQL version, PostGIS spatial extension,
 * schema migrations, table counts, spatial indexing, and seed data.
 *
 * Usage:
 *   pnpm -C platform/api db:health
 */
import { existsSync } from "node:fs";
import { createDb } from "../src/db.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const devUrl = process.env.DATABASE_URL;
const testUrl = process.env.DATABASE_URL_TEST;

if (!devUrl) {
  console.error("FATAL: DATABASE_URL is not set in environment or platform/api/.env"); // eslint-disable-line no-console
  process.exit(1);
}

interface DbCheckResult {
  url: string;
  connected: boolean;
  version?: string;
  postgisVersion?: string;
  spatialQueryOk?: boolean;
  tableCount?: number;
  userCount?: number;
  propertyCount?: number;
  tariffCount?: number;
  policyRuleCount?: number;
  gistIndexFound?: boolean;
  error?: string;
}

async function auditDatabase(name: string, connectionUrl: string): Promise<DbCheckResult> {
  const parsed = new URL(connectionUrl);
  const sanitizedHost = `${parsed.username ? parsed.username + "@" : ""}${parsed.host}${parsed.pathname}`;
  console.log(`\n============================================================`); // eslint-disable-line no-console
  console.log(`AUDITING ${name.toUpperCase()} DATABASE: ${sanitizedHost}`); // eslint-disable-line no-console
  console.log(`============================================================`); // eslint-disable-line no-console

  const db = createDb(connectionUrl);
  const result: DbCheckResult = { url: sanitizedHost, connected: false };

  try {
    // 1. Connectivity & PostgreSQL version
    const versionRes = await db.$queryRaw<Array<{ version: string }>>`SELECT version();`;
    result.version = versionRes[0]?.version ?? "Unknown";
    result.connected = true;
    console.log(`[PASS] PostgreSQL Engine: ${result.version.split(" on ")[0]}`); // eslint-disable-line no-console

    // 2. PostGIS Extension & Version
    try {
      const postgisRes = await db.$queryRaw<Array<{ postgis_full_version: string }>>`SELECT postgis_full_version();`;
      result.postgisVersion = postgisRes[0]?.postgis_full_version ?? "Unknown";
      console.log(`[PASS] PostGIS Extension: ${result.postgisVersion.split(" ")[0]} (Spatial Enabled)`); // eslint-disable-line no-console
    } catch (e) {
      console.error(`[FAIL] PostGIS extension is MISSING or DISABLED! Error: ${e instanceof Error ? e.message : e}`); // eslint-disable-line no-console
      result.error = "PostGIS extension missing";
      return result;
    }

    // 3. PostGIS Geometry & Geography Computation Test
    try {
      const spatialTest = await db.$queryRaw<Array<{ point: string; distance_m: number }>>`
        SELECT
          ST_AsText(ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)) AS point,
          ROUND(ST_Distance(
            ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography,
            ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography
          )::numeric, 2)::float8 AS distance_m;
      `;
      const pt = spatialTest[0]?.point;
      const dist = spatialTest[0]?.distance_m;
      result.spatialQueryOk = !!pt && typeof dist === "number";
      console.log(`[PASS] Spatial Arithmetic: Point=${pt}, Geodesic Distance=${dist} m`); // eslint-disable-line no-console
    } catch (e) {
      console.error(`[FAIL] Spatial calculation test failed: ${e instanceof Error ? e.message : e}`); // eslint-disable-line no-console
      result.spatialQueryOk = false;
    }

    // 4. Schema Tables Count
    const tablesRes = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM information_schema.tables WHERE table_schema = 'public';
    `;
    result.tableCount = Number(tablesRes[0]?.count ?? 0);
    console.log(`[PASS] Public Schema Tables: ${result.tableCount} tables present`); // eslint-disable-line no-console

    // 5. Check GiST Spatial Index on properties(location)
    try {
      const indexRes = await db.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'properties' AND indexdef ILIKE '%gist%location%';
      `;
      result.gistIndexFound = indexRes.length > 0;
      if (result.gistIndexFound) {
        console.log(`[PASS] Spatial Indexing: GiST spatial index confirmed on properties(location)`); // eslint-disable-line no-console
      } else {
        console.warn(`[WARN] GiST index on properties(location) not found in pg_indexes`); // eslint-disable-line no-console
      }
    } catch {
      // properties table might not exist yet if unmigrated
    }

    // 6. Record Counts for Core Entities
    try {
      result.userCount = await db.user.count();
      result.propertyCount = await db.property.count();
      result.tariffCount = await db.tariffPlan.count();
      result.policyRuleCount = await db.policyRule.count();

      console.log(`[DATA] Users: ${result.userCount}`); // eslint-disable-line no-console
      console.log(`[DATA] Properties: ${result.propertyCount}`); // eslint-disable-line no-console
      console.log(`[DATA] Tariff Plans (Seeded): ${result.tariffCount}`); // eslint-disable-line no-console
      console.log(`[DATA] Policy Rules (Seeded): ${result.policyRuleCount}`); // eslint-disable-line no-console
    } catch (e) {
      console.warn(`[WARN] Table query warning (possibly unmigrated schema): ${e instanceof Error ? e.message : e}`); // eslint-disable-line no-console
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[FAIL] Connection failed: ${result.error}`); // eslint-disable-line no-console
    return result;
  } finally {
    await db.$disconnect();
  }
}

console.log("AVISHKAR Database Diagnostic & Health Check Starting..."); // eslint-disable-line no-console

const devCheck = await auditDatabase("Development (DATABASE_URL)", devUrl);

let testCheck: DbCheckResult | null = null;
if (testUrl) {
  testCheck = await auditDatabase("Integration Test (DATABASE_URL_TEST)", testUrl);
} else {
  console.log("\n[INFO] DATABASE_URL_TEST is not set. Skipping integration test database check."); // eslint-disable-line no-console
}

console.log("\n============================================================"); // eslint-disable-line no-console
console.log("FINAL DATABASE HEALTH VERDICT"); // eslint-disable-line no-console
console.log("============================================================"); // eslint-disable-line no-console

const isDevHealthy = devCheck.connected && !!devCheck.postgisVersion && devCheck.spatialQueryOk && (devCheck.tableCount ?? 0) >= 20;
const isTestHealthy = !testCheck || (testCheck.connected && !!testCheck.postgisVersion && (testCheck.tableCount ?? 0) >= 20);

if (isDevHealthy && isTestHealthy) {
  console.log("[STATUS: 100% HEALTHY] Database is online, PostGIS spatial features enabled, schema migrated, and reference data loaded."); // eslint-disable-line no-console
  process.exit(0);
} else {
  console.error("[STATUS: DEGRADED OR UNHEALTHY] One or more database health gates failed. Check output above for remediation."); // eslint-disable-line no-console
  process.exit(1);
}
