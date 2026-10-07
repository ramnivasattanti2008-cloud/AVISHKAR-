import type { z } from "zod";
import type { Db } from "../db.js";
import { AppError } from "../errors.js";
import { type Appliance, type ApplianceEvent, type Battery, type Ev, Prisma, type SolarSystem } from "../generated/prisma/client.js";
import { type Measured, reference, unavailable } from "../provenance/index.js";
import { DEFAULTS, param, plannerParam } from "./defaults.js";
import {
  ApplianceInput,
  type AppliancePatch,
  BatteryInput,
  type BatteryPatch,
  EvInput,
  type EvPatch,
  type EventInput,
  SolarInput,
  type SolarPatch,
  windowMinutes,
} from "./schemas.js";

export const MAX_PER_PROPERTY = { batteries: 10, solarSystems: 10, evs: 10, appliances: 200 } as const;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateOnly = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Parse with a schema and report every problem in the words the schema gives it. */
function check<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError("VALIDATION_FAILED", r.error.issues.map((i) => i.message).join(" "), r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  return r.data;
}

/** The property must be the caller's. Anyone else's is "not found", never "forbidden". */
export async function ownProperty(db: Db, userId: string, propertyId: string): Promise<void> {
  const p = await db.property.findFirst({ where: { id: propertyId, ownerId: userId, deletedAt: null }, select: { id: true } });
  if (!p) throw new AppError("NOT_FOUND", "No such property.");
}

async function assertRoom(count: Promise<number>, max: number, what: string): Promise<void> {
  if ((await count) >= max) throw new AppError("VALIDATION_FAILED", `A property can have up to ${max} ${what}. Delete one you no longer need first.`);
}

const common = (r: { id: string; propertyId: string; createdAt: Date; updatedAt: Date }) => ({
  id: r.id,
  propertyId: r.propertyId,
  source: "USER_ENTERED" as const,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

// ---------------------------------------------------------------- batteries

export function toBatteryDto(b: Battery) {
  const eff = (v: number | null) => param(v, DEFAULTS.battery.oneWayEfficiency);
  const minSoc = param(b.minSoc, DEFAULTS.battery.minSoc);
  const maxSoc = param(b.maxSoc, DEFAULTS.battery.maxSoc);
  return {
    ...common(b),
    name: b.name,
    status: b.status,
    capacityKwh: b.capacityKwh,
    maxChargeKw: b.maxChargeKw,
    maxDischargeKw: b.maxDischargeKw,
    entered: {
      chargeEfficiency: b.chargeEfficiency,
      dischargeEfficiency: b.dischargeEfficiency,
      minSoc: b.minSoc,
      maxSoc: b.maxSoc,
      reserveSoc: b.reserveSoc,
      maxCyclesPerDay: b.maxCyclesPerDay,
      ratedCycles: b.ratedCycles,
      wearInrPerKwh: b.wearInrPerKwh,
      currentSoc: b.currentSoc,
    },
    effective: {
      chargeEfficiency: eff(b.chargeEfficiency),
      dischargeEfficiency: eff(b.dischargeEfficiency),
      minSoc,
      maxSoc,
      reserveSoc: plannerParam(b.reserveSoc, "Not set: the planner works the reserve out from your critical loads and the backup time you ask for."),
      wearInrPerKwh: param(b.wearInrPerKwh, DEFAULTS.battery.wearInrPerKwh),
    },
    usableKwh: round(b.capacityKwh * ((maxSoc.value ?? 1) - (minSoc.value ?? 0)), 3),
    currentSocAt: iso(b.currentSocAt),
    installedOn: day(b.installedOn),
    notes: b.notes,
  };
}

const batteryData = (v: z.output<typeof BatteryInput>, now: Date): Prisma.BatteryUncheckedUpdateInput => ({
  name: v.name,
  status: v.status,
  capacityKwh: v.capacityKwh,
  maxChargeKw: v.maxChargeKw,
  maxDischargeKw: v.maxDischargeKw,
  chargeEfficiency: v.chargeEfficiency ?? null,
  dischargeEfficiency: v.dischargeEfficiency ?? null,
  minSoc: v.minSoc ?? null,
  maxSoc: v.maxSoc ?? null,
  reserveSoc: v.reserveSoc ?? null,
  maxCyclesPerDay: v.maxCyclesPerDay ?? null,
  ratedCycles: v.ratedCycles ?? null,
  wearInrPerKwh: v.wearInrPerKwh ?? null,
  currentSoc: v.currentSoc ?? null,
  currentSocAt: v.currentSoc == null ? null : now,
  installedOn: dateOnly(v.installedOn),
  notes: v.notes ?? null,
});

const batteryAsInput = (b: Battery): Record<string, unknown> => ({
  name: b.name,
  status: b.status,
  capacityKwh: b.capacityKwh,
  maxChargeKw: b.maxChargeKw,
  maxDischargeKw: b.maxDischargeKw,
  chargeEfficiency: b.chargeEfficiency,
  dischargeEfficiency: b.dischargeEfficiency,
  minSoc: b.minSoc,
  maxSoc: b.maxSoc,
  reserveSoc: b.reserveSoc,
  maxCyclesPerDay: b.maxCyclesPerDay,
  ratedCycles: b.ratedCycles,
  wearInrPerKwh: b.wearInrPerKwh,
  currentSoc: b.currentSoc,
  installedOn: day(b.installedOn),
  notes: b.notes,
});

export const listBatteries = async (db: Db, userId: string, propertyId: string) => {
  await ownProperty(db, userId, propertyId);
  return (await db.battery.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } })).map(toBatteryDto);
};

