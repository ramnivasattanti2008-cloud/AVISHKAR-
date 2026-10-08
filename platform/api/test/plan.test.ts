import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import type { PlanDto } from "../src/plan/schemas.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { local } from "../src/plan/horizon.js";
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

/** Cheap at night, ordinary by day, dear in the evening: the shape of an Indian time-of-day tariff. */
const TARIFF = { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" };

describeBoth("plans, through the API and the real engine", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;

  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, session: Session | null = s) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const plan = (body: Record<string, unknown> = {}) => call("POST", `/api/properties/${pid}/plan`, body);
  const make = async (body: Record<string, unknown> = {}): Promise<PlanDto> => {
    const res = await plan(body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };

  const currentCsv = (days = 70) => {
    const istToday = new Date(t.clock.now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${istToday}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);
    return meterCsv({ start, days, intervalMinutes: 60, kw: (_d, h) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) });
  };
  const withTariff = async () => {
    const tariff = (await call("POST", "/api/tariffs", TARIFF)).json();
    expect((await call("PUT", `/api/properties/${pid}/tariff`, { tariffPlanId: tariff.id })).statusCode).toBe(200);
    return tariff;
  };
  const withMeter = async (csv = currentCsv()) => expect((await call("POST", `/api/properties/${pid}/energy/imports`, { csv, filename: "m.csv" })).statusCode).toBe(201);
  const withSolar = () => call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180 });
  const withBattery = (over: Record<string, unknown> = {}) => call("POST", `/api/properties/${pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5, ...over });

  beforeEach(async () => {
    await resetDb();
    t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 60_000 }) });
    // a fixed afternoon (15:40 IST), so what the plan can do (an EV leaving at 07:00, a 24 h horizon inside the provider's hours) never depends on when the tests run
    t.clock.now = new Date("2026-10-07T10:10:00Z");
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "plan@example.com");
    pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });

  it("plans a day that costs less than the same day with no control, and every hour's energy balances", async () => {
    await withTariff();
    await withMeter();
    await withSolar();
    await withBattery();
    const p = await make({ mode: "SAVE_MONEY" });

    expect(p.validation).toMatchObject({ valid: true, problems: [] });
    expect(p.horizon.steps).toBe(24);
    expect(p.schedule.times).toHaveLength(24);
    expect(new Date(p.horizon.start).getUTCMinutes()).toBe(30); // a whole IST hour
    expect(p.result.provenance.status).toBe("SIMULATED");
    expect(p.result.provenance.modelVersion).toMatch(/^engine-/);
    const r = p.result.value!;
    expect(r.savingsInr).toBeGreaterThan(0);
    expect(r.netCostInr).toBeLessThan(r.baselineNetCostInr);
    expect(r.savingsInr).toBeCloseTo(r.baselineNetCostInr - r.netCostInr, 2);
    expect(r.unservedKwh).toBeCloseTo(0, 6);

    const sc = p.schedule;
    for (let i = 0; i < 24; i++) {
      const sources = sc.pvUsedKw[i]! + sc.gridImportKw[i]! + sc.batteryDischargeKw[i]!;
      const uses = sc.loadKw[i]! + sc.batteryChargeKw[i]! + sc.evChargeKw[i]! + sc.gridExportKw[i]! + Object.values(sc.applianceKw).reduce((a, k) => a + k[i]!, 0);
      expect(sources).toBeCloseTo(uses, 3);
    }
    expect(Math.min(...sc.batterySocKwh)).toBeGreaterThanOrEqual(1 - 1e-6); // the default 10% floor of a 10 kWh battery
    expect(Math.max(...sc.batterySocKwh)).toBeLessThanOrEqual(10 + 1e-6);
    expect(sc.batterySocKwh[23]).toBeGreaterThanOrEqual(1 - 1e-6); // it ends the day no emptier than it began
    // the reasons are worded in the local clock: a time written in a reason is the local time of the decision it explains
    const worded = p.decisions.filter((d) => /\bat (\d\d):(\d\d)\b/.test(d.reason));
    expect(worded.length).toBeGreaterThan(0);
    for (const d of worded) {
      const l = local(Date.parse(d.time));
      expect(d.reason).toContain(`at ${String(l.hour).padStart(2, "0")}:${String(l.minute).padStart(2, "0")}`);
    }
    // every step is priced at the tariff's rate for its own local hour
    for (let i = 0; i < 24; i++) {
      const hour = local(Date.parse(sc.times[i]!)).hour;
      expect(sc.importPrice[i]).toBe(TARIFF.touBlocks.find((b) => hour >= b.startHour && hour < b.endHour)!.rate);
    }
  });

  describe("the recommendation (spec section 45)", () => {
    it("says what to do in the next hours, why, from what, worth how much, and how steady it is, with the planner's own reasons", async () => {
      await withTariff();
      await withMeter();
      await withSolar();
      await withBattery();
      const p = await make({ mode: "SAVE_MONEY" });
      const r = p.recommendation!;
      expect(r).toBeDefined();
      expect(["CHARGE_BATTERY", "USE_BATTERY", "HOLD"]).toContain(r.kind);
      expect(r.headline.length).toBeGreaterThan(20);

      // the advice is read from the plan's own first three hours
      const moves = [0, 1, 2].map((i) => (p.schedule.batteryChargeKw[i]! > 0.05 ? "charge" : p.schedule.batteryDischargeKw[i]! > 0.05 ? "discharge" : "idle"));
      expect(r.confidence.scenarios[0]!.moves).toEqual(moves);
      if (r.kind === "CHARGE_BATTERY") expect(moves).toContain("charge");
      if (r.kind === "USE_BATTERY") expect(moves).toContain("discharge");
      if (r.kind === "HOLD") expect(moves.every((m) => m === "idle")).toBe(true);
      expect(r.why.length).toBeGreaterThan(0);
      const reasons = p.decisions.map((d) => d.reason);
      for (const w of r.why) {
        if (w === "The plan does not move the battery at all in this period.") continue;
        const bare = w.replace(/^The battery's next move is at \d\d:\d\d: /, "").replace(/\.$/, "");
        expect(reasons, `"${bare}" is not one of the planner's own reasons`).toContain(bare);
      }

      // what it was built from, and what it assumed
      expect(r.dataUsed.join(" ")).toContain("Tariff: Test ToD");
      expect(r.dataUsed.join(" ")).toContain("Battery: 9 kWh usable, starting at");
      expect(r.dataUsed.join(" ")).toContain("assumed");
      expect(r.assumptions).toEqual(p.assumptions);
      expect(r.expectedBenefit.savingsInr).toBe(p.result.value!.savingsInr);
      expect(r.expectedBenefit.basis).toContain("not this move alone");
    });

    it("tests how steady the advice is against the forecast bands, and says exactly what it tested", async () => {
      await withTariff();
      await withMeter();
      await withSolar();
      await withBattery();
      const c = (await make()).recommendation!.confidence;
      // the central forecast, plus whichever band ends the forecasts measured: every row says how the advice differs
      expect(c.scenarios[0]!.label).toContain("central estimate");
      expect(c.scenarios[0]!.agrees).toBe(true);
      if (c.assessed) {
        expect(c.total).toBe(c.scenarios.filter((s) => s.agrees !== null).length);
        expect(c.agreeing).toBe(c.scenarios.filter((s) => s.agrees === true).length);
        expect(c.agreeing).toBeGreaterThanOrEqual(1);
        expect(c.statement).toMatch(/forecasts tried/);
        expect(c.statement).not.toMatch(/%|probab/i); // it is a count of forecasts, never a made-up percentage
        for (const s of c.scenarios.slice(1)) expect(s.label).toMatch(/percentile/);
      } else {
        expect(c.statement).toMatch(/^Not assessed: /);
      }
    });

    it("is not assessed, and says so, for a home with no battery: there is no battery move to test", async () => {
      await withTariff();
      await withMeter();
      await withSolar();
      const r = (await make()).recommendation!;
      expect(r.kind).toBe("NO_BATTERY_MOVE");
      expect(r.confidence).toMatchObject({ assessed: false, total: 0 });
      expect(r.confidence.statement).toContain("there is no battery");
      expect(r.dataUsed.join(" ")).toContain("Battery: none");
    });

    it("is kept with the plan: a plan fetched later carries the same recommendation", async () => {
      await withTariff();
      await withMeter();
      await withSolar();
      await withBattery();
      const p = await make();
      const again = (await call("GET", `/api/properties/${pid}/plans/${p.id}`)).json();
      expect(again.recommendation).toEqual(p.recommendation);
    });
  });

  it("says what it assumed: the battery's start, the export rate, the load basis, and that nothing is certain", async () => {
    await withTariff();
    await withMeter();
    await withSolar();
    await withBattery();
    const p = await make();
    const text = p.assumptions.join(" ");
    expect(text).toContain("charge now is not known");
    expect(text).toContain("Fixed monthly charges");
    expect(text).toContain("No outage information");
    expect(text).toContain("Energy sent to the grid is credited at INR 3 per kWh (entered by you)");
    expect(p.inputs).toMatchObject({
      load: { basis: "FORECAST" },
      solar: { systems: 1 },
      tariff: { name: "Test ToD", exportRate: 3, exportBasis: "USER_ENTERED" },
      battery: { capacityKwh: 10, usableKwh: 9, startSocBasis: "ASSUMPTION" },
    });
    expect(p.result.provenance.notes.join(" ")).toContain("not a measurement");
  });

  it("uses the battery charge the owner states", async () => {
    await withTariff();
    await withMeter();
    await withBattery();
    const p = await make({ startSocPercent: 80 });
    expect(p.inputs.battery).toMatchObject({ startSocKwh: 8, startSocBasis: "USER_ENTERED" });
    expect(p.schedule.batterySocKwh[0]).toBeLessThanOrEqual(8 + 1e-6);
  });

  it("falls back to the property's own typical day, and says it is a pattern, when the meter data is old", async () => {
    await withTariff();
    await withMeter(meterCsv({ start: "2026-03-02", days: 30, intervalMinutes: 60, kw: (_d, h) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) }));
    const p = await make();
    expect(p.inputs.load.basis).toBe("TYPICAL_DAY");
    expect(p.inputs.load.note).toContain("your typical day");
    expect(p.validation.valid).toBe(true);
    // the typical load has its evening peak in the evening
    const peakHour = new Date(Date.parse(p.schedule.times[p.schedule.loadKw.indexOf(Math.max(...p.schedule.loadKw))]!) + 330 * 60_000).getUTCHours();
    expect(peakHour).toBeGreaterThanOrEqual(18);
    expect(peakHour).toBeLessThan(22);
  });

  it("plans with no solar and no battery too: the grid alone, at the day's prices", async () => {
    await withTariff();
    await withMeter();
    const p = await make();
    expect(p.inputs.battery).toBeNull();
    expect(p.inputs.solar.systems).toBe(0);
    expect(p.result.value!.savingsInr).toBeCloseTo(0, 6); // nothing to shift: the plan is the baseline
    expect(p.assumptions.join(" ")).toContain("No battery is entered");
  });

  it("schedules a flexible appliance inside its window and an EV before it leaves, at the cheapest hours", async () => {
    await withTariff();
    await withMeter();
    await withSolar();
    await call("POST", `/api/properties/${pid}/appliances`, { name: "Washer", kind: "washing machine", priority: "FLEXIBLE", ratedPowerW: 2000, earliestStart: "00:00", latestFinish: "23:00", durationMin: 120 });
    await call("POST", `/api/properties/${pid}/evs`, { name: "Nexon", batteryKwh: 30, chargerKw: 7, targetSoc: 0.8, currentSoc: 0.2, departureTime: "07:00", departureDays: [0, 1, 2, 3, 4, 5, 6] });
    const p = await make();
    expect(p.appliances).toHaveLength(1);
    expect(p.appliances[0]).toMatchObject({ name: "Washer", runHours: 2 });
    expect(p.appliances[0]!.startTime).not.toBeNull();
    expect(p.result.value!.evShortfallKwh).toBeCloseTo(0, 6);
    expect(p.inputs.ev).toMatchObject({ energyNeededKwh: 18 });
    const ev = p.schedule.evChargeKw;
    const cheapest = Math.min(...p.schedule.importPrice);
    const hoursAtCheapest = ev.filter((k, i) => k > 1e-6 && p.schedule.importPrice[i] === cheapest).length;
    expect(hoursAtCheapest).toBeGreaterThanOrEqual(2); // 18 kWh at 7 kW wants at least three hours; the cheap night is where it goes
    expect(p.schedule.evChargeKw.every((k) => k >= 0)).toBe(true);
  });

  it("a mode changes what the plan favours, and the cost is still reported at the true prices", async () => {
    await withTariff();
    await withMeter();
    await withSolar();
    await withBattery({ capacityKwh: 20, maxChargeKw: 8, maxDischargeKw: 8 });
    const save = await make({ mode: "SAVE_MONEY", startSocPercent: 50 });
    const indep = await make({ mode: "INDEPENDENCE", startSocPercent: 50 });
    expect(save.modeWeights).not.toEqual(indep.modeWeights);
    expect(indep.result.value!.importKwh).toBeLessThanOrEqual(save.result.value!.importKwh + 1e-6);
    expect(indep.result.value!.netCostInr).toBeGreaterThanOrEqual(save.result.value!.netCostInr - 1e-6); // saving money is what the first one is for
  });

  it("plans 48 hours when asked", async () => {
    await withTariff();
    await withMeter();
    await withSolar();
    const p = await make({ hours: 48 });
    expect(p.horizon.steps).toBe(48);
    expect(p.schedule.loadKw).toHaveLength(48);
  });

  it("keeps each plan, lists them newest first, and gives back exactly what was shown", async () => {
    await withTariff();
    await withMeter();
    const first = await make({ mode: "SAVE_MONEY" });
    t.clock.now = new Date(t.clock.now.getTime() + 60_000);
    const second = await make({ mode: "GREEN" });
    const latest = (await call("GET", `/api/properties/${pid}/plan`)).json();
    expect(latest.id).toBe(second.id);
    expect(latest).toEqual(second);
    const list = (await call("GET", `/api/properties/${pid}/plans`)).json().plans;
    expect(list.map((x: { id: string }) => x.id)).toEqual([second.id, first.id]);
    expect(list[0]).toMatchObject({ mode: "GREEN", steps: 24 });
    expect((await call("GET", `/api/properties/${pid}/plans/${first.id}`)).json()).toEqual(first);
    const row = await db().optimizationRun.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.savingsInr).toBeCloseTo(first.result.value!.savingsInr, 2);
    expect((await call("GET", `/api/properties/${pid}/plans/00000000-0000-4000-8000-000000000000`)).statusCode).toBe(404);
  });

  it("names what is missing, and makes no plan, when there is no tariff or no meter data", async () => {
    let res = await plan();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PLAN_INPUTS_MISSING");
    expect(res.json().error.details.missing.map((m: { what: string }) => m.what).sort()).toEqual(["load", "tariff"]);
    await withTariff();
    res = await plan();
    expect(res.json().error.details.missing.map((m: { what: string }) => m.what)).toEqual(["load"]);
    expect(await db().optimizationRun.count()).toBe(0);
    expect((await call("GET", `/api/properties/${pid}/plan`)).statusCode).toBe(404);
  });

  it("refuses to show a plan that fails the engine's own independent check", async () => {
    await withTariff();
    await withMeter();
    const real = new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 60_000 });
    const tampering = Object.create(real) as EngineClient;
    tampering.optimise = async (req, ctx) => {
      const r = await real.optimise(req, ctx);
      return { ...r, validation: { valid: false, maxBalanceErrorKw: 3.2, problems: ["energy balance broken in step 4"] } };
    };
    const bad = await makeApp({}, { engine: tampering });
    bad.setFetch(router(() => bad.clock.now));
    const u = await register(bad, "tamper@example.com");
    const h = { cookies: u.cookies, headers: u.headers };
    const prop = (await bad.app.inject({ method: "POST", url: "/api/properties", ...h, payload: { name: "H", latitude: LAT, longitude: LON, positionSource: "map-click" } })).json().id;
    const tariff = (await bad.app.inject({ method: "POST", url: "/api/tariffs", ...h, payload: TARIFF })).json();
    await bad.app.inject({ method: "PUT", url: `/api/properties/${prop}/tariff`, ...h, payload: { tariffPlanId: tariff.id } });
    await bad.app.inject({ method: "POST", url: `/api/properties/${prop}/energy/imports`, ...h, payload: { csv: currentCsv(), filename: "m.csv" } });
    const res = await bad.app.inject({ method: "POST", url: `/api/properties/${prop}/plan`, ...h, payload: {} });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("PLAN_INVALID");
    expect(res.json().error.message).toContain("SIMULATION INVALID");
    expect(res.json().error.details.problems).toEqual(["energy balance broken in step 4"]);
    expect(await db().optimizationRun.count({ where: { propertyId: prop } })).toBe(0);
  });

  it("is private to its owner, needs a session and the CSRF header, and needs the engine", async () => {
    await withTariff();
    await withMeter();
    const p = await make();
    const other = await register(t, "other@example.com");
    expect((await call("GET", `/api/properties/${pid}/plan`, undefined, other)).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${pid}/plans/${p.id}`, undefined, other)).statusCode).toBe(404);
    expect((await call("POST", `/api/properties/${pid}/plan`, {}, other)).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${pid}/plan` })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${pid}/plan`, cookies: s.cookies, payload: {} })).statusCode).toBe(403);
    expect((await call("POST", `/api/properties/${pid}/plan`, { hours: 12 })).statusCode).toBe(400);
    expect((await call("POST", `/api/properties/${pid}/plan`, { mode: "WILD" })).statusCode).toBe(400);

    const bare = await makeApp();
    const u = await register(bare, "noengine@example.com");
    const id = (await bare.app.inject({ method: "POST", url: "/api/properties", cookies: u.cookies, headers: u.headers, payload: { name: "H", latitude: LAT, longitude: LON, positionSource: "map-click" } })).json().id;
    const res = await bare.app.inject({ method: "POST", url: `/api/properties/${id}/plan`, cookies: u.cookies, headers: u.headers, payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("ENGINE_UNAVAILABLE");
  });
});
