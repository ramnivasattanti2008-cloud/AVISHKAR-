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
    ctx.s = await register(ctx.t, "futures@example.com");
    ctx.pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });
  const run = async (body: Record<string, unknown> = {}) => {
    const res = await call("POST", `/api/properties/${ctx.pid}/futures`, body);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const ready = async (critical = true) => {
    const tariff = (await call("POST", "/api/tariffs", TARIFF)).json();
    await call("PUT", `/api/properties/${ctx.pid}/tariff`, { tariffPlanId: tariff.id });
    const istToday = new Date(ctx.t.clock.now.getTime() + IST).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${istToday}T00:00:00Z`) - 70 * DAY).toISOString().slice(0, 10);
    await call("POST", `/api/properties/${ctx.pid}/energy/imports`, { csv: meterCsv({ start, days: 70, intervalMinutes: 60, kw: (_d, h) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) }), filename: "m.csv" });
    await call("POST", `/api/properties/${ctx.pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180 });
    await call("POST", `/api/properties/${ctx.pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
    if (critical) await call("POST", `/api/properties/${ctx.pid}/appliances`, { name: "Fridge", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 1000 });
  };
  return { ctx, call, run, ready };
}

const byKey = (r: { futures: { key: string }[] }, key: string) => r.futures.find((f) => f.key === key) as { key: string; state: string; reason: string | null; basis: string; built: string; result: { value: Record<string, number | null> | null; provenance: { status: string; notes: string[] } } };

describeDb("futures, for a property with nothing yet", () => {
  const { ctx, call } = harness(false);

  it("is private to its owner, needs a session, the CSRF header and good inputs", async () => {
    const other = await register(ctx.t, "other@example.com");
    expect((await call("POST", `/api/properties/${ctx.pid}/futures`, {}, other)).statusCode).toBe(404);
    expect((await call("POST", `/api/properties/${ctx.pid}/futures`, {}, null)).statusCode).toBe(401);
    expect((await call("POST", `/api/properties/not-an-id/futures`, {})).statusCode).toBe(400);
    expect((await call("POST", `/api/properties/${ctx.pid}/futures`, { rainSolarPercent: 140 })).statusCode).toBe(400);
    expect((await call("POST", `/api/properties/${ctx.pid}/futures`, { outage: { startHour: 25, hours: 2 } })).statusCode).toBe(400);
  });

  it("says what is missing, as a plan does, when there is no tariff or no meter data", async () => {
    const res = await call("POST", `/api/properties/${ctx.pid}/futures`, {});
    expect(res.statusCode).not.toBe(200);
  });
});

describeBoth("futures, through the real engine", () => {
  const { ctx, call, run, ready } = harness(true);

  it("plans the expected day the same as a plan does, and runs the other days from it", async () => {
    await ready();
    await call("GET", `/api/properties/${ctx.pid}/solar-forecast`);
    await call("GET", `/api/properties/${ctx.pid}/load-forecast`);
    const plan = (await call("POST", `/api/properties/${ctx.pid}/plan`, {})).json();
    const f = await run();
    expect(f.label).toBe("ENERGY FUTURES");
    expect(f.futures.map((x: { key: string }) => x.key)).toEqual(["expected", "sunny", "heavyCloud", "rain", "highDemand", "batteryOffline", "outage", "stress"]);
    const expected = byKey(f, "expected");
    expect(expected).toMatchObject({ state: "RUN", basis: "REFERENCE" });
    expect(expected.result.value!.netCostInr).toBe(plan.result.value.netCostInr); // the same inputs, the same optimum
    expect(expected.result.value!.noControlCostInr).toBe(plan.result.value.baselineNetCostInr);
    expect(expected.result.value!.vsExpectedInr).toBe(0);
    for (const x of f.futures) if (x.state === "RUN") expect(x.result.provenance.status, x.key).toBe("SIMULATED");
    expect(f.assumptions.join(" ")).toMatch(/planned from scratch with the planner told what the day will be/);
    // asking does not store a plan
    expect(await db().optimizationRun.count({ where: { propertyId: ctx.pid } })).toBe(1);
  }, 400_000);

  it("never makes a worse sky cheaper or a better sky dearer, and a rainy day at 100% is the expected day", async () => {
    await ready();
    const f = await run({ rainSolarPercent: 20 });
    const cost = (k: string) => byKey(f, k).result.value!.netCostInr as number;
    const e = cost("expected");
    expect(byKey(f, "rain").state).toBe("RUN");
    expect(byKey(f, "rain").basis).toBe("ASSUMPTION");
    expect(cost("rain")).toBeGreaterThanOrEqual(e - 0.01); // less sun cannot be cheaper
    expect(byKey(f, "rain").result.value!.solarKwh).toBeCloseTo((byKey(f, "expected").result.value!.solarKwh as number) * 0.2, 1);
    if (byKey(f, "sunny").state === "RUN") expect(cost("sunny")).toBeLessThanOrEqual(e + 0.01);
    if (byKey(f, "heavyCloud").state === "RUN") expect(cost("heavyCloud")).toBeGreaterThanOrEqual(e - 0.01);
    if (byKey(f, "highDemand").state === "RUN") expect(cost("highDemand")).toBeGreaterThanOrEqual(e - 0.01); // more use cannot be cheaper

    const same = await run({ rainSolarPercent: 100 });
    expect(byKey(same, "rain").result.value!.netCostInr).toBe(byKey(same, "expected").result.value!.netCostInr);
    expect((byKey(same, "rain") as unknown as { sameAsExpected: boolean }).sameAsExpected).toBe(true); // and it says so
    expect((byKey(f, "rain") as unknown as { sameAsExpected: boolean }).sameAsExpected).toBe(false);
  }, 400_000);

  it("takes the battery away for the battery-offline day: no cycles, and no cheaper", async () => {
    await ready();
    const f = await run();
    const off = byKey(f, "batteryOffline");
    expect(off.state).toBe("RUN");
    expect(off.result.value!.batteryCycles).toBe(0);
    expect(off.result.value!.netCostInr as number).toBeGreaterThanOrEqual((byKey(f, "expected").result.value!.netCostInr as number) - 0.01);
  }, 400_000);

  it("keeps only the critical load on in an outage, counts what was switched off, and does not call that day cheaper", async () => {
    await ready();
    const f = await run({ outage: { startHour: 18, hours: 4 } });
    const o = byKey(f, "outage");
    expect(o.state).toBe("RUN");
    expect(o.built).toMatch(/A question, not a forecast/);
    // the evening load is 2.5 kW, the critical load 1 kW: 1.5 kW is off for 4 hours
    expect(o.result.value!.shedKwh).toBeCloseTo(6, 1);
    expect(o.result.value!.vsExpectedInr).toBeNull();
    expect(o.result.value!.unservedKwh as number).toBeGreaterThanOrEqual(0);
    // the cheapest and dearest are chosen among the days without an outage
    expect(f.spread).not.toBeNull();
    for (const k of ["cheapest", "dearest"]) expect(["outage", "stress"]).not.toContain(f.spread[k].key);
    expect(f.spread.cheapest.netCostInr).toBeLessThanOrEqual(f.spread.dearest.netCostInr);
    expect(f.spread.note).toMatch(/left out/);
    // the others have nothing switched off
    expect(byKey(f, "expected").result.value!.shedKwh).toBe(0);
  }, 400_000);

  it("will not run an outage with no critical appliance, and says what to mark", async () => {
    await ready(false);
    const f = await run();
    for (const k of ["outage", "stress"]) {
      const x = byKey(f, k);
      expect(x.state, k).toBe("UNAVAILABLE");
      expect(x.result.value, k).toBeNull();
      expect(x.result.provenance.status, k).toBe("UNAVAILABLE");
      expect(x.reason, k).toMatch(/CRITICAL/);
    }
    expect(byKey(f, "expected").state).toBe("RUN");
  }, 400_000);

  it("says plainly that it has no sunny or cloudy day when the forecast has no calibrated band, instead of making one", async () => {
    await ready();
    const f = await run();
    for (const k of ["sunny", "heavyCloud"]) {
      const x = byKey(f, k);
      if (x.state === "UNAVAILABLE") expect(x.reason, k).toMatch(/no calibrated band/);
      else expect(x.basis, k).toBe("DATA");
    }
  }, 400_000);
});
