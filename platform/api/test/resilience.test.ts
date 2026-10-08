import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeBoth = engineAvailable && hasDb ? describe : describe.skip;
const describeDb = hasDb ? describe : describe.skip;
const DAY = 86_400_000;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

const TARIFF = { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" };

function harness(withEngine: boolean) {
  const ctx = {} as { t: TestApp; s: Session; pid: string };
  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, session: Session | null = ctx.s) =>
    ctx.t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  beforeEach(async () => {
    await resetDb();
    ctx.t = await makeApp({}, withEngine ? { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 120_000 }) } : {});
    ctx.t.clock.now = new Date("2026-10-07T10:10:00Z"); // 15:40 IST
    ctx.t.setFetch(router(() => ctx.t.clock.now));
    ctx.s = await register(ctx.t, "resilience@example.com");
    ctx.pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });
  const report = (query = "") => call("GET", `/api/properties/${ctx.pid}/resilience${query}`);
  const critical = (name: string, ratedPowerW: number, quantity = 1) => call("POST", `/api/properties/${ctx.pid}/appliances`, { name, kind: "refrigerator", priority: "CRITICAL", ratedPowerW, quantity });
  const battery = (over: Record<string, unknown> = {}) => call("POST", `/api/properties/${ctx.pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5, ...over });
  return { ctx, call, report, critical, battery };
}

describeDb("resilience, without the engine", () => {
  const { ctx, call, report, critical, battery } = harness(false);

  it("answers from the battery alone when the sun cannot be forecast, and says so", async () => {
    await critical("Fridge", 1000);
    await battery();
    const res = await report("?startSocPercent=60");
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect(r.label).toBe("RESILIENCE AND AUTONOMY");
    expect(r.notes.join(" ")).toContain("No sun is counted");
    const v = r.resilience.value;
    // 10 kWh battery, 10% never used, 60% charged = 6 kWh; 5 usable kWh x 0.9487 delivered at 1 kW is 4.7 hours
    expect(v.criticalKw).toBe(1);
    expect(v.battery).toMatchObject({ usableKwh: 9, startSocKwh: 6, startSocBasis: "USER_ENTERED" });
    expect(v.backupHours.withoutSun).toBeCloseTo(4.7, 1);
    expect(v.backupHours.withForecastSun).toBeCloseTo(4.7, 1);
    expect(v.backupHours.atLeast).toBe(false);
    expect(v.score).toBe(Math.round((100 * 4.7435) / 24)); // 20
    expect(v.scoreMethod).toContain("divided by 24");
  });

  it("never predicts an outage: the grid's risk is unavailable, and says why", async () => {
    await critical("Fridge", 1000);
    await battery();
    const r = (await report()).json();
    expect(r.outageRisk).toMatchObject({ status: "UNAVAILABLE" });
    expect(r.outageRisk.reason).toContain("no outage or grid-reliability data source exists");
    expect(r.assumptions.join(" ")).toContain("No outage is predicted");
    expect(r.resilience.provenance.status).toBe("SIMULATED");
  });

  it("recommends the reserve for the time asked: the floor plus the load's draw, counting losses, and says when it cannot be held", async () => {
    await critical("Fridge", 500, 2); // 1 kW together
    await battery();
    const v = (await report("?targetHours=4")).json().resilience.value;
    expect(v.criticalLoads).toEqual([{ name: "Fridge", quantity: 2, ratedPowerW: 500, kw: 1 }]);
    expect(v.recommendedReserve).toMatchObject({ targetHours: 4, feasible: true });
    expect(v.recommendedReserve.reserveKwh).toBeCloseTo(1 + 4 / 0.9487, 1); // 5.2
    expect(v.recommendedReserve.reservePercentOfCapacity).toBe(52);
    expect(v.recommendedReserve.currentReserveKwh).toBe(1); // none set: the floor
    expect(v.recommendedReserve.gapKwh).toBeCloseTo(v.recommendedReserve.reserveKwh - 1, 2);
    expect(v.recommendedReserve.longestPossibleHours).toBeCloseTo(8.5, 1);
    const long = (await report("?targetHours=24")).json();
    expect(long.resilience.value.recommendedReserve.feasible).toBe(false);
    expect(long.notes.join(" ")).toContain("cannot hold 24 hours of the critical load");
  });

  it("scores no backup at all, and says why, for a home with no battery", async () => {
    await critical("Fridge", 1000);
    const r = (await report()).json();
    expect(r.resilience.value).toMatchObject({ battery: null, score: 0, recommendedReserve: null, backupHours: { withForecastSun: 0, withoutSun: 0 } });
    expect(r.notes.join(" ")).toContain("There is no battery");
  });

  it("asks which appliances must stay on when none is marked critical", async () => {
    await battery();
    const res = await report();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PLAN_INPUTS_MISSING");
    expect(res.json().error.details.missing[0].what).toBe("critical");
  });

  it("leaves autonomy unavailable, with the reason, until a plan exists", async () => {
    await critical("Fridge", 1000);
    await battery();
    const a = (await report()).json().autonomy;
    expect(a.value).toBeNull();
    expect(a.provenance.status).toBe("UNAVAILABLE");
    expect(a.provenance.notes.join(" ")).toContain("No plan has been made yet");
  });

  it("refuses what is not asked sensibly, and is private to its owner", async () => {
    await critical("Fridge", 1000);
    expect((await report("?targetHours=0")).statusCode).toBe(400);
    expect((await report("?targetHours=25")).statusCode).toBe(400);
    expect((await report("?startSocPercent=120")).statusCode).toBe(400);
    const other = await register(ctx.t, "other@example.com");
    expect((await call("GET", `/api/properties/${ctx.pid}/resilience`, undefined, other)).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${ctx.pid}/resilience`, undefined, null)).statusCode).toBe(401);
  });
});

