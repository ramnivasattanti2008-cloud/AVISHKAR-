import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeBoth = engineAvailable && hasDb ? describe : describe.skip;
const describeDb = hasDb ? describe : describe.skip;
const DAY = 86_400_000;
const IST = 330 * 60_000;

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
    ctx.t = await makeApp({}, withEngine ? { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 180_000 }) } : {});
    ctx.t.clock.now = new Date("2026-10-07T04:40:00Z"); // 10:10 IST
    ctx.t.setFetch(router(() => ctx.t.clock.now));
    ctx.s = await register(ctx.t, "insight@example.com");
    ctx.pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });
  const get = async (what: "health" | "waste") => {
    const res = await call("GET", `/api/properties/${ctx.pid}/${what}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const ready = async () => {
    const tariff = (await call("POST", "/api/tariffs", TARIFF)).json();
    await call("PUT", `/api/properties/${ctx.pid}/tariff`, { tariffPlanId: tariff.id });
    const istToday = new Date(ctx.t.clock.now.getTime() + IST).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${istToday}T00:00:00Z`) - 70 * DAY).toISOString().slice(0, 10);
    await call("POST", `/api/properties/${ctx.pid}/energy/imports`, { csv: meterCsv({ start, days: 70, intervalMinutes: 60, kw: (_d, h) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) }), filename: "m.csv" });
    await call("POST", `/api/properties/${ctx.pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180 });
    await call("POST", `/api/properties/${ctx.pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
    await call("POST", `/api/properties/${ctx.pid}/appliances`, { name: "Fridge", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 1000 });
    await call("GET", `/api/properties/${ctx.pid}/solar-forecast`);
    await call("GET", `/api/properties/${ctx.pid}/load-forecast`);
  };
  return { ctx, call, get, ready };
}

describeDb("energy health and waste, for a property with no plan", () => {
  const { ctx, call, get } = harness(false);

  it("shows no metric and no figure, and says the way to get one is to make a plan", async () => {
    const h = await get("health");
    expect(h).toMatchObject({ label: "ENERGY HEALTH", basedOn: null, metrics: [] });
    expect(h.noOverallScore).toMatch(/weights/);
    expect(h.next).toEqual([expect.objectContaining({ label: "Make a plan", href: `/property/${ctx.pid}/plan` })]);

    const w = await get("waste");
    expect(w).toMatchObject({ label: "ENERGY WASTE", basedOn: null, findings: [] });
    for (const k of ["perDay", "averageMonth"]) {
      expect(w.avoidable[k].value, k).toBeNull();
      expect(w.avoidable[k].provenance.status, k).toBe("UNAVAILABLE");
    }
  });

  it("is private to its owner, needs a session and a good id", async () => {
    const other = await register(ctx.t, "other@example.com");
    for (const what of ["health", "waste"]) {
      expect((await call("GET", `/api/properties/${ctx.pid}/${what}`, undefined, other)).statusCode, what).toBe(404);
      expect((await call("GET", `/api/properties/${ctx.pid}/${what}`, undefined, null)).statusCode, what).toBe(401);
      expect((await call("GET", `/api/properties/not-an-id/${what}`)).statusCode, what).toBe(400);
    }
  });
});

