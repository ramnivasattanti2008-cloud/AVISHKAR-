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

export type TariffPlan = components["schemas"]["TariffPlan"];
export type PolicyRule = components["schemas"]["PolicyRule"];
export type ProgramResult = components["schemas"]["ProgramResult"];

export type Battery = components["schemas"]["Battery"];
export type SolarSystem = components["schemas"]["SolarSystem"];
export type Ev = components["schemas"]["Ev"];
export type Appliance = components["schemas"]["Appliance"];
export type EnergyImport = components["schemas"]["EnergyImport"];
export type EnergyDna = components["schemas"]["EnergyDna"];

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
export type TariffList = Resp<"/api/tariffs", "get", 200>;
export type Bill = Resp<"/api/tariffs/{id}/bill", "post", 200>;
export type Eligibility = Resp<"/api/eligibility", "post", 200>;
export type EnergySummary = Resp<"/api/properties/{id}/energy", "get", 200>;
export type ImportResult = Resp<"/api/properties/{id}/energy/imports", "post", 201>;
export type AssetProfiles = Resp<"/api/properties/{id}/assets", "get", 200>;
export type SolarForecast = Resp<"/api/properties/{id}/solar-forecast", "get", 200>;
export type SolarPerformance = Resp<"/api/properties/{id}/solar-forecast/performance", "get", 200>;
export type LoadForecast = Resp<"/api/properties/{id}/load-forecast", "get", 200>;
export type Plan = components["schemas"]["Plan"];
export type PlanSummary = components["schemas"]["PlanSummary"];
export type PlanRequest = components["schemas"]["PlanRequestInput"];
