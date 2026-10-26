import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, hasDb, makeApp, register, resetDb } from "./helpers.js";
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
    ctx.s = await register(ctx.t, "robust@example.com");
    ctx.pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });
  const get = async () => {
    const res = await call("GET", `/api/properties/${ctx.pid}/robustness`);
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
    await call("GET", `/api/properties/${ctx.pid}/solar-forecast`);
    await call("GET", `/api/properties/${ctx.pid}/load-forecast`);
  };
  return { ctx, call, get, ready };
}

describeDb("putting a plan under pressure, before there is one", () => {
  const { ctx, call, get } = harness(false);

  it("says there is no plan to put under pressure, and shows no figures", async () => {
    const r = await get();
    expect(r).toMatchObject({ label: "IF THE DAY TURNS OUT DIFFERENTLY", basedOn: null, scenarios: [] });
    expect(r.result.value).toBeNull();
    expect(r.result.provenance.status).toBe("UNAVAILABLE");
    expect(r.next[0]).toMatchObject({ label: "Make a plan" });
  });

  it("is private to its owner, needs a session and a good id", async () => {
    const other = await register(ctx.t, "other@example.com");
    expect((await call("GET", `/api/properties/${ctx.pid}/robustness`, undefined, other)).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${ctx.pid}/robustness`, undefined, null)).statusCode).toBe(401);
    expect((await call("GET", "/api/properties/not-an-id/robustness")).statusCode).toBe(400);
  });
});

describeBoth("putting a plan under pressure, over a plan the real engine made", () => {
  const { ctx, call, get, ready } = harness(true);

  it("replays the plan's own moves against the ends of the forecasts' own bands", async () => {
    await ready();
    const plan = (await call("POST", `/api/properties/${ctx.pid}/plan`, {})).json();
    const r = await get();
    const v = r.result.value;

    expect(r.basedOn).toMatchObject({ planId: plan.id, stale: false });
    expect(r.result.provenance.status).toBe("SIMULATED");
    expect(r.scenarios.map((s: { key: string }) => s.key)).toEqual(["lowSun", "highDemand", "both", "moreSun"]);
    for (const s of r.scenarios) {
      if (s.state === "UNAVAILABLE") expect(s.reason.length, s.key).toBeGreaterThan(20);
      else expect(s.result.vsExpectedInr, s.key).toBeTypeOf("number");
    }

    // The reference replay reconstructs the battery's efficiency and wear from the plan's totals, so it lands near the plan's own
    // bill rather than exactly on it; what must hold is that it is close, and that the response says so.
    // replayed against the day it was made for, the plan's own bill comes back out
    expect(v.expected.netCostInr).toBeCloseTo(plan.result.value.netCostInr as number, 1);
    expect(v.expected.vsExpectedInr).toBe(0);
    expect(v.whyNothingFails).toMatch(/grid makes up whatever the sun does not cover/);
    expect(v.statement.length).toBeGreaterThan(30);
    expect(v.statement).not.toMatch(/\bprobab|\blikel/i); // it never claims a likelihood
  }, 400_000);

  it("never makes a worse day cheaper for the same plan", async () => {
    await ready();
    await call("POST", `/api/properties/${ctx.pid}/plan`, {});
    const v = (await get()).result.value;
    const by = Object.fromEntries(v.scenarios.filter((s: { state: string }) => s.state === "RUN").map((s: { key: string; result: { netCostInr: number } }) => [s.key, s.result.netCostInr]));
    if (by.lowSun !== undefined) expect(by.lowSun).toBeGreaterThanOrEqual(v.expected.netCostInr - 0.01);
    if (by.highDemand !== undefined) expect(by.highDemand).toBeGreaterThanOrEqual(v.expected.netCostInr - 0.01);
    if (by.both !== undefined && by.lowSun !== undefined) expect(by.both).toBeGreaterThanOrEqual(by.lowSun - 0.01);
    if (by.moreSun !== undefined) expect(by.moreSun).toBeLessThanOrEqual(v.expected.netCostInr + 0.01);
    if (v.worst) expect(v.worst.netCostInr).toBeGreaterThanOrEqual(v.expected.netCostInr - 0.01);
  }, 400_000);

  it("says what it rests on, and that the ends of a band are not a probability", async () => {
    await ready();
    await call("POST", `/api/properties/${ctx.pid}/plan`, {});
    const notes = (await get()).result.provenance.notes.join(" ");
    expect(notes).toMatch(/1 hour in 10/);
    expect(notes).toMatch(/no probability is attached/);
    expect(notes).toMatch(/battery moves and appliance starts are kept/);
  }, 400_000);

  it("will not put a plan under pressure with no forecast band to use, and says why", async () => {
    await ready();
    await call("POST", `/api/properties/${ctx.pid}/plan`, {});
    await (await import("./helpers.js")).db().forecastRun.deleteMany({ where: { propertyId: ctx.pid } });
    const r = await get();
    expect(r.result.value).toBeNull();
    expect(r.result.provenance.notes.at(-1)).toMatch(/No forecast is stored/);
    expect(r.next.map((n: { label: string }) => n.label)).toContain("Make a forecast");
  }, 400_000);
});
