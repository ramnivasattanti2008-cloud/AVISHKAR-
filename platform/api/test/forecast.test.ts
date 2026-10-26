import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { LAT, LON, router } from "./fixtures.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { type Session, type TestApp, db, hasDb, json, makeApp, register, resetDb } from "./helpers.js";
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

describeBoth("forecasts, through the API and the real engine", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;

  const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown, session: Session | null = s) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const addSolar = (over: Record<string, unknown> = {}) =>
    call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180, ...over });
  const count = (kind: "SOLAR" | "LOAD") => db().forecastRun.count({ where: { propertyId: pid, kind } });

  /** Hourly readings ending at 23:00 IST yesterday, so the meter data is current. */
  const currentCsv = (days = 70) => {
    const istToday = new Date(t.clock.now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${istToday}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);
    return meterCsv({ start, days, intervalMinutes: 60, kw: (_d, h, wd) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) + (wd >= 5 ? 0.4 : 0) });
  };

  beforeEach(async () => {
    await resetDb();
    t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 60_000 }) });
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "forecast@example.com");
    pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });

  describe("solar", () => {
    it("forecasts a system's output with a band learned from the place's own past forecast errors", async () => {
      expect((await addSolar()).statusCode).toBe(201);
      const res = await call("GET", `/api/properties/${pid}/solar-forecast`);
      expect(res.statusCode, res.body).toBe(200);
      const f = res.json();

      expect(f.systems).toHaveLength(1);
      expect(f.systems[0]).toMatchObject({ capacityKwp: 5, lossFraction: 0.14, lossBasis: "ASSUMPTION" });
      expect(f.hours.provenance).toMatchObject({ status: "FORECAST", provider: "avishkar-engine" });
      expect(f.hours.provenance.modelVersion).toMatch(/^engine-\d+\.\d+/);
      const hours = f.hours.value as { time: string; clearSkyKw: number; p10Kw: number; p50Kw: number; p90Kw: number }[];
      expect(hours).toHaveLength(48);
      for (const h of hours) {
        expect(h.p10Kw).toBeLessThanOrEqual(h.p50Kw + 1e-9);
        expect(h.p50Kw).toBeLessThanOrEqual(h.p90Kw + 1e-9);
        expect(h.p50Kw).toBeLessThanOrEqual(1.25 * h.clearSkyKw + 1e-9); // the clear-sky curve is a reference: irradiance above it is clipped at 1.25 times
      }
      const noon = hours.find((h) => h.time.slice(11, 13) === "06");
      expect(noon!.p50Kw).toBeGreaterThan(2); // the fixture's sun peaks near 850 W/m2 at 06-07 UTC: a 5 kWp roof is well into its output
      expect(hours.find((h) => h.time.slice(11, 13) === "20")!.p50Kw).toBe(0); // after dark
      expect(f.energy.value.yieldKwhPerKwpP50).toBeGreaterThan(6);
      expect(f.energy.value.yieldKwhPerKwpP50).toBeLessThan(16);
      expect(f.energy.value.kwhP10).toBeLessThanOrEqual(f.energy.value.kwhP50);
      expect(f.energy.value.kwhP90).toBeGreaterThanOrEqual(f.energy.value.kwhP50);

      expect(f.band.available).toBe(true);
      expect(f.band.calibration.hoursUsed).toBeGreaterThan(120);
      expect(f.band.calibration.holdoutCoverage).toBeGreaterThan(0.5);
      expect(f.weather).toMatchObject({ provider: "open-meteo", stale: false });
      expect(t.fetched.some((u) => u.hostname.includes("previous-runs"))).toBe(true);
    });

    it("stores the forecast as issued, once per hour, so it can be scored later", async () => {
      await addSolar();
      await call("GET", `/api/properties/${pid}/solar-forecast`);
      await call("GET", `/api/properties/${pid}/solar-forecast`);
      expect(await count("SOLAR")).toBe(1);
      const row = await db().forecastRun.findFirstOrThrow({ where: { propertyId: pid } });
      expect(row).toMatchObject({ kind: "SOLAR", hours: 48, model: expect.stringContaining("pvlib") });
      expect((row.series as { p50Kw: number[] }).p50Kw).toHaveLength(48);
      t.clock.now = new Date(t.clock.now.getTime() + 2 * 3_600_000);
      await call("GET", `/api/properties/${pid}/solar-forecast`);
      expect(await count("SOLAR")).toBe(2);
    });

    it("adds up several systems on the same sky, and a planned one only when nothing is installed", async () => {
      await addSolar({ name: "East", azimuthDeg: 90 });
      await addSolar({ name: "West", azimuthDeg: 270 });
      await addSolar({ name: "Future", status: "PLANNED", capacityKwp: 50 });
      const f = (await call("GET", `/api/properties/${pid}/solar-forecast`)).json();
      expect(f.systems.map((x: { name: string }) => x.name)).toEqual(["East", "West"]);
      expect(f.notes.join(" ")).toContain("Planned systems are left out");
      expect(f.assumptions.join(" ")).toContain("share one sky");
    });

    it("says there is nothing to forecast, with the reason, when no system is entered", async () => {
      const f = (await call("GET", `/api/properties/${pid}/solar-forecast`)).json();
      expect(f.hours).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
      expect(f.hours.provenance.notes.join(" ")).toContain("Add one");
      expect(f.systems).toEqual([]);
    });

    it("still forecasts, without a band and saying why, when the record of past errors cannot be fetched", async () => {
      t.setFetch(router(() => t.clock.now, { previousRuns: () => json({ reason: "nope" }, 400) }));
      await addSolar();
      const f = (await call("GET", `/api/properties/${pid}/solar-forecast`)).json();
      expect(f.hours.provenance.status).toBe("FORECAST");
      expect(f.band).toMatchObject({ available: false, calibration: null });
      const h = f.hours.value as { p10Kw: number | null; p90Kw: number | null }[];
      expect(h.every((x) => x.p10Kw === null && x.p90Kw === null)).toBe(true);
      expect(f.notes.join(" ")).toContain("No uncertainty band");
    });

    it("scores the forecast against the baselines it has to beat, and says what it was scored against", async () => {
      await addSolar();
      const res = await call("GET", `/api/properties/${pid}/solar-forecast/performance`);
      expect(res.statusCode, res.body).toBe(200);
      const p = res.json();
      expect(p.result.provenance.status).toBe("ESTIMATED");
      expect(p.basis).toContain("not of metered panel output");
      const r = p.result.value;
      expect(r.window.hours).toBeGreaterThan(24 * 20);
      expect(r.forecast.maeKw).toBeGreaterThan(0); // the fixture's forecast is off by up to 18%
      expect(r.forecast.maeKw).toBeLessThan(r.clearSky.maeKw); // a forecast that sees the clouds beats assuming none
      expect(r.skillVsClearSky).toBeGreaterThan(0);
      expect(r.persistenceBaseline.hours).toBeGreaterThan(24 * 20);
    });

    it("needs the engine: without one it is unavailable, never a made-up number", async () => {
      const bare = await makeApp();
      bare.setFetch(router(() => bare.clock.now));
      const u = await register(bare, "noengine@example.com");
      const id = (await bare.app.inject({ method: "POST", url: "/api/properties", cookies: u.cookies, headers: u.headers, payload: { name: "H", latitude: LAT, longitude: LON, positionSource: "map-click" } })).json().id;
      const res = await bare.app.inject({ method: "GET", url: `/api/properties/${id}/solar-forecast`, cookies: u.cookies });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("ENGINE_UNAVAILABLE");
    });

    it("is private to its owner", async () => {
      await addSolar();
      const other = await register(t, "other@example.com");
      const res = await t.app.inject({ method: "GET", url: `/api/properties/${pid}/solar-forecast`, cookies: other.cookies });
      expect(res.statusCode).toBe(404);
      expect((await t.app.inject({ method: "GET", url: `/api/properties/${pid}/solar-forecast` })).statusCode).toBe(401);
    });
  });

  describe("load", () => {
    const importCsv = (csv: string) => call("POST", `/api/properties/${pid}/energy/imports`, { csv, filename: "meter.csv" });

    it("forecasts tomorrow from current readings: the evening peak is where it was, the band holds it, the winner is named", async () => {
      expect((await importCsv(currentCsv())).statusCode).toBe(201);
      const res = await call("GET", `/api/properties/${pid}/load-forecast?hours=24`);
      expect(res.statusCode).toBe(200);
      const f = res.json();
      expect(f.hours.provenance).toMatchObject({ status: "FORECAST", provider: "avishkar-engine" });
      const hours = f.hours.value as { time: string; p10Kw: number; p50Kw: number; p90Kw: number; peakProbability: number }[];
      expect(hours).toHaveLength(24);
      for (const h of hours) {
        const local = new Date(Date.parse(h.time) + 330 * 60_000).getUTCHours();
        const weekend = [0, 6].includes(new Date(Date.parse(h.time) + 330 * 60_000).getUTCDay());
        const truth = 0.5 + (local >= 18 && local < 22 ? 2 : 0) + (weekend ? 0.4 : 0);
        expect(h.p50Kw).toBeCloseTo(truth, 1);
        expect(h.p10Kw).toBeLessThanOrEqual(h.p50Kw);
        expect(h.p90Kw).toBeGreaterThanOrEqual(h.p50Kw);
      }
      expect(f.model.methods.length).toBeGreaterThanOrEqual(3);
      expect(f.model.selectedMethod).toBeTruthy();
      expect(f.history).toMatchObject({ intervalMinutes: 60, readingsUsed: 70 * 24, emptyIntervals: 0 });
      expect(f.history.dataEndsDaysAgo).toBeLessThanOrEqual(1); // the data ends at the last midnight: up to a day ago, whatever the hour the test runs
      expect(await count("LOAD")).toBe(1);
    });

    it("does not call a forecast of the hours after old data a forecast of tomorrow", async () => {
      await importCsv(meterCsv({ start: "2026-03-02", days: 30, intervalMinutes: 60 })); // ends 31 March
      const f = (await call("GET", `/api/properties/${pid}/load-forecast`)).json();
      expect(f.hours.provenance.status).toBe("ESTIMATED");
      expect(f.hours.provenance.notes.join(" ")).toContain("not for the coming days");
      expect(f.history.dataEndsDaysAgo).toBeGreaterThan(150);
      expect(f.notes.join(" ")).toContain("Your meter data ends");
      expect(await count("LOAD")).toBe(0); // nothing is kept to be scored: it was not a prediction of the future
    });

    it("explains what is missing when there is not enough history", async () => {
      await importCsv(meterCsv({ start: "2026-03-02", days: 8, intervalMinutes: 60 }));
      const f = (await call("GET", `/api/properties/${pid}/load-forecast`)).json();
      expect(f.hours).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
      expect(f.hours.provenance.notes.join(" ")).toContain("at least 14 days");
    });

    it("says so when there are no readings at all", async () => {
      const f = (await call("GET", `/api/properties/${pid}/load-forecast`)).json();
      expect(f.hours.provenance.status).toBe("UNAVAILABLE");
      expect(f.hours.provenance.notes.join(" ")).toContain("no meter readings");
    });

    it("refuses an hours value outside 1 to 168", async () => {
      for (const h of ["0", "169", "x"]) expect((await call("GET", `/api/properties/${pid}/load-forecast?hours=${h}`)).statusCode).toBe(400);
    });
  });
});