export async function createBattery(db: Db, userId: string, propertyId: string, input: unknown, now: Date) {
  await ownProperty(db, userId, propertyId);
  const v = check(BatteryInput, input);
  await assertRoom(db.battery.count({ where: { propertyId } }), MAX_PER_PROPERTY.batteries, "batteries");
  return toBatteryDto(await db.battery.create({ data: { ...(batteryData(v, now) as Prisma.BatteryUncheckedCreateInput), propertyId } }));
}

export async function updateBattery(db: Db, userId: string, propertyId: string, id: string, patch: z.infer<typeof BatteryPatch>, now: Date) {
  await ownProperty(db, userId, propertyId);
  const row = await db.battery.findFirst({ where: { id, propertyId } });
  if (!row) throw new AppError("NOT_FOUND", "No such battery.");
  const v = check(BatteryInput, { ...batteryAsInput(row), ...definedOnly(patch) });
  const data = batteryData(v, now);
  if (patch.currentSoc === undefined) {
    data.currentSocAt = row.currentSocAt; // unchanged state of charge keeps its own timestamp
  }
  return toBatteryDto(await db.battery.update({ where: { id }, data }));
}

export async function deleteBattery(db: Db, userId: string, propertyId: string, id: string): Promise<void> {
  await ownProperty(db, userId, propertyId);
  const { count } = await db.battery.deleteMany({ where: { id, propertyId } });
  if (count === 0) throw new AppError("NOT_FOUND", "No such battery.");
}

// ------------------------------------------------------------ solar systems

export function toSolarDto(s: SolarSystem) {
  return {
    ...common(s),
    name: s.name,
    status: s.status,
    capacityKwp: s.capacityKwp,
    tiltDeg: s.tiltDeg,
    azimuthDeg: s.azimuthDeg,
    inverterKw: s.inverterKw,
    entered: { lossFraction: s.lossFraction },
    effective: { lossFraction: param(s.lossFraction, DEFAULTS.solar.lossFraction) },
    installedOn: day(s.installedOn),
    notes: s.notes,
  };
}

const solarData = (v: z.output<typeof SolarInput>): Prisma.SolarSystemUncheckedUpdateInput => ({
  name: v.name,
  status: v.status,
  capacityKwp: v.capacityKwp,
  tiltDeg: v.tiltDeg,
  azimuthDeg: v.azimuthDeg,
  inverterKw: v.inverterKw ?? null,
  lossFraction: v.lossFraction ?? null,
  installedOn: dateOnly(v.installedOn),
  notes: v.notes ?? null,
});

