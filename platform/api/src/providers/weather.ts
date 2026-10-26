import { z } from "zod";
import { AppError } from "../errors.js";
import { type GeoPoint, type Measured, forecast, humanAge, observed, unavailable } from "../provenance/index.js";
import { type WeatherKind, assessSeries, checkCoordinates, checkValue } from "../quality.js";
import { type Cache, cachedFetch } from "./cache.js";
import type { ProviderHttp } from "./http.js";

export type WeatherVariable =
  | "air_temperature"
  | "relative_humidity"
  | "cloud_cover"
  | "wind_speed"
  | "precipitation"
  | "global_horizontal_irradiance"
  | "direct_normal_irradiance"
  | "diffuse_horizontal_irradiance";

export interface VariableSpec {
  name: WeatherVariable;
  /** The provider's own field name. */
  api: string;
  /** Which physical limits apply (quality.ts). */
  kind: WeatherKind;
  unit: string;
  /** Available in the provider's `current` block. */
  current: boolean;
}

export const VARIABLES: readonly VariableSpec[] = [
  { name: "air_temperature", api: "temperature_2m", kind: "air_temperature_c", unit: "°C", current: true },
  { name: "relative_humidity", api: "relative_humidity_2m", kind: "relative_humidity_pct", unit: "%", current: true },
  { name: "cloud_cover", api: "cloud_cover", kind: "cloud_cover_pct", unit: "%", current: true },
  { name: "wind_speed", api: "wind_speed_10m", kind: "wind_speed_ms", unit: "m/s", current: true },
  { name: "precipitation", api: "precipitation", kind: "precipitation_mm", unit: "mm", current: true },
  { name: "global_horizontal_irradiance", api: "shortwave_radiation", kind: "shortwave_radiation_wm2", unit: "W/m²", current: true },
  { name: "direct_normal_irradiance", api: "direct_normal_irradiance", kind: "shortwave_radiation_wm2", unit: "W/m²", current: false },
  { name: "diffuse_horizontal_irradiance", api: "diffuse_radiation", kind: "shortwave_radiation_wm2", unit: "W/m²", current: false },
];

/** What the provider returned, parsed and checked for shape but not yet for physics. This is what is cached and stored. */
export interface RawWeather {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  current: { time: string; intervalSeconds: number; values: Record<string, number | null> };
  hourly: { times: string[]; values: Record<string, (number | null)[]> };
}

export interface HourlyPoint {
  time: string;
  value: number;
}

export interface WeatherReport {
  /** The place the user asked about, coarsened to about 1 km before it was sent to the provider (privacy). */
  requested: GeoPoint;
  /** The grid point the provider actually used. */
  grid: GeoPoint;
  elevationM: number | null;
  /** When this platform fetched the data from the provider. */
  fetchedAt: string;
  /** True when the provider did not answer and an older copy is shown. */
  stale: boolean;
  current: Partial<Record<WeatherVariable, Measured<number>>>;
  hourly: Partial<Record<WeatherVariable, Measured<HourlyPoint[]>>>;
  /** What the quality engine refused, per variable. Rejected points are never shown. */
  quality: { variable: WeatherVariable; rejected: number; reasons: string[] }[];
  notes: string[];
}

export interface WeatherContext {
  requestId?: string;
  now?: () => Date;
}

export interface WeatherProvider {
  readonly name: string;
  forecast(latitude: number, longitude: number, opts: { days?: number }, ctx?: WeatherContext): Promise<WeatherReport>;
}

const Num = z.number().nullable();
const OpenMeteoResponse = z.object({
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().nullable().optional(),
  current: z.object({ time: z.string(), interval: z.number() }).catchall(Num),
  hourly: z.object({ time: z.array(z.string()) }).catchall(z.array(Num)),
});

const TTL_SECONDS = 600; // Open-Meteo refreshes models roughly hourly and `current` every 15 minutes
export const CURRENT_NOTE = "Model analysis value from Open-Meteo, not a reading from a weather station.";

const utc = (t: string): Date => new Date(t.endsWith("Z") ? t : `${t}Z`);
/** About 1.1 km. Coordinates are coarsened before they leave the machine and used as the cache key. */
export const coarsen = (x: number): number => Math.round(x * 100) / 100;
/** 0.05 degree cell index used to key stored observations. */
export const cellOf = (x: number): number => Math.round(x * 20);

