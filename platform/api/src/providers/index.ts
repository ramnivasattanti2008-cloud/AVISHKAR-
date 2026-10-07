import type { Config } from "../config.js";
import type { Cache } from "./cache.js";
import { type GeocodingProvider, NominatimGeocoder } from "./geocoding.js";
import { ProviderHttp } from "./http.js";
import type { CallRecorder } from "./recorder.js";

/** Everything the domain layer may call outside the process. Phases add weather, solar resource, footprints, satellite. */
export interface Providers {
  geocoding: GeocodingProvider;
}

export interface ProviderDeps {
  cache: Cache;
  recorder: CallRecorder;
  fetchImpl?: typeof fetch;
}

/** Names reported by the health endpoint; keep in step with the providers actually built. */
export const PROVIDER_NAMES = ["nominatim"] as const;

export function buildProviders(config: Config, deps: ProviderDeps): Providers {
  const http = (provider: string, baseUrl: string, minIntervalMs?: number) =>
    new ProviderHttp({
      provider,
      baseUrl,
      userAgent: config.PROVIDER_USER_AGENT,
      timeoutMs: config.PROVIDER_TIMEOUT_MS,
      recorder: deps.recorder,
      fetchImpl: deps.fetchImpl,
      minIntervalMs,
    });
  return {
    // Nominatim's usage policy: at most one request per second, identifying User-Agent, cache results.
    geocoding: new NominatimGeocoder({ http: http("nominatim", config.GEOCODING_BASE_URL, 1100), cache: deps.cache }),
  };
}
