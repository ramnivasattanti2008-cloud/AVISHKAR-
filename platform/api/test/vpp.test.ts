import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeBoth = engineAvailable && hasDb ? describe : describe.skip;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

const PATTERN = (h: number) => 0.5 + (h >= 18 && h < 22 ? 2 : 0); // 20 kWh a day
const TARIFF = { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" };

describeBoth("virtual power plant simulation and the community view, through the API and the real engine", () => {
  let t: TestApp;
  let s: Session;
  let archetype: string;
  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, session: Session | null = s) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const newProperty = async (name: string, session: Session | null = s) => (await call("POST", "/api/properties", { name, latitude: LAT, longitude: LON, positionSource: "map-click" }, session)).json().id as string;
  const withTariffAndMeter = async (pid: string) => {
    const tariff = (await call("POST", "/api/tariffs", { ...TARIFF, name: `ToD ${pid.slice(0, 4)}` })).json();
    await call("PUT", `/api/properties/${pid}/tariff`, { tariffPlanId: tariff.id });
    expect((await call("POST", `/api/properties/${pid}/energy/imports`, { csv: meterCsv({ start: "2026-07-29", days: 70, intervalMinutes: 60, kw: (_d, h) => PATTERN(h) }), filename: "m.csv" })).statusCode).toBe(201);
  };
  const simulate = async (over: Record<string, unknown> = {}) => {
    const res = await call("POST", "/api/vpp/simulate", { archetypePropertyId: archetype, homes: 100, ...over });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };

  beforeEach(async () => {
    await resetDb();
    t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 180_000 }) });
    t.clock.now = new Date("2026-10-07T10:10:00Z");
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "vpp@example.com");
  });

  describe("VPP", () => {
    beforeEach(async () => {
      archetype = await newProperty("Archetype");
      await withTariffAndMeter(archetype);
    });

    it("is labelled a simulation everywhere, lists every assumption, and says it coordinates no real homes", async () => {
      const r = await simulate();
      expect(r.label).toBe("VIRTUAL POWER PLANT SIMULATION");
      expect(r.result.provenance.status).toBe("SIMULATED");
      expect(r.result.provenance.notes.join(" ")).toContain("not a measurement of any real ones");
      const text = r.assumptions.join(" ");
      expect(text).toContain("Every home is synthetic");
      expect(text).toContain("does not coordinate real homes");
      expect(text).toContain("no network constraint");
      expect(r.fleet.homes).toBe(100);
    });

    it("describes the same homes for the same seed, and the same result", async () => {
      const a = await simulate({ seed: 5 });
      const b = await simulate({ seed: 5 });
      expect(b.fleet).toEqual(a.fleet);
      expect(b.result.value).toEqual(a.result.value);
      expect(b.hourly).toEqual(a.hourly);
      const c = await simulate({ seed: 6 });
      expect(c.fleet).not.toEqual(a.fleet);
    });

    it("with identical homes and nothing to coordinate, the day is one hundred times the pattern, worked out by hand", async () => {
      const r = await simulate({ pvSharePercent: 0, evSharePercent: 0, flexibleSharePercent: 0, loadCv: 0 });
      const v = r.result.value;
      expect(v.loadKwhPerDay).toBe(2000); // 100 homes x 20 kWh
      expect(v.solarKwhPerDay).toBe(0);
      expect(v.peakImportBeforeKw).toBe(250); // 100 x 2.5 kW in the evening
      expect(v.peakImportBeforeHour).toBe(18);
      expect(v.costBeforeInr).toBe(15_800); // 100 x (0.5 x (6 x 4 + 12 x 6 + 6 x 10) + 2 x 4 x 10)
      expect(v.costAfterInr).toBe(15_800);
      expect(v.savingsInr).toBe(0);
      expect(v.peakReductionPercent).toBe(0);
    });

    it("moving 15% of everyone's load to the cheapest hours cuts the evening peak by 15% and saves exactly what the prices say", async () => {
      const r = await simulate({ pvSharePercent: 0, evSharePercent: 0, flexibleSharePercent: 15, loadCv: 0 });
      const v = r.result.value;
      // 300 kWh is shiftable (3 kWh a home): 225 kWh fits the six cheapest hours at the power cap (37.5 kW each), the other 75 kWh goes to the next cheapest
      expect(r.fleet.shiftableKwhPerDay).toBe(300);
      expect(v.peakImportAfterKw).toBe(212.5); // 85% of 250 remains in the evening
      expect(v.peakReductionPercent).toBe(15);
      expect(v.costBeforeInr).toBe(15_800);
      expect(v.costAfterInr).toBe(14_780); // 13,430 fixed + 225 x 4 + 75 x 6
      expect(v.savingsInr).toBe(1_020);
      expect(v.importKwhAfter).toBe(v.importKwhBefore); // moved, not removed
    });

    it("with solar, batteries and vehicles it never costs more than not coordinating, and the solar per kWp is a believable number", async () => {
      const r = await simulate({ homes: 1000, pvSharePercent: 60, batterySharePercent: 50, evSharePercent: 10 });
      const v = r.result.value;
      expect(r.fleet.withSolar).toBeGreaterThan(520);
      expect(r.fleet.withSolar).toBeLessThan(680);
      expect(r.fleet.withBattery).toBeGreaterThan(0);
      expect(r.fleet.batteryKwh).toBeGreaterThan(0);
      expect(v.solarKwhPerDay / r.fleet.solarKwp).toBeGreaterThan(3.5); // kWh per kWp on a typical day
      expect(v.solarKwhPerDay / r.fleet.solarKwp).toBeLessThan(5.5);
      expect(v.costAfterInr).toBeLessThanOrEqual(v.costBeforeInr + 1);
      expect(v.peakImportAfterKw).toBeLessThanOrEqual(v.peakImportBeforeKw + 1e-6);
      expect(v.solarUsedLocallyAfter).toBeGreaterThanOrEqual(v.solarUsedLocallyBefore! - 1e-9);
      expect(r.hourly.loadKw).toHaveLength(24);
      expect(r.hourly.batteryKwh.some((x: number) => x > 0)).toBe(true);
    });

    it("runs a fleet of ten thousand homes, with the aggregate split into appliances the engine accepts", async () => {
      const r = await simulate({ homes: 10_000, evSharePercent: 20 });
      expect(r.fleet.homes).toBe(10_000);
      expect(r.fleet.withSolar).toBeGreaterThan(2800);
      expect(r.fleet.withSolar).toBeLessThan(3200);
      expect(r.result.value.loadKwhPerDay).toBeGreaterThan(150_000);
      expect(r.result.value.costAfterInr).toBeLessThanOrEqual(r.result.value.costBeforeInr + 1);
    }, 120_000);

    it("runs ten homes, the smallest fleet", async () => {
      const r = await simulate({ homes: 10 });
      expect(r.fleet.homes).toBe(10);
      expect(r.result.value.loadKwhPerDay).toBeGreaterThan(50);
    });

    it("uses the weekend pattern and the month asked for", async () => {
      const wd = await simulate({ loadCv: 0, pvSharePercent: 0, evSharePercent: 0 });
      const we = await simulate({ loadCv: 0, pvSharePercent: 0, evSharePercent: 0, dayType: "weekend", month: 3 });
      expect(we.dayType).toBe("weekend");
      expect(we.month).toBe(3);
      expect(wd.month).toBe(10); // this month on the Indian clock
    });

    it("refuses a fleet size that is not one of the four, and values that cannot be right", async () => {
      for (const body of [{ homes: 50 }, { homes: 100, pvSharePercent: 120 }, { homes: 100, pvKwpMean: 0 }, { homes: 100, flexibleSharePercent: 90 }, { homes: 100, seed: -1 }, { homes: 100, month: 13 }]) {
        expect((await call("POST", "/api/vpp/simulate", { archetypePropertyId: archetype, ...body })).statusCode, JSON.stringify(body)).toBe(400);
      }
    });

    it("names what the pattern property lacks, and is private to its owner", async () => {
      const bare = await newProperty("Bare");
      const res = await call("POST", "/api/vpp/simulate", { archetypePropertyId: bare, homes: 100 });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details.missing.map((m: { what: string }) => m.what).sort()).toEqual(["load", "tariff"]);
      const other = await register(t, "other@example.com");
      expect((await call("POST", "/api/vpp/simulate", { archetypePropertyId: archetype, homes: 100 }, other)).statusCode).toBe(404);
      expect((await t.app.inject({ method: "POST", url: "/api/vpp/simulate", payload: { archetypePropertyId: archetype, homes: 100 } })).statusCode).toBe(401);
      expect((await t.app.inject({ method: "POST", url: "/api/vpp/simulate", cookies: s.cookies, payload: { archetypePropertyId: archetype, homes: 100 } })).statusCode).toBe(403);
    });

    it("needs the engine", async () => {
      const bare = await makeApp();
      const u = await register(bare, "noengine@example.com");
      const id = (await bare.app.inject({ method: "POST", url: "/api/properties", cookies: u.cookies, headers: u.headers, payload: { name: "H", latitude: LAT, longitude: LON, positionSource: "map-click" } })).json().id;
      const res = await bare.app.inject({ method: "POST", url: "/api/vpp/simulate", cookies: u.cookies, headers: u.headers, payload: { archetypePropertyId: id, homes: 100 } });
      expect(res.statusCode).toBe(503);
    });
  });

  describe("community", () => {
    it("shows an empty account as nothing, not as zeros", async () => {
      const r = (await call("GET", "/api/community")).json();
      expect(r).toMatchObject({ label: "COMMUNITY ENERGY SIMULATION", members: [] });
      expect(r.totals.value).toBeNull();
    });

    it("sets properties side by side: a solar home in surplus, a home with none in deficit, one with no readings left out and says why", async () => {
      const sunny = await newProperty("Sunny");
      const shady = await newProperty("Shady");
      await newProperty("Blank"); // no tariff and no readings: left out of the sums, with the reason
      await withTariffAndMeter(sunny);
      await withTariffAndMeter(shady);
      await call("POST", `/api/properties/${sunny}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 13, azimuthDeg: 180 });
      await call("POST", `/api/properties/${sunny}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
      await call("POST", `/api/properties/${shady}/appliances`, { name: "Washer", kind: "washing machine", priority: "FLEXIBLE", ratedPowerW: 2000, earliestStart: "08:00", latestFinish: "20:00", durationMin: 120 });

      const r = (await call("GET", "/api/community")).json();
      const by = Object.fromEntries(r.members.map((m: { name: string }) => [m.name, m]));
      expect(by.Sunny).toMatchObject({ status: "SURPLUS", solarKwp: 5, batteryUsableKwh: 9, loadKwhPerDay: 20 });
      expect(by.Sunny.solarKwhPerDay).toBeGreaterThan(18); // 5 kWp at 5.5 kWh/m2/day
      expect(by.Sunny.solarKwhPerDay).toBeLessThan(26);
      expect(by.Shady).toMatchObject({ status: "DEFICIT", solarKwhPerDay: 0, surplusKwhPerDay: 0, deficitKwhPerDay: 20, shiftableKw: 2 });
      expect(by.Blank.status).toBe("NO_DATA");
      expect(by.Blank.reason).toContain("No meter readings");
      expect(by.Blank.surplusKwhPerDay).toBeNull();

      const tot = r.totals.value;
      expect(r.totals.provenance.status).toBe("SIMULATED");
      expect(tot.properties).toBe(2); // the one with no data is left out
      expect(tot.loadKwhPerDay).toBe(40);
      expect(tot.storageUsableKwh).toBe(9);
      expect(tot.shiftableKw).toBe(2);
      // the surplus of one that meets the deficit of the other in the same hour: by day the shady home needs 0.5 kW while the sunny one has plenty
      expect(tot.shareableKwhPerDay).toBeGreaterThan(3);
      expect(tot.shareableKwhPerDay).toBeLessThan(8);
      expect(tot.shareableKwhPerDay).toBeCloseTo(r.hourly.shareableKw.reduce((a: number, b: number) => a + b, 0), 0);
      expect(tot.shareableKwhPerDay).toBeLessThanOrEqual(Math.min(tot.surplusKwhPerDay, tot.deficitKwhPerDay) + 1e-6);
    });

    it("never says electricity is traded or shared, and says whose properties these are", async () => {
      const r = (await call("GET", "/api/community")).json();
      const text = r.notes.join(" ");
      expect(text).toContain("does not move electricity between properties");
      expect(text).toContain("depends on the law and the utility");
      expect(text).toContain("Only properties your account owns appear here");
    });

    it("shows only the signed-in account's own properties", async () => {
      await newProperty("Mine");
      const other = await register(t, "neighbour@example.com");
      await newProperty("Theirs", other);
      const mine = (await call("GET", "/api/community")).json();
      expect(mine.members.map((m: { name: string }) => m.name)).toEqual(["Mine"]);
      const theirs = (await call("GET", "/api/community", undefined, other)).json();
      expect(theirs.members.map((m: { name: string }) => m.name)).toEqual(["Theirs"]);
      expect((await t.app.inject({ method: "GET", url: "/api/community" })).statusCode).toBe(401);
    });
  });
});