describeBoth("resilience with the forecast sun, and autonomy from a plan, through the real engine", () => {
  const { call, report, critical, battery } = harness(true);

  const prepare = async (pid: string) => {
    const tariff = (await call("POST", "/api/tariffs", TARIFF)).json();
    await call("PUT", `/api/properties/${pid}/tariff`, { tariffPlanId: tariff.id });
  };

  it("counts the forecast sun: it never lasts less than the battery alone, and the score follows the hours", async () => {
    await critical("Fridge", 1000);
    await battery();
    const pid = (await call("GET", "/api/properties")).json().properties[0].id;
    await call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180 });
    const v = (await report("?startSocPercent=60")).json().resilience.value;
    expect(v.backupHours.withoutSun).toBeCloseTo(4.7, 1);
    expect(v.backupHours.withForecastSun).toBeGreaterThanOrEqual(v.backupHours.withoutSun);
    expect(v.backupHours.withForecastSun).toBeLessThan(24);
    expect(Math.abs(v.score - (100 * v.backupHours.withForecastSun) / 24)).toBeLessThanOrEqual(1);
  }, 120_000);

  it("reads autonomy from the latest plan: the share of the energy used that was not bought, with its parts and method", async () => {
    await critical("Fridge", 150);
    await battery();
    const pid = (await call("GET", "/api/properties")).json().properties[0].id;
    await prepare(pid);
    const istToday = new Date(Date.parse("2026-10-07T10:10:00Z") + 330 * 60_000).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${istToday}T00:00:00Z`) - 70 * DAY).toISOString().slice(0, 10);
    await call("POST", `/api/properties/${pid}/energy/imports`, { csv: meterCsv({ start, days: 70, intervalMinutes: 60, kw: (_d, h) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) }), filename: "m.csv" });
    await call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180 });
    const plan = (await call("POST", `/api/properties/${pid}/plan`, {})).json();

    const a = (await report()).json().autonomy;
    expect(a.provenance.status).toBe("SIMULATED");
    const v = a.value;
    expect(v.planId).toBe(plan.id);
    const s = plan.schedule;
    const sum = (x: number[]) => x.reduce((p: number, q: number) => p + q, 0);
    const consumed = sum(s.loadKw) + sum(s.evChargeKw) + Object.values(s.applianceKw).reduce((p: number, k) => p + sum(k as number[]), 0);
    const bought = sum(s.gridImportKw);
    expect(v.parts.consumedKwh).toBeCloseTo(consumed, 1);
    expect(v.parts.boughtKwh).toBeCloseTo(bought, 1);
    expect(v.parts.solarUsedKwh).toBeCloseTo(sum(s.pvUsedKw), 1);
    expect(v.score).toBe(Math.round(100 * (1 - Math.min(1, bought / consumed))));
    expect(v.parts.gridDependencyPercent).toBeCloseTo(100 - v.score, 0);
    expect(v.methodology).toContain("Autonomy = 100 x (1 - energy bought from the grid / energy used)");
    expect(v.criticalCoverageHours).toBeGreaterThan(0);
  }, 180_000);
});
