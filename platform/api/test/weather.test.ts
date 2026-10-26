import { beforeEach, describe, expect, it } from "vitest";
import { MemoryCache } from "../src/providers/cache.js";
import { ProviderHttp } from "../src/providers/http.js";
import { MemoryRecorder } from "../src/providers/recorder.js";
import { type RawWeather, OpenMeteoWeather, buildReport, cellOf, coarsen } from "../src/providers/weather.js";
import { PASSWORD, type TestApp, db, hasDb, json, makeApp, register, resetDb } from "./helpers.js";

const NOW = new Date("2026-10-07T10:10:00Z");

/** A realistic Open-Meteo response (shape verified against the live API). */
function body(over: { current?: Record<string, unknown>; hourly?: Record<string, unknown[]>; hours?: number } = {}) {
  const hours = over.hours ?? 24;
  const times = Array.from({ length: hours }, (_, h) => `2026-10-07T${String(h).padStart(2, "0")}:00`);
  const sun = (h: number) => Math.max(0, Math.round(900 * Math.sin(((h - 0.5) / 12) * Math.PI) * (h >= 1 && h <= 12 ? 1 : 0)));
  return {
    latitude: 12.970123,
    longitude: 77.56364,
    elevation: 910,
    utc_offset_seconds: 0,
    timezone: "GMT",
    current: { time: "2026-10-07T10:00", interval: 900, temperature_2m: 28.2, relative_humidity_2m: 53, cloud_cover: 27, wind_speed_10m: 1.99, precipitation: 0, shortwave_radiation: 530, ...over.current },
    hourly: {
      time: times,
      temperature_2m: times.map((_, h) => 22 + h * 0.3),
      relative_humidity_2m: times.map(() => 60),
      cloud_cover: times.map(() => 30),
      wind_speed_10m: times.map(() => 2),
      precipitation: times.map(() => 0),
      shortwave_radiation: times.map((_, h) => sun(h)),
      direct_normal_irradiance: times.map((_, h) => sun(h) * 0.7),
      diffuse_radiation: times.map((_, h) => sun(h) * 0.3),
      ...over.hourly,
    },
  };
}

function raw(over?: Parameters<typeof body>[0]): RawWeather {
  const b = body(over);
  const { time, interval, ...cur } = b.current;
  const { time: times, ...hourly } = b.hourly;
  return { latitude: b.latitude, longitude: b.longitude, elevationM: 910, current: { time: time as string, intervalSeconds: interval as number, values: cur as RawWeather["current"]["values"] }, hourly: { times: times as string[], values: hourly as RawWeather["hourly"]["values"] } };
}

const opts = (over: Partial<Parameters<typeof buildReport>[1]> = {}) => ({
  provider: "open-meteo",
  requested: { latitude: 12.97, longitude: 77.59 },
  now: NOW,
  fetchedAt: new Date("2026-10-07T10:09:00Z"),
  stale: false,
  source: "Open-Meteo forecast API (model data)",
  ...over,
});

