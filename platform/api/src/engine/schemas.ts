/**
 * The engine's wire format, written against platform/engine/openapi.json (the committed contract). Responses are validated
 * at runtime: a reply that does not match is an error here, never a silently wrong number downstream.
 */
import { z } from "zod";

export const MODES = ["SAVE_MONEY", "INDEPENDENCE", "RESILIENCE", "GREEN", "REVENUE", "BALANCED"] as const;
export type Mode = (typeof MODES)[number];

export interface OptimiseRequest {
  stepHours: 0.25 | 0.5 | 1;
  startTime?: string;
  loadKw: number[];
  pvKw: number[];
  importPrice: number[];
  exportPrice: number[];
  battery?: {
    capacityKwh: number;
    maxChargeKw: number;
    maxDischargeKw: number;
    chargeEfficiency: number;
    dischargeEfficiency: number;
    minSocKwh: number;
    maxSocKwh: number;
    reserveSocKwh?: number | null;
    initialSocKwh: number;
    terminalSocKwh?: number | null;
    wearInrPerKwh?: number;
  } | null;
  grid?: { importLimitKw?: number | null; exportLimitKw?: number | null; outages?: { startStep: number; endStep: number }[] };
  criticalKw?: number;
  backupHours?: number;
  ev?: { energyNeededKwh: number; chargerKw: number; chargerEfficiency: number; availableFromStep: number; departureStep: number } | null;
  appliances?: { id: string; name: string; powerKw: number; durationSteps: number; earliestStartStep: number; latestFinishStep: number; interruptible: boolean }[];
  mode?: Mode;
  carbonKgPerKwh?: number[] | null;
  timeLimitS?: number;
}

const nums = z.array(z.number());

export const OptimiseResponse = z.object({
  mode: z.enum(MODES),
  modeWeights: z.record(z.string(), z.number()),
  solver: z.object({ status: z.enum(["optimal", "infeasible", "error"]), message: z.string(), objective: z.number().nullable(), seconds: z.number(), integerVariables: z.number() }),
  schedule: z
    .object({
      pvUsedKw: nums,
      pvCurtailedKw: nums,
      gridImportKw: nums,
      gridExportKw: nums,
      batteryChargeKw: nums,
      batteryDischargeKw: nums,
      batterySocKwh: nums,
      evChargeKw: nums,
      applianceKw: z.record(z.string(), nums),
      servedLoadKw: nums,
      unservedKw: nums,
    })
    .nullable(),
  appliances: z.array(z.object({ id: z.string(), name: z.string(), startStep: z.number().nullable(), runSteps: z.array(z.number()), energyKwh: z.number() })),
  totals: z
    .object({
      importKwh: z.number(),
      exportKwh: z.number(),
      importCostInr: z.number(),
      exportRevenueInr: z.number(),
      wearCostInr: z.number(),
      netCostInr: z.number(),
      loadKwh: z.number(),
      pvKwh: z.number(),
      pvUsedKwh: z.number(),
      curtailedKwh: z.number(),
      batteryThroughputKwh: z.number(),
      batteryCycles: z.number(),
      evDeliveredKwh: z.number(),
      evShortfallKwh: z.number(),
      unservedKwh: z.number(),
      selfConsumptionRatio: z.number().nullable(),
      selfSufficiencyRatio: z.number().nullable(),
    })
    .nullable(),
  baseline: z.object({ description: z.string(), netCostInr: z.number(), importKwh: z.number(), exportKwh: z.number(), unservedKwh: z.number() }).nullable(),
  savingsInr: z.number().nullable(),
  decisions: z.array(
    z.object({
      step: z.number(),
      kind: z.enum(["charge_battery", "discharge_battery", "export", "curtail", "ev_charge", "appliance", "import_peak", "shed"]),
      kwh: z.number(),
      reason: z.string(),
    }),
  ),
  validation: z.object({ valid: z.boolean(), maxBalanceErrorKw: z.number(), problems: z.array(z.string()) }),
  notes: z.array(z.string()),
});
export type OptimiseResponse = z.infer<typeof OptimiseResponse>;

export const EngineHealth = z.object({ status: z.literal("ok"), version: z.string(), scipy: z.string(), highs: z.string(), modes: z.array(z.string()) });
export type EngineHealth = z.infer<typeof EngineHealth>;
