import type { Db } from "../db.js";
import { type EngineClient } from "../engine/client.js";
import { requireEngine } from "../engine/index.js";
import type { HourlyWeather, LoadForecastResponse, SolarForecastResponse } from "../engine/schemas.js";
import { AppError } from "../errors.js";
import type { Prisma, SolarSystem } from "../generated/prisma/client.js";
import { DEFAULTS, param } from "../assets/defaults.js";
import { ownProperty } from "../assets/service.js";
import { getProperty } from "../properties/service.js";
import type { Providers } from "../providers/index.js";
import type { WeatherReport } from "../providers/weather.js";
import { type Measured, estimated, forecast, unavailable } from "../provenance/index.js";
import { MAX_HISTORY_DAYS, buildLoadSeries } from "./load-series.js";

export interface ForecastDeps {
  db: Db;
  providers: Providers;
  engine: EngineClient | null;
  now: () => Date;
  policy: { navicEnabled: boolean };
}

interface Ctx {
  requestId?: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;
const hourFloor = (d: Date): Date => new Date(Math.floor(d.getTime() / HOUR) * HOUR);
const sum = (xs: number[][]): number[] => xs[0]!.map((_, i) => round(xs.reduce((a, x) => a + x[i]!, 0), 4));
/** How far back the record of day-ahead forecast errors reaches: long enough to see every sky condition, short enough to stay seasonal. */
const HISTORY_DAYS = 45;
const MODEL_SOLAR = "solar:pvlib-simplified-solis+empirical-bands";

/** The engine's own version, asked once and remembered for a few minutes: it goes on every forecast's provenance. */
const versions = new WeakMap<EngineClient, { at: number; version: string }>();
async function engineVersion(engine: EngineClient, ctx: Ctx, now: Date): Promise<string> {
  const hit = versions.get(engine);
  if (hit && now.getTime() - hit.at < 5 * 60_000) return hit.version;
  const version = (await engine.health(ctx)).version;
  versions.set(engine, { at: now.getTime(), version });
  return version;
}

/** The longest unbroken run of whole hours that have both irradiance and temperature. Gaps are not bridged. Pure. */
export function hourlyWeatherFrom(report: WeatherReport): { weather: HourlyWeather | null; reason: string | null; dropped: number } {
  const ghi = report.hourly.global_horizontal_irradiance?.value ?? [];
  const temp = new Map((report.hourly.air_temperature?.value ?? []).map((p) => [new Date(p.time).getTime(), p.value]));
  const pairs = ghi.map((p) => ({ t: new Date(p.time).getTime(), g: p.value, c: temp.get(new Date(p.time).getTime()) })).filter((p): p is { t: number; g: number; c: number } => typeof p.c === "number");
  if (pairs.length === 0) return { weather: null, reason: "The weather service returned no hours with both irradiance and temperature.", dropped: ghi.length };
  let best: typeof pairs = [];
  let run: typeof pairs = [];
  for (const p of pairs) {
    if (run.length && p.t - run[run.length - 1]!.t !== HOUR) run = [];
    run.push(p);
    if (run.length > best.length) best = [...run];
  }
  return {
    weather: { startTime: new Date(best[0]!.t).toISOString().replace(".000Z", "Z"), convention: "end", ghiWm2: best.map((p) => p.g), temperatureC: best.map((p) => p.c) },
    reason: null,
    dropped: pairs.length - best.length,
  };
}

const pvInput = (s: SolarSystem) => ({
  capacityKwp: s.capacityKwp,
  tiltDeg: s.tiltDeg,
  azimuthDeg: s.azimuthDeg,
  lossFraction: param(s.lossFraction, DEFAULTS.solar.lossFraction).value as number,
  inverterKw: s.inverterKw,
});

async function chosenSystems(db: Db, propertyId: string): Promise<{ systems: SolarSystem[]; note: string | null }> {
  const all = await db.solarSystem.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } });
  const existing = all.filter((s) => s.status === "EXISTING");
  if (existing.length) return { systems: existing, note: all.length > existing.length ? "Planned systems are left out: this is the output of what is installed." : null };
  return { systems: all, note: all.length ? "No installed system is entered, so this is the output of the planned one(s)." : null };
}

