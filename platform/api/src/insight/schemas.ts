import { z } from "zod";
import { measured } from "../schemas.js";

const NextStep = z.object({ label: z.string(), href: z.string(), why: z.string() });

/** The plan a view was read from, and how old it is. Null when there is none. */
const BasedOn = z
  .object({
    planId: z.uuid(),
    madeAt: z.string(),
    stale: z.boolean().describe("True when the plan is more than a day old."),
    note: z.string(),
  })
  .nullable();

export const HEALTH_METRIC_KEYS = ["efficiency", "solarUtilisation", "peakManagement", "storageUtilisation", "resilience", "gridDependence", "flexibility"] as const;

export const HealthSchema = z
  .object({
    label: z.literal("ENERGY HEALTH"),
    propertyId: z.uuid(),
    madeAt: z.string(),
    basedOn: BasedOn,
    metrics: z.array(
      z.object({
        key: z.enum(HEALTH_METRIC_KEYS),
        label: z.string(),
        direction: z.enum(["HIGHER_IS_BETTER", "LOWER_IS_BETTER"]),
        formula: z.string().describe("How the value is worked out, in words."),
        detail: z.string().describe("The figures that went into it, or the reason there is no value."),
        result: measured(z.number()).describe("A percentage, except resilience, which is hours. Null, with a reason, when it does not exist for this property."),
      }),
    ),
    noOverallScore: z.string().describe("Why the metrics are not added into one number."),
    next: z.array(NextStep),
  })
  .meta({ id: "EnergyHealth" });
export type HealthDto = z.infer<typeof HealthSchema>;

export const WASTE_KEYS = ["solarCurtailment", "surplusSold", "soldThenBoughtBack", "dearHoursImport", "applianceSchedule", "batteryOpportunity"] as const;

export const WasteSchema = z
  .object({
    label: z.literal("ENERGY WASTE"),
    propertyId: z.uuid(),
    madeAt: z.string(),
    basedOn: BasedOn,
    findings: z.array(
      z.object({
        key: z.enum(WASTE_KEYS),
        label: z.string(),
        state: z.enum(["FOUND", "NONE", "UNAVAILABLE"]),
        explanation: z.string(),
        how: z.string().describe("The method, so the figure can be checked."),
        amount: measured(z.object({ kwh: z.number().nullable(), valueInr: z.number().nullable() })),
      }),
    ),
    avoidable: z.object({
      perDay: measured(z.number()).describe("What the latest plan saves over the same day with no control: the cost a controlled day would not have had (INR)."),
      averageMonth: measured(z.number()).describe("Potential avoidable cost in an average month, only when a what-if run gives a year to take it from; otherwise UNAVAILABLE with what to do."),
    }),
    note: z.string(),
    next: z.array(NextStep),
  })
  .meta({ id: "EnergyWaste" });
export type WasteDto = z.infer<typeof WasteSchema>;
