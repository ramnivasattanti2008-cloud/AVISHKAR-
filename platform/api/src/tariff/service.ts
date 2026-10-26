import { z } from "zod";
import type { Db } from "../db.js";
import { AppError } from "../errors.js";
import type { Prisma, TariffPlan as TariffRow } from "../generated/prisma/client.js";
import { estimated, reference, type Measured, type Provenance } from "../provenance/index.js";
import { type Bill, computeBill, hourlyRates, validateShape, validityOn } from "./engine.js";
import { type TariffInput, FixedChargeSchema, SlabSchema, TouBlockSchema, shapeOf } from "./schemas.js";

export interface TariffPlanDto {
  id: string;
  origin: "CURATED" | "USER";
  name: string;
  state: string | null;
  discom: string | null;
  category: string | null;
  consumerType: TariffRow["consumerType"];
  touBlocks: z.infer<typeof TouBlockSchema>[];
  slabs: z.infer<typeof SlabSchema>[] | null;
  hourlyRates: number[];
  fixedCharge: z.infer<typeof FixedChargeSchema> | null;
  export: { rate: number | null; basis: TariffRow["exportRateBasis"]; meteringMode: TariffRow["meteringMode"] };
  source: string;
  sourceUrl: string | null;
  tariffYear: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  verifiedAt: string | null;
  validity: ReturnType<typeof validityOn>;
  notes: string[];
  provenance: Provenance;
}

export interface TariffFilter {
  state?: string;
  discom?: string;
  consumerType?: TariffRow["consumerType"];
  /** curated: shared plans only; mine: only the signed-in user's own; all (default): both. */
  scope?: "curated" | "mine" | "all";
}

const PROVIDER = "avishkar-tariffs";
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const strings = (v: Prisma.JsonValue): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError("INTERNAL", `Stored tariff ${what} is not valid.`);
  return r.data;
}

/** What the API shows for a stored plan, with its validity worked out for `now` and its provenance spelled out. */
export function toTariffDto(row: TariffRow, now: Date): TariffPlanDto {
  const touBlocks = parsed(z.array(TouBlockSchema), row.touBlocks, "time-of-day blocks");
  const slabs = row.slabs === null ? null : parsed(z.array(SlabSchema), row.slabs, "slabs");
  const fixedCharge = row.fixedChargeInr !== null && row.fixedChargeBasis !== null ? { amountInr: row.fixedChargeInr, basis: row.fixedChargeBasis } : null;
  const validity = validityOn(row.effectiveFrom, row.effectiveTo, now);
  const origin = row.ownerId === null ? "CURATED" : "USER";
  const notes = strings(row.notes);

  const provNotes: string[] = [];
  if (validity.status !== "WITHIN") provNotes.push(validity.message);
  if (row.exportRateBasis === "ASSUMPTION") provNotes.push("The export rate is an assumption: the source states none.");
  if (row.meteringMode === "UNKNOWN") provNotes.push("The metering arrangement (net metering, net billing, gross metering) is not recorded for this plan.");
  const provenance = reference<null>(null, {
    provider: origin === "CURATED" ? PROVIDER : "user",
    source: row.source,
    dataType: "tariff_plan",
    notes: provNotes,
    now,
  }).provenance;

  return {
    id: row.id,
    origin,
    name: row.name,
    state: row.state,
    discom: row.discom,
    category: row.category,
    consumerType: row.consumerType,
    touBlocks,
    slabs,
    hourlyRates: hourlyRates(touBlocks),
    fixedCharge,
    export: { rate: row.exportRate, basis: row.exportRateBasis, meteringMode: row.meteringMode },
    source: row.source,
    sourceUrl: row.sourceUrl,
    tariffYear: row.tariffYear,
    effectiveFrom: day(row.effectiveFrom),
    effectiveTo: day(row.effectiveTo),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    validity,
    notes,
    provenance,
  };
}

/** A plan is visible to its owner, and curated plans to everyone. Anything else is "not found", never "forbidden". */
function visible(userId: string | null): Prisma.TariffPlanWhereInput {
  return { deletedAt: null, OR: userId ? [{ ownerId: null }, { ownerId: userId }] : [{ ownerId: null }] };
}

export async function listTariffs(db: Db, userId: string | null, filter: TariffFilter, now: Date): Promise<TariffPlanDto[]> {
  const scope = filter.scope ?? "all";
  const where: Prisma.TariffPlanWhereInput = { AND: [visible(userId)] };
  const and = where.AND as Prisma.TariffPlanWhereInput[];
  if (scope === "curated") and.push({ ownerId: null });
  if (scope === "mine") and.push(userId ? { ownerId: userId } : { id: { in: [] } });
  if (filter.state) and.push({ state: filter.state });
  if (filter.discom) and.push({ discom: { contains: filter.discom, mode: "insensitive" } });
  if (filter.consumerType) and.push({ consumerType: filter.consumerType });
  const rows = await db.tariffPlan.findMany({ where, orderBy: [{ ownerId: { sort: "asc", nulls: "first" } }, { state: "asc" }, { name: "asc" }], take: 200 });
  return rows.map((r) => toTariffDto(r, now));
}

export async function getTariffRow(db: Db, userId: string | null, id: string): Promise<TariffRow> {
  const row = await db.tariffPlan.findFirst({ where: { id, ...visible(userId) } });
  if (!row) throw new AppError("NOT_FOUND", "No such tariff.");
  return row;
}