// ----------------------------------------------------------------------------------- solar

export async function solarForecast(deps: ForecastDeps, userId: string, propertyId: string, opts: { days: number } & Ctx) {
  const { db, providers, now } = deps;
  const engine = requireEngine(deps.engine);
  const at = now();
  const property = await getProperty(db, userId, propertyId, deps.policy);
  const where = { latitude: property.latitude, longitude: property.longitude };
  const { systems, note: systemNote } = await chosenSystems(db, propertyId);
  const base = { provider: "avishkar-engine", source: "AVISHKAR solar model (pvlib) driven by the Open-Meteo irradiance forecast", dataType: "solar_output_forecast", location: where, now: at, unit: "kW" };
  const empty = (reason: string, weather: WeatherReport | null = null) => ({
    propertyId,
    generatedAt: at.toISOString(),
    systems: [],
    hours: unavailable<never>(reason, base),
    energy: unavailable<never>(reason, { ...base, unit: "kWh" }),
    band: { available: false, reason, calibration: null },
    weather: weather ? weatherRef(weather) : null,
    assumptions: [],
    notes: [reason],
  });
  if (systems.length === 0) return empty("No solar system is entered for this property. Add one (installed or planned) on the Assets tab to forecast its output.");

  const report = await providers.weather.forecast(property.latitude, property.longitude, { days: opts.days }, { requestId: opts.requestId, now });
  const w = hourlyWeatherFrom(report);
  if (!w.weather) return empty(w.reason ?? "No weather forecast is available.", report);

  // How wrong this forecast usually is at this place, from its own past day-ahead forecasts. Without it no band is claimed.
  const notes: string[] = [];
  if (systemNote) notes.push(systemNote);
  if (w.dropped > 0) notes.push(`${w.dropped} hour(s) of the weather forecast were left out because the run of consecutive hours was broken; nothing was filled in.`);
  if (report.stale) notes.push(...report.notes);
  let errorHistory: { weather: HourlyWeather; forecastGhiWm2: number[] } | null = null;
  let historyReason: string | null = null;
  try {
    const h = await providers.forecastHistory.history(property.latitude, property.longitude, { pastDays: HISTORY_DAYS }, { requestId: opts.requestId, now });
    if (h.series) {
      errorHistory = { weather: { startTime: h.series.startTime, convention: "end", ghiWm2: h.series.actualGhiWm2, temperatureC: h.series.temperatureC }, forecastGhiWm2: h.series.forecastGhiWm2 };
      if (h.stale) notes.push("The record of past forecast errors could not be refreshed, so an older copy was used.");
    } else historyReason = h.reason;
  } catch (e) {
    historyReason = e instanceof AppError ? e.message : "The record of past forecast errors could not be fetched.";
  }

  const location = { ...where, altitudeM: report.elevationM ?? 0 };
  if (report.elevationM === null) notes.push("The elevation of the site is unknown, so sea level was assumed; the effect on output is small.");
  const results = await Promise.all(
    systems.map((s) => engine.solarForecast({ location, system: pvInput(s), weather: w.weather!, errorHistory }, { requestId: opts.requestId })),
  );
  const first = results[0]!;
  const bandOk = results.every((r) => r.p10Kw && r.p90Kw);
  const times = first.times;
  const p50 = sum(results.map((r) => r.p50Kw));
  const p10 = bandOk ? sum(results.map((r) => r.p10Kw!)) : null;
  const p90 = bandOk ? sum(results.map((r) => r.p90Kw!)) : null;
  const clear = sum(results.map((r) => r.clearSkyKw));
  const totalKwp = systems.reduce((a, s) => a + s.capacityKwp, 0);
  const total = (f: (r: SolarForecastResponse) => number | null): number | null => {
    const v = results.map(f);
    return v.every((x): x is number => x !== null) ? round(v.reduce((a, b) => a + b, 0), 3) : null;
  };
  const version = await engineVersion(engine, { requestId: opts.requestId }, at);
  const prov = { ...base, modelVersion: `engine-${version}`, notes: [...new Set(results.flatMap((r) => r.notes))] };
  const assumptions = [...new Set(results.flatMap((r) => r.assumptions))];
  if (systems.length > 1) assumptions.push("The systems share one sky, so their bands add (the same cloud lowers every roof at once).");

  const hours = times.map((t, i) => ({ time: t, clearSkyKw: clear[i]!, p50Kw: p50[i]!, p10Kw: p10 ? p10[i]! : null, p90Kw: p90 ? p90[i]! : null }));
  const firstHour = new Date(times[0]!);
  const dto = {
    propertyId,
    generatedAt: at.toISOString(),
    systems: systems.map((s) => {
      const loss = param(s.lossFraction, DEFAULTS.solar.lossFraction);
      return { id: s.id, name: s.name, status: s.status, capacityKwp: s.capacityKwp, tiltDeg: s.tiltDeg, azimuthDeg: s.azimuthDeg, lossFraction: loss.value as number, lossBasis: loss.basis as "USER_ENTERED" | "ASSUMPTION" };
    }),
    hours: forecast(hours, { ...prov, validFor: firstHour }),
    energy: forecast(
      {
        kwhP50: total((r) => r.kwhP50)!,
        kwhP10: bandOk ? total((r) => r.kwhP10) : null,
        kwhP90: bandOk ? total((r) => r.kwhP90) : null,
        kwhClearSky: total((r) => r.kwhClearSky)!,
        yieldKwhPerKwpP50: round(total((r) => r.kwhP50)! / totalKwp, 3),
      },
      { ...prov, unit: "kWh", validFor: firstHour },
    ),
    band: {
      available: bandOk,
      reason: bandOk ? null : (historyReason ?? "The past forecast errors were too few to calibrate a band, so none is claimed."),
      calibration: first.calibration,
    },
    weather: weatherRef(report),
    assumptions,
    notes: [...notes, ...(historyReason ? [`No uncertainty band: ${historyReason}`] : [])],
  };

  await remember(deps, {
    propertyId,
    kind: "SOLAR",
    at,
    times,
    series: { times, p10Kw: p10, p50Kw: p50, p90Kw: p90 },
    model: MODEL_SOLAR,
    engineVersion: version,
    basis: { systems: dto.systems, weather: { provider: "open-meteo", fetchedAt: report.fetchedAt }, calibration: first.calibration, bandAvailable: bandOk },
  });
  return dto;
}

