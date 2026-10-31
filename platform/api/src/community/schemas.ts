import { z } from "zod";
import { measured } from "../schemas.js";
import { ALLOCATION_RULES, BATTERY_POLICIES } from "./allocate.js";

const kw = (max: number) => z.number().min(0).max(max);

export const BatteryInputSchema = z
  .object({
    usableKwh: z.number().min(0).max(10_000).describe("Capacity that may be cycled: the usable band above the depth-of-discharge floor."),
    socKwh: z.number().min(0).max(10_000).describe("Energy stored now, counted within that usable band."),
    reserveKwh: z.number().min(0).max(10_000).default(0).describe("The part kept back for backup. Discharging stops here."),
    maxChargeKw: kw(10_000),
    maxDischargeKw: kw(10_000),
    roundTripEfficiency: z.number().gt(0).max(1).default(0.9).describe("Charged on the way in: putting x kWh in stores x times this."),
  })
  .meta({ id: "CommunityBatteryInput" });

export const MemberInputSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    generationKw: kw(100_000),
    demandKw: kw(100_000),
    criticalKw: kw(100_000).default(0).describe("The part of the demand that must not be dropped. Used by the CRITICAL_FIRST rule; clamped to the demand."),
    battery: BatteryInputSchema.nullable().default(null),
    exportLimitKw: kw(100_000).default(100_000).describe("Most this property may push past its meter: the smaller of its inverter and what its connection permits."),
    importLimitKw: kw(100_000).default(100_000).describe("Most it may draw past its meter: its sanctioned load. Shared and bought energy both pass it."),
    lineLossFraction: z.number().min(0).max(0.5).default(0).describe("Fraction lost on this property's own leg to the shared node."),
  })
  .meta({ id: "CommunityMemberInput" });

export const LimitsInputSchema = z
  .object({
    feederLimitKw: kw(1_000_000).default(1_000_000).describe("Most that may pass through the shared node at once: the feeder or the transformer, whichever is smaller."),
    networkLossFraction: z.number().min(0).max(0.5).default(0).describe("Fraction lost in the shared network itself. Charged once, on the pool."),
    rule: z.enum(ALLOCATION_RULES).default("PROPORTIONAL").describe("How the pool is divided when the askers want more than it holds."),
    batteryPolicy: z.enum(BATTERY_POLICIES).default("SHARE_FIRST").describe("Whether a property in surplus fills its own battery before offering anything."),
    stepHours: z.number().gt(0).max(24).default(1).describe("Length of the interval, hours. Converts kW to the kWh a charge level moves by."),
  })
  .meta({ id: "CommunityLimitsInput" });

/**
 * Either describe the members yourself, or name your own properties and let AVISHKAR fill their figures in from what you
 * have entered and imported. Naming properties needs the engine and a solar resource for each place; describing members
 * yourself is pure arithmetic and always available.
 */
export const AllocateRequest = z
  .object({
    members: z.array(MemberInputSchema).max(200).optional().describe("The properties to allocate between, described in full."),
    propertyIds: z.array(z.uuid()).max(50).optional().describe("Your own properties to allocate between instead, at the hour given by `hour`."),
    hour: z.number().int().min(0).max(23).optional().describe("Hour of the typical day (IST) to take generation and demand from, when using propertyIds. Default: the current hour."),
    month: z.number().int().min(1).max(12).optional().describe("Month of that typical day. Default: this month."),
    dayType: z.enum(["weekday", "weekend"]).optional(),
    overrides: z
      .record(z.string(), MemberInputSchema.partial().omit({ id: true }))
      .optional()
      .describe("Changes to apply to the figures built from your properties, keyed by property id: what you want to ask 'what if' about."),
    limits: LimitsInputSchema.prefault({}),
  })
  .refine((v) => (v.members ? v.members.length > 0 : false) !== (v.propertyIds ? v.propertyIds.length > 0 : false), {
    message: "Give either members or propertyIds, not both and not neither.",
  })
  .meta({ id: "CommunityAllocateRequest" });
export type AllocateRequest = z.infer<typeof AllocateRequest>;
export type AllocateRequestInput = z.input<typeof AllocateRequest>;

const MemberResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  generationKw: z.number(),
  demandKw: z.number(),
  selfUseKw: z.number(),
  batteryDischargeKw: z.number(),
  batteryChargeKw: z.number(),
  batterySocKwh: z.number().nullable(),
  offeredKw: z.number(),
  sentKw: z.number(),
  requestedKw: z.number(),
  allocatedKw: z.number(),
  receivedKw: z.number(),
  gridImportKw: z.number(),
  gridExportKw: z.number(),
  curtailedKw: z.number(),
  unservedKw: z.number(),
  status: z.enum(["SURPLUS", "DEFICIT", "BALANCED"]),
  binding: z.enum(["NONE", "EXPORT_LIMIT", "IMPORT_LIMIT", "FEEDER_LIMIT", "NO_TAKER", "NO_SUPPLY", "BATTERY_FULL", "BATTERY_EMPTY"]),
  explanation: z.string(),
});

const TotalsSchema = z.object({
  members: z.number(),
  generationKw: z.number(),
  demandKw: z.number(),
  selfUseKw: z.number(),
  offeredKw: z.number(),
  requestedKw: z.number(),
  sharedSentKw: z.number(),
  sharedDeliveredKw: z.number(),
  transferLossKw: z.number(),
  batteryChargeKw: z.number(),
  batteryDischargeKw: z.number(),
  gridImportKw: z.number(),
  gridExportKw: z.number(),
  curtailedKw: z.number(),
  unservedKw: z.number(),
  selfSufficiency: z.number().nullable(),
  selfConsumption: z.number().nullable(),
});

/** What the same interval costs with the sharing and without it, when every member's prices are known. */
const ComparisonSchema = z.object({
  /** Each member on its own: its surplus sold and its deficit bought, with no sharing at all. */
  withoutSharingInr: z.number(),
  /** With the allocation above. */
  withSharingInr: z.number(),
  /** The difference. Negative means sharing cost more, which a loss or an export price above the import price can do. */
  savingInr: z.number(),
  /** The price the shared energy was valued at, and where it came from. */
  basis: z.string(),
});

export const AllocateSchema = z
  .object({
    label: z.literal("COMMUNITY ALLOCATION SIMULATION"),
    source: z.enum(["MEMBERS_GIVEN", "YOUR_PROPERTIES"]).describe("Whether the figures were supplied in the request or built from your own properties."),
    result: measured(
      z.object({
        members: z.array(MemberResultSchema),
        transfers: z.array(z.object({ fromId: z.string(), fromName: z.string(), toId: z.string(), toName: z.string(), sentKw: z.number(), deliveredKw: z.number(), lossKw: z.number() })),
        totals: TotalsSchema,
        limits: z.object({ feederLimitKw: z.number(), networkLossFraction: z.number(), rule: z.enum(ALLOCATION_RULES), batteryPolicy: z.enum(BATTERY_POLICIES), stepHours: z.number() }),
        feederBinding: z.boolean(),
        feederFlowKw: z.number(),
        check: z.object({ balanced: z.boolean(), maxMemberErrorKw: z.number(), communityErrorKw: z.number(), note: z.string() }),
        decisions: z.array(z.string()),
        comparison: ComparisonSchema.nullable(),
      }),
    ),
    /** Where each member's generation, demand and limits came from, member by member. */
    inputs: z.array(z.object({ id: z.string(), name: z.string(), basis: z.array(z.string()) })),
    notes: z.array(z.string()),
  })
  .meta({ id: "CommunityAllocateResponse" });