const solarAsInput = (s: SolarSystem): Record<string, unknown> => ({
  name: s.name,
  status: s.status,
  capacityKwp: s.capacityKwp,
  tiltDeg: s.tiltDeg,
  azimuthDeg: s.azimuthDeg,
  inverterKw: s.inverterKw,
  lossFraction: s.lossFraction,
  installedOn: day(s.installedOn),
  notes: s.notes,
});

export const listSolarSystems = async (db: Db, userId: string, propertyId: string) => {
  await ownProperty(db, userId, propertyId);
  return (await db.solarSystem.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } })).map(toSolarDto);
};

export async function createSolarSystem(db: Db, userId: string, propertyId: string, input: unknown) {
  await ownProperty(db, userId, propertyId);
  const v = check(SolarInput, input);
  await assertRoom(db.solarSystem.count({ where: { propertyId } }), MAX_PER_PROPERTY.solarSystems, "solar systems");
  return toSolarDto(await db.solarSystem.create({ data: { ...(solarData(v) as Prisma.SolarSystemUncheckedCreateInput), propertyId } }));
}

export async function updateSolarSystem(db: Db, userId: string, propertyId: string, id: string, patch: z.infer<typeof SolarPatch>) {
  await ownProperty(db, userId, propertyId);
  const row = await db.solarSystem.findFirst({ where: { id, propertyId } });
  if (!row) throw new AppError("NOT_FOUND", "No such solar system.");
  const v = check(SolarInput, { ...solarAsInput(row), ...definedOnly(patch) });
  return toSolarDto(await db.solarSystem.update({ where: { id }, data: solarData(v) }));
}

export async function deleteSolarSystem(db: Db, userId: string, propertyId: string, id: string): Promise<void> {
  await ownProperty(db, userId, propertyId);
  const { count } = await db.solarSystem.deleteMany({ where: { id, propertyId } });
  if (count === 0) throw new AppError("NOT_FOUND", "No such solar system.");
}

// ---------------------------------------------------------------------- EVs

export function toEvDto(e: Ev) {
  return {
    ...common(e),
    name: e.name,
    batteryKwh: e.batteryKwh,
    chargerKw: e.chargerKw,
    targetSoc: e.targetSoc,
    currentSoc: e.currentSoc,
    currentSocAt: iso(e.currentSocAt),
    departureTime: e.departureTime,
    departureDays: e.departureDays,
    entered: { chargerEfficiency: e.chargerEfficiency },
    effective: { chargerEfficiency: param(e.chargerEfficiency, DEFAULTS.ev.chargerEfficiency) },
    notes: e.notes,
  };
}

const evData = (v: z.output<typeof EvInput>, now: Date): Prisma.EvUncheckedUpdateInput => ({
  name: v.name,
  batteryKwh: v.batteryKwh,
  chargerKw: v.chargerKw,
  chargerEfficiency: v.chargerEfficiency ?? null,
  targetSoc: v.targetSoc,
  currentSoc: v.currentSoc ?? null,
  currentSocAt: v.currentSoc == null ? null : now,
  departureTime: v.departureTime,
  departureDays: [...v.departureDays].sort((a, b) => a - b),
  notes: v.notes ?? null,
});

const evAsInput = (e: Ev): Record<string, unknown> => ({
  name: e.name,
  batteryKwh: e.batteryKwh,
  chargerKw: e.chargerKw,
  chargerEfficiency: e.chargerEfficiency,
  targetSoc: e.targetSoc,
  currentSoc: e.currentSoc,
  departureTime: e.departureTime,
  departureDays: e.departureDays,
  notes: e.notes,
});

export const listEvs = async (db: Db, userId: string, propertyId: string) => {
  await ownProperty(db, userId, propertyId);
  return (await db.ev.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } })).map(toEvDto);
};

export async function createEv(db: Db, userId: string, propertyId: string, input: unknown, now: Date) {
  await ownProperty(db, userId, propertyId);
  const v = check(EvInput, input);
  await assertRoom(db.ev.count({ where: { propertyId } }), MAX_PER_PROPERTY.evs, "electric vehicles");
  return toEvDto(await db.ev.create({ data: { ...(evData(v, now) as Prisma.EvUncheckedCreateInput), propertyId } }));
}

