import { z } from "zod";
import { ProvenanceSchema, measured } from "../schemas.js";
import { type TariffShape, validateShape } from "./engine.js";

/** ISO 3166-2:IN codes of the states and union territories (without the "IN-" prefix). */
export const STATE_CODES = [
  "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DH", "DL", "GA", "GJ", "HP", "HR", "JH", "JK", "KA", "KL", "LA", "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "PB", "PY", "RJ", "SK", "TN", "TR", "TS", "UK", "UP", "WB",
] as const;
export const CONSUMER_TYPES = ["RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL", "AGRICULTURAL", "OTHER"] as const;
export const FIXED_CHARGE_BASES = ["PER_CONNECTION_MONTH", "PER_KW_MONTH"] as const;
export const METERING_MODES = ["NET_METERING", "NET_BILLING", "GROSS_METERING", "NONE", "UNKNOWN"] as const;
export const EXPORT_RATE_BASES = ["REGULATOR_ORDER", "USER_ENTERED", "ASSUMPTION", "NONE"] as const;

export const TouBlockSchema = z.object({
  startHour: z.number().min(0).max(24).describe("Local hour the block starts, 0 to 24 (6.5 is 06:30)."),
  endHour: z.number().min(0).max(24).describe("Local hour the block ends, exclusive. A block may wrap midnight (start after end)."),
  rate: z.number().min(0).max(100).describe("INR per kWh."),
});
export const SlabSchema = z.object({
  upToKwhPerMonth: z.number().positive().nullable().describe("Upper limit of the slab in kWh per month; null for the last, open-ended slab."),
  rate: z.number().min(0).max(100).describe("INR per kWh inside this slab."),
});
export const FixedChargeSchema = z.object({
  amountInr: z.number().min(0).max(1_000_000),
  basis: z.enum(FIXED_CHARGE_BASES),
});

/** What a person enters for their own tariff. Slabs or time-of-day blocks, never invented defaults. */
export const TariffInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    state: z.enum(STATE_CODES).optional(),
    discom: z.string().trim().min(1).max(120).optional(),
    category: z.string().trim().min(1).max(120).optional(),
    consumerType: z.enum(CONSUMER_TYPES),
    touBlocks: z.array(TouBlockSchema).max(48).optional().describe("Omit when you give slabs: a single flat block at the last slab's rate is stored for the optimiser."),
    slabs: z.array(SlabSchema).max(20).optional(),
    fixedCharge: FixedChargeSchema.optional(),
    exportRate: z.number().min(0).max(100).optional().describe("Credit per exported kWh in INR, from your bill or net-metering agreement."),
    meteringMode: z.enum(METERING_MODES).optional(),
    source: z.string().trim().max(300).optional().describe("Where these numbers come from, for example 'my bill of March 2026'."),
    effectiveFrom: z.iso.date().optional(),
    effectiveTo: z.iso.date().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.touBlocks?.length && !v.slabs?.length) {
      ctx.addIssue({ code: "custom", message: "Give time-of-day blocks (a flat tariff is one block from 0 to 24) or slabs.", path: ["touBlocks"] });
      return;
    }
    const shape = shapeOf(v);
    for (const problem of validateShape(shape)) ctx.addIssue({ code: "custom", message: problem, path: [v.slabs?.length ? "slabs" : "touBlocks"] });
    if (v.effectiveFrom && v.effectiveTo && v.effectiveTo < v.effectiveFrom) ctx.addIssue({ code: "custom", message: "The end date is before the start date.", path: ["effectiveTo"] });
  });
export type TariffInput = z.infer<typeof TariffInput>;

/** The blocks to store: the ones given, or one flat block at the marginal (last slab) rate when only slabs were given. */
export function shapeOf(v: Pick<TariffInput, "touBlocks" | "slabs" | "fixedCharge">): TariffShape {
  const slabs = v.slabs?.length ? v.slabs : null;
  const touBlocks = v.touBlocks?.length ? v.touBlocks : slabs ? [{ startHour: 0, endHour: 24, rate: slabs[slabs.length - 1]!.rate }] : [];
  return { touBlocks, slabs, fixedCharge: v.fixedCharge ?? null };
}

export const ValiditySchema = z.object({
  status: z.enum(["WITHIN", "EXPIRED", "NOT_YET_EFFECTIVE", "OPEN_ENDED", "UNKNOWN"]),
  message: z.string(),
});

export const TariffPlanSchema = z
  .object({
    id: z.uuid(),
    origin: z.enum(["CURATED", "USER"]).describe("CURATED plans come from a regulator order recorded with its source text; USER plans were entered by their owner."),
    name: z.string(),
    state: z.string().nullable(),
    discom: z.string().nullable(),
    category: z.string().nullable(),
    consumerType: z.enum(CONSUMER_TYPES),
    touBlocks: z.array(TouBlockSchema),
    slabs: z.array(SlabSchema).nullable(),
    hourlyRates: z.array(z.number()).length(24).describe("INR per kWh for each hour of the local day (time-weighted inside an hour)."),
    fixedCharge: FixedChargeSchema.nullable(),
    export: z.object({
      rate: z.number().nullable(),
      basis: z.enum(EXPORT_RATE_BASES).describe("ASSUMPTION means the source order states no export rate and the value is an assumption."),
      meteringMode: z.enum(METERING_MODES),
    }),
    source: z.string(),
    sourceUrl: z.string().nullable(),
    tariffYear: z.string().nullable(),
    effectiveFrom: z.string().nullable(),
    effectiveTo: z.string().nullable(),
    verifiedAt: z.string().nullable(),
    validity: ValiditySchema,
    notes: z.array(z.string()),
    provenance: ProvenanceSchema,
  })
  .meta({ id: "TariffPlan" });

export const TariffListSchema = z.object({ tariffs: z.array(TariffPlanSchema) });

export const BillInputSchema = z.object({
  monthlyKwh: z.number().min(0).max(1_000_000).describe("Consumption in kWh for one month."),
  hourShare: z.array(z.number().min(0)).length(24).optional().describe("Share of consumption in each hour of the day (any scale). Omit for an even spread."),
  sanctionedLoadKw: z.number().positive().max(100_000).optional().describe("Needed to price a fixed charge billed per kW."),
});

export const BillSchema = z.object({
  tariffId: z.uuid(),
  total: measured(z.number()),
  energyCharge: measured(z.number()),
  fixedCharge: measured(z.number()),
  effectiveRateInrPerKwh: z.number().nullable(),
  lines: z.array(z.object({ label: z.string(), kwh: z.number().nullable(), rate: z.number().nullable(), amountInr: z.number() })),
  assumptions: z.array(z.string()),
  validity: ValiditySchema,
});
