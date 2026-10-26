import { z } from "zod";
import { measured } from "../schemas.js";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const hhmm = z.string().regex(HHMM, "Use a 24-hour time such as 07:30.");
export const fraction = z.number().min(0).max(1);
const efficiency = z.number().min(0.5, "An efficiency below 0.5 is not credible: enter it as a fraction such as 0.95.").max(1);
const text = (max: number) => z.string().trim().max(max);

export const ASSET_STATUSES = ["EXISTING", "PLANNED"] as const;
export const APPLIANCE_PRIORITIES = ["CRITICAL", "IMPORTANT", "FLEXIBLE", "DISCRETIONARY"] as const;

export const minutesOf = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Minutes from `from` to `to` going forward in time, so a window may run past midnight (22:00 to 06:00 is 480). 24 h if equal. */
export function windowMinutes(from: string, to: string): number {
  const d = (minutesOf(to) - minutesOf(from) + 1440) % 1440;
  return d === 0 ? 1440 : d;
}

// ---- batteries

// The field sets carry NO defaults: a PATCH built from them must not fill in anything the caller did not send (in Zod 4 a
// default inside .partial() still applies). Create schemas add the defaults on top.
const BatteryFields = z.object({
  name: text(120).min(1),
  status: z.enum(ASSET_STATUSES),
  capacityKwh: z.number().positive().max(100_000).describe("Nominal capacity in kWh."),
  maxChargeKw: z.number().positive().max(100_000),
  maxDischargeKw: z.number().positive().max(100_000),
  chargeEfficiency: efficiency.nullish().describe("One way, 0.5 to 1. Leave out to use the labelled default."),
  dischargeEfficiency: efficiency.nullish(),
  minSoc: fraction.nullish().describe("Fraction of capacity that is never used."),
  maxSoc: fraction.nullish(),
  reserveSoc: fraction.nullish().describe("Fraction kept back for backup. Leave out and the planner works it out from your critical loads."),
  maxCyclesPerDay: z.number().min(0.1).max(10).nullish(),
  ratedCycles: z.number().int().min(1).max(100_000).nullish().describe("Cycle life from the datasheet."),
  wearInrPerKwh: z.number().min(0).max(1000).nullish(),
  currentSoc: fraction.nullish().describe("State of charge now, if you know it."),
  installedOn: z.iso.date().nullish(),
  notes: text(500).nullish(),
});

/** Cross-field rules shared by create and update: the same ones the database enforces, with words a person can act on. */
export function batteryRules(v: { minSoc?: number | null; maxSoc?: number | null; reserveSoc?: number | null }, ctx: z.RefinementCtx): void {
  const lo = v.minSoc ?? 0;
  const hi = v.maxSoc ?? 1;
  if (lo >= hi) ctx.addIssue({ code: "custom", message: `The unused fraction (${lo}) must be below the maximum charge (${hi}).`, path: ["minSoc"] });
  if (v.reserveSoc != null && (v.reserveSoc < lo || v.reserveSoc > hi)) ctx.addIssue({ code: "custom", message: `The backup reserve (${v.reserveSoc}) must lie between the minimum (${lo}) and maximum (${hi}) charge.`, path: ["reserveSoc"] });
}
export const BatteryInput = BatteryFields.extend({ status: z.enum(ASSET_STATUSES).default("EXISTING") }).superRefine(batteryRules);
export const BatteryPatch = BatteryFields.partial();
export type BatteryInput = z.infer<typeof BatteryInput>;

// ---- solar systems

const SolarFields = z.object({
  name: text(120).min(1),
  status: z.enum(ASSET_STATUSES),
  capacityKwp: z.number().positive().max(100_000).describe("DC capacity in kWp."),
  tiltDeg: z.number().min(0).max(90).describe("Degrees from horizontal."),
  azimuthDeg: z.number().min(0).lt(360).describe("Degrees clockwise from north: 180 faces south."),
  inverterKw: z.number().positive().max(100_000).nullish().describe("AC limit of the inverter."),
  lossFraction: z.number().min(0).max(0.5).nullish().describe("Fixed system losses as a fraction. Leave out to use the labelled default."),
  installedOn: z.iso.date().nullish(),
  notes: text(500).nullish(),
});
export const SolarInput = SolarFields.extend({ status: z.enum(ASSET_STATUSES).default("EXISTING") });
export const SolarPatch = SolarFields.partial();
export type SolarInput = z.infer<typeof SolarInput>;