export async function getTariff(db: Db, userId: string | null, id: string, now: Date): Promise<TariffPlanDto> {
  return toTariffDto(await getTariffRow(db, userId, id), now);
}

const MAX_PLANS_PER_USER = 50;

export async function createTariff(db: Db, userId: string, input: TariffInput, now: Date): Promise<TariffPlanDto> {
  const shape = shapeOf(input);
  const problems = validateShape(shape);
  if (problems.length) throw new AppError("VALIDATION_FAILED", `The tariff is not usable: ${problems.join(" ")}`);
  if ((await db.tariffPlan.count({ where: { ownerId: userId, deletedAt: null } })) >= MAX_PLANS_PER_USER) {
    throw new AppError("VALIDATION_FAILED", `You can keep up to ${MAX_PLANS_PER_USER} tariffs. Delete one you no longer need first.`);
  }
  const hasExport = input.exportRate !== undefined;
  const row = await db.tariffPlan.create({
    data: {
      ownerId: userId,
      name: input.name,
      state: input.state ?? null,
      discom: input.discom ?? null,
      category: input.category ?? null,
      consumerType: input.consumerType,
      touBlocks: shape.touBlocks as unknown as Prisma.InputJsonValue,
      slabs: (shape.slabs as unknown as Prisma.InputJsonValue | null) ?? undefined,
      fixedChargeInr: shape.fixedCharge?.amountInr ?? null,
      fixedChargeBasis: shape.fixedCharge?.basis ?? null,
      exportRate: hasExport ? input.exportRate : null,
      exportRateBasis: hasExport ? "USER_ENTERED" : "NONE",
      meteringMode: input.meteringMode ?? "UNKNOWN",
      source: input.source ?? "Entered by you",
      effectiveFrom: input.effectiveFrom ? new Date(`${input.effectiveFrom}T00:00:00Z`) : null,
      effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00Z`) : null,
      notes: (input.notes ? [input.notes] : []) as Prisma.InputJsonValue,
      verifiedAt: now,
    },
  });
  return toTariffDto(row, now);
}

/** Only the owner can delete a plan, and curated plans cannot be deleted here. Properties and twins that used it keep working. */
export async function deleteTariff(db: Db, userId: string, id: string): Promise<void> {
  const { count } = await db.tariffPlan.deleteMany({ where: { id, ownerId: userId } });
  if (count === 0) throw new AppError("NOT_FOUND", "No such tariff of yours.");
}

/** Choose (or clear, with null) the tariff for one of the caller's properties. The plan must be visible to the caller. */
export async function selectPropertyTariff(db: Db, userId: string, propertyId: string, planId: string | null): Promise<void> {
  const property = await db.property.findFirst({ where: { id: propertyId, ownerId: userId, deletedAt: null }, select: { id: true } });
  if (!property) throw new AppError("NOT_FOUND", "No such property.");
  if (planId !== null) await getTariffRow(db, userId, planId);
  await db.property.update({ where: { id: propertyId }, data: { tariffPlanId: planId } });
}

export interface BillResult {
  tariffId: string;
  bill: Bill;
  /** What the figures assume and leave out, including a warning when the plan's validity period has ended. */
  assumptions: string[];
  total: Measured<number>;
  energyCharge: Measured<number>;
  fixedCharge: Measured<number>;
  validity: ReturnType<typeof validityOn>;
}

/**
 * An estimated monthly bill. ESTIMATED, not REFERENCE: the rates are looked up, but the consumption is an input the caller
 * supplied, so the result is a calculation from stated assumptions and not a bill anybody issued.
 */
export function billFor(plan: TariffPlanDto, input: { monthlyKwh: number; hourShare?: number[]; sanctionedLoadKw?: number }, now: Date): BillResult {
  let bill: Bill;
  try {
    bill = computeBill({ touBlocks: plan.touBlocks, slabs: plan.slabs, fixedCharge: plan.fixedCharge }, input);
  } catch (e) {
    throw new AppError("VALIDATION_FAILED", e instanceof Error ? e.message : "The bill could not be computed.");
  }
  const notes = [...bill.assumptions];
  if (plan.validity.status !== "WITHIN" && plan.validity.status !== "OPEN_ENDED") notes.unshift(plan.validity.message);
  const common = { provider: "avishkar-tariff-engine", source: plan.source, dataType: "monthly_bill", unit: "INR", basis: `${input.monthlyKwh} kWh a month priced with ${plan.name}`, now, notes } as const;
  const total = estimated(bill.totalInr, { ...common });
  const energyCharge = estimated(bill.energyChargeInr, { ...common, dataType: "monthly_energy_charge" });
  const fixedCharge: Measured<number> =
    bill.fixedChargeInr === null
      ? { value: null, unit: "INR", provenance: { ...energyCharge.provenance, status: "UNAVAILABLE", dataType: "monthly_fixed_charge", notes: [plan.fixedCharge ? "Needs the sanctioned load." : "No fixed charge is recorded for this plan."] } }
      : estimated(bill.fixedChargeInr, { ...common, dataType: "monthly_fixed_charge" });
  return { tariffId: plan.id, bill, assumptions: notes, total, energyCharge, fixedCharge, validity: plan.validity };
}
