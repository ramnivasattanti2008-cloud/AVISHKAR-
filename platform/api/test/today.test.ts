import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { dayEnergy } from "../src/today/calc.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeBoth = engineAvailable && hasDb ? describe : describe.skip;
const describeDb = hasDb ? describe : describe.skip;
const DAY = 86_400_000;
const HOUR = 3_600_000;
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
    ctx.t = await makeApp({}, withEngine ? { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 120_000 }) } : {});
    ctx.t.clock.now = new Date("2026-10-07T04:40:00Z"); // 10:10 IST on 7 October: the day is still ahead
    ctx.t.setFetch(router(() => ctx.t.clock.now));
    ctx.s = await register(ctx.t, "today@example.com");
    ctx.pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });
  const today = async () => {
    const res = await call("GET", `/api/properties/${ctx.pid}/today`);
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
  };
  return { ctx, call, today, ready };
}

describeDb("Today, for a property with nothing yet", () => {
  const { ctx, call, today } = harness(false);

  it("says what is missing figure by figure, prints no number for it, and says where to fill it in", async () => {
    const t = await today();
    expect(t.label).toBe("TODAY");
    expect(t.localDate).toBe("2026-10-07");
    for (const k of ["generation", "consumption", "surplus", "plan", "resilience"]) {
      expect(t[k].value, k).toBeNull();
      expect(t[k].provenance.status, k).toBe("UNAVAILABLE");
      expect(t[k].provenance.notes.at(-1).length, k).toBeGreaterThan(15);
    }
    expect(t.recommendation).toBeNull();
    expect(t.achieved).toMatchObject({ expectedSavingsInr: null, carbon: { status: "UNAVAILABLE" } });
    // listed in the order things depend on each other; with no solar system the way to generation is to add one, not to forecast it
    expect(t.next.map((n: { label: string; href: string }) => [n.label, n.href.replace(`/property/${ctx.pid}`, "")])).toEqual([
      ["Choose a tariff", "/tariff"],
      ["Import meter readings", "/meter-data"],
      ["Add your solar system", "/assets"],
      ["Mark critical appliances", "/assets"],
      ["Make a plan", "/plan"],
    ]);
    expect(t.next.every((n: { why: string }) => n.why.length > 10)).toBe(true);
  });

  it("asks for a forecast, not for a solar system, once there is one", async () => {
    await call("POST", `/api/properties/${ctx.pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180 });
    const labels = (await today()).next.map((n: { label: string }) => n.label);
    expect(labels).toContain("Make a solar forecast");
    expect(labels).not.toContain("Add your solar system");
  });

  it("is private to its owner, needs a session, and a good id", async () => {
    const other = await register(ctx.t, "other@example.com");
    expect((await call("GET", `/api/properties/${ctx.pid}/today`, undefined, other)).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${ctx.pid}/today`, undefined, null)).statusCode).toBe(401);
    expect((await call("GET", "/api/properties/not-an-id/today")).statusCode).toBe(400);
  });

  it("reads the weather risk from the provider's own cloud, rain and irradiance, by the stated rule, and says it is a forecast", async () => {
    const t = await today();
    const w = t.weatherRisk;
    expect(w.provenance.provider).toBe("open-meteo");
    expect(w.provenance.status).toBe("FORECAST");
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(w.value.level);
    expect(w.value.rule).toContain("Over the next 12 hours of daylight");
    expect(w.value.hours).toBeGreaterThan(0);
    expect(w.value.meanCloudPercent).toBeGreaterThanOrEqual(0);
    expect(w.value.meanCloudPercent).toBeLessThanOrEqual(100);
  });

  it("falls back to the owner's own typical day, labelled ESTIMATED and said to be a pattern, when only meter data exists", async () => {
    const istToday = new Date(ctx.t.clock.now.getTime() + IST).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${istToday}T00:00:00Z`) - 30 * DAY).toISOString().slice(0, 10);
    await call("POST", `/api/properties/${ctx.pid}/energy/imports`, { csv: meterCsv({ start, days: 30, intervalMinutes: 60, kw: (_d, h) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) }), filename: "m.csv" });
    const c = (await today()).consumption;
    expect(c.provenance.status).toBe("ESTIMATED");
    expect(c.value.basis).toBe("TYPICAL_DAY");
    expect(c.value.kwh).toBeCloseTo(0.5 * 24 + 2 * 4, 0); // 20 kWh: the pattern the readings were built with
    expect(c.provenance.notes.join(" ")).toContain("a pattern, not a forecast");
  });
});

describeBoth("Today, from stored forecasts and a plan, through the real engine", () => {
  const { ctx, call, today, ready } = harness(true);

  it("reads generation, use and surplus from the latest stored forecasts, and they agree with the forecasts themselves", async () => {
    await ready();
    expect((await call("GET", `/api/properties/${ctx.pid}/solar-forecast`)).statusCode).toBe(200);
    expect((await call("GET", `/api/properties/${ctx.pid}/load-forecast`)).statusCode).toBe(200);
    const t = await today();
    expect(t.generation.provenance.status).toBe("FORECAST");
    expect(t.consumption.provenance.status).toBe("FORECAST");
    expect(t.consumption.value.basis).toBe("FORECAST");

    // recomputed from the rows the forecasts were stored as
    const dayStart = Math.floor((ctx.t.clock.now.getTime() + IST) / DAY) * DAY - IST;
    const solar = await db().forecastRun.findFirstOrThrow({ where: { propertyId: ctx.pid, kind: "SOLAR" }, orderBy: { issuedAt: "desc" } });
    const load = await db().forecastRun.findFirstOrThrow({ where: { propertyId: ctx.pid, kind: "LOAD" }, orderBy: { issuedAt: "desc" } });
    const pts = (s: { times: string[]; p50Kw: number[] }) => s.times.map((time, i) => ({ time, value: s.p50Kw[i]! }));
    const g = dayEnergy(pts(solar.series as never), "end", dayStart);
    const c = dayEnergy(pts(load.series as never), "start", dayStart);
    expect(t.generation.value.kwh).toBeCloseTo(g.kwh, 1);
    expect(t.consumption.value.kwh).toBeCloseTo(c.kwh, 1);
    expect(t.generation.value.kwh).toBeGreaterThan(5); // a 5 kWp roof in an Indian October
    expect(t.generation.value.kwh).toBeLessThan(35);
    expect(t.generation.value.forecastIssuedAt).toBe(solar.issuedAt.toISOString());
    expect(t.surplus.value.kwh).toBeGreaterThanOrEqual(0);
    expect(t.surplus.value.kwh).toBeLessThanOrEqual(t.generation.value.kwh + 0.1); // surplus is part of what is generated, never more
  }, 240_000);

  it("shows the latest plan's saving, autonomy and recommendation, and what is expected to be achieved, as expected and not measured", async () => {
    await ready();
    await call("GET", `/api/properties/${ctx.pid}/solar-forecast`);
    await call("GET", `/api/properties/${ctx.pid}/load-forecast`);
    const plan = (await call("POST", `/api/properties/${ctx.pid}/plan`, {})).json();
    const t = await today();
    expect(t.plan.provenance.status).toBe("SIMULATED");
    expect(t.plan.value).toMatchObject({ planId: plan.id, stale: false, savingsInr: plan.result.value.savingsInr, netCostInr: plan.result.value.netCostInr, baselineNetCostInr: plan.result.value.baselineNetCostInr });
    expect(t.plan.value.autonomyScore).toBeGreaterThanOrEqual(0);
    expect(t.plan.value.autonomyScore).toBeLessThanOrEqual(100);
    expect(t.recommendation).toEqual(plan.recommendation);
    expect(t.achieved.expectedSavingsInr).toBe(plan.result.value.savingsInr);
    expect(t.achieved.basis).toContain("not a measurement");
    expect(t.next.map((n: { href: string }) => n.href)).not.toContain(`/property/${ctx.pid}/plan`);
  }, 240_000);

  it("gives the resilience from the stored sun, the same as the resilience page gives from a fresh forecast", async () => {
    await ready();
    await call("GET", `/api/properties/${ctx.pid}/solar-forecast`);
    const t = await today();
    const r = (await call("GET", `/api/properties/${ctx.pid}/resilience`)).json().resilience.value;
    expect(t.resilience.value).toEqual({ hours: r.backupHours.withForecastSun, atLeast: r.backupHours.atLeast, score: r.score });
    expect(t.resilience.provenance.status).toBe("SIMULATED");
  }, 240_000);

  it("calls a plan older than a day old, and asks for a new one", async () => {
    await ready();
    await call("GET", `/api/properties/${ctx.pid}/solar-forecast`);
    await call("POST", `/api/properties/${ctx.pid}/plan`, {});
    ctx.t.clock.now = new Date(ctx.t.clock.now.getTime() + 25 * HOUR);
    const t = await today();
    expect(t.plan.value.stale).toBe(true);
    expect(t.plan.provenance.notes.join(" ")).toContain("more than a day old");
    expect(t.next.map((n: { label: string }) => n.label)).toContain("Make a new plan");
  }, 240_000);

  it("asks for critical appliances, with a link, when none is marked", async () => {
    await ready();
    await db().appliance.deleteMany({ where: { propertyId: ctx.pid } });
    const t = await today();
    expect(t.resilience.value).toBeNull();
    expect(t.resilience.provenance.notes.at(-1)).toContain("no appliance of this property is marked CRITICAL");
    expect(t.next.map((n: { href: string }) => n.href)).toContain(`/property/${ctx.pid}/assets`);
  }, 120_000);
});
