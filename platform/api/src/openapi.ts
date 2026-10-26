import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { Db } from "./db.js";
import type { Providers } from "./providers/index.js";

/**
 * Build the OpenAPI document without a database or network. Route registration never touches either, so stubs are safe.
 * The result is committed as `openapi.json`; the web app generates its types from it, and a test fails when the two differ.
 */
export async function buildOpenApi(): Promise<Record<string, unknown>> {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgresql://unused@localhost/unused",
    SESSION_SECRET: "openapi-export-secret-0123456789abcdef",
  });
  const app = await buildApp({ config, db: {} as Db, providers: {} as Providers, engine: null, now: () => new Date(0) });
  await app.ready();
  const doc = JSON.parse(JSON.stringify(app.swagger())) as Record<string, unknown>;
  await app.close();
  return doc;
}

/** Stable text form: sorted keys so that unrelated reordering never produces a diff. */
export function stringifyStable(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as object)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + "\n";
}