describe("buildReport", () => {
  it("labels fresh current values LIVE, says they are model analysis, and keeps units and location", () => {
    const r = buildReport(raw(), opts());
    const t = r.current.air_temperature!;
    expect(t.value).toBe(28.2);
    expect(t.unit).toBe("°C");
    expect(t.provenance).toMatchObject({ status: "LIVE", provider: "open-meteo", observedAt: "2026-10-07T10:00:00.000Z", ageSeconds: 600 });
    expect(t.provenance.location).toEqual({ latitude: 12.970123, longitude: 77.56364 });
    expect(t.provenance.notes.join(" ")).toContain("not a reading from a weather station");
    expect(Object.keys(r.current)).toHaveLength(6);
    expect(r.stale).toBe(false);
  });

  it("calls an old current value UPDATED and states its age", () => {
    const r = buildReport(raw(), opts({ now: new Date("2026-10-07T10:42:00Z") }));
    expect(r.current.air_temperature!.provenance.status).toBe("UPDATED");
    expect(r.current.air_temperature!.provenance.notes.join(" ")).toContain("42 min");
  });

  it("labels hourly values FORECAST, stamped with when they were fetched", () => {
    const r = buildReport(raw(), opts());
    const g = r.hourly.global_horizontal_irradiance!;
    expect(g.provenance).toMatchObject({ status: "FORECAST", generatedAt: "2026-10-07T10:09:00.000Z", dataType: "global_horizontal_irradiance_hourly_forecast" });
    expect(g.value).toHaveLength(24);
    expect(g.value![0]).toEqual({ time: "2026-10-07T00:00:00.000Z", value: 0 });
    expect(Object.keys(r.hourly)).toHaveLength(8);
  });

  it("rejects an impossible current temperature and reports it instead of showing it", () => {
    const r = buildReport(raw({ current: { temperature_2m: 999 } }), opts());
    const t = r.current.air_temperature!;
    expect(t.value).toBeNull();
    expect(t.provenance.status).toBe("UNAVAILABLE");
    expect(t.provenance.notes.join(" ")).toContain("physically possible");
    expect(r.quality).toContainEqual(expect.objectContaining({ variable: "air_temperature", rejected: 1 }));
  });

  it("removes impossible and spiking hourly points, says how many, and does not fill the holes", () => {
    const temps = Array.from({ length: 24 }, (_, h) => 22 + h * 0.3) as (number | null)[];
    temps[5] = 999; // impossible
    temps[10] = 55; // sensor spike between plausible neighbours
    temps[15] = null; // missing
    const r = buildReport(raw({ hourly: { temperature_2m: temps } }), opts());
    const m = r.hourly.air_temperature!;
    expect(m.value).toHaveLength(21);
    expect(m.value!.some((p) => p.value === 999 || p.value === 55)).toBe(false);
    expect(m.provenance.notes.join(" ")).toContain("3 point(s) failed quality checks");
    expect(m.provenance.notes.join(" ")).toContain("gap");
    const q = r.quality.find((x) => x.variable === "air_temperature")!;
    expect(q.rejected).toBe(3);
    expect(q.reasons.join(" ")).toMatch(/spike/);
  });

  it("when the provider is down and an old copy is shown, says so and the age", () => {
    const r = buildReport(raw(), opts({ now: new Date("2026-10-07T11:00:00Z"), stale: true }));
    expect(r.stale).toBe(true);
    expect(r.notes[0]).toContain("WEATHER SERVICE TEMPORARILY UNAVAILABLE");
    expect(r.notes[0]).toContain("51 min");
    expect(r.current.air_temperature!.provenance.status).toBe("UPDATED");
  });

  it("omits a variable the provider did not send rather than inventing it", () => {
    const b = raw();
    delete b.current.values.cloud_cover;
    delete b.hourly.values.cloud_cover;
    const r = buildReport(b, opts());
    expect(r.current.cloud_cover).toBeUndefined();
    expect(r.hourly.cloud_cover).toBeUndefined();
  });
});

describe("coordinate coarsening", () => {
  it("rounds to about 1 km and keys 0.05 degree cells", () => {
    expect(coarsen(12.971634)).toBe(12.97);
    expect(coarsen(77.5946)).toBe(77.59);
    expect(cellOf(12.97)).toBe(259);
    expect(cellOf(77.59)).toBe(1552);
  });
});

