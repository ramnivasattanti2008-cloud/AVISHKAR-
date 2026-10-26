import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { evaluateDueForecasts } from "../src/forecast/evaluate.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const describeBoth = engineAvailable && hasDb ? describe : describe.skip;
const describeDb = hasDb ? describe : describe.skip;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

/** Mean of the pattern below over a day: 0.5 all day, plus 2 for four evening hours. */
const PATTERN = (h: number) => 0.5 + (h >= 18 && h < 22 ? 2 : 0);
const MEAN = 0.5 + (2 * 4) / 24;

describeBoth("forecasts are scored against the readings that follow them", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;
  const T0 = new Date("2026-10-07T10:10:00Z"); // 15:40 IST on Wednesday 7 October

  const call = (method: "GET" | "POST", url: string, payload?: unknown, session: Session | null = s) => t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const importCsv = async (csv: string) => {
    const res = await call("POST", `/api/properties/${pid}/energy/imports`, { csv, filename: `m-${Math.random()}.csv` });
    expect(res.statusCode, res.body).toBe(201);
  };
  const accuracy = async () => (await call("GET", `/api/properties/${pid}/forecast-accuracy`)).json();

  beforeEach(async () => {
    await resetDb();
    t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 60_000 }) });
    t.clock.now = T0;
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "learn@example.com");
    pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
    // 70 days of hourly readings that end at midnight at the start of Wednesday 7 October (IST), an exact weekly-flat pattern
    await importCsv(meterCsv({ start: "2026-07-29", days: 70, intervalMinutes: 60, kw: (_d, h) => PATTERN(h) }));
  });

  it("waits while the readings do not reach the forecast's hours, then scores it when they do, against known answers", async () => {
    const f = (await call("GET", `/api/properties/${pid}/load-forecast?hours=24`)).json();
    expect(f.hours.provenance.status).toBe("FORECAST");
    expect(f.history.dataEndsDaysAgo).toBeLessThan(1);

    let a = await accuracy();
    expect(a.load.runs).toHaveLength(1);
    expect(a.load.runs[0]).toMatchObject({ status: "WAITING", scores: null, hours: 24 });
    expect(a.load.runs[0].reason).toContain("does not yet cover");
    expect(a.load.summary).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });

    // two days later the meter has recorded the day that was forecast, and the household used 20% more than its pattern
    t.clock.now = new Date(T0.getTime() + 2 * DAY);
    await importCsv(meterCsv({ start: "2026-10-07", days: 1, intervalMinutes: 60, kw: (_d, h) => 1.2 * PATTERN(h) }));

    a = await accuracy();
    const run = a.load.runs[0];
    expect(run.status).toBe("SCORED"); // scored by the import itself, not by a separate call
    expect(run.scores.hours).toBe(24);
    expect(run.scores.maeKw).toBeCloseTo(0.2 * MEAN, 2); // the forecast was the pattern, the day was 20% above it
    expect(run.scores.biasKw).toBeCloseTo(-0.2 * MEAN, 2); // negative: the forecast ran low
    expect(run.scores.wapePct).toBeCloseTo((0.2 / 1.2) * 100, 0);
    expect(run.scores.coverage80).toBeLessThan(0.5); // the band was built from noise-free history, so a 20% jump falls outside it
    // last week the household used the pattern, which is what the forecast also said: no better, no worse
    expect(run.scores.lastWeek.hours).toBe(24);
    expect(Math.abs(run.scores.skillVsLastWeek)).toBeLessThan(0.1);
    expect(a.load.summary.provenance.status).toBe("ESTIMATED");
    expect(a.load.summary.value).toMatchObject({ scored: 1 });
    expect(a.load.summary.value.meanBiasKw).toBeCloseTo(-0.2 * MEAN, 2);
    expect(a.solar.available).toBe(false);
    expect(a.solar.reason).toContain("no generation meter");

    const row = await db().forecastRun.findFirstOrThrow({ where: { propertyId: pid } });
    expect(row.evaluatedAt).not.toBeNull();
    expect((row.evaluation as { status: string }).status).toBe("SCORED");
  });

  it("scores a forecast once: evaluating again changes nothing", async () => {
    await call("GET", `/api/properties/${pid}/load-forecast?hours=24`);
    t.clock.now = new Date(T0.getTime() + 2 * DAY);
    await importCsv(meterCsv({ start: "2026-10-07", days: 1, intervalMinutes: 60, kw: (_d, h) => PATTERN(h) }));
    const before = await db().forecastRun.findFirstOrThrow({ where: { propertyId: pid } });
    const again = await call("POST", `/api/properties/${pid}/forecast-accuracy/evaluate`);
    expect(again.json()).toEqual({ scored: 0, notScorable: 0, waiting: 0 });
    const after = await db().forecastRun.findFirstOrThrow({ where: { propertyId: pid } });
    expect(after.evaluatedAt).toEqual(before.evaluatedAt);
    // a perfect pattern: the forecast was right
    expect((after.evaluation as { scores: { maeKw: number } }).scores.maeKw).toBeLessThan(0.02);
  });

  it("evaluates on request too, and says what it did", async () => {
    await call("GET", `/api/properties/${pid}/load-forecast?hours=24`);
    const none = await call("POST", `/api/properties/${pid}/forecast-accuracy/evaluate`);
    expect(none.json()).toEqual({ scored: 0, notScorable: 0, waiting: 1 });
  });

  it("is private to its owner and needs a session", async () => {
    const other = await register(t, "other@example.com");
    expect((await call("GET", `/api/properties/${pid}/forecast-accuracy`, undefined, other)).statusCode).toBe(404);
    expect((await call("POST", `/api/properties/${pid}/forecast-accuracy/evaluate`, {}, other)).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${pid}/forecast-accuracy` })).statusCode).toBe(401);
  });
});

describeDb("a forecast that cannot be scored is closed, with the reason", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;
  const T0 = Date.parse("2026-03-01T18:30:00Z");

  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
    s = await register(t, "gaps@example.com");
    pid = (await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" } })).json().id;
  });

  const store = (start: number, hours: number) =>
    db().forecastRun.create({
      data: {
        propertyId: pid,
        kind: "LOAD",
        issuedAt: new Date(start),
        issuedHour: new Date(start),
        firstHour: new Date(start),
        hours,
        model: "load:test",
        engineVersion: "0.1.0",
        series: { times: Array.from({ length: hours }, (_, i) => new Date(start + i * HOUR).toISOString()), p10Kw: Array(hours).fill(0.5), p50Kw: Array(hours).fill(1), p90Kw: Array(hours).fill(1.5) },
        basis: {},
      },
    });

  it("closes a forecast whose hours mostly have no reading as NOT_SCORABLE instead of waiting for ever", async () => {
    await store(T0, 24);
    // readings exist for hours 0-5 and 20-23 of the day only, and run on after it, so the data covers the horizon but is full of holes
    const csv = meterCsv({ start: "2026-03-02", days: 3, intervalMinutes: 60, skip: (d, slot) => d === 0 && slot >= 6 && slot < 20 });
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${pid}/energy/imports`, cookies: s.cookies, headers: s.headers, payload: { csv, filename: "holes.csv" } })).statusCode).toBe(201);
    // the import itself closed it; asking again finds nothing left to do
    expect(await evaluateDueForecasts(db(), pid, new Date("2026-03-10T00:00:00Z"))).toEqual({ scored: 0, notScorable: 0, waiting: 0 });
    const row = await db().forecastRun.findFirstOrThrow({ where: { propertyId: pid } });
    expect((row.evaluation as { status: string; reason: string }).status).toBe("NOT_SCORABLE");
    expect((row.evaluation as { reason: string }).reason).toContain("Fewer than 12 of its 24 hours");
    const a = (await t.app.inject({ method: "GET", url: `/api/properties/${pid}/forecast-accuracy`, cookies: s.cookies })).json();
    expect(a.load.runs[0]).toMatchObject({ status: "NOT_SCORABLE", scores: null });
  });

  it("leaves a forecast waiting while there are no readings at all", async () => {
    await store(T0, 24);
    expect(await evaluateDueForecasts(db(), pid, new Date())).toEqual({ scored: 0, notScorable: 0, waiting: 1 });
  });
});
