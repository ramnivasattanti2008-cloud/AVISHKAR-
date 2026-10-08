import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { type AppDeps, buildApp } from "../src/app.js";
import { type Config, loadConfig } from "../src/config.js";
import type { DeviceExecutor } from "../src/control/executor.js";
import { type Db, createDb } from "../src/db.js";
import type { EngineClient } from "../src/engine/client.js";
import { MemoryCache } from "../src/providers/cache.js";
import { buildProviders } from "../src/providers/index.js";
import { DbRecorder } from "../src/providers/recorder.js";

if (existsSync(".env")) process.loadEnvFile(".env");

export const TEST_DB_URL = process.env.DATABASE_URL_TEST;
/** Use `describeDb` for anything that needs the database; it is skipped (not faked) when no test database is configured. */
export const hasDb = Boolean(TEST_DB_URL);

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DB_URL ?? "postgresql://unused:unused@localhost:5432/unused",
    SESSION_SECRET: "test-session-secret-0123456789abcdef-0123456789",
    ...over,
  });
}

let sharedDb: Db | undefined;
export function db(): Db {
  if (!TEST_DB_URL) throw new Error("DATABASE_URL_TEST is not set");
  return (sharedDb ??= createDb(TEST_DB_URL));
}

export async function resetDb(): Promise<void> {
  await db().$executeRawUnsafe(
    'TRUNCATE TABLE "users", "tariff_plans", "policy_rules", "audit_logs", "provider_calls", "cache_entries", "data_provenance", "weather_observations" RESTART IDENTITY CASCADE',
  );
}

export interface TestApp {
  app: FastifyInstance;
  deps: AppDeps;
  /** Every URL the fake network was asked for. */
  fetched: URL[];
  setFetch(handler: (url: URL) => Response | Promise<Response>): void;
  clock: { now: Date };
}

/** An app wired to the real test database, with a fake network (no outbound calls) and a controllable clock. */
export async function makeApp(over: Record<string, string> = {}, extra: { engine?: EngineClient | null; executor?: DeviceExecutor | null } = {}): Promise<TestApp> {
  const config = testConfig(over);
  const fetched: URL[] = [];
  let handler: (url: URL) => Response | Promise<Response> = () => new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: URL | string) => {
    const u = new URL(input.toString());
    fetched.push(u);
    return handler(u);
  }) as typeof fetch;
  // Starts at the real current time: rows the database timestamps itself (provider calls) must fall inside "now" windows.
  const clock = { now: new Date() };
  const recorder = new DbRecorder(db());
  const providers = buildProviders(config, { cache: new MemoryCache(), recorder, db: db(), fetchImpl });
  // geocoding spacing would slow tests down; the unit tests cover it
  const deps: AppDeps = { config, db: db(), providers, engine: extra.engine ?? null, executor: extra.executor ?? null, now: () => clock.now };
  const app = await buildApp(deps);
  return { app, deps, fetched, setFetch: (h) => void (handler = h), clock };
}

/** The repository's data/ folder: the sourced tariff orders and policy files the seeder loads. */
export function defaultTestDataDir(): string {
  return fileURLToPath(new URL("../../../data", import.meta.url));
}

export const PASSWORD = "correct-horse-battery";

export interface Session {
  cookies: Record<string, string>;
  csrf: string;
  headers: Record<string, string>;
  userId: string;
}

export function cookiesFrom(res: { cookies: { name: string; value: string }[] }): Record<string, string> {
  return Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
}

export async function register(t: TestApp, email: string, password = PASSWORD): Promise<Session> {
  const res = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email, password } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const body = res.json();
  return { cookies: cookiesFrom(res), csrf: body.csrfToken, headers: { "x-csrf-token": body.csrfToken }, userId: body.user.id };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
