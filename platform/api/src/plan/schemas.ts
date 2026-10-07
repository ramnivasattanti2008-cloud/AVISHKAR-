import { z } from "zod";
import { MODES } from "../engine/schemas.js";
import { measured } from "../schemas.js";

const nums = z.array(z.number());
const iso = z.string();

export const PlanRequest = z
  .object({
    mode: z.enum(MODES).default("BALANCED").describe("What to favour: money, independence from the grid, outage resilience, low carbon, export revenue, or a balance."),
    hours: z.union([z.literal(24), z.literal(48)]).default(24).describe("How far ahead to plan."),
    startSocPercent: z.number().min(0).max(100).nullish().describe("The battery's charge now, if you know it. Otherwise the plan assumes it starts at its reserve (or minimum) level and says so."),
  })
  .meta({ id: "PlanRequest" });
export type PlanRequest = z.infer<typeof PlanRequest>;

const Totals = z.object({
  netCostInr: z.number(),
  baselineNetCostInr: z.number().describe("What the same day costs with no battery control, no appliance shifting and no EV scheduling."),
  savingsInr: z.number(),
  importKwh: z.number(),
  exportKwh: z.number(),
  loadKwh: z.number(),
  pvKwh: z.number(),
  pvUsedKwh: z.number(),
  curtailedKwh: z.number(),
  batteryCycles: z.number(),
  unservedKwh: z.number(),
  evShortfallKwh: z.number(),
  selfConsumptionRatio: z.number().nullable(),
  selfSufficiencyRatio: z.number().nullable(),
});

export const PlanSchema = z
  .object({
    id: z.uuid(),
    propertyId: z.uuid(),
    createdAt: iso,
    mode: z.enum(MODES),
    modeWeights: z.record(z.string(), z.number()),
    horizon: z.object({ start: iso, stepHours: z.number(), steps: z.number() }),
    schedule: z.object({
      times: z.array(iso).describe("Start of each local hour."),
      loadKw: nums,
      pvForecastKw: nums,
      pvUsedKw: nums,
      pvCurtailedKw: nums,
      gridImportKw: nums,
      gridExportKw: nums,
      batteryChargeKw: nums,
      batteryDischargeKw: nums,
      batterySocKwh: nums,
      evChargeKw: nums,
      applianceKw: z.record(z.string(), nums),
      importPrice: nums,
      exportPrice: nums,
    }),
    result: measured(Totals),
    appliances: z.array(z.object({ id: z.string(), name: z.string(), startTime: iso.nullable(), runHours: z.number(), energyKwh: z.number() })),
    decisions: z.array(z.object({ time: iso, kind: z.string(), kwh: z.number(), reason: z.string() })),
    inputs: z.object({
      tariff: z.object({ id: z.uuid(), name: z.string(), validity: z.string(), exportRate: z.number().nullable(), exportBasis: z.string() }),
      load: z.object({ basis: z.enum(["FORECAST", "TYPICAL_DAY"]), note: z.string() }),
      solar: z.object({ systems: z.number(), note: z.string() }),
      battery: z
        .object({ capacityKwh: z.number(), usableKwh: z.number(), maxChargeKw: z.number(), maxDischargeKw: z.number(), startSocKwh: z.number(), startSocBasis: z.enum(["USER_ENTERED", "ASSUMPTION"]), reserveKwh: z.number().nullable() })
        .nullable(),
      ev: z.object({ energyNeededKwh: z.number(), departure: iso }).nullable(),
      criticalKw: z.number(),
    }),
    assumptions: z.array(z.string()),
    solver: z.object({ status: z.string(), seconds: z.number(), integerVariables: z.number() }),
    validation: z.object({ valid: z.boolean(), maxBalanceErrorKw: z.number(), problems: z.array(z.string()) }),
    notes: z.array(z.string()),
  })
  .meta({ id: "Plan" });
export type PlanDto = z.infer<typeof PlanSchema>;

export const PlanSummarySchema = z
  .object({ id: z.uuid(), createdAt: iso, mode: z.enum(MODES), startsAt: iso, steps: z.number(), netCostInr: z.number(), baselineNetCostInr: z.number(), savingsInr: z.number() })
  .meta({ id: "PlanSummary" });
