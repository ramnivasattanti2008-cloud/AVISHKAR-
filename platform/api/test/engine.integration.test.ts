import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { MODES, type OptimiseRequest } from "../src/engine/schemas.js";
import { AppError } from "../src/errors.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { hasDb, makeApp, resetDb } from "./helpers.js";

const describeEngine = engineAvailable ? describe : describe.skip;
const describeBoth = engineAvailable && hasDb ? describe : describe.skip;

const battery = { capacityKwh: 4, maxChargeKw: 10, maxDischargeKw: 10, chargeEfficiency: 1, dischargeEfficiency: 1, minSocKwh: 0, maxSocKwh: 4, initialSocKwh: 0, wearInrPerKwh: 0 };
/** The hand-solved case from the engine's own tests: buy 4 kWh at INR 1, avoid INR 10: net cost 4 against 40, saving 36. */
const ARBITRAGE: OptimiseRequest = { stepHours: 1, loadKw: [0, 0, 2, 2], pvKw: [0, 0, 0, 0], importPrice: [1, 1, 10, 10], exportPrice: [0, 0, 0, 0], battery };

/** The error a call fails with; the test fails if the call succeeds. */
async function fails(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected the call to fail");
}

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

describeEngine("the real engine process, over HTTP", () => {
  const client = (over: { apiKey?: string; baseUrl?: string } = {}) => new EngineClient({ baseUrl: over.baseUrl ?? engine.url, apiKey: over.apiKey ?? engine.key, timeoutMs: 30_000 });

  it("reports its version and solver", async () => {
    const h = await client().health();
    expect(h.status).toBe("ok");
    expect(h.highs).toMatch(/^\d+\.\d+/);
    expect(h.modes).toEqual(expect.arrayContaining([...MODES]));
  });

  it("solves the hand-worked arbitrage case through the typed client: net cost 4, baseline 40, saving 36", async () => {
    const r = await client().optimise(ARBITRAGE);
    expect(r.solver.status).toBe("optimal");
    expect(r.totals?.netCostInr).toBeCloseTo(4, 3);
    expect(r.baseline?.netCostInr).toBeCloseTo(40, 3);
    expect(r.savingsInr).toBeCloseTo(36, 3);
    expect(r.validation).toMatchObject({ valid: true, problems: [] });
    expect(r.schedule?.batterySocKwh[1]).toBeCloseTo(4, 6);
    expect(r.decisions.some((d) => d.kind === "charge_battery" && d.reason.includes("INR 1.00"))).toBe(true);
  });

  it("returns a valid plan for every mode, with its weights", async () => {
    for (const mode of MODES) {
      const r = await client().optimise({ ...ARBITRAGE, mode, criticalKw: 0.5, backupHours: 2 });
      expect(r.mode).toBe(mode);
      expect(r.validation.valid, mode).toBe(true);
      expect(Object.keys(r.modeWeights)).toContain("importCost");
    }
  });

  it("plans an EV, an appliance and an outage together, and every balance holds", async () => {
    const r = await client().optimise({
      stepHours: 1,
      loadKw: [1, 1, 1, 1, 1, 1],
      pvKw: [0, 0, 2, 2, 0, 0],
      importPrice: [6, 6, 4, 4, 9, 9],
      exportPrice: [2, 2, 2, 2, 2, 2],
      battery,
      grid: { outages: [{ startStep: 5, endStep: 6 }] },
      criticalKw: 0.5,
      ev: { energyNeededKwh: 6, chargerKw: 3, chargerEfficiency: 0.9, availableFromStep: 0, departureStep: 5 },
      appliances: [{ id: "w", name: "Washer", powerKw: 1, durationSteps: 2, earliestStartStep: 0, latestFinishStep: 5, interruptible: false }],
    });
    expect(r.validation.valid).toBe(true);
    expect(r.totals?.evShortfallKwh).toBeCloseTo(0, 6);
    expect(r.totals?.unservedKwh).toBeCloseTo(0, 6);
    expect(r.appliances[0]?.runSteps).toHaveLength(2);
    expect(r.schedule?.gridImportKw[5]).toBeCloseTo(0, 9); // the grid is down
  });

  it("surfaces the engine's own refusal of impossible inputs, in words", async () => {
    const e = await fails(client().optimise({ ...ARBITRAGE, pvKw: [0, 0] }));
    expect(e).toMatchObject({ code: "ENGINE_REJECTED", status: 502 });
    expect(e.message).toContain("every series must cover the same steps");
  });

  it("refuses a wrong key as an unavailable engine, never a plan", async () => {
    const e = await fails(client({ apiKey: "w".repeat(24) }).optimise(ARBITRAGE));
    expect(e).toMatchObject({ code: "ENGINE_UNAVAILABLE", details: { reason: "key refused" } });
  });

  it("says the engine is unavailable when nothing listens", async () => {
    const e = await fails(client({ baseUrl: "http://127.0.0.1:9" }).optimise(ARBITRAGE));
    expect(e).toMatchObject({ code: "ENGINE_UNAVAILABLE", details: { reason: "could not connect" } });
  });
});

describeBoth("the API's system health with the real engine", () => {
  it("shows the engine as healthy with its version and solver, and degrades when it is down", async () => {
    await resetDb();
    const up = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 5_000 }) });
    const ok = (await up.app.inject({ method: "GET", url: "/api/system/health" })).json();
    expect(ok.engine).toMatchObject({ state: "healthy", error: null });
    expect(ok.engine.solver).toMatch(/^HiGHS /);

    const down = await makeApp({}, { engine: new EngineClient({ baseUrl: "http://127.0.0.1:9", timeoutMs: 1_000 }) });
    const bad = (await down.app.inject({ method: "GET", url: "/api/system/health" })).json();
    expect(bad.engine.state).toBe("down");
    expect(bad.status).toBe("degraded");

    const none = await makeApp();
    expect((await none.app.inject({ method: "GET", url: "/api/system/health" })).json().engine.state).toBe("not_configured");
  });
});