describe("OpenMeteoWeather", () => {
  type Handler = (u: URL, n: number) => Response | Promise<Response>;
  const make = (handler: Handler, onFresh?: ConstructorParameters<typeof OpenMeteoWeather>[0]["onFresh"]) => {
    const urls: URL[] = [];
    const recorder = new MemoryRecorder();
    const http = new ProviderHttp({
      provider: "open-meteo",
      baseUrl: "https://api.open-meteo.test",
      userAgent: "AVISHKAR-tests/1.0 (contact: tests)",
      timeoutMs: 1000,
      recorder,
      retries: 0,
      fetchImpl: (async (i: URL | string) => {
        const u = new URL(i.toString());
        urls.push(u);
        return handler(u, urls.length);
      }) as typeof fetch,
    });
    const cache = new MemoryCache();
    return { w: new OpenMeteoWeather({ http, cache, onFresh }), urls, cache, recorder };
  };
  const at = { now: () => NOW };

  it("sends coarsened coordinates, UTC time and the variable lists, and reports the requested and grid points", async () => {
    const { w, urls } = make(() => json(body()));
    const r = await w.forecast(12.971634, 77.594612, { days: 2 }, at);
    const q = urls[0]!.searchParams;
    expect(q.get("latitude")).toBe("12.97");
    expect(q.get("longitude")).toBe("77.59");
    expect(q.get("forecast_days")).toBe("2");
    expect(q.get("timezone")).toBe("UTC");
    expect(q.get("current")).toContain("shortwave_radiation");
    expect(q.get("hourly")).toContain("direct_normal_irradiance");
    expect(r.requested).toEqual({ latitude: 12.97, longitude: 77.59 });
    expect(r.grid).toEqual({ latitude: 12.970123, longitude: 77.56364 });
  });

  it("clamps the number of days to 1..7", async () => {
    const { w, urls } = make(() => json(body()));
    await w.forecast(12.97, 77.59, { days: 30 }, at);
    await w.forecast(13.5, 77.59, { days: 0 }, at);
    expect(urls.map((u) => u.searchParams.get("forecast_days"))).toEqual(["7", "1"]);
  });

  it("serves a repeat request from the cache without another provider call", async () => {
    const { w, urls } = make(() => json(body()));
    await w.forecast(12.97, 77.59, {}, at);
    await w.forecast(12.9712, 77.5903, {}, at); // same ~1 km cell
    expect(urls).toHaveLength(1);
  });

  it("rejects impossible coordinates before calling anyone", async () => {
    const { w, urls } = make(() => json(body()));
    await expect(w.forecast(95, 10, {}, at)).rejects.toMatchObject({ code: "INVALID_COORDINATES" });
    expect(urls).toHaveLength(0);
  });

  it("raises PROVIDER_UNAVAILABLE when the service is down and nothing is cached (no invented weather)", async () => {
    const { w } = make(() => json({}, 503));
    await expect(w.forecast(12.97, 77.59, {}, at)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", provider: "open-meteo" });
  });

  it("refuses a malformed provider response", async () => {
    const { w } = make(() => json({ latitude: 12.9, longitude: 77.5, current: { time: "x" }, hourly: {} }));
    await expect(w.forecast(12.97, 77.59, {}, at)).rejects.toMatchObject({ code: "PROVIDER_BAD_RESPONSE" });
  });

  it("falls back to the last good copy, marked stale, when the service later fails", async () => {
    let down = false;
    const { w, cache } = make(() => (down ? json({}, 503) : json(body())));
    await w.forecast(12.97, 77.59, {}, { now: () => new Date("2026-10-07T10:09:00Z") });
    const key = [...(cache as unknown as { m: Map<string, unknown> }).m.keys()][0]!;
    const rec = (await cache.get<RawWeather>(key))!;
    await cache.set(key, "open-meteo", rec.value, 1, new Date("2026-10-07T10:09:00Z")); // expires after 1 s
    down = true;
    const r = await w.forecast(12.97, 77.59, {}, { now: () => new Date("2026-10-07T10:50:00Z") });
    expect(r.stale).toBe(true);
    expect(r.notes[0]).toContain("TEMPORARILY UNAVAILABLE");
    expect(r.current.air_temperature!.provenance.status).toBe("UPDATED");
    expect(r.fetchedAt).toBe("2026-10-07T10:09:00.000Z");
  });
});

const describeDb = hasDb ? describe : describe.skip;

describeDb("weather routes and stored history", () => {
  let t: TestApp;
  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
    t.setFetch(() => json(body()));
  });

  it("serves public weather with provenance and stores what was issued", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/weather?latitude=12.9716&longitude=77.5946&days=1" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.current.air_temperature.provenance.status).toMatch(/^(LIVE|UPDATED)$/);
    expect(b.hourly.global_horizontal_irradiance.provenance.status).toBe("FORECAST");
    expect(b.requested).toEqual({ latitude: 12.97, longitude: 77.59 });
    const rows = await db().weatherObservation.findMany();
    expect(rows.filter((r) => r.kind === "ANALYSIS")).toHaveLength(6);
    expect(rows.filter((r) => r.kind === "FORECAST").length).toBeGreaterThanOrEqual(8 * 24);
    expect(rows.every((r) => r.latCell === 259 && r.lonCell === 1551 && r.provider === "open-meteo")).toBe(true);
  });

  it("does not store values that failed the physical checks", async () => {
    const temps = Array.from({ length: 24 }, (_, h) => 22 + h * 0.3) as (number | null)[];
    temps[5] = 999;
    t.setFetch(() => json(body({ hourly: { temperature_2m: temps }, current: { temperature_2m: 999 } })));
    await t.app.inject({ method: "GET", url: "/api/weather?latitude=12.9716&longitude=77.5946" });
    const stored = await db().weatherObservation.findMany({ where: { variable: "air_temperature" } });
    expect(stored.some((r) => r.value > 60)).toBe(false);
    expect(stored.filter((r) => r.kind === "ANALYSIS")).toHaveLength(0);
    expect(stored.filter((r) => r.kind === "FORECAST")).toHaveLength(23);
  });

  it("does not duplicate history when the same fetch is stored twice", async () => {
    await t.app.inject({ method: "GET", url: "/api/weather?latitude=12.9716&longitude=77.5946" });
    const n = await db().weatherObservation.count();
    await t.app.inject({ method: "GET", url: "/api/weather?latitude=12.9716&longitude=77.5946" }); // cached: no new fetch
    expect(await db().weatherObservation.count()).toBe(n);
  });

  it("returns INVALID_COORDINATES and 503 PROVIDER_UNAVAILABLE as documented", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/weather?latitude=100&longitude=10" })).json().error.code).toBe("INVALID_COORDINATES");
    expect((await t.app.inject({ method: "GET", url: "/api/weather?latitude=abc&longitude=10" })).statusCode).toBe(400);
    t.setFetch(() => json({}, 503));
    const down = await t.app.inject({ method: "GET", url: "/api/weather?latitude=19.07&longitude=72.87" });
    expect(down.statusCode).toBe(503);
    expect(down.json().error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", details: { provider: "open-meteo" } });
  });

  it("serves weather for your own property only", async () => {
    const a = await register(t, "wa@example.com", PASSWORD);
    const b = await register(t, "wb@example.com", PASSWORD);
    const p = (
      await t.app.inject({ method: "POST", url: "/api/properties", cookies: a.cookies, headers: a.headers, payload: { name: "Home", latitude: 12.9716, longitude: 77.5946, positionSource: "map-click" } })
    ).json();
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${p.id}/weather` })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${p.id}/weather`, cookies: b.cookies })).statusCode).toBe(404);
    const ok = await t.app.inject({ method: "GET", url: `/api/properties/${p.id}/weather?days=2`, cookies: a.cookies });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().grid.latitude).toBeCloseTo(12.97, 2);
  });

  it("lists the weather provider in system health once it has been called", async () => {
    await t.app.inject({ method: "GET", url: "/api/weather?latitude=12.9716&longitude=77.5946" });
    const h = (await t.app.inject({ method: "GET", url: "/api/system/health" })).json();
    expect(h.providers.find((p: { provider: string }) => p.provider === "open-meteo")).toMatchObject({ state: "healthy", calls: 1 });
  });
});
