import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { economics } from "../src/scenarios/economics.js";
import { seedReferenceData } from "../src/seed/reference.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, defaultTestDataDir, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeBoth = engineAvailable && hasDb ? describe : describe.skip;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

const PATTERN = (h: number) => 0.5 + (h >= 18 && h < 22 ? 2 : 0);
/** Cheap at night (hours 0 to 5), ordinary by day (6 to 17), dear in the evening (18 to 23). */
const TARIFF = { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" };
/** What a day of the pattern costs on that tariff: 0.5 kW all day plus 2 kW more from 18:00 to 22:00. */
const DAY_COST = 0.5 * (6 * 4 + 12 * 6 + 6 * 10) + 2 * 4 * 10;

describeBoth("what-if scenarios, through the API and the real engine", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, session: Session | null = s) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const run = (body: Record<string, unknown>) => call("POST", `/api/properties/${pid}/scenarios`, body);
  const ok = async (body: Record<string, unknown>) => {
    const res = await run(body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const withTariff = async (over: Record<string, unknown> = {}) => {
    const tariff = (await call("POST", "/api/tariffs", { ...TARIFF, ...over })).json();
    return tariff;
  };
  const select = async (tariff: { id: string }) => expect((await call("PUT", `/api/properties/${pid}/tariff`, { tariffPlanId: tariff.id })).statusCode).toBe(200);
  const withMeter = async () => expect((await call("POST", `/api/properties/${pid}/energy/imports`, { csv: meterCsv({ start: "2026-07-29", days: 70, intervalMinutes: 60, kw: (_d, h) => PATTERN(h) }), filename: "m.csv" })).statusCode).toBe(201);
  const withSolar = () => call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 13, azimuthDeg: 180 });

  beforeEach(async () => {
    await resetDb();
    await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
    t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 120_000 }) });
    t.clock.now = new Date("2026-10-07T10:10:00Z");
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "scenario@example.com");
    pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
    await select(await withTariff());
    await withMeter();
  });

  it("with nothing installed, today's bill is every kWh bought: a year of the pattern, worked out by hand", async () => {
    const r = await ok({ addSolarKwp: 5 });
    expect(r.base.netCostInr).toBeCloseTo(365 * DAY_COST, 0); // 57,670: the engine has nothing to optimise, and neither does the arithmetic
    expect(r.base.gridOnlyCostInr).toBeCloseTo(r.base.netCostInr, 2);
    expect(r.base.importKwh).toBeCloseTo(365 * (0.5 * 24 + 2 * 4), 0);
    expect(r.base.pvKwh).toBe(0);
    expect(r.equipment.base).toEqual({ solarKwp: 0, batteryKwh: 0, tariff: "Test ToD" });
    expect(r.equipment.scenario).toMatchObject({ solarKwp: 5, batteryKwh: 0 });
    expect(r.base.months).toHaveLength(12);
    expect(r.base.months.reduce((a: number, m: { days: number }) => a + m.days, 0)).toBe(365);
  });

  it("added solar produces a believable year, lowers the bill, and the saving per kWh sits between the prices it displaces and the export rate", async () => {
    const r = await ok({ addSolarKwp: 5 });
    expect(r.scenario.pvKwh).toBeGreaterThan(6_500); // 5 kWp at 5.5 kWh/m2/day: about 7,800 kWh a year
    expect(r.scenario.pvKwh).toBeLessThan(9_500);
    const c = r.comparison.value;
    expect(c.annualSavingsInr).toBeGreaterThan(0);
    expect(c.annualSavingsInr).toBe(Math.round((r.base.netCostInr - r.scenario.netCostInr) * 100) / 100);
    const perKwh = c.annualSavingsInr / r.scenario.pvKwh;
    expect(perKwh).toBeGreaterThan(3); // never worth less than the export rate
    expect(perKwh).toBeLessThan(7); // nor more than the dearest daytime price it displaces
    expect(c.importKwhChange).toBeLessThan(0);
    expect(r.comparison.provenance.status).toBe("ESTIMATED");
    expect(r.comparison.provenance.notes.join(" ")).toContain("not a forecast of any particular one");
    expect(r.scenario.selfSufficiencyRatio).toBeGreaterThan(r.base.selfSufficiencyRatio);
    expect(r.assumptions.join(" ")).toContain("one typical weekday and one typical weekend day");
    expect(r.assumptions.join(" ")).toContain("tilted 13 degrees"); // the latitude, because no tilt was given
    expect(r.assumptions.join(" ")).toContain("credited at INR 3 per kWh (entered by you)"); // where the export credit comes from is always said
    expect(r.assumptions.join(" ")).toContain("of the solar is sent to the grid"); // the pattern uses little by day, so most of the solar is exported
  });

  it("will not invent a price: without the quote there is no payback, with it the arithmetic is the economics module's", async () => {
    const without = await ok({ addSolarKwp: 5 });
    expect(without.investment).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
    expect(without.investment.provenance.notes[0]).toContain("from a quote");
    expect(without.economics).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
    expect(without.comparison.value.annualSavingsInr).toBeGreaterThan(0); // the saving is still shown

    const r = await ok({ addSolarKwp: 5, costs: { solarInrPerKwp: 50_000 }, economics: { years: 20 } });
    expect(r.investment.value).toEqual({ totalInr: 250_000, solarInr: 250_000, batteryInr: 0, otherInr: 0 });
    expect(r.investment.provenance.status).toBe("REFERENCE");
    const expected = economics({ investmentInr: 250_000, annualSavingsInr: r.comparison.value.annualSavingsInr, years: 20, discountRate: 0.08, tariffEscalation: 0, degradation: 0.005 });
    expect(r.economics.value).toEqual(expected);
    expect(r.economics.provenance.status).toBe("ESTIMATED");
    expect(r.economicsAssumptions).toEqual({ years: 20, discountRatePercent: 8, tariffEscalationPercent: 0, degradationPercent: 0.5 });
    expect(without.assumptions.join(" ")).toContain("are assumptions, not data"); // the defaults are flagged as assumptions
    expect(r.assumptions.join(" ")).not.toContain("are assumptions, not data"); // the ones you chose are not
  });

  it("shows what a published subsidy would pay on a new system, separately, and never nets it off the price you gave", async () => {
    const r = await ok({ addSolarKwp: 5, costs: { solarInrPerKwp: 50_000 } });
    expect(r.subsidy.value).toBe(78_000); // PM Surya Ghar, capped, from the sourced rule on file
    expect(r.subsidy.provenance.status).toBe("ESTIMATED");
    expect(r.investment.value.totalInr).toBe(250_000); // not netted
    expect(r.economicsIfSubsidised.value.paybackYears).toBeLessThan(r.economics.value.paybackYears);
    expect(r.economicsIfSubsidised.value.netGainInr).toBeCloseTo(r.economics.value.netGainInr + 78_000, 0);
  });

  it("states no subsidy for an addition to an existing system, or when nothing solar is added", async () => {
    await withSolar();
    const added = await ok({ addSolarKwp: 2, costs: { solarInrPerKwp: 50_000 } });
    expect(added.subsidy.value).toBeNull();
    expect(added.subsidy.provenance.notes[0]).toContain("existing system");
    const battery = await ok({ addBatteryKwh: 5, costs: { batteryInrPerKwh: 30_000 } });
    expect(battery.subsidy.provenance.notes[0]).toContain("No solar is added");
    expect(battery.economicsIfSubsidised).toBeNull();
  });

  it("a battery on top of solar saves by moving cheap and free energy into the dear evening, within what the prices allow", async () => {
    await withSolar();
    const r = await ok({ addBatteryKwh: 10, costs: { batteryInrPerKwh: 30_000 } });
    expect(r.equipment.base).toMatchObject({ solarKwp: 5, batteryKwh: 0 });
    expect(r.equipment.scenario).toMatchObject({ solarKwp: 5, batteryKwh: 10 });
    expect(r.comparison.value.annualSavingsInr).toBeGreaterThan(3_000);
    expect(r.comparison.value.annualSavingsInr).toBeLessThan(365 * 9 * (10 - 3)); // never more than 9 usable kWh a day moved across the widest price gap
    expect(r.scenario.batteryCycles).toBeGreaterThan(100);
    expect(r.scenario.batteryCycles).toBeLessThan(365 * 1.5);
    expect(r.assumptions.join(" ")).toContain("half its capacity per hour");
    expect(r.assumptions.join(" ")).toContain("replacing it is not modelled");
  });

  it("a battery alone arbitrages the tariff, and never pays more than the price gap allows", async () => {
    const r = await ok({ addBatteryKwh: 10 });
    expect(r.base.pvKwh).toBe(0);
    expect(r.comparison.value.annualSavingsInr).toBeGreaterThan(6_000);
    expect(r.comparison.value.annualSavingsInr).toBeLessThan(365 * 9 * (10 - 4)); // 9 usable kWh between the cheapest and dearest price
    expect(r.comparison.value.importKwhChange).toBeGreaterThan(0); // it buys more than the house uses, to sell itself to the evening
    expect(r.scenario.netCostInr).toBeLessThan(r.scenario.uncontrolledCostInr + 1e-6);
  });

  it("a different tariff needs no investment and compares the same year of use", async () => {
    const flat = await withTariff({ name: "Flat 7", touBlocks: [{ startHour: 0, endHour: 24, rate: 7 }], exportRate: undefined });
    const r = await ok({ tariffPlanId: flat.id });
    expect(r.equipment.scenario.tariff).toBe("Flat 7");
    expect(r.scenario.netCostInr).toBeCloseTo(365 * 7 * 20, 0); // 7 per kWh on 20 kWh a day
    expect(r.comparison.value.annualSavingsInr).toBeCloseTo(365 * DAY_COST - 365 * 7 * 20, 0); // 158 a day on the time-of-day plan against 140
    expect(r.investment.value).toEqual({ totalInr: 0, solarInr: 0, batteryInr: 0, otherInr: 0 });
    expect(r.economics.value.paybackYears).toBe(0);
    expect(r.economics.value.irrPercent).toBeNull();
  });

  it("gives carbon only when you give the emission factor, and then exactly the change in imports times it", async () => {
    const none = await ok({ addSolarKwp: 5 });
    expect(none.carbon).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
    expect(none.carbon.provenance.notes[0]).toContain("No grid emission factor is built in");
    const r = await ok({ addSolarKwp: 5, gridCarbonKgPerKwh: 0.8 });
    expect(r.carbon.value.avoidedKgPerYear).toBeCloseTo((r.base.importKwh - r.scenario.importKwh) * 0.8, -1);
    expect(r.carbon.provenance.status).toBe("ESTIMATED");
  });

  it("keeps each scenario, lists them, returns them as shown, and deletes them", async () => {
    const a = await ok({ addSolarKwp: 3, name: "Three kWp" });
    t.clock.now = new Date(t.clock.now.getTime() + 60_000);
    const b = await ok({ addBatteryKwh: 5 });
    expect(b.name).toBe("Add 5 kWh battery");
    const list = (await call("GET", `/api/properties/${pid}/scenarios`)).json().scenarios;
    expect(list.map((x: { id: string }) => x.id)).toEqual([b.id, a.id]);
    expect(list[1]).toMatchObject({ name: "Three kWp", addSolarKwp: 3, addBatteryKwh: null, tariffChanged: false });
    expect((await call("GET", `/api/properties/${pid}/scenarios/${a.id}`)).json()).toEqual(a);
    expect((await call("DELETE", `/api/properties/${pid}/scenarios/${a.id}`)).statusCode).toBe(204);
    expect((await call("GET", `/api/properties/${pid}/scenarios/${a.id}`)).statusCode).toBe(404);
    expect(await db().scenario.count({ where: { propertyId: pid } })).toBe(1);
  });

  it("refuses a request that changes nothing, and values that cannot be right", async () => {
    expect((await run({})).statusCode).toBe(400);
    expect((await run({ name: "Nothing" })).statusCode).toBe(400);
    expect((await run({ addSolarKwp: -1 })).statusCode).toBe(400);
    expect((await run({ addSolarKwp: 5, economics: { years: 0 } })).statusCode).toBe(400);
    expect((await run({ addSolarKwp: 5, costs: { solarInrPerKwp: -5 } })).statusCode).toBe(400);
    expect((await run({ tariffPlanId: "not-a-uuid" })).statusCode).toBe(400);
    expect(await db().scenario.count()).toBe(0);
  });

  it("names what is missing, and runs nothing, when there is no tariff or no meter data", async () => {
    await call("DELETE", `/api/properties/${pid}/tariff`);
    let res = await run({ addSolarKwp: 5 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PLAN_INPUTS_MISSING");
    expect(res.json().error.details.missing.map((m: { what: string }) => m.what)).toEqual(["tariff"]);
    const other = (await call("POST", "/api/properties", { name: "Empty", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
    res = await call("POST", `/api/properties/${other}/scenarios`, { addSolarKwp: 5 });
    expect(res.json().error.details.missing.map((m: { what: string }) => m.what).sort()).toEqual(["load", "tariff"]);
    expect(await db().scenario.count()).toBe(0);
  });

  it("does not let one account use another's tariff or read its scenarios", async () => {
    const mine = await ok({ addSolarKwp: 3 });
    const other = await register(t, "other@example.com");
    const theirs = (await call("POST", "/api/tariffs", { ...TARIFF, name: "Theirs" }, other)).json();
    expect((await run({ tariffPlanId: theirs.id })).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${pid}/scenarios`, undefined, other)).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${pid}/scenarios/${mine.id}`, undefined, other)).statusCode).toBe(404);
    expect((await call("DELETE", `/api/properties/${pid}/scenarios/${mine.id}`, undefined, other)).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${pid}/scenarios` })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${pid}/scenarios`, cookies: s.cookies, payload: { addSolarKwp: 3 } })).statusCode).toBe(403);
  });

  it("needs the engine", async () => {
    const bare = await makeApp();
    const u = await register(bare, "noengine@example.com");
    const id = (await bare.app.inject({ method: "POST", url: "/api/properties", cookies: u.cookies, headers: u.headers, payload: { name: "H", latitude: LAT, longitude: LON, positionSource: "map-click" } })).json().id;
    const res = await bare.app.inject({ method: "POST", url: `/api/properties/${id}/scenarios`, cookies: u.cookies, headers: u.headers, payload: { addSolarKwp: 3 } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("ENGINE_UNAVAILABLE");
  });
});