/** Turn raw provider data into a report with provenance, applying physical checks. Pure: `now` and `fetchedAt` are inputs. */
export function buildReport(
  raw: RawWeather,
  o: { provider: string; requested: GeoPoint; now: Date; fetchedAt: Date; stale: boolean; source: string },
): WeatherReport {
  const grid = { latitude: raw.latitude, longitude: raw.longitude };
  const report: WeatherReport = {
    requested: o.requested,
    grid,
    elevationM: raw.elevationM,
    fetchedAt: o.fetchedAt.toISOString(),
    stale: o.stale,
    current: {},
    hourly: {},
    quality: [],
    notes: [],
  };
  if (o.stale) {
    report.notes.push(`WEATHER SERVICE TEMPORARILY UNAVAILABLE: showing data fetched ${humanAge((o.now.getTime() - o.fetchedAt.getTime()) / 1000)} ago.`);
  }

  for (const v of VARIABLES) {
    const common = { provider: o.provider, source: o.source, location: grid, now: o.now, unit: v.unit };
    if (v.current) {
      const value = raw.current.values[v.api];
      if (value !== undefined && value !== null) {
        const check = checkValue(v.kind, value);
        report.current[v.name] = check.ok
          ? observed(value, { ...common, dataType: `${v.name}_current`, observedAt: utc(raw.current.time), cadenceSeconds: raw.current.intervalSeconds, notes: [CURRENT_NOTE] })
          : unavailable<number>(`${v.name} rejected by the quality check: ${check.reason}`, { ...common, dataType: `${v.name}_current` });
        if (!check.ok) report.quality.push({ variable: v.name, rejected: 1, reasons: [check.reason] });
      }
    }
    const series = raw.hourly.values[v.api];
    if (series) {
      const a = assessSeries(
        v.kind,
        raw.hourly.times.map((t, i) => ({ time: utc(t), value: series[i] ?? null })),
        { now: o.now, maxAgeMinutes: Number.POSITIVE_INFINITY, expectedStepMinutes: 60 },
      );
      const points: HourlyPoint[] = a.accepted.map((p) => ({ time: p.time.toISOString(), value: p.value as number }));
      if (points.length) {
        const m = forecast(points, {
          provider: o.provider,
          source: o.source,
          dataType: `${v.name}_hourly_forecast`,
          location: grid,
          unit: v.unit,
          now: o.fetchedAt,
          validFor: new Date(points[0]!.time),
        });
        if (a.rejected.length) m.provenance.notes.push(`${a.rejected.length} point(s) failed quality checks and were removed.`);
        if (a.gaps) m.provenance.notes.push(`${a.gaps} gap(s) in the series; missing hours are not filled in.`);
        report.hourly[v.name] = m;
      }
      if (a.rejected.length) {
        report.quality.push({ variable: v.name, rejected: a.rejected.length, reasons: [...new Set(a.rejected.map((r) => r.reason))].slice(0, 5) });
      }
    }
  }
  return report;
}

export type OnFreshWeather = (raw: RawWeather, fetchedAt: Date) => Promise<void>;

export class OpenMeteoWeather implements WeatherProvider {
  readonly name = "open-meteo";
  constructor(private readonly deps: { http: ProviderHttp; cache: Cache; onFresh?: OnFreshWeather }) {}

  async forecast(latitude: number, longitude: number, opts: { days?: number } = {}, ctx: WeatherContext = {}): Promise<WeatherReport> {
    const c = checkCoordinates(latitude, longitude);
    if (!c.ok) throw new AppError("INVALID_COORDINATES", c.reason);
    const days = Math.min(Math.max(Math.trunc(opts.days ?? 3), 1), 7);
    const lat = coarsen(latitude);
    const lon = coarsen(longitude);
    const now = ctx.now ?? (() => new Date());
    const got = await cachedFetch<RawWeather>(
      this.deps.cache,
      `weather:open-meteo:${lat}:${lon}:${days}`,
      this.name,
      TTL_SECONDS,
      async () => {
        const r = await this.deps.http.getJson(
          "forecast",
          "/v1/forecast",
          {
            latitude: lat,
            longitude: lon,
            current: VARIABLES.filter((v) => v.current).map((v) => v.api).join(","),
            hourly: VARIABLES.map((v) => v.api).join(","),
            forecast_days: days,
            timezone: "UTC",
            wind_speed_unit: "ms",
          },
          { schema: OpenMeteoResponse, requestId: ctx.requestId },
        );
        const { time, interval, ...cur } = r.current;
        const { time: times, ...hourly } = r.hourly;
        return {
          latitude: r.latitude,
          longitude: r.longitude,
          elevationM: r.elevation ?? null,
          current: { time, intervalSeconds: interval, values: cur },
          hourly: { times, values: hourly },
        };
      },
      now,
    );
    if (!got.fromCache && this.deps.onFresh) {
      try {
        await this.deps.onFresh(got.value, got.storedAt);
      } catch {
        /* storing history must never break serving the forecast */
      }
    }
    return buildReport(got.value, {
      provider: this.name,
      requested: { latitude: lat, longitude: lon },
      now: now(),
      fetchedAt: got.storedAt,
      stale: got.stale,
      source: "Open-Meteo forecast API (model data)",
    });
  }
}
