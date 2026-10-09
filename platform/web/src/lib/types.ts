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
export type ForecastAccuracy = components["schemas"]["ForecastAccuracy"];
export type Scenario = components["schemas"]["Scenario"];
export type ScenarioSummary = components["schemas"]["ScenarioSummary"];
export type ScenarioRequest = components["schemas"]["ScenarioRequestInput"];
export type Opportunities = components["schemas"]["Opportunities"];
export type Opportunity = components["schemas"]["Opportunity"];
export type CopilotAnswer = components["schemas"]["CopilotAnswer"];
export type Community = components["schemas"]["CommunitySimulation"];
export type VppSimulation = components["schemas"]["VppSimulation"];
export type CloudFront = components["schemas"]["CloudFrontScenario"];
export type ResilienceReport = components["schemas"]["ResilienceReport"];
export type Control = components["schemas"]["Control"];
export type ControlProposal = components["schemas"]["ControlProposal"];
export type AdminOverview = components["schemas"]["AdminOverview"];
export type AdminJobs = components["schemas"]["AdminJobs"];
export type AdminAudit = components["schemas"]["AdminAudit"];
export type Today = components["schemas"]["Today"];
export type EnergyHealth = components["schemas"]["EnergyHealth"];
export type EnergyWaste = components["schemas"]["EnergyWaste"];
export type DemoWorld = components["schemas"]["DemoWorld"];
export type CopilotTools = Resp<"/api/copilot/tools", "get", 200>;
