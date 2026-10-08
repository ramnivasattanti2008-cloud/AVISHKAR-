import { z } from "zod";
import { RecommendationSchema } from "../plan/schemas.js";
import { measured } from "../schemas.js";

const Level = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const TodaySchema = z
  .object({
    label: z.literal("TODAY"),
    propertyId: z.uuid(),
    madeAt: z.string(),
    localDate: z.string().describe("Today on the India Standard Time clock, YYYY-MM-DD."),
    generation: measured(z.object({ kwh: z.number(), hoursCovered: z.number(), forecastIssuedAt: z.string() })).describe("What the solar system is forecast to make today."),
    consumption: measured(z.object({ kwh: z.number(), hoursCovered: z.number(), basis: z.enum(["FORECAST", "TYPICAL_DAY"]) })).describe("What the property is expected to use today."),
    surplus: measured(z.object({ kwh: z.number(), note: z.string() })).describe("Solar that exceeds use hour by hour today: what is free to store, sell or shift into."),
    weatherRisk: measured(
      z.object({ level: Level, meanCloudPercent: z.number(), maxRainMmPerHour: z.number(), hours: z.number(), rule: z.string() }),
    ).describe("The risk the weather poses to the sun in the next daylight hours."),
    resilience: measured(z.object({ hours: z.number(), atLeast: z.boolean(), score: z.number().int() })).describe("How long the critical load would last if the grid failed now."),
    plan: measured(
      z.object({
        planId: z.uuid(),
        madeAt: z.string(),
        stale: z.boolean().describe("True when the plan was made more than a day ago."),
        savingsInr: z.number(),
        baselineNetCostInr: z.number(),
        netCostInr: z.number(),
        importKwh: z.number(),
        autonomyScore: z.number().int().nullable(),
      }),
    ).describe("The latest plan: what it is expected to save, and how autonomous it is."),
    recommendation: RecommendationSchema.nullable().describe("What to do next, with why, the data used, the assumptions and how steady the advice is."),
    achieved: z.object({ expectedSavingsInr: z.number().nullable(), basis: z.string(), carbon: z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }) }).describe("What AVISHKAR is expected to have achieved: from the plan, not measured."),
    next: z.array(z.object({ label: z.string(), href: z.string(), why: z.string() })).describe("What would fill in what is missing, each with where to do it."),
  })
  .meta({ id: "Today" });
export type TodayDto = z.infer<typeof TodaySchema>;
export type RiskLevel = z.infer<typeof Level>;