describeBoth("energy health and waste, from a real plan through the real engine", () => {
  const { ctx, call, get, ready } = harness(true);

  it("works each metric from the stored plan, labels it SIMULATED, and agrees with the plan's own totals", async () => {
    await ready();
    const plan = (await call("POST", `/api/properties/${ctx.pid}/plan`, {})).json();
    const h = await get("health");
    expect(h.basedOn).toMatchObject({ planId: plan.id, stale: false });
    expect(h.metrics.map((m: { key: string }) => m.key)).toEqual(["efficiency", "solarUtilisation", "peakManagement", "storageUtilisation", "resilience", "gridDependence", "flexibility"]);
    const m = Object.fromEntries(h.metrics.map((x: { key: string }) => [x.key, x]));
    const r = plan.result.value;

    // the ratios that the plan's totals give directly
    expect(m.solarUtilisation.result.value).toBeCloseTo(100 * (r.pvUsedKwh / r.pvKwh), 0);
    expect(m.gridDependence.result.value).toBeCloseTo(100 * (1 - r.selfSufficiencyRatio), 0);
    for (const k of ["efficiency", "solarUtilisation", "peakManagement", "storageUtilisation", "gridDependence", "flexibility"]) {
      const v = m[k].result;
      expect(v.provenance.status, k).toBe("SIMULATED");
      expect(v.value, k).toBeGreaterThanOrEqual(0);
      expect(v.value, k).toBeLessThanOrEqual(100);
      expect(v.provenance.notes.join(" "), k).toContain("not a measurement");
      expect(m[k].formula.length, k).toBeGreaterThan(20);
    }
    // nothing was entered that can be moved: no car and no appliance with a window
    expect(m.flexibility.result.value).toBe(0);
    expect(m.flexibility.detail).toMatch(/Nothing was entered/);
    // the battery moved, so its range is used
    expect(m.storageUtilisation.result.value).toBeGreaterThan(0);

    // resilience is the same figure the resilience page gives from the same stored sun
    const res = (await call("GET", `/api/properties/${ctx.pid}/resilience`)).json().resilience.value;
    expect(m.resilience.result.unit).toBe("h");
    expect(m.resilience.result.value).toBeCloseTo(res.backupHours.withForecastSun, 5);
  }, 300_000);

  it("finds waste only where the plan shows it, with figures that agree with the plan, and says what it cannot know", async () => {
    await ready();
    const plan = (await call("POST", `/api/properties/${ctx.pid}/plan`, {})).json();
    const w = await get("waste");
    const f = Object.fromEntries(w.findings.map((x: { key: string }) => [x.key, x]));
    const r = plan.result.value;
    expect(f.solarCurtailment.amount.value.kwh).toBeCloseTo(r.curtailedKwh, 1);
    expect(f.surplusSold.amount.value.kwh).toBeCloseTo(r.exportKwh, 1);
    expect(f.soldThenBoughtBack.amount.value.kwh).toBeLessThanOrEqual(r.exportKwh + 0.01); // can never be more than was sold
    expect(f.applianceSchedule.amount.provenance.status).toBe("UNAVAILABLE");
    expect(f.batteryOpportunity.amount.provenance.status).toBe("UNAVAILABLE");
    expect(f.batteryOpportunity.explanation).toMatch(/no device feed/);
    expect(w.avoidable.perDay.value).toBe(Math.round(r.savingsInr * 100) / 100);
    expect(w.avoidable.perDay.provenance.status).toBe("SIMULATED");
  }, 300_000);

  it("gives an average month's avoidable cost only once a what-if run has worked out a year, and shows where it came from", async () => {
    await ready();
    await call("POST", `/api/properties/${ctx.pid}/plan`, {});
    const before = await get("waste");
    expect(before.avoidable.averageMonth.provenance.status).toBe("UNAVAILABLE");
    expect(before.next.map((n: { label: string }) => n.label)).toContain("Run a what-if");

    const run = await call("POST", `/api/properties/${ctx.pid}/scenarios`, { name: "Bigger battery", addBatteryKwh: 5 });
    expect(run.statusCode, run.body).toBe(201);
    const s = run.json();
    const after = await get("waste");
    const month = after.avoidable.averageMonth;
    expect(month.provenance.status).toBe("ESTIMATED");
    expect(month.value).toBeCloseTo(Math.round((Math.max(s.base.uncontrolledCostInr - s.base.netCostInr, 0) / 12) * 100) / 100, 2);
    expect(month.provenance.source).toContain("Bigger battery");
    expect(month.provenance.notes.join(" ")).toMatch(/not this month/);
    expect(after.next.map((n: { label: string }) => n.label)).not.toContain("Run a what-if");
  }, 600_000);

  it("calls a plan older than a day old", async () => {
    await ready();
    await call("POST", `/api/properties/${ctx.pid}/plan`, {});
    ctx.t.clock.now = new Date(ctx.t.clock.now.getTime() + 25 * 3_600_000);
    for (const what of ["health", "waste"] as const) {
      const v = await get(what);
      expect(v.basedOn.stale, what).toBe(true);
      expect(v.basedOn.note, what).toContain("more than a day old");
    }
    // the stored plan is untouched: nothing was recomputed or written
    expect(await db().optimizationRun.count({ where: { propertyId: ctx.pid } })).toBe(1);
  }, 300_000);
});