// ---- electric vehicles

const EvFields = z.object({
  name: text(120).min(1),
  batteryKwh: z.number().positive().max(500),
  chargerKw: z.number().positive().max(350),
  chargerEfficiency: efficiency.nullish(),
  targetSoc: fraction.describe("The charge you want by departure."),
  currentSoc: fraction.nullish(),
  departureTime: hhmm.describe("Local time, 24-hour."),
  departureDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).describe("0 is Monday, 6 is Sunday."),
  notes: text(500).nullish(),
});
export const EvInput = EvFields.refine((v) => new Set(v.departureDays).size === v.departureDays.length, { message: "List each weekday once.", path: ["departureDays"] });
export const EvPatch = EvFields.partial();
export type EvInput = z.infer<typeof EvInput>;

// ---- appliances

const ScheduleWindow = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: hhmm,
  to: hhmm,
});

const ApplianceFields = z.object({
  name: text(120).min(1),
  kind: text(60).min(1).describe("What it is: refrigerator, air conditioner, washing machine, geyser, pump, lights..."),
  priority: z.enum(APPLIANCE_PRIORITIES),
  ratedPowerW: z.number().positive().max(1_000_000),
  quantity: z.number().int().min(1).max(1000),
  runtimeMinPerDay: z.number().int().min(0).max(1440).nullish(),
  schedule: z.array(ScheduleWindow).max(14).nullish().describe("When it usually runs."),
  earliestStart: hhmm.nullish(),
  latestFinish: hhmm.nullish(),
  durationMin: z.number().int().min(1).max(1440).nullish(),
  interruptible: z.boolean(),
  comfortNote: text(300).nullish(),
});

export function applianceRules(v: { priority?: string; earliestStart?: string | null; latestFinish?: string | null; durationMin?: number | null }, ctx: z.RefinementCtx): void {
  const hasWindow = v.earliestStart != null && v.latestFinish != null && v.durationMin != null;
  if (v.priority === "FLEXIBLE" && !hasWindow) {
    ctx.addIssue({ code: "custom", message: "A flexible appliance needs the window it may run in (earliest start and latest finish) and how long it runs, so the optimiser can place it.", path: ["earliestStart"] });
  }
  if ((v.earliestStart != null) !== (v.latestFinish != null)) ctx.addIssue({ code: "custom", message: "Give both the earliest start and the latest finish, or neither.", path: ["latestFinish"] });
  if (hasWindow) {
    const win = windowMinutes(v.earliestStart!, v.latestFinish!);
    if (v.durationMin! > win) ctx.addIssue({ code: "custom", message: `It needs ${v.durationMin} minutes but the window from ${v.earliestStart} to ${v.latestFinish} is only ${win} minutes long.`, path: ["durationMin"] });
  }
}
export const ApplianceInput = ApplianceFields.extend({ quantity: z.number().int().min(1).max(1000).default(1), interruptible: z.boolean().default(false) }).superRefine(applianceRules);
export const AppliancePatch = ApplianceFields.partial();
export type ApplianceInput = z.infer<typeof ApplianceInput>;

export const EventInput = z
  .object({
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }).nullish(),
    energyKwh: z.number().min(0).max(100_000).nullish(),
  })
  .refine((v) => !v.endedAt || new Date(v.endedAt) >= new Date(v.startedAt), { message: "It cannot end before it starts.", path: ["endedAt"] });

// ---- response shapes

const Param = z.object({ value: z.number().nullable(), basis: z.enum(["USER_ENTERED", "ASSUMPTION", "PLANNER"]), note: z.string() });
const Common = { id: z.uuid(), propertyId: z.uuid(), source: z.literal("USER_ENTERED"), createdAt: z.string(), updatedAt: z.string() };

