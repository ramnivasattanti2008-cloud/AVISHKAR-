import { describe, expect, it } from "vitest";
import { type Obs } from "../src/energy/dna.js";
import { buildLoadSeries } from "../src/forecast/load-series.js";
import { hourlyWeatherFrom } from "../src/forecast/service.js";
import { MemoryCache } from "../src/providers/cache.js";
import { type RawHistory, OpenMeteoPreviousRuns, SETTLE_HOURS, latestRun } from "../src/providers/forecast-history.js";
import { ProviderHttp } from "../src/providers/http.js";
import { MemoryRecorder } from "../src/providers/recorder.js";
import type { WeatherReport } from "../src/providers/weather.js";
import { previousRunsBody } from "./fixtures.js";
import { json } from "./helpers.js";

const NOW = new Date("2026-10-07T10:10:00Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** `n` hours ending at `endMs` (the label of the last hour), every value valid unless `holes` says otherwise. */
function raw(n: number, endMs: number, holes: number[] = []): RawHistory {
  const times = Array.from({ length: n }, (_, i) => iso(endMs - (n - 1 - i) * HOUR));
  const v = (i: number, x: number) => (holes.includes(i) ? null : x);
  return {
    latitude: 12.97,
    longitude: 77.56,
    times,
    actual: times.map((_, i) => v(i, 100 + i)),
    forecast: times.map((_, i) => v(i, 110 + i)),
    temperature: times.map((_, i) => v(i, 25)),
  };
}

describe("latestRun: the unbroken stretch of hours that have both an analysis and a day-ahead forecast", () => {
  const settled = NOW.getTime() - SETTLE_HOURS * HOUR; // 07:10 UTC; the last hour allowed is 07:00

  it("keeps a clean window whole and labels its start with the first hour's end", () => {
    const r = latestRun(raw(48, Math.floor(settled / HOUR) * HOUR), NOW);
    expect(r.series).toMatchObject({ hours: 48, droppedHours: 0 });
    expect(r.series!.startTime).toBe("2026-10-05T08:00:00Z");
    expect(r.series!.actualGhiWm2[0]).toBe(100);
    expect(r.series!.forecastGhiWm2[47]).toBe(157);
  });

  it("leaves out the last hours whose analysis has not settled", () => {
    const r = latestRun(raw(48, NOW.getTime()), NOW);
    expect(r.series!.hours).toBe(48 - SETTLE_HOURS);
  });

  it("does not bridge a hole: it keeps the latest unbroken run and counts what lies before it", () => {
    const r = latestRun(raw(48, Math.floor(settled / HOUR) * HOUR, [10, 11]), NOW);
    expect(r.series).toMatchObject({ hours: 36, droppedHours: 2 }); // hours 12..47
    expect(r.series!.actualGhiWm2[0]).toBe(112);
  });

  it("drops physically impossible values rather than passing them on", () => {
    const x = raw(24, Math.floor(settled / HOUR) * HOUR);
    x.actual[20] = 5000;
    const r = latestRun(x, NOW);
    expect(r.series!.hours).toBe(3); // only 21..23 remain after the bad hour
  });

  it("says why when nothing is usable", () => {
    const x = raw(24, Math.floor(settled / HOUR) * HOUR);
    x.forecast = x.forecast.map(() => null);
    expect(latestRun(x, NOW)).toEqual({ series: null, reason: expect.stringContaining("no hour with both an analysis and a day-ahead forecast") });
  });
});

describe("OpenMeteoPreviousRuns", () => {
  const make = (handler: (u: URL, n: number) => Response | Promise<Response>) => {
    const urls: URL[] = [];
    const http = new ProviderHttp({
      provider: "open-meteo-previous-runs",
      baseUrl: "https://previous-runs-api.open-meteo.test",
      userAgent: "AVISHKAR-tests/1.0 (contact: tests)",
      timeoutMs: 1000,
      recorder: new MemoryRecorder(),
      retries: 0,
      fetchImpl: (async (i: URL | string) => {
        const u = new URL(i.toString());
        urls.push(u);
        return handler(u, urls.length);
      }) as typeof fetch,
    });
    return { urls, provider: new OpenMeteoPreviousRuns({ http, cache: new MemoryCache() }) };
  };

  it("asks for the analysis, the one-day-ahead forecast and the temperature at the coarsened place", async () => {
    const { urls, provider } = make(() => json(previousRunsBody(NOW)));
    const r = await provider.history(12.97163, 77.59461, { pastDays: 28 }, { now: () => NOW });
    expect(urls[0]!.pathname).toBe("/v1/forecast");
    expect(urls[0]!.searchParams.get("hourly")).toBe("shortwave_radiation,shortwave_radiation_previous_day1,temperature_2m");
    expect(urls[0]!.searchParams.get("past_days")).toBe("28");
    expect(urls[0]!.searchParams.get("latitude")).toBe("12.97"); // about 1 km: the exact point never leaves
    expect(r.series!.hours).toBeGreaterThan(24 * 27);
    expect(r.stale).toBe(false);
  });

  it("serves the second call from the cache, and a stale copy when the service fails", async () => {
    let t = NOW.getTime();
    let fail = false;
    const { urls, provider } = make(() => (fail ? new Response("down", { status: 503 }) : json(previousRunsBody(NOW))));
    const now = () => new Date(t);
    await provider.history(12.97, 77.59, {}, { now });
    await provider.history(12.97, 77.59, {}, { now });
    expect(urls).toHaveLength(1);
    t += 4 * HOUR; // past the 3 h lifetime
    fail = true;
    const r = await provider.history(12.97, 77.59, {}, { now });
    expect(r.stale).toBe(true);
    expect(r.series).not.toBeNull();
  });

  it("refuses an impossible coordinate before calling anyone", async () => {
    const { urls, provider } = make(() => json({}));
    await expect(provider.history(91, 0, {})).rejects.toMatchObject({ code: "INVALID_COORDINATES" });
    expect(urls).toHaveLength(0);
  });
});

describe("hourlyWeatherFrom", () => {
  const pts = (times: number[], f: (t: number) => number) => times.map((t) => ({ time: new Date(t).toISOString(), value: f(t) }));
  const report = (ghiT: number[], tempT: number[]) =>
    ({ hourly: { global_horizontal_irradiance: { value: pts(ghiT, () => 300) }, air_temperature: { value: pts(tempT, () => 25) } } }) as unknown as WeatherReport;
  const t0 = Date.parse("2026-10-07T00:00:00Z");
  const hrs = (...h: number[]) => h.map((x) => t0 + x * HOUR);

  it("uses every hour of an unbroken forecast", () => {
    const r = hourlyWeatherFrom(report(hrs(0, 1, 2, 3), hrs(0, 1, 2, 3)));
    expect(r.weather).toMatchObject({ startTime: "2026-10-07T00:00:00Z", convention: "end", ghiWm2: [300, 300, 300, 300], temperatureC: [25, 25, 25, 25] });
    expect(r.dropped).toBe(0);
  });

  it("takes the longest unbroken run when an hour is missing, and says how many were left out", () => {
    const r = hourlyWeatherFrom(report(hrs(0, 1, 3, 4, 5, 6), hrs(0, 1, 3, 4, 5, 6)));
    expect(r.weather!.startTime).toBe("2026-10-07T03:00:00Z");
    expect(r.weather!.ghiWm2).toHaveLength(4);
    expect(r.dropped).toBe(2);
  });

  it("ignores an irradiance hour that has no temperature", () => {
    const r = hourlyWeatherFrom(report(hrs(0, 1, 2), hrs(0, 2)));
    expect(r.weather!.ghiWm2).toHaveLength(1);
  });

  it("returns a reason, not an empty forecast, when there is nothing", () => {
    const r = hourlyWeatherFrom(report([], []));
    expect(r.weather).toBeNull();
    expect(r.reason).toContain("no hours");
  });
});

describe("buildLoadSeries: a regular series from stored readings, gaps left as gaps", () => {
  const T0 = Date.parse("2026-03-01T18:30:00Z"); // 2 March 00:00 IST
  const obs = (n: number, interval: number, skip: (i: number) => boolean = () => false, kwh = (i: number) => i + 1): Obs[] =>
    Array.from({ length: n }, (_, i) => ({ ts: new Date(T0 + i * interval * 60_000), kwh: kwh(i), intervalMinutes: interval })).filter((_, i) => !skip(i));

  it("hourly readings go through as they are", () => {
    const r = buildLoadSeries(obs(48, 60));
    expect(r.ok && r.series).toMatchObject({ startTime: "2026-03-01T18:30:00Z", intervalMinutes: 60 });
    expect(r.ok && r.series.kwh.slice(0, 3)).toEqual([1, 2, 3]);
    expect(r.ok && r.report).toMatchObject({ used: 48, gaps: 0, otherInterval: 0, offGrid: 0, aggregatedFrom: null });
    expect(r.ok && r.report.endsAt.toISOString()).toBe("2026-03-03T18:30:00.000Z");
  });

  it("leaves a null where a reading is missing and never fills it", () => {
    const r = buildLoadSeries(obs(10, 30, (i) => i === 4 || i === 5));
    expect(r.ok && r.series.kwh).toEqual([1, 2, 3, 4, null, null, 7, 8, 9, 10]);
    expect(r.ok && r.report).toMatchObject({ used: 8, gaps: 2 });
  });

  it("takes the dominant interval and counts the readings at another one", () => {
    const mixed = [...obs(20, 60), { ts: new Date(T0 + 5 * 60_000), kwh: 9, intervalMinutes: 5 }];
    const r = buildLoadSeries(mixed);
    expect(r.ok && r.series.intervalMinutes).toBe(60);
    expect(r.ok && r.report.otherInterval).toBe(1);
  });

  it("counts readings that do not sit on the first reading's grid, and leaves them out", () => {
    const x = obs(10, 60);
    x.push({ ts: new Date(T0 + 90 * 60_000), kwh: 99, intervalMinutes: 60 });
    const r = buildLoadSeries(x);
    expect(r.ok && r.report.offGrid).toBe(1);
    expect(r.ok && r.series.kwh).not.toContain(99);
  });

  it("adds finer readings into hours, and leaves an hour empty if any reading of it is missing", () => {
    const r = buildLoadSeries(obs(36, 5, (i) => i === 14, () => 0.1)); // three hours of 5-minute readings, one missing in hour 2
    expect(r.ok && r.series).toMatchObject({ intervalMinutes: 60 });
    expect(r.ok && r.series.kwh).toEqual([1.2, null, 1.2]);
    expect(r.ok && r.report).toMatchObject({ aggregatedFrom: 5, gaps: 1, used: 24 });
  });

  it("explains why readings that are too coarse, or cannot be combined, are not used", () => {
    const daily = buildLoadSeries(obs(10, 1440));
    expect(!daily.ok && daily.reason).toContain("at least hourly");
    const odd = buildLoadSeries(obs(10, 45));
    expect(!odd.ok && odd.reason).toContain("cannot be combined into whole hours");
    const none = buildLoadSeries([]);
    expect(!none.ok && none.reason).toContain("no meter readings");
  });
});
