import { z } from "zod";
import { GeoPoint, measured } from "./schemas.js";

export const SatelliteSceneSchema = z.object({
  id: z.string(),
  satellite: z.string(),
  sensor: z.string(),
  acquiredAt: z.string(),
  processedAt: z.string().nullable(),
  cloudPercent: z.number().nullable(),
  footprint: z.object({ type: z.string(), coordinates: z.unknown() }),
  source: z.string(),
  processingStatus: z.string(),
  thumbnailUrl: z.string().nullable(),
});

const SourceRecordSchema = z.object({ provider: z.string(), dataType: z.string(), status: z.string(), ok: z.boolean(), at: z.string(), note: z.string() });
const GapSchema = z.object({ what: z.string(), reason: z.string() });
const AssumptionSchema = z.object({ key: z.string(), value: z.number(), unit: z.string(), rationale: z.string() });
const QualitySchema = z.enum(["MINIMAL", "PARTIAL", "FULL"]);

/** The Energy Twin: a versioned snapshot. Every number is a Measured value; unknowns are UNAVAILABLE with a reason. */
export const TwinSchema = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  version: z.number().int(),
  createdAt: z.string(),
  reason: z.string(),
  dataQuality: QualitySchema,
  confidence: z.number().describe("Weighted share of the needed inputs that are available: data completeness, not a probability."),
  confidenceMeaning: z.string(),
  confidenceBasis: z.array(z.object({ item: z.string(), weight: z.number(), available: z.boolean() })),
  location: z.object({ latitude: z.number(), longitude: z.number(), elevationM: z.number().nullable() }),
  geometry: z.object({ kind: z.enum(["BUILDING_FOOTPRINT", "USER_POLYGON"]).nullable(), roofAreaM2: measured(z.number()) }),
  solar: z.object({
    annualGhiKwhM2Day: measured(z.number()),
    clearSkyKwhM2Day: measured(z.number()),
    clearnessIndex: measured(z.number()),
    usableRoofAreaM2: measured(z.number()),
    capacityKwEstimate: measured(z.number()),
    yieldKwhPerKwpDay: measured(z.number()),
    estimatedDailyGenerationKwh: measured(z.number()),
    forecastNext24hGhiKwhM2: measured(z.number()),
    forecastNext24hKwhPerKwp: measured(z.number()),
  }),
  satellite: measured(SatelliteSceneSchema),
  consumption: z.object({ estimatedDailyLoadKwh: measured(z.number()) }),
  tariff: measured(z.null()),
  energyAutonomyScore: measured(z.number()),
  warnings: z.array(z.string()),
  sources: z.array(SourceRecordSchema),
  assumptions: z.array(AssumptionSchema),
  unavailable: z.array(GapSchema),
});

export const TwinVersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  createdAt: z.string(),
  reason: z.string(),
  dataQuality: QualitySchema,
  confidence: z.number(),
});

export const PreviewSchema = z.object({
  requested: GeoPoint,
  warnings: z.array(z.string()),
  solar: z.object({ annualGhiKwhM2Day: measured(z.number()), yieldKwhPerKwpDay: measured(z.number()), forecastNext24hKwhPerKwp: measured(z.number()) }),
  weather: z.object({ airTemperature: measured(z.number()), cloudCover: measured(z.number()), globalHorizontalIrradiance: measured(z.number()) }),
  dataQuality: QualitySchema,
  confidence: z.number(),
  sources: z.array(SourceRecordSchema),
  unavailable: z.array(GapSchema),
});
