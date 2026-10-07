import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { EngineClient } from "../src/engine/client.js";
import { buildEngine, requireEngine } from "../src/engine/index.js";
import { AppError } from "../src/errors.js";
import type { OptimiseRequest } from "../src/engine/schemas.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const REQUEST: OptimiseRequest = { stepHours: 1, loadKw: [1, 1], pvKw: [0, 0], importPrice: [5, 5], exportPrice: [0, 0] };

/** A well-formed engine answer for a two-step horizon. */
const OK = {
  mode: "SAVE_MONEY",
  modeWeights: { importCost: 1 },
  solver: { status: "optimal", message: "ok", objective: 10, seconds: 0.01, integerVariables: 0 },
  schedule: { pvUsedKw: [0, 0], pvCurtailedKw: [0, 0], gridImportKw: [1, 1], gridExportKw: [0, 0], batteryChargeKw: [0, 0], batteryDischargeKw: [0, 0], batterySocKwh: [0, 0], evChargeKw: [0, 0], applianceKw: {}, servedLoadKw: [1, 1], unservedKw: [0, 0] },
  appliances: [],
  totals: { importKwh: 2, exportKwh: 0, importCostInr: 10, exportRevenueInr: 0, wearCostInr: 0, netCostInr: 10, loadKwh: 2, pvKwh: 0, pvUsedKwh: 0, curtailedKwh: 0, batteryThroughputKwh: 0, batteryCycles: 0, evDeliveredKwh: 0, evShortfallKwh: 0, unservedKwh: 0, selfConsumptionRatio: null, selfSufficiencyRatio: 0 },
  baseline: { description: "none", netCostInr: 10, importKwh: 2, exportKwh: 0, unservedKwh: 0 },
  savingsInr: 0,
  decisions: [],
  validation: { valid: true, maxBalanceErrorKw: 0, problems: [] },
  notes: [],
};

function client(fetchImpl: typeof fetch, over: Partial<ConstructorParameters<typeof EngineClient>[0]> = {}) {
  return new EngineClient({ baseUrl: "http://engine.test", apiKey: "k".repeat(20), timeoutMs: 200, fetchImpl, ...over });
}

const code = async (p: Promise<unknown>) => {
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
};