export async function updateEv(db: Db, userId: string, propertyId: string, id: string, patch: z.infer<typeof EvPatch>, now: Date) {
  await ownProperty(db, userId, propertyId);
  const row = await db.ev.findFirst({ where: { id, propertyId } });
  if (!row) throw new AppError("NOT_FOUND", "No such vehicle.");
  const v = check(EvInput, { ...evAsInput(row), ...definedOnly(patch) });
  const data = evData(v, now);
  if (patch.currentSoc === undefined) data.currentSocAt = row.currentSocAt;
  return toEvDto(await db.ev.update({ where: { id }, data }));
}

export async function deleteEv(db: Db, userId: string, propertyId: string, id: string): Promise<void> {
  await ownProperty(db, userId, propertyId);
  const { count } = await db.ev.deleteMany({ where: { id, propertyId } });
  if (count === 0) throw new AppError("NOT_FOUND", "No such vehicle.");
}

// -------------------------------------------------------------- appliances

export function toApplianceDto(a: Appliance) {
  return {
    ...common(a),
    name: a.name,
    kind: a.kind,
    priority: a.priority,
    ratedPowerW: a.ratedPowerW,
    quantity: a.quantity,
    totalRatedKw: round((a.ratedPowerW * a.quantity) / 1000, 4),
    runtimeMinPerDay: a.runtimeMinPerDay,
    schedule: (a.schedule as { days: number[]; from: string; to: string }[] | null) ?? null,
    flexibility: {
      earliestStart: a.earliestStart,
      latestFinish: a.latestFinish,
      durationMin: a.durationMin,
      interruptible: a.interruptible,
      windowMinutes: a.earliestStart && a.latestFinish ? windowMinutes(a.earliestStart, a.latestFinish) : null,
    },
    comfortNote: a.comfortNote,
  };
}

const applianceData = (v: z.output<typeof ApplianceInput>): Prisma.ApplianceUncheckedUpdateInput => ({
  name: v.name,
  kind: v.kind,
  priority: v.priority,
  ratedPowerW: v.ratedPowerW,
  quantity: v.quantity,
  runtimeMinPerDay: v.runtimeMinPerDay ?? null,
  schedule: (v.schedule ?? undefined) as Prisma.InputJsonValue | undefined,
  earliestStart: v.earliestStart ?? null,
  latestFinish: v.latestFinish ?? null,
  durationMin: v.durationMin ?? null,
  interruptible: v.interruptible,
  comfortNote: v.comfortNote ?? null,
});

const applianceAsInput = (a: Appliance): Record<string, unknown> => ({
  name: a.name,
  kind: a.kind,
  priority: a.priority,
  ratedPowerW: a.ratedPowerW,
  quantity: a.quantity,
  runtimeMinPerDay: a.runtimeMinPerDay,
  schedule: a.schedule,
  earliestStart: a.earliestStart,
  latestFinish: a.latestFinish,
  durationMin: a.durationMin,
  interruptible: a.interruptible,
  comfortNote: a.comfortNote,
});

export const listAppliances = async (db: Db, userId: string, propertyId: string) => {
  await ownProperty(db, userId, propertyId);
  return (await db.appliance.findMany({ where: { propertyId }, orderBy: [{ priority: "asc" }, { name: "asc" }] })).map(toApplianceDto);
};

export async function createAppliance(db: Db, userId: string, propertyId: string, input: unknown) {
  await ownProperty(db, userId, propertyId);
  const v = check(ApplianceInput, input);
  await assertRoom(db.appliance.count({ where: { propertyId } }), MAX_PER_PROPERTY.appliances, "appliances");
  const data = applianceData(v);
  if (v.schedule == null) delete data.schedule;
  return toApplianceDto(await db.appliance.create({ data: { ...(data as Prisma.ApplianceUncheckedCreateInput), propertyId } }));
}

