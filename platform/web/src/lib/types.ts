import type { components, paths } from "./api-types";

/** Convenience types derived from the generated OpenAPI types (never hand-written, so they cannot drift). */
type Resp<P extends keyof paths, M extends keyof paths[P], S extends string | number> = paths[P][M] extends { responses: infer R }
  ? S extends keyof R
    ? R[S] extends { content: { "application/json": infer B } }
      ? B
      : never
    : never
  : never;

export type Provenance = components["schemas"]["Provenance"];
export type Property = components["schemas"]["Property"];
export type Twin = components["schemas"]["EnergyTwin"];
export type SatelliteScene = components["schemas"]["SatelliteScene"];
export type ApiUser = components["schemas"]["User"];

export type DataStatus = Provenance["status"];

/** A value with where it came from and how far to trust it. */
export interface Measured<T> {
  value: T | null;
  unit?: string;
  provenance: Provenance;
}

export type Preview = Resp<"/api/preview", "get", 200>;
export type WeatherReport = Resp<"/api/weather", "get", 200>;
export type GeocodeSearch = Resp<"/api/geocode/search", "get", 200>;
export type GeocodeResult = NonNullable<GeocodeSearch["value"]>[number];
export type SystemHealth = Resp<"/api/system/health", "get", 200>;
export type CloudNowcast = Resp<"/api/cloud-nowcast", "get", 200>;