const weatherRef = (r: WeatherReport) => ({ provider: "open-meteo", fetchedAt: r.fetchedAt, stale: r.stale, grid: r.grid, elevationM: r.elevationM });

/**
 * Score the solar model on the last weeks, the only way a forecast earns trust: each past hour's day-ahead irradiance forecast
 * is turned into output and compared with the output the weather model's analysis of that hour implies, next to the naive
 * baselines (yesterday's output, a cloudless sky) it has to beat. There is no meter on the panels, so this is scored against
 * analysis, not generation: the basis says so.
 */
export async function solarPerformance(deps: ForecastDeps, userId: string, propertyId: string, opts: Ctx) {
  const { providers, now } = deps;
  const engine = requireEngine(deps.engine);
  const at = now();
  const property = await getProperty(deps.db, userId, propertyId, deps.policy);
  const { systems } = await chosenSystems(deps.db, propertyId);
  const basis =
    "The day-ahead irradiance forecast, turned into output by the AVISHKAR solar model, against the output that Open-Meteo's own analysis of the same hours implies. This is a measure of the weather forecast, not of metered panel output: no generation meter is connected.";
  const src = { provider: "avishkar-engine", source: "AVISHKAR solar model scored on Open-Meteo forecast history", dataType: "solar_forecast_skill", location: { latitude: property.latitude, longitude: property.longitude }, now: at };
  const none = (reason: string) => ({ propertyId, generatedAt: at.toISOString(), result: unavailable<never>(reason, src), basis, notes: [reason] });
  if (systems.length === 0) return none("No solar system is entered for this property.");

  const h = await providers.forecastHistory.history(property.latitude, property.longitude, { pastDays: HISTORY_DAYS }, { requestId: opts.requestId, now });
  if (!h.series) return none(h.reason ?? "No history of past forecasts is available for this place.");
  if (h.series.hours < 48) return none(`Only ${h.series.hours} consecutive hours of forecast history exist for this place; at least 48 are needed.`);

  const location = { latitude: property.latitude, longitude: property.longitude, altitudeM: 0 };
  const weather = (ghi: number[]): HourlyWeather => ({ startTime: h.series!.startTime, convention: "end", ghiWm2: ghi, temperatureC: h.series!.temperatureC });
  const per = await Promise.all(
    systems.map(async (s) => {
      const [a, f] = await Promise.all([
        engine.solarForecast({ location, system: pvInput(s), weather: weather(h.series!.actualGhiWm2) }, { requestId: opts.requestId }),
        engine.solarForecast({ location, system: pvInput(s), weather: weather(h.series!.forecastGhiWm2) }, { requestId: opts.requestId }),
      ]);
      return { a, f };
    }),
  );
  const totalKwp = systems.reduce((a, s) => a + s.capacityKwp, 0);
  const ev = await engine.solarEvaluate(
    {
      forecastKw: sum(per.map((p) => p.f.p50Kw)),
      actualKw: sum(per.map((p) => p.a.p50Kw)),
      clearSkyKw: sum(per.map((p) => p.a.clearSkyKw)),
      minActualKw: round(0.02 * totalKwp, 3),
    },
    { requestId: opts.requestId },
  );
  const lastHour = new Date(new Date(h.series.startTime).getTime() + (h.series.hours - 1) * HOUR);
  const version = await engineVersion(engine, { requestId: opts.requestId }, at);
  return {
    propertyId,
    generatedAt: at.toISOString(),
    result: estimated(
      {
        window: { from: h.series.startTime, to: lastHour.toISOString(), hours: h.series.hours },
        forecast: ev.forecast,
        persistenceBaseline: ev.persistenceBaseline,
        clearSky: ev.clearSky,
        skillVsPersistence: ev.skillVsPersistence,
        skillVsClearSky: ev.skillVsClearSky,
      },
      { ...src, modelVersion: `engine-${version}`, basis },
    ),
    basis,
    notes: [...ev.notes, ...(h.series.droppedHours > 0 ? [`${h.series.droppedHours} earlier hour(s) in the window were left out because of a gap; only the latest unbroken run was scored.`] : [])],
  };
}