export async function updateAppliance(db: Db, userId: string, propertyId: string, id: string, patch: z.infer<typeof AppliancePatch>) {
  await ownProperty(db, userId, propertyId);
  const row = await db.appliance.findFirst({ where: { id, propertyId } });
  if (!row) throw new AppError("NOT_FOUND", "No such appliance.");
  const v = check(ApplianceInput, { ...applianceAsInput(row), ...definedOnly(patch) });
  const data = applianceData(v);
  if (v.schedule == null) data.schedule = Prisma.DbNull; // SQL NULL; JsonNull would store a JSON null, which the CHECK rightly refuses
  return toApplianceDto(await db.appliance.update({ where: { id }, data }));
}

export async function deleteAppliance(db: Db, userId: string, propertyId: string, id: string): Promise<void> {
  await ownProperty(db, userId, propertyId);
  const { count } = await db.appliance.deleteMany({ where: { id, propertyId } });
  if (count === 0) throw new AppError("NOT_FOUND", "No such appliance.");
}

// ------------------------------------------------------- appliance events

export function toEventDto(e: ApplianceEvent) {
  return {
    id: e.id,
    applianceId: e.applianceId,
    startedAt: e.startedAt.toISOString(),
    endedAt: iso(e.endedAt),
    energyKwh: e.energyKwh,
    source: e.source,
    confidence: e.confidence,
    uncertaintyKwh: e.uncertaintyKwh,
  };
}

async function ownAppliance(db: Db, userId: string, propertyId: string, applianceId: string): Promise<void> {
  await ownProperty(db, userId, propertyId);
  const a = await db.appliance.findFirst({ where: { id: applianceId, propertyId }, select: { id: true } });
  if (!a) throw new AppError("NOT_FOUND", "No such appliance.");
}

const MAX_EVENTS_PER_APPLIANCE = 5000;

/** The owner logs a run themselves. Estimated and meter-derived events are written by engines, never through this call. */
export async function logApplianceEvent(db: Db, userId: string, propertyId: string, applianceId: string, input: z.infer<typeof EventInput>) {
  await ownAppliance(db, userId, propertyId, applianceId);
  await assertRoom(db.applianceEvent.count({ where: { applianceId } }), MAX_EVENTS_PER_APPLIANCE, "logged runs per appliance");
  const row = await db.applianceEvent.create({
    data: { applianceId, startedAt: new Date(input.startedAt), endedAt: input.endedAt ? new Date(input.endedAt) : null, energyKwh: input.energyKwh ?? null, source: "USER_LOGGED" },
  });
  return toEventDto(row);
}

export async function listApplianceEvents(db: Db, userId: string, propertyId: string, applianceId: string, opts: { since?: string; limit?: number }) {
  await ownAppliance(db, userId, propertyId, applianceId);
  const rows = await db.applianceEvent.findMany({
    where: { applianceId, ...(opts.since ? { startedAt: { gte: new Date(opts.since) } } : {}) },
    orderBy: { startedAt: "desc" },
    take: Math.min(opts.limit ?? 100, 500),
  });
  return rows.map(toEventDto);
}

export async function deleteApplianceEvent(db: Db, userId: string, propertyId: string, applianceId: string, eventId: string): Promise<void> {
  await ownAppliance(db, userId, propertyId, applianceId);
  const { count } = await db.applianceEvent.deleteMany({ where: { id: eventId, applianceId } });
  if (count === 0) throw new AppError("NOT_FOUND", "No such logged run.");
}

// ----------------------------------------------------------- twin profiles

export interface AssetSnapshot {
  capturedAt: string;
  /** The consumption figure the twin used and the days it came from; set by the twin builder, not by `summariseAssets`. */
  load?: { dnaId: string; meanDailyKwh: number; completeDays: number; from: string; to: string } | null;
  battery: { count: number; existingCount: number; plannedCount: number; totalCapacityKwh: number; totalUsableKwh: number; maxChargeKw: number; maxDischargeKw: number } | null;
  solar: { count: number; existingKwp: number; plannedKwp: number } | null;
  ev: { count: number; totalBatteryKwh: number; maxChargerKw: number } | null;
  appliances: { count: number; totalRatedKw: number; criticalKw: number; flexibleKw: number; byPriority: Record<string, number> } | null;
}

