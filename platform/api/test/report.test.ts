import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { seedReferenceData } from "../src/seed/reference.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, defaultTestDataDir, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeDb = hasDb ? describe : describe.skip;
const describeBoth = engineAvailable && hasDb ? describe : describe.skip;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

const PATTERN = (h: number) => 0.5 + (h >= 18 && h < 22 ? 2 : 0);
const TARIFF = { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" };

describeDb("the report of a property with nothing in it", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;
  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
    t.clock.now = new Date("2026-10-08T06:00:00Z");
    s = await register(t, "report-empty@example.com");
    pid = (await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name: "Empty Home", latitude: LAT, longitude: LON, positionSource: "map-click" } })).json().id;
  });

  it("says, section by section, what is not there and why, and invents nothing; it needs no engine", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/properties/${pid}/report`, cookies: s.cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="avishkar-report-empty-home-2026-10-08.md"');
    const md = res.body;
    expect(md).toContain("# AVISHKAR report: Empty Home");
    expect(md).toContain("Made 2026-10-08 11:30 IST from what AVISHKAR holds for this property."); // 06:00 UTC, on the clock the person lives by, and the date is separated from the word
    expect(md).toContain("*Tariff: not available. No tariff has been chosen for this property.*");
    expect(md).toContain("*Meter readings: not available. None have been imported.*");
    expect(md).toContain("*Equipment: not available. Nothing has been entered.*");
    expect(md).toContain("*Plan: not available. None has been made yet.*");
    expect(md).toContain("*What-if: not available. None has been run yet.*");
    expect(md).toContain("*Forecast accuracy: not available.");
    expect(md).toContain("**UNAVAILABLE**: No value: the source is down or the data does not exist. Nothing has been made up.");
    expect(md).not.toMatch(/INR \d/); // no figure of any kind
    expect(await db().auditLog.count({ where: { action: "report.export" } })).toBe(1);
  });

  it("is private to its owner and needs a session", async () => {
    const other = await register(t, "other@example.com");
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${pid}/report`, cookies: other.cookies })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${pid}/report` })).statusCode).toBe(401);
  });
});

describeBoth("the report of a property with a plan and a what-if", () => {
  it("carries the same figures the plan and the what-if carry, with their labels and assumptions", async () => {
    await resetDb();
    await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
    const t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 180_000 }) });
    t.clock.now = new Date("2026-10-07T10:10:00Z");
    t.setFetch(router(() => t.clock.now));
    const s = await register(t, "report-full@example.com");
    const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => t.app.inject({ method, url, cookies: s.cookies, headers: s.headers, payload: payload as never });
    const pid = (await call("POST", "/api/properties", { name: "Full Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
    const tariff = (await call("POST", "/api/tariffs", TARIFF)).json();
    await call("PUT", `/api/properties/${pid}/tariff`, { tariffPlanId: tariff.id });
    await call("POST", `/api/properties/${pid}/energy/imports`, { csv: meterCsv({ start: "2026-07-29", days: 70, intervalMinutes: 60, kw: (_d, h) => PATTERN(h) }), filename: "m.csv" });
    await call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 13, azimuthDeg: 180 });
    await call("POST", `/api/properties/${pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
    const plan = (await call("POST", `/api/properties/${pid}/plan`, { mode: "BALANCED", hours: 24 })).json();
    const sc = (await call("POST", `/api/properties/${pid}/scenarios`, { addBatteryKwh: 5, costs: { batteryInrPerKwh: 30_000 } })).json();

    const md = (await call("GET", `/api/properties/${pid}/report`)).body;
    const r = plan.result.value;
    const inr = (v: number) => `INR ${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(2)}`;
    expect(md).toContain("- Location: ");
    expect(md).toContain("Test ToD");
    expect(md).toContain("Export credit: INR 3.00 per kWh (entered by the owner)");
    expect(md).toContain("Energy DNA (version 1, 70 complete days)");
    expect(md).toContain("- Solar: Roof, 5 kWp");
    expect(md).toContain("- Battery: Wall, 10 kWh");
    expect(md).toContain(`Expected cost ${inr(r.netCostInr)} against ${inr(r.baselineNetCostInr)} with no control: a saving of ${inr(r.savingsInr)}`);
    expect(md).toContain("[SIMULATED]");
    expect(md).toContain("This is a simulated outcome of forecasts, not a measurement.");
    expect(md).toContain(plan.decisions[0].reason);
    // the time beside each decision is on the same clock as the time written in its reason (a report once mixed UTC with IST)
    const timed = [...md.matchAll(/^- (\d{4}-\d\d-\d\d) (\d\d:\d\d) IST: .*? kWh\. .*? at (\d\d:\d\d)/gm)];
    expect(timed.length).toBeGreaterThan(0);
    for (const m of timed) expect(m[3], m[0]).toBe(m[2]);
    expect(md).not.toMatch(/\d\d:\d\d UTC/);
    expect(md).toContain(`${sc.name} (`);
    expect(md).toContain(`Planned yearly cost today ${inr(sc.base.netCostInr)}; with the change ${inr(sc.scenario.netCostInr)}`);
    expect(md).toContain("You would pay INR 1,50,000 (your quote)");
    expect(md).toContain("[ESTIMATED]");
    for (const a of plan.assumptions.slice(0, 2)) expect(md).toContain(a);
    expect(md).toContain("It does not confirm a subsidy or an eligibility");
  });
});
