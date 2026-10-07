import { AppError } from "../errors.js";
import { type GeoPoint, type Measured, estimated, forecast, reference, unavailable } from "../provenance/index.js";
import { checkCoordinates, isNearIndia } from "../quality.js";
import type { Providers } from "../providers/index.js";
import { type CompletenessInput, ASSUMPTIONS, completeness, estimatePv, nextDayIrradiation } from "./estimate.js";
import type { Gap, SourceRecord } from "./service.js";

export interface PreviewDto {
  requested: GeoPoint;
  warnings: string[];
  solar: {
    annualGhiKwhM2Day: Measured<number>;
    yieldKwhPerKwpDay: Measured<number>;
    forecastNext24hKwhPerKwp: Measured<number>;
  };
  weather: {
    airTemperature: Measured<number>;
    cloudCover: Measured<number>;
    globalHorizontalIrradiance: Measured<number>;
  };
  dataQuality: "MINIMAL" | "PARTIAL" | "FULL";
  confidence: number;
  sources: SourceRecord[];
  unavailable: Gap[];
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * What the map shows the moment a point is clicked (spec section 59): real solar resource and weather for that spot and
 * the yield per kWp they imply. Nothing is saved, and no roof is assumed: capacity needs an outline (`analyze`).
 */
export async function previewLocation(deps: { providers: Providers; now: () => Date }, latitude: number, longitude: number, ctx: { requestId?: string } = {}): Promise<PreviewDto> {
  const c = checkCoordinates(latitude, longitude);
  if (!c.ok) throw new AppError("INVALID_COORDINATES", c.reason);
  const now = deps.now();
  const cx = { requestId: ctx.requestId, now: deps.now };
  const [solar, weather] = await Promise.allSettled([deps.providers.solarResource.climatology(latitude, longitude, cx), deps.providers.weather.forecast(latitude, longitude, { days: 2 }, cx)]);
  const where = { latitude, longitude };
  const base = (provider: string, source: string, dataType: string) => ({ provider, source, dataType, location: where, now });
  const sources: SourceRecord[] = [];
  const gaps: Gap[] = [];
  const at = now.toISOString();

  let ghi: number | null = null;
  if (solar.status === "fulfilled" && solar.value.value) {
    ghi = solar.value.value.annual.ghiKwhM2Day;
    sources.push({ provider: "nasa-power", dataType: "solar_resource_climatology", status: "REFERENCE", ok: true, at, note: `Annual average ${ghi?.toFixed(2)} kWh/m2/day.` });
  } else {
    const reason = solar.status === "rejected" ? why(solar.reason) : "no value returned";
    sources.push({ provider: "nasa-power", dataType: "solar_resource_climatology", status: "UNAVAILABLE", ok: false, at, note: reason });
    gaps.push({ what: "Solar resource", reason });
  }
  const w = weather.status === "fulfilled" ? weather.value : null;
  if (w) sources.push({ provider: "open-meteo", dataType: "weather_forecast", status: w.stale ? "UPDATED" : "FORECAST", ok: true, at, note: w.stale ? `Stale copy fetched ${w.fetchedAt}.` : `Fetched ${w.fetchedAt}.` });
  else {
    const reason = why((weather as PromiseRejectedResult).reason);
    sources.push({ provider: "open-meteo", dataType: "weather_forecast", status: "UNAVAILABLE", ok: false, at, note: reason });
    gaps.push({ what: "Weather", reason });
  }
  const nextDay = w ? nextDayIrradiation(w.hourly.global_horizontal_irradiance?.value ?? [], now) : null;
  const pv = estimatePv({ roofAreaM2: null, ghiKwhM2Day: ghi });
  const flags: CompletenessInput = { location: true, solarResource: ghi !== null, weather: w !== null, geometry: false, satellite: false, loadProfile: false, tariff: false };
  const comp = completeness(flags);
  const none = (what: string) => unavailable<number>(`${what} is unavailable right now.`, base("avishkar-preview", "AVISHKAR preview", what));
  const warnings: string[] = [];
  if (!isNearIndia(latitude, longitude)) warnings.push("This location is outside India; Indian tariffs and schemes will not apply.");

  return {
    requested: where,
    warnings,
    solar: {
      annualGhiKwhM2Day: ghi === null ? none("Solar resource") : reference(ghi, { ...base("nasa-power", "NASA POWER climatology", "annual_ghi"), unit: "kWh/m2/day" }),
      yieldKwhPerKwpDay:
        pv.yieldKwhPerKwpDay === null
          ? none("Yield per kWp")
          : estimated(pv.yieldKwhPerKwpDay, { ...base("avishkar-preview", "AVISHKAR estimate", "yield_per_kwp"), unit: "kWh/kWp/day", basis: `annual average irradiation x performance ratio ${ASSUMPTIONS.performanceRatio.value}` }),
      forecastNext24hKwhPerKwp:
        nextDay === null
          ? none("Next-24-hour yield per kWp")
          : forecast(nextDay.kwhPerM2 * ASSUMPTIONS.performanceRatio.value, { ...base("open-meteo", "Open-Meteo hourly forecast", "forecast_yield_24h"), unit: "kWh/kWp", validFor: new Date(now.getTime() + 24 * 3_600_000) }),
    },
    weather: {
      airTemperature: w?.current.air_temperature ?? none("Air temperature"),
      cloudCover: w?.current.cloud_cover ?? none("Cloud cover"),
      globalHorizontalIrradiance: w?.current.global_horizontal_irradiance ?? none("Solar irradiance"),
    },
    dataQuality: comp.quality,
    confidence: comp.confidence,
    sources,
    unavailable: gaps,
  };
}
