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
    ctx.s = await register(ctx.t, "allocation@example.com");
    ctx.pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });
  const get = async () => {
    const res = await call("GET", `/api/properties/${ctx.pid}/allocation`);
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

describeDb("the energy ledger, before there is a plan", () => {
  const { ctx, call, get } = harness(false);

  it("says there is nothing to follow yet, and shows no figures", async () => {
    const a = await get();
    expect(a).toMatchObject({ label: "WHERE EVERY kWh WENT", basedOn: null, hours: [] });
    expect(a.totals.value).toBeNull();
    expect(a.totals.provenance.status).toBe("UNAVAILABLE");
    expect(a.next[0]).toMatchObject({ label: "Make a plan" });
    expect(a.rule.length).toBeGreaterThan(4); // the order is stated even when there is nothing to apply it to
  });

  it("is private to its owner, needs a session and a good id", async () => {
    const other = await register(ctx.t, "other@example.com");
    expect((await call("GET", `/api/properties/${ctx.pid}/allocation`, undefined, other)).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${ctx.pid}/allocation`, undefined, null)).statusCode).toBe(401);
    expect((await call("GET", "/api/properties/not-an-id/allocation")).statusCode).toBe(400);
  });
});

describeBoth("the energy ledger, over a plan the real engine made", () => {
  const { ctx, call, get, ready } = harness(true);

  it("accounts for every kWh of every hour, and agrees with the plan's own totals", async () => {
    await ready();
    const plan = (await call("POST", `/api/properties/${ctx.pid}/plan`, {})).json();
    const a = await get();
    const t = a.totals.value;
    const r = plan.result.value;

    expect(a.basedOn).toMatchObject({ planId: plan.id, stale: false });
    expect(a.totals.provenance.status).toBe("SIMULATED");
    expect(a.check.balanced, `worst hour was out by ${a.check.maxHourErrorKwh} kWh`).toBe(true);
    expect(a.hours).toHaveLength(24);

    // the sun's four destinations are everything the panels made, and that is the plan's own figure
    expect(t.solar.toDemandKwh + t.solar.toBatteryKwh + t.solar.soldKwh + t.solar.thrownAwayKwh).toBeCloseTo(t.solar.madeKwh, 2);
    expect(t.solar.madeKwh).toBeCloseTo(r.pvKwh, 1);
    expect(t.solar.thrownAwayKwh).toBeCloseTo(r.curtailedKwh, 2);

    // the demand's three sources are what was served
    expect(t.demand.fromSolarKwh + t.demand.fromBatteryKwh + t.demand.fromGridKwh).toBeCloseTo(t.demand.servedKwh, 2);

    // what was bought and sold is the plan's own figure, split by what the buying was for
    expect(t.grid.boughtKwh).toBeCloseTo(r.importKwh, 1);
    expect(t.grid.soldKwh).toBeCloseTo(r.exportKwh, 1);
    expect(t.grid.forDemandKwh + t.grid.forBatteryKwh).toBeCloseTo(t.grid.boughtKwh, 2);

    // and the money for the bought energy adds up to what the plan paid for it
    const importCost = a.hours.reduce((x: number, h: { gridToDemandKwh: number; gridToBatteryKwh: number; importPriceInr: number }) => x + (h.gridToDemandKwh + h.gridToBatteryKwh) * h.importPriceInr, 0);
    expect(t.money.boughtForDemandInr + t.money.boughtForBatteryInr).toBeCloseTo(importCost, 1);
  }, 400_000);

  it("follows what came out of the battery back to where it went in", async () => {
    await ready();
    await call("POST", `/api/properties/${ctx.pid}/plan`, {});
    const t = (await get()).totals.value;
    const b = t.battery;
    expect(b).not.toBeNull();
    expect(b.outFromSolarKwh + b.outFromGridKwh).toBeCloseTo(b.outKwh, 2);
    expect(b.inKwh).toBeGreaterThanOrEqual(b.outKwh - 1e-6); // a battery never gives out more than it took in
    expect(b.lostKwh).toBeGreaterThanOrEqual(0);
    expect(b.inKwh - b.outKwh - b.levelChangeKwh).toBeCloseTo(b.lostKwh, 2);
    // on a sunny day with a cheap night, what the battery gives back is worth more than nothing
    expect(t.money.batteryDisplacedInr).toBeGreaterThanOrEqual(t.money.storedSolarDisplacedInr - 1e-9);
  }, 400_000);

  it("states the order it attributes by, and says it is a convention rather than a measurement", async () => {
    await ready();
    await call("POST", `/api/properties/${ctx.pid}/plan`, {});
    const a = await get();
    expect(a.rule[0]).toMatch(/sun serves what the property is using now/);
    expect(a.check.note).toMatch(/accounting convention, not a measurement/);
    expect(a.totals.provenance.notes.join(" ")).toMatch(/does not record which kWh went where/);
  }, 400_000);

  it("calls a plan more than a day old stale, and recomputes nothing", async () => {
    await ready();
    await call("POST", `/api/properties/${ctx.pid}/plan`, {});
    ctx.t.clock.now = new Date(ctx.t.clock.now.getTime() + 25 * 3_600_000);
    const a = await get();
    expect(a.basedOn.stale).toBe(true);
    expect(a.next.map((n: { label: string }) => n.label)).toContain("Make a new plan");
  }, 400_000);
});