/** A summary of what the owner has entered for a property, as it is now. Null for a kind with nothing entered. */
export async function summariseAssets(db: Db, propertyId: string, now: Date): Promise<AssetSnapshot> {
  const [batteries, solar, evs, appliances] = await Promise.all([
    db.battery.findMany({ where: { propertyId } }),
    db.solarSystem.findMany({ where: { propertyId } }),
    db.ev.findMany({ where: { propertyId } }),
    db.appliance.findMany({ where: { propertyId } }),
  ]);
  const sum = (xs: number[]) => round(xs.reduce((a, b) => a + b, 0), 4);
  const byPriority: Record<string, number> = {};
  for (const a of appliances) byPriority[a.priority] = (byPriority[a.priority] ?? 0) + a.quantity;
  const kw = (a: Appliance) => (a.ratedPowerW * a.quantity) / 1000;
  return {
    capturedAt: now.toISOString(),
    battery: batteries.length
      ? {
          count: batteries.length,
          existingCount: batteries.filter((b) => b.status === "EXISTING").length,
          plannedCount: batteries.filter((b) => b.status === "PLANNED").length,
          totalCapacityKwh: sum(batteries.map((b) => b.capacityKwh)),
          totalUsableKwh: sum(batteries.map((b) => toBatteryDto(b).usableKwh)),
          maxChargeKw: sum(batteries.map((b) => b.maxChargeKw)),
          maxDischargeKw: sum(batteries.map((b) => b.maxDischargeKw)),
        }
      : null,
    solar: solar.length ? { count: solar.length, existingKwp: sum(solar.filter((s) => s.status === "EXISTING").map((s) => s.capacityKwp)), plannedKwp: sum(solar.filter((s) => s.status === "PLANNED").map((s) => s.capacityKwp)) } : null,
    ev: evs.length ? { count: evs.length, totalBatteryKwh: sum(evs.map((e) => e.batteryKwh)), maxChargerKw: Math.max(...evs.map((e) => e.chargerKw)) } : null,
    appliances: appliances.length
      ? {
          count: appliances.reduce((n, a) => n + a.quantity, 0),
          totalRatedKw: sum(appliances.map(kw)),
          criticalKw: sum(appliances.filter((a) => a.priority === "CRITICAL").map(kw)),
          flexibleKw: sum(appliances.filter((a) => a.priority === "FLEXIBLE").map(kw)),
          byPriority,
        }
      : null,
  };
}

/** Rebuild the labelled view of a stored snapshot. Entered values are REFERENCE data ("you said so"), absent kinds are UNAVAILABLE. */
export function profilesFromSnapshot(snap: AssetSnapshot | null, at: Date) {
  const src = (dataType: string) => ({ provider: "user", source: "Entered by the property owner", dataType, now: at });
  const none = <T>(what: string, why: string): Measured<T> => unavailable<T>(`No ${what} has been entered. ${why}`, src(what));
  const have = <T>(v: T | null | undefined, dataType: string, what: string, why: string): Measured<T> =>
    v ? reference(v, { ...src(dataType), notes: ["Entered by you; AVISHKAR has not checked it against the equipment."] }) : none<T>(what, why);
  return {
    battery: have(snap?.battery, "battery_profile", "battery", "Add one to plan with it; without a battery the planner only shifts load."),
    solar: have(snap?.solar, "solar_profile", "solar system", "Add an installed or planned system to forecast its output."),
    ev: have(snap?.ev, "ev_profile", "electric vehicle", "Add one so charging can be placed in the cheapest or sunniest hours."),
    appliances: have(snap?.appliances, "appliance_profile", "appliances", "Add them, with the critical ones marked, so backup and scheduling respect them."),
  };
}

// ------------------------------------------------------------------ helpers

const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round((v + Number.EPSILON) * f) / f;
};

/** A patch with the keys the caller did not send removed, so `undefined` never overwrites a stored value. */
function definedOnly<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
