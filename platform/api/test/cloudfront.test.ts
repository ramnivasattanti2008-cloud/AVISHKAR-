import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { frontScale } from "../src/cloudfront/front.js";
import { EngineClient } from "../src/engine/client.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeBoth = engineAvailable && hasDb ? describe : describe.skip;
const DAY = 86_400_000;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

const TARIFF = { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" };

describeBoth("the cloud-front scenario, through the API and the real engine", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;
  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, session: Session | null = s) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const front = (body: Record<string, unknown> = {}, id = pid) => call("POST", `/api/properties/${id}/cloud-front`, body);
  const ready = async (opts: { solar?: boolean; battery?: boolean } = { solar: true, battery: true }) => {
    const tariff = (await call("POST", "/api/tariffs", TARIFF)).json();
    await call("PUT", `/api/properties/${pid}/tariff`, { tariffPlanId: tariff.id });
    const istToday = new Date(t.clock.now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${istToday}T00:00:00Z`) - 70 * DAY).toISOString().slice(0, 10);
    await call("POST", `/api/properties/${pid}/energy/imports`, { csv: meterCsv({ start, days: 70, intervalMinutes: 60, kw: (_d, h) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) }), filename: "m.csv" });
    if (opts.solar) await call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180 });
    if (opts.battery) await call("POST", `/api/properties/${pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
  };

  beforeEach(async () => {
    await resetDb();
    t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 120_000 }) });
    t.clock.now = new Date("2026-10-07T10:10:00Z"); // 15:40 IST
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "front@example.com");
    pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });

  it("plans the day twice and reports the front, the advice, and the grid energy and cost with and without AVISHKAR, all from the planner", async () => {
    await ready();
    const res = await front({ arrivalMinutes: 38, reductionPercent: 22, durationHours: 3 });
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect(r.label).toBe("CLOUD FRONT SCENARIO");
    expect(r.result.provenance.status).toBe("SIMULATED");
    expect(r.result.provenance.notes.join(" ")).toContain("A scenario: the front is assumed");
    const v = r.result.value;

    // the front: 15:40 + 38 minutes = 16:18, for three hours
    expect(v.frontArrivesAt).toBe("2026-10-07T16:18:00+05:30");
    expect(v.frontEndsAt).toBe("2026-10-07T19:18:00+05:30");
    expect(v.reductionPercent).toBe(22);

    // the sun taken is exactly the reduction times the sun of the hours covered
    const h = r.hourly;
    const now = t.clock.now.getTime();
    const start = Date.parse(r.horizon.start);
    const scale = frontScale(now, start, 24, { arrivalMinutes: 38, reductionPercent: 22, durationHours: 3 });
    expect(h.times).toHaveLength(24);
    h.solarKw.forEach((kw: number, i: number) => expect(h.solarWithFrontKw[i]).toBeCloseTo(kw * scale[i]!, 3));
    const lost = h.solarKw.reduce((a: number, kw: number, i: number) => a + kw - h.solarWithFrontKw[i], 0);
    expect(v.solarLostKwh).toBeCloseTo(lost, 1);
    expect(v.solarLostKwh).toBeGreaterThan(0);
    expect(v.solarLostPercentOfDay).toBeGreaterThan(0);
    expect(v.solarLostPercentOfDay).toBeLessThan(22);

    // the battery starts where the plan assumes (its reserve), the evening is the load pattern's (2.5 kW against a day's mean of 0.9 kW)
    expect(v.batteryNowBasis).toBe("ASSUMPTION");
    expect(v.batteryNowPercent).toBeGreaterThanOrEqual(0);
    expect(v.eveningDemand.level).toBe("HIGH");
    expect(v.eveningDemand.eveningMeanKw).toBeCloseTo(2.5, 1);
    expect(v.eveningDemand.rule).toContain("HIGH at 1.25");

    // without and with: the plan can only help, and the difference is the difference of what is shown
    expect(v.without.netCostInr).toBeGreaterThanOrEqual(v.with.netCostInr);
    expect(v.difference.savingsInr).toBeCloseTo(v.without.netCostInr - v.with.netCostInr, 2);
    expect(v.difference.importKwh).toBeCloseTo(v.without.importKwh - v.with.importKwh, 2);
    expect(v.with.importKwh).toBeGreaterThan(0);
    expect(["CHARGE_NOW", "HOLD_CHARGE", "NO_CHANGE"]).toContain(v.advice.code);
    expect(v.advice.text.length).toBeGreaterThan(20);
    // the cost of the front is what the two runs differ by: the plan's bill on the front sky less its bill on the forecast sky
    expect(v.onForecastSky.withNetCostInr).toBeLessThanOrEqual(v.onForecastSky.withoutNetCostInr);
    expect(v.frontCost.withAvishkarInr).toBeCloseTo(v.with.netCostInr - v.onForecastSky.withNetCostInr, 2);
    expect(v.frontCost.withoutAvishkarInr).toBeCloseTo(v.without.netCostInr - v.onForecastSky.withoutNetCostInr, 2);
    expect(v.frontCost.withAvishkarInr).toBeGreaterThanOrEqual(-0.01); // taking sun away never makes the day cheaper

    expect(r.assumptions.join(" ")).toContain("AVISHKAR has no cloud-nowcast source");
    expect(await db().auditLog.count({ where: { action: "cloud-front.run" } })).toBe(1);
    expect(await db().optimizationRun.count()).toBe(0); // a scenario is not a plan: nothing is stored in the plan history
  }, 180_000);

  it("takes more sun for a bigger front, and a front that takes less costs less", async () => {
    await ready();
    const small = (await front({ reductionPercent: 10 })).json().result.value;
    const big = (await front({ reductionPercent: 80 })).json().result.value;
    expect(big.solarLostKwh).toBeGreaterThan(small.solarLostKwh);
    expect(big.frontCost.withAvishkarInr).toBeGreaterThanOrEqual(small.frontCost.withAvishkarInr - 0.01);
    expect(big.with.importKwh).toBeGreaterThanOrEqual(small.with.importKwh - 0.01);
  }, 240_000);

  it("says there is no battery to charge, and still shows what the front costs, for a home with solar only", async () => {
    await ready({ solar: true, battery: false });
    const v = (await front()).json().result.value;
    expect(v.advice.code).toBe("NO_BATTERY");
    expect(v.batteryNowPercent).toBeNull();
    expect(v.batteryNowBasis).toBeNull();
    expect(v.solarLostKwh).toBeGreaterThan(0);
  }, 180_000);

  it("refuses, saying what is missing, for a property with no solar system", async () => {
    await ready({ solar: false, battery: true });
    const res = await front();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PLAN_INPUTS_MISSING");
    expect(res.json().error.details.missing[0].what).toBe("solar");
  }, 120_000);

  it("refuses a front that is not a front, and does not accept a property that is not yours or a session that is not there", async () => {
    await ready();
    expect((await front({ reductionPercent: 0 })).statusCode).toBe(400);
    expect((await front({ reductionPercent: 120 })).statusCode).toBe(400);
    expect((await front({ arrivalMinutes: 0 })).statusCode).toBe(400);
    expect((await front({ arrivalMinutes: 5000 })).statusCode).toBe(400);
    expect((await front({ durationHours: 0 })).statusCode).toBe(400);
    expect((await front({ mode: "WILD" })).statusCode).toBe(400);
    const other = await register(t, "other@example.com");
    expect((await call("POST", `/api/properties/${pid}/cloud-front`, {}, other)).statusCode).toBe(404);
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${pid}/cloud-front`, payload: {} })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${pid}/cloud-front`, cookies: s.cookies, payload: {} })).statusCode).toBe(403);
  }, 120_000);
});
