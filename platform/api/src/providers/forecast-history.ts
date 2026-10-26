import { z } from "zod";
import { AppError } from "../errors.js";
import { checkCoordinates, checkValue } from "../quality.js";
import { type Cache, cachedFetch } from "./cache.js";
import type { ProviderHttp } from "./http.js";
import { coarsen } from "./weather.js";

/**
 * What Open-Meteo forecast for each past hour one day ahead, next to what its model says happened. This is the only honest way
 * to learn how wrong the irradiance forecast usually is at a place, and so how wide the solar output band must be (spec
 * sections 13 and 38). The "actual" is the weather model's own analysis, not a ground sensor: the platform says so wherever
 * it shows an error figure.
 */
export interface ForecastErrorSeries {
  /** The label of the first hour: Open-Meteo labels an hourly irradiance value with the END of the hour it averages. */
  startTime: string;
  hours: number;
  actualGhiWm2: number[];
  forecastGhiWm2: number[];
  temperatureC: number[];
  /** Hours inside the window that were left out (a missing or implausible value), which shortens the run used. */
  droppedHours: number;
}

export interface ForecastHistoryReport {
  grid: { latitude: number; longitude: number };
  fetchedAt: string;
  stale: boolean;
  /** Null when no usable run of hours exists; `reason` then says why. */
  series: ForecastErrorSeries | null;
  reason: string | null;
}

export interface ForecastHistoryContext {
  requestId?: string;
  now?: () => Date;
}

export interface ForecastHistoryProvider {
  readonly name: string;
  history(latitude: number, longitude: number, opts: { pastDays?: number }, ctx?: ForecastHistoryContext): Promise<ForecastHistoryReport>;
}

const Num = z.number().nullable();
const Response = z.object({
  latitude: z.number(),
  longitude: z.number(),
  hourly: z.object({
    time: z.array(z.string()),
    shortwave_radiation: z.array(Num),
    shortwave_radiation_previous_day1: z.array(Num),
    temperature_2m: z.array(Num),
  }),
});

export interface RawHistory {
  latitude: number;
  longitude: number;
  times: string[];
  actual: (number | null)[];
  forecast: (number | null)[];
  temperature: (number | null)[];
}

/** The model analysis of the last few hours is still being settled; leave them out. */
export const SETTLE_HOURS = 3;
const TTL_SECONDS = 3 * 3600; // the archive of past runs changes once a day
export const MIN_PAST_DAYS = 7;
export const MAX_PAST_DAYS = 60;
const utc = (t: string): Date => new Date(t.endsWith("Z") ? t : `${t}Z`);

/**
 * The most recent unbroken run of hours that have an analysis, a day-ahead forecast and a temperature. Gaps are not bridged:
 * the engine needs consecutive hours and a filled-in hour would be a made-up one. Pure.
 */
export function latestRun(raw: RawHistory, now: Date): { series: ForecastErrorSeries | null; reason: string | null } {
  const cutoff = now.getTime() - SETTLE_HOURS * 3_600_000;
  const ok = raw.times.map((t, i) => {
    const a = raw.actual[i];
    const f = raw.forecast[i];
    const c = raw.temperature[i];
    return (
      utc(t).getTime() <= cutoff &&
      typeof a === "number" && checkValue("shortwave_radiation_wm2", a).ok &&
      typeof f === "number" && checkValue("shortwave_radiation_wm2", f).ok &&
      typeof c === "number" && checkValue("air_temperature_c", c).ok
    );
  });
  let end = ok.lastIndexOf(true);
  if (end < 0) return { series: null, reason: "Open-Meteo returned no hour with both an analysis and a day-ahead forecast." };
  let start = end;
  while (start > 0 && ok[start - 1]) start--;
  // A hole in the middle shortens the run; count what lies inside the window but before the run as dropped.
  const dropped = ok.slice(0, start).filter((x) => !x).length;
  const hours = end - start + 1;
  end += 1;
  return {
    series: {
      startTime: utc(raw.times[start]!).toISOString().replace(".000Z", "Z"),
      hours,
      actualGhiWm2: raw.actual.slice(start, end) as number[],
      forecastGhiWm2: raw.forecast.slice(start, end) as number[],
      temperatureC: raw.temperature.slice(start, end) as number[],
      droppedHours: dropped,
    },
    reason: null,
  };
}

export class OpenMeteoPreviousRuns implements ForecastHistoryProvider {
  readonly name = "open-meteo-previous-runs";
  constructor(private readonly deps: { http: ProviderHttp; cache: Cache }) {}

  async history(latitude: number, longitude: number, opts: { pastDays?: number } = {}, ctx: ForecastHistoryContext = {}): Promise<ForecastHistoryReport> {
    const c = checkCoordinates(latitude, longitude);
    if (!c.ok) throw new AppError("INVALID_COORDINATES", c.reason);
    const pastDays = Math.min(Math.max(Math.trunc(opts.pastDays ?? 28), MIN_PAST_DAYS), MAX_PAST_DAYS);
    const lat = coarsen(latitude);
    const lon = coarsen(longitude);
    const now = ctx.now ?? (() => new Date());
    const got = await cachedFetch<RawHistory>(
      this.deps.cache,
      `forecast-history:open-meteo:${lat}:${lon}:${pastDays}`,
      this.name,
      TTL_SECONDS,
      async () => {
        const r = await this.deps.http.getJson(
          "previous-runs",
          "/v1/forecast",
          {
            latitude: lat,
            longitude: lon,
            hourly: "shortwave_radiation,shortwave_radiation_previous_day1,temperature_2m",
            past_days: pastDays,
            forecast_days: 1,
            timezone: "UTC",
          },
          { schema: Response, requestId: ctx.requestId },
        );
        return {
          latitude: r.latitude,
          longitude: r.longitude,
          times: r.hourly.time,
          actual: r.hourly.shortwave_radiation,
          forecast: r.hourly.shortwave_radiation_previous_day1,
          temperature: r.hourly.temperature_2m,
        };
      },
      now,
    );
    const run = latestRun(got.value, now());
    return {
      grid: { latitude: got.value.latitude, longitude: got.value.longitude },
      fetchedAt: got.storedAt.toISOString(),
      stale: got.stale,
      series: run.series,
      reason: run.reason,
    };
  }
}