describe("EngineClient", () => {
  it("sends the key, the request id and the JSON body to the right URL, and returns the validated answer", async () => {
    let seen: { url: string; headers: Record<string, string>; body: unknown } | undefined;
    const c = client((async (url: URL, init: RequestInit) => {
      seen = { url: url.toString(), headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
      return json(OK);
    }) as unknown as typeof fetch);
    const r = await c.optimise(REQUEST, { requestId: "req-1" });
    expect(seen!.url).toBe("http://engine.test/v1/optimise");
    expect(seen!.headers).toMatchObject({ "x-engine-key": "k".repeat(20), "x-request-id": "req-1", "content-type": "application/json" });
    expect(seen!.body).toEqual(REQUEST);
    expect(r.totals?.netCostInr).toBe(10);
  });

  it("reads the engine's health", async () => {
    const c = client((async () => json({ status: "ok", version: "0.1.0", scipy: "1.18.1", highs: "1.15.1", modes: ["SAVE_MONEY"] })) as unknown as typeof fetch);
    expect(await c.health()).toMatchObject({ version: "0.1.0", highs: "1.15.1" });
  });

  it("says the engine is unavailable when it cannot be reached", async () => {
    const e = await code(client((async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch).optimise(REQUEST));
    expect(e).toMatchObject({ code: "ENGINE_UNAVAILABLE", status: 503, details: { reason: "could not connect" } });
    expect(e.message).toContain("plans and model forecasts are unavailable");
  });

  it("says so when it does not answer in time, and aborts the request", async () => {
    let aborted = false;
    const hang = (async (_u: URL, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      })) as unknown as typeof fetch;
    const e = await code(client(hang, { timeoutMs: 1_000 }).optimise(REQUEST));
    expect(e.code).toBe("ENGINE_UNAVAILABLE");
    expect((e.details as { reason: string }).reason).toBe("no answer within 1 s");
    expect(aborted).toBe(true);
  }, 5_000);

  it("explains a refused key without exposing it", async () => {
    const e = await code(client((async () => json({ error: { code: "UNAUTHENTICATED", message: "A valid x-engine-key header is required." } }, 401)) as unknown as typeof fetch).optimise(REQUEST));
    expect(e.code).toBe("ENGINE_UNAVAILABLE");
    expect(e.message).toContain("refused this server's key");
    expect(JSON.stringify(e)).not.toContain("kkkkkkkk");
  });

  it("passes on the engine's plain-language reason when it refuses the inputs", async () => {
    const e = await code(client((async () => json({ error: { code: "VALIDATION_FAILED", message: "The request is not valid: every series must cover the same steps" } }, 400)) as unknown as typeof fetch).optimise(REQUEST));
    expect(e).toMatchObject({ code: "ENGINE_REJECTED", status: 502 });
    expect(e.message).toContain("every series must cover the same steps");
  });

  it("treats a server error as the engine being unavailable", async () => {
    const e = await code(client((async () => json({ error: { code: "INTERNAL" } }, 500)) as unknown as typeof fetch).optimise(REQUEST));
    expect(e).toMatchObject({ code: "ENGINE_UNAVAILABLE", details: { reason: "engine answered 500" } });
  });

  it("refuses an answer in an unexpected shape rather than guessing, and says which fields", async () => {
    const bad = { ...OK, totals: { ...OK.totals, netCostInr: "ten" }, schedule: undefined };
    const e = await code(client((async () => json(bad)) as unknown as typeof fetch).optimise(REQUEST));
    expect(e).toMatchObject({ code: "ENGINE_BAD_RESPONSE", status: 502 });
    expect(JSON.stringify(e.details)).toContain("totals.netCostInr");
  });

  it("refuses a reply that is not JSON at all", async () => {
    const e = await code(client((async () => new Response("<html>bad gateway</html>", { status: 200 })) as unknown as typeof fetch).optimise(REQUEST));
    expect(e.code).toBe("ENGINE_BAD_RESPONSE");
  });

  it("works without a key for a local engine started in insecure dev mode", async () => {
    let headers: Record<string, string> = {};
    const c = new EngineClient({ baseUrl: "http://engine.test", timeoutMs: 200, fetchImpl: (async (_u: URL, init: RequestInit) => ((headers = init.headers as Record<string, string>), json(OK))) as unknown as typeof fetch });
    await c.optimise(REQUEST);
    expect(headers["x-engine-key"]).toBeUndefined();
  });
});

describe("engine configuration", () => {
  const base = { DATABASE_URL: "postgresql://u@h/d", SESSION_SECRET: "s".repeat(32) };

  it("has no engine unless ENGINE_URL is set, and says so plainly when one is required", () => {
    const cfg = loadConfig({ ...base });
    expect(buildEngine(cfg)).toBeNull();
    const e = (() => {
      try {
        requireEngine(null);
      } catch (x) {
        return x as AppError;
      }
    })()!;
    expect(e).toMatchObject({ code: "ENGINE_UNAVAILABLE", status: 503, details: { reason: "ENGINE_URL is not set" } });
    expect(e.message).toContain("not configured");
  });

  it("builds a client from the environment", () => {
    const cfg = loadConfig({ ...base, ENGINE_URL: "http://127.0.0.1:8090", ENGINE_API_KEY: "e".repeat(20), ENGINE_TIMEOUT_MS: "30000" });
    expect(buildEngine(cfg)).toBeInstanceOf(EngineClient);
    expect(cfg.ENGINE_TIMEOUT_MS).toBe(30_000);
  });

  it("refuses a short key, and requires a key in production", () => {
    expect(() => loadConfig({ ...base, ENGINE_URL: "http://x:1", ENGINE_API_KEY: "short" })).toThrow(/at least 16 characters/);
    expect(() => loadConfig({ ...base, NODE_ENV: "production", ENGINE_URL: "http://x:1" })).toThrow(/ENGINE_API_KEY is required in production/);
    expect(() => loadConfig({ ...base, NODE_ENV: "development", ENGINE_URL: "http://x:1" })).not.toThrow();
  });
});