// -------------------------------------------------------------------------------------- load

const toLoadHours = (r: LoadForecastResponse) => r.times.map((t, i) => ({ time: t, p10Kw: r.p10Kw[i]!, p50Kw: r.p50Kw[i]!, p90Kw: r.p90Kw[i]!, peakProbability: r.peakProbability[i]! }));

export async function loadForecast(deps: ForecastDeps, userId: string, propertyId: string, opts: { hours: number } & Ctx) {
  const { db, now } = deps;
  const engine = requireEngine(deps.engine);
  const at = now();
  await ownProperty(db, userId, propertyId);
  const base = { provider: "avishkar-engine", source: "AVISHKAR load model on this property's own meter readings", dataType: "load_forecast", now: at, unit: "kW" };
  const off = (reason: string) => ({
    propertyId,
    generatedAt: at.toISOString(),
    hours: unavailable<never>(reason, base),
    energy: unavailable<never>(reason, { ...base, unit: "kWh" }),
    peakThresholdKw: null,
    model: null,
    history: null,
    assumptions: [],
    notes: [reason],
  });

  const last = (await db.energyObservation.aggregate({ where: { propertyId }, _max: { ts: true } }))._max.ts;
  if (!last) return off("There are no meter readings yet. Import a meter file on the Meter data tab; a load forecast needs at least two weeks of readings.");
  const rows = await db.energyObservation.findMany({
    where: { propertyId, ts: { gte: new Date(last.getTime() - MAX_HISTORY_DAYS * DAY) } },
    select: { ts: true, importKwh: true, intervalMinutes: true },
    orderBy: { ts: "asc" },
  });
  const built = buildLoadSeries(rows.map((r) => ({ ts: r.ts, kwh: r.importKwh, intervalMinutes: r.intervalMinutes })));
  if (!built.ok) return off(built.reason);

  const r = await engine.loadForecast({ history: built.series, horizonHours: opts.hours, timezoneOffsetMinutes: 330 }, { requestId: opts.requestId });
  if (r.status === "unavailable") return off(r.unavailableReason ?? "The load model could not make a forecast from this history.");

  const { report } = built;
  const dataEndsDaysAgo = round(Math.max(0, (at.getTime() - report.endsAt.getTime()) / DAY), 1);
  const notes = [...r.notes];
  if (report.otherInterval > 0) notes.push(`${report.otherInterval} reading(s) at another interval than the ${report.aggregatedFrom ?? built.series.intervalMinutes}-minute one were not used.`);
  if (report.offGrid > 0) notes.push(`${report.offGrid} reading(s) did not fall on the regular interval grid and were not used.`);
  if (report.aggregatedFrom) notes.push(`Readings every ${report.aggregatedFrom} minutes were added up into hours; an hour with any reading missing was left empty.`);
  const version = await engineVersion(engine, { requestId: opts.requestId }, at);
  const prov = { ...base, modelVersion: `engine-${version}:${r.selectedMethod ?? "?"}` };
  const hours = toLoadHours(r);
  const firstHour = new Date(r.times[0]!);
  // A forecast of the hours right after the data ends is a forecast of "tomorrow" only when the data is current.
  const stale = dataEndsDaysAgo > 2;
  const hoursM: Measured<typeof hours> = stale
    ? estimated(hours, { ...prov, basis: `your meter data ends ${dataEndsDaysAgo} days ago, so this is what the model expects for the hours that followed it, not for the coming days. Import recent readings for a forecast of tomorrow.` })
    : forecast(hours, { ...prov, validFor: firstHour });
  const energyM: Measured<{ kwhP50: number }> = stale
    ? estimated({ kwhP50: r.kwhP50! }, { ...prov, unit: "kWh", basis: "the same pattern-based expectation for the period after your data ends." })
    : forecast({ kwhP50: r.kwhP50! }, { ...prov, unit: "kWh", validFor: firstHour });
  if (stale) notes.push(`Your meter data ends ${dataEndsDaysAgo} days ago. The forecast below covers the hours that followed it.`);

  const dto = {
    propertyId,
    generatedAt: at.toISOString(),
    hours: hoursM,
    energy: energyM,
    peakThresholdKw: r.peakThresholdKw,
    model: { selectedMethod: r.selectedMethod, methods: r.methods, holdoutDays: r.holdoutDays, historyDays: r.historyDays, gapsShare: r.gapsShare },
    history: {
      from: built.series.startTime,
      to: report.endsAt.toISOString(),
      intervalMinutes: built.series.intervalMinutes,
      readingsUsed: report.used,
      readingsOtherInterval: report.otherInterval,
      readingsOffGrid: report.offGrid,
      emptyIntervals: report.gaps,
      dataEndsDaysAgo,
    },
    assumptions: r.assumptions,
    notes,
  };
  if (!stale) {
    await remember(deps, {
      propertyId,
      kind: "LOAD",
      at,
      times: r.times,
      series: { times: r.times, p10Kw: r.p10Kw, p50Kw: r.p50Kw, p90Kw: r.p90Kw },
      model: `load:${r.selectedMethod ?? "?"}`,
      engineVersion: version,
      basis: { history: dto.history, methods: r.methods, selectedMethod: r.selectedMethod, holdoutDays: r.holdoutDays },
    });
  }
  return dto;
}

// ----------------------------------------------------------------------------------- storage

/** Keep the forecast as issued so a later job can score it. At most one per property, kind and hour; never breaks serving. */
async function remember(
  deps: ForecastDeps,
  f: { propertyId: string; kind: "SOLAR" | "LOAD"; at: Date; times: string[]; series: Record<string, unknown>; model: string; engineVersion: string; basis: Record<string, unknown> },
): Promise<void> {
  try {
    await deps.db.forecastRun.createMany({
      data: [
        {
          propertyId: f.propertyId,
          kind: f.kind,
          issuedAt: f.at,
          issuedHour: hourFloor(f.at),
          firstHour: new Date(f.times[0]!),
          hours: f.times.length,
          model: f.model,
          engineVersion: f.engineVersion,
          series: f.series as Prisma.InputJsonValue,
          basis: f.basis as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
  } catch {
    /* remembering a forecast must never stop it being shown */
  }
}
