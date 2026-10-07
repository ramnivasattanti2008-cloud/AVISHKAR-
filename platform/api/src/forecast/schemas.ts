import { z } from "zod";
import { GeoPoint, measured } from "../schemas.js";

const iso = z.string();

export const SolarHourSchema = z
  .object({
    time: iso.describe("The hour, labelled by its end, in UTC."),
    clearSkyKw: z.number().describe("What a cloudless sky would give, as a reference curve. The forecast can sit slightly above it where the weather model is brighter than the clear-sky model."),
    p50Kw: z.number(),
    p10Kw: z.number().nullable(),
    p90Kw: z.number().nullable(),
  })
  .meta({ id: "SolarHour" });

export const BandCalibrationSchema = z
  .object({
    method: z.string(),
    hoursUsed: z.number(),
    bins: z.array(z.object({ name: z.string(), samples: z.number(), p10: z.number(), p50: z.number(), p90: z.number() })),
    medianResidualKt: z.number(),
    holdoutHours: z.number(),
    holdoutCoverage: z.number().nullable().describe("Share of hours the band had not seen that fell inside it. About 0.8 is what an 80% band should score."),
    targetCoverage: z.number(),
  })
  .meta({ id: "BandCalibration" });

export const SolarSystemRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(["EXISTING", "PLANNED"]),
  capacityKwp: z.number(),
  tiltDeg: z.number(),
  azimuthDeg: z.number(),
  lossFraction: z.number(),
  lossBasis: z.enum(["USER_ENTERED", "ASSUMPTION"]),
});

export const SolarForecastSchema = z
  .object({
    propertyId: z.uuid(),
    generatedAt: iso,
    systems: z.array(SolarSystemRefSchema),
    hours: measured(z.array(SolarHourSchema)),
    energy: measured(
      z.object({
        kwhP50: z.number(),
        kwhP10: z.number().nullable(),
        kwhP90: z.number().nullable(),
        kwhClearSky: z.number(),
        yieldKwhPerKwpP50: z.number(),
      }),
    ),
    band: z.object({ available: z.boolean(), reason: z.string().nullable(), calibration: BandCalibrationSchema.nullable() }),
    weather: z.object({ provider: z.string(), fetchedAt: iso, stale: z.boolean(), grid: GeoPoint, elevationM: z.number().nullable() }).nullable(),
    assumptions: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .meta({ id: "SolarForecast" });

const MetricsSchema = z.object({
  hours: z.number(),
  maeKw: z.number(),
  rmseKw: z.number(),
  mapePct: z.number().nullable(),
  wapePct: z.number().nullable(),
  biasKw: z.number(),
});

export const SolarPerformanceSchema = z
  .object({
    propertyId: z.uuid(),
    generatedAt: iso,
    result: measured(
      z.object({
        window: z.object({ from: iso, to: iso, hours: z.number() }),
        forecast: MetricsSchema,
        persistenceBaseline: MetricsSchema.nullable(),
        clearSky: MetricsSchema.nullable(),
        skillVsPersistence: z.number().nullable().describe("1 minus the forecast's mean error over the naive baseline's. Above 0 means it beats yesterday's output."),
        skillVsClearSky: z.number().nullable(),
      }),
    ),
    basis: z.string(),
    notes: z.array(z.string()),
  })
  .meta({ id: "SolarPerformance" });

export const LoadHourSchema = z
  .object({
    time: iso.describe("Start of the hour, UTC."),
    p10Kw: z.number(),
    p50Kw: z.number(),
    p90Kw: z.number(),
    peakProbability: z.number().describe("Chance that this hour is one of the property's own top-5% hours."),
  })
  .meta({ id: "LoadHour" });

export const MethodScoreSchema = z.object({
  method: z.string(),
  description: z.string(),
  maeKw: z.number(),
  rmseKw: z.number(),
  wapePct: z.number().nullable(),
  biasKw: z.number(),
  coverage80: z.number().nullable(),
});

export const LoadForecastSchema = z
  .object({
    propertyId: z.uuid(),
    generatedAt: iso,
    hours: measured(z.array(LoadHourSchema)),
    energy: measured(z.object({ kwhP50: z.number() })),
    peakThresholdKw: z.number().nullable(),
    model: z
      .object({
        selectedMethod: z.string().nullable(),
        methods: z.array(MethodScoreSchema),
        holdoutDays: z.number(),
        historyDays: z.number(),
        gapsShare: z.number(),
      })
      .nullable(),
    history: z.object({
      from: iso,
      to: iso,
      intervalMinutes: z.number(),
      readingsUsed: z.number(),
      readingsOtherInterval: z.number(),
      readingsOffGrid: z.number(),
      emptyIntervals: z.number(),
      dataEndsDaysAgo: z.number(),
    }).nullable(),
    assumptions: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .meta({ id: "LoadForecast" });
