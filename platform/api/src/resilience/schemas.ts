import { z } from "zod";
import { measured } from "../schemas.js";

export const ResilienceRequest = z
  .object({
    targetHours: z.number().min(1).max(24).default(4).describe("How long you want the critical load to last, for the reserve to recommend."),
    startSocPercent: z.number().min(0).max(100).nullish().describe("The battery's charge now, if you know it. Otherwise the level you last entered within the day, or the battery's reserve level."),
  })
  .meta({ id: "ResilienceRequest" });
export type ResilienceRequest = z.infer<typeof ResilienceRequest>;

const Resilience = z.object({
  criticalKw: z.number().describe("The power the appliances you marked CRITICAL draw together."),
  criticalLoads: z.array(z.object({ name: z.string(), quantity: z.number(), ratedPowerW: z.number(), kw: z.number() })),
  battery: z.object({ usableKwh: z.number(), startSocKwh: z.number(), startSocBasis: z.enum(["USER_ENTERED", "ASSUMPTION"]), reserveKwh: z.number().nullable() }).nullable(),
  backupHours: z.object({
    withForecastSun: z.number().describe("If the grid failed at the start of the next hour: how long the critical load is served with the forecast sun and the battery."),
    atLeast: z.boolean().describe("True when it was served through the whole 48 hours examined, so the figure is a lower bound."),
    withoutSun: z.number().describe("The battery alone: as at night or under heavy cloud."),
  }),
  score: z.number().int().min(0).max(100),
  scoreMethod: z.string(),
  recommendedReserve: z
    .object({
      targetHours: z.number(),
      reserveKwh: z.number().describe("The charge to keep back so the critical load lasts the target time with no sun."),
      reservePercentOfCapacity: z.number(),
      currentReserveKwh: z.number().describe("What the battery keeps back now: the reserve you set, or its floor."),
      gapKwh: z.number().describe("How much more to hold back than now; zero or negative when the current reserve is enough."),
      feasible: z.boolean().describe("False when the battery cannot hold that much."),
      longestPossibleHours: z.number().describe("The longest the full battery could carry the critical load with no sun."),
    })
    .nullable(),
});

const Autonomy = z.object({
  score: z.number().int().min(0).max(100),
  methodology: z.string(),
  parts: z.object({ consumedKwh: z.number(), solarUsedKwh: z.number(), batteryReleasedKwh: z.number(), boughtKwh: z.number(), gridDependencyPercent: z.number() }),
  criticalCoverageHours: z.number().nullable().describe("How long the critical load would last with the forecast sun if the grid failed now (from the resilience figures)."),
  planId: z.uuid(),
  planMadeAt: z.string(),
});

export const ResilienceSchema = z
  .object({
    label: z.literal("RESILIENCE AND AUTONOMY"),
    request: z.object({ targetHours: z.number(), startSocPercent: z.number().nullable() }),
    madeAt: z.string(),
    outageRisk: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }).describe("Grid outage risk is never predicted: no outage data source exists."),
    resilience: measured(Resilience),
    autonomy: measured(Autonomy),
    assumptions: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .meta({ id: "ResilienceReport" });
export type ResilienceDto = z.infer<typeof ResilienceSchema>;
