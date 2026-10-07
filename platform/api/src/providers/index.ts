import type { Config } from "../config.js";
import type { Db } from "../db.js";
import type { Cache } from "./cache.js";
import { type BuildingFootprintProvider, OverpassFootprints } from "./footprint.js";
import { type ForecastHistoryProvider, OpenMeteoPreviousRuns } from "./forecast-history.js";
import { type GeocodingProvider, NominatimGeocoder } from "./geocoding.js";
import { ProviderHttp } from "./http.js";
import type { CallRecorder } from "./recorder.js";
import { EarthSearchSatellite, type SatelliteProvider } from "./satellite.js";
import { NasaPowerSolarResource, type SolarResourceProvider } from "./solar-resource.js";
import { OpenMeteoWeather, type WeatherProvider } from "./weather.js";
import { persistWeather } from "./weather-store.js";

/** Everything the domain layer may call outside the process. */
export interface Providers {
  geocoding: GeocodingProvider;
  weather: WeatherProvider;
  forecastHistory: ForecastHistoryProvider;
  solarResource: SolarResourceProvider;
  footprints: BuildingFootprintProvider;
  satellite: SatelliteProvider;
}

export interface ProviderDeps {
  cache: Cache;
  recorder: CallRecorder;
  /** When given, issued weather values are stored for later forecast evaluation. */
  db?: Db;
  fetchImpl?: typeof fetch;
}

/** Names reported by the health endpoint; keep in step with the providers actually built. */
export const PROVIDER_NAMES = ["nominatim", "open-meteo", "open-meteo-previous-runs", "nasa-power", "overpass", "earth-search"] as const;

export function buildProviders(config: Config, deps: ProviderDeps): Providers {
  const http = (provider: string, baseUrl: string, extra: { minIntervalMs?: number; timeoutMs?: number; retries?: number } = {}) =>
    new ProviderHttp({
      provider,
      baseUrl,
      userAgent: config.PROVIDER_USER_AGENT,
      timeoutMs: extra.timeoutMs ?? config.PROVIDER_TIMEOUT_MS,
      recorder: deps.recorder,
      fetchImpl: deps.fetchImpl,
      minIntervalMs: extra.minIntervalMs,
      retries: extra.retries,
    });
  const db = deps.db;
  return {
    // Nominatim's usage policy: at most one request per second, identifying User-Agent, cache results.
    geocoding: new NominatimGeocoder({ http: http("nominatim", config.GEOCODING_BASE_URL, { minIntervalMs: 1100 }), cache: deps.cache }),
    weather: new OpenMeteoWeather({
      http: http("open-meteo", config.WEATHER_BASE_URL),
      cache: deps.cache,
      onFresh: db ? async (raw, fetchedAt) => void (await persistWeather(db, "open-meteo", raw, fetchedAt)) : undefined,
    }),
    forecastHistory: new OpenMeteoPreviousRuns({ http: http("open-meteo-previous-runs", config.FORECAST_HISTORY_BASE_URL, { timeoutMs: 20_000 }), cache: deps.cache }),
    solarResource: new NasaPowerSolarResource({ http: http("nasa-power", config.SOLAR_RESOURCE_BASE_URL, { timeoutMs: 30_000 }), cache: deps.cache }),
    // Overpass is slow and intermittently answers 504: a long timeout, one retry per server, then the next mirror.
    footprints: new OverpassFootprints({
      http: http("overpass", config.BUILDING_FOOTPRINT_BASE_URL, { timeoutMs: 30_000, retries: 1 }),
      cache: deps.cache,
      baseUrls: [config.BUILDING_FOOTPRINT_BASE_URL, ...config.BUILDING_FOOTPRINT_FALLBACK_URLS],
    }),
    satellite: new EarthSearchSatellite({ http: http("earth-search", config.SATELLITE_BASE_URL, { timeoutMs: 20_000 }), cache: deps.cache }),
  };
}