export const BatterySchema = z
  .object({
    ...Common,
    name: z.string(),
    status: z.enum(ASSET_STATUSES),
    capacityKwh: z.number(),
    maxChargeKw: z.number(),
    maxDischargeKw: z.number(),
    entered: z.object({
      chargeEfficiency: z.number().nullable(),
      dischargeEfficiency: z.number().nullable(),
      minSoc: z.number().nullable(),
      maxSoc: z.number().nullable(),
      reserveSoc: z.number().nullable(),
      maxCyclesPerDay: z.number().nullable(),
      ratedCycles: z.number().nullable(),
      wearInrPerKwh: z.number().nullable(),
      currentSoc: z.number().nullable(),
    }),
    effective: z.object({ chargeEfficiency: Param, dischargeEfficiency: Param, minSoc: Param, maxSoc: Param, reserveSoc: Param, wearInrPerKwh: Param }).describe("What a plan will use: your value, or a labelled default."),
    usableKwh: z.number().describe("Capacity between the minimum and maximum charge."),
    currentSocAt: z.string().nullable(),
    installedOn: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .meta({ id: "Battery" });

export const SolarSystemSchema = z
  .object({
    ...Common,
    name: z.string(),
    status: z.enum(ASSET_STATUSES),
    capacityKwp: z.number(),
    tiltDeg: z.number(),
    azimuthDeg: z.number(),
    inverterKw: z.number().nullable(),
    entered: z.object({ lossFraction: z.number().nullable() }),
    effective: z.object({ lossFraction: Param }),
    installedOn: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .meta({ id: "SolarSystem" });

export const EvSchema = z
  .object({
    ...Common,
    name: z.string(),
    batteryKwh: z.number(),
    chargerKw: z.number(),
    targetSoc: z.number(),
    currentSoc: z.number().nullable(),
    currentSocAt: z.string().nullable(),
    departureTime: z.string(),
    departureDays: z.array(z.number()),
    entered: z.object({ chargerEfficiency: z.number().nullable() }),
    effective: z.object({ chargerEfficiency: Param }),
    notes: z.string().nullable(),
  })
  .meta({ id: "Ev" });

export const ApplianceSchema = z
  .object({
    ...Common,
    name: z.string(),
    kind: z.string(),
    priority: z.enum(APPLIANCE_PRIORITIES),
    ratedPowerW: z.number(),
    quantity: z.number(),
    totalRatedKw: z.number().describe("Rated power times quantity, in kW. A rating is a ceiling, not what it draws."),
    runtimeMinPerDay: z.number().nullable(),
    schedule: z.array(ScheduleWindow).nullable(),
    flexibility: z.object({ earliestStart: z.string().nullable(), latestFinish: z.string().nullable(), durationMin: z.number().nullable(), interruptible: z.boolean(), windowMinutes: z.number().nullable() }),
    comfortNote: z.string().nullable(),
  })
  .meta({ id: "Appliance" });

export const ApplianceEventSchema = z
  .object({
    id: z.uuid(),
    applianceId: z.uuid(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    energyKwh: z.number().nullable(),
    source: z.enum(["USER_LOGGED", "NILM_ESTIMATE", "METER_DERIVED"]),
    confidence: z.number().nullable(),
    uncertaintyKwh: z.number().nullable(),
  })
  .meta({ id: "ApplianceEvent" });

/** What the Energy Twin keeps of a property's assets (a profile per kind, spec section 8). */
export const AssetProfilesSchema = z.object({
  battery: measured(z.object({ count: z.number(), existingCount: z.number(), plannedCount: z.number(), totalCapacityKwh: z.number(), totalUsableKwh: z.number(), maxChargeKw: z.number(), maxDischargeKw: z.number() })),
  solar: measured(z.object({ count: z.number(), existingKwp: z.number(), plannedKwp: z.number() })),
  ev: measured(z.object({ count: z.number(), totalBatteryKwh: z.number(), maxChargerKw: z.number() })),
  appliances: measured(z.object({ count: z.number(), totalRatedKw: z.number(), criticalKw: z.number(), flexibleKw: z.number(), byPriority: z.record(z.string(), z.number()) })),
});
