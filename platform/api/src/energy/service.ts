import { createHash } from "node:crypto";
import type { z } from "zod";
import { ownProperty } from "../assets/service.js";
import type { Db } from "../db.js";
import { AppError } from "../errors.js";
import type { EnergyDna, EnergyImport, Prisma } from "../generated/prisma/client.js";
import { estimated, unavailable } from "../provenance/index.js";
import { type DnaResult, computeDna } from "./dna.js";
import { MeterFileError, type RejectReason, type Unit, describeRejects, parseMeterFile } from "./parse.js";
import type { ImportInput } from "./schemas.js";

const CHUNK = 5000;
/** Only the last five years of readings are used for the fingerprint. */
const DNA_WINDOW_DAYS = 5 * 366;
const MAX_IMPORTS_PER_PROPERTY = 100;

const iso = (d: Date | null) => d?.toISOString() ?? null;

export interface ImportDto {
  id: string;
  filename: string | null;
  uploadedAt: string;
  rows: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  intervalMinutes: number;
  usageColumn: string;
  unit: string;
  from: string | null;
  to: string | null;
  rejectedByReason: Record<string, number>;
  gaps: { missingIntervals: number; longestGapMinutes: number };
  notes: string[];
}

export function toImportDto(r: EnergyImport): ImportDto {
  const q = (r.quality ?? {}) as { rejectedByReason?: Record<string, number>; gaps?: ImportDto["gaps"] };
  return {
    id: r.id,
    filename: r.filename,
    uploadedAt: r.uploadedAt.toISOString(),
    rows: r.rows,
    accepted: r.accepted,
    rejected: r.rejected,
    duplicates: r.duplicates,
    intervalMinutes: r.intervalMinutes,
    usageColumn: r.usageColumn,
    unit: r.unit,
    from: iso(r.fromTs),
    to: iso(r.toTs),
    rejectedByReason: q.rejectedByReason ?? {},
    gaps: q.gaps ?? { missingIntervals: 0, longestGapMinutes: 0 },
    notes: Array.isArray(r.notes) ? (r.notes as string[]) : [],
  };
}

interface DnaPatterns {
  hourly: number[];
  weekdayHourly: number[] | null;
  weekendHourly: number[] | null;
  monthlyDailyKwh: Record<string, number>;
  intervalMinutes: number;
  totalDays: number;
}

/** The labelled view of a stored fingerprint. Every figure is ESTIMATED and says which days it came from. */
export function toDnaDto(r: EnergyDna) {
  const p = r.patterns as unknown as DnaPatterns;
  const from = r.fromTs.toISOString().slice(0, 10);
  const to = r.toTs.toISOString().slice(0, 10);
  const base = { provider: "avishkar-energy-dna", source: "Your imported meter readings", now: r.computedAt };
  const basis = `${r.completeDays} complete days of your meter readings, ${from} to ${to}`;
  const est = (value: number, dataType: string, unit: string) => estimated(value, { ...base, dataType, unit, basis });
  const need = (value: number | null, dataType: string, unit: string, reason: string) => (value === null ? unavailable<number>(reason, { ...base, dataType, unit }) : est(value, dataType, unit));
  return {
    id: r.id,
    version: r.version,
    computedAt: r.computedAt.toISOString(),
    period: { from: r.fromTs.toISOString(), to: r.toTs.toISOString(), completeDays: r.completeDays, totalDays: p.totalDays, intervalMinutes: p.intervalMinutes },
    baseline: {
      meanDailyKwh: est(r.meanDailyKwh, "mean_daily_load", "kWh/day"),
      weekdayDailyKwh: need(r.weekdayDailyKwh, "weekday_daily_load", "kWh/day", "Fewer than two complete weekdays."),
      weekendDailyKwh: need(r.weekendDailyKwh, "weekend_daily_load", "kWh/day", "Fewer than two complete weekend days: one day is not a pattern."),
      baseloadKw: est(r.baseloadKw, "baseload", "kW"),
      peakKw: est(r.peakKw, "peak_load", "kW"),
      peakHour: est(r.peakHour, "peak_hour", "hour of day"),
    },
    patterns: { hourlyKw: p.hourly, weekdayHourlyKw: p.weekdayHourly, weekendHourlyKw: p.weekendHourly, monthlyDailyKwh: p.monthlyDailyKwh },
    unavailable: (Array.isArray(r.unavailable) ? r.unavailable : []) as { what: string; reason: string }[],
  };
}

/**
 * Rebuild the property's Energy DNA from every reading it has. A new version is stored when there is enough data; when there is
 * not, nothing is stored and the reason is returned (an older version, if any, is left for the caller to decide about).
 */
export async function recomputeDna(db: Db, propertyId: string, now: Date): Promise<{ row: EnergyDna | null; reason: string | null }> {
  const since = new Date(now.getTime() - DNA_WINDOW_DAYS * 86_400_000);
  const rows = await db.energyObservation.findMany({ where: { propertyId, ts: { gte: since } }, select: { ts: true, importKwh: true, intervalMinutes: true }, orderBy: { ts: "asc" } });
  const out = computeDna(rows.map((r) => ({ ts: r.ts, kwh: r.importKwh, intervalMinutes: r.intervalMinutes })));
  if (!out.ok) return { row: null, reason: out.reason };
  const d: DnaResult = out.dna;
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await db.energyDna.findFirst({ where: { propertyId }, orderBy: { version: "desc" }, select: { version: true } });
    try {
      const row = await db.energyDna.create({
        data: {
          propertyId,
          version: (last?.version ?? 0) + 1,
          computedAt: now,
          fromTs: d.fromTs,
          toTs: d.toTs,
          completeDays: d.completeDays,
          meanDailyKwh: d.meanDailyKwh,
          weekdayDailyKwh: d.weekdayDailyKwh,
          weekendDailyKwh: d.weekendDailyKwh,
          peakKw: d.peakKw,
          peakHour: d.peakHour,
          baseloadKw: d.baseloadKw,
          patterns: { ...d.patterns, intervalMinutes: d.intervalMinutes, totalDays: d.totalDays } as unknown as Prisma.InputJsonValue,
          unavailable: d.unavailable as unknown as Prisma.InputJsonValue,
        },
      });
      return { row, reason: null };
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002" || attempt === 2) throw e; // two recomputations raced for one version number
    }
  }
  return { row: null, reason: "The fingerprint could not be stored; try again." };
}

export async function latestDna(db: Db, propertyId: string): Promise<EnergyDna | null> {
  return db.energyDna.findFirst({ where: { propertyId }, orderBy: { version: "desc" } });
}

/**
 * Read a meter file, keep the readings that pass the checks, and rebuild the Energy DNA. The same file twice is refused; readings
 * whose time already exists are left as they were, and counted. Every row of the file ends up in exactly one of three counts:
 * accepted, rejected (with a reason) or duplicate.
 */
export async function importMeterData(db: Db, userId: string, propertyId: string, input: z.infer<typeof ImportInput>, now: Date) {
  await ownProperty(db, userId, propertyId);
  let parsed;
  try {
    parsed = parseMeterFile(input.csv, { now, unit: input.unit as Unit | undefined });
  } catch (e) {
    if (e instanceof MeterFileError) throw new AppError("VALIDATION_FAILED", e.message);
    throw e;
  }
  const sha256 = createHash("sha256").update(input.csv).digest("hex");
  const same = await db.energyImport.findUnique({ where: { propertyId_sha256: { propertyId, sha256 } }, select: { uploadedAt: true } });
  if (same) throw new AppError("CONFLICT", `This exact file was already imported on ${same.uploadedAt.toISOString().slice(0, 10)}. Delete that import first if you want to load it again.`);
  if ((await db.energyImport.count({ where: { propertyId } })) >= MAX_IMPORTS_PER_PROPERTY) throw new AppError("VALIDATION_FAILED", `A property can keep ${MAX_IMPORTS_PER_PROPERTY} imports. Delete old ones first.`);

  const from = parsed.readings[0]!.ts;
  const to = parsed.readings[parsed.readings.length - 1]!.ts;
  const rejected = Object.values(parsed.rejected).reduce((a, b) => a + (b ?? 0), 0);
  const notes = [...parsed.notes];
  if (rejected) notes.push(`Rows refused: ${describeRejects(parsed.rejected)}.`);

  const row = await db.$transaction(async (tx) => {
    const existing = new Set((await tx.energyObservation.findMany({ where: { propertyId, ts: { gte: from, lte: to } }, select: { ts: true } })).map((o) => o.ts.getTime()));
    const fresh = parsed.readings.filter((r) => !existing.has(r.ts.getTime()));
    const duplicates = parsed.readings.length - fresh.length;
    if (duplicates) notes.push(`${duplicates} reading${duplicates === 1 ? "" : "s"} already existed for those times and were kept as they were.`);
    const imp = await tx.energyImport.create({
      data: {
        propertyId,
        filename: input.filename ?? null,
        sha256,
        rows: parsed.rows,
        accepted: fresh.length,
        rejected,
        duplicates,
        intervalMinutes: parsed.intervalMinutes,
        usageColumn: parsed.usageColumn,
        unit: parsed.unit,
        fromTs: from,
        toTs: to,
        quality: { rejectedByReason: parsed.rejected as Record<RejectReason, number>, gaps: parsed.gaps } as unknown as Prisma.InputJsonValue,
        notes: notes as unknown as Prisma.InputJsonValue,
        uploadedAt: now,
      },
    });
    for (let i = 0; i < fresh.length; i += CHUNK) {
      await tx.energyObservation.createMany({
        data: fresh.slice(i, i + CHUNK).map((r) => ({ propertyId, importId: imp.id, ts: r.ts, intervalMinutes: parsed.intervalMinutes, importKwh: r.kwh })),
        skipDuplicates: true,
      });
    }
    return imp;
  }, { timeout: 120_000, maxWait: 10_000 });

  const dna = await recomputeDna(db, propertyId, now);
  return { import: toImportDto(row), dna: dna.row ? toDnaDto(dna.row) : null, dnaUnavailableReason: dna.reason };
}

export async function listImports(db: Db, userId: string, propertyId: string): Promise<ImportDto[]> {
  await ownProperty(db, userId, propertyId);
  return (await db.energyImport.findMany({ where: { propertyId }, orderBy: { uploadedAt: "desc" } })).map(toImportDto);
}

/** Delete an import and every reading it brought. The fingerprint was built from those readings, so it is rebuilt from what is left. */
export async function deleteImport(db: Db, userId: string, propertyId: string, importId: string, now: Date): Promise<void> {
  await ownProperty(db, userId, propertyId);
  const { count } = await db.energyImport.deleteMany({ where: { id: importId, propertyId } });
  if (count === 0) throw new AppError("NOT_FOUND", "No such import.");
  await db.energyDna.deleteMany({ where: { propertyId } });
  await recomputeDna(db, propertyId, now);
}

interface DayRow {
  day: string;
  kwh: number;
  n: number;
  interval: number;
}

export async function energySummary(db: Db, userId: string, propertyId: string) {
  await ownProperty(db, userId, propertyId);
  const [imports, agg, days, dna] = await Promise.all([
    db.energyImport.findMany({ where: { propertyId }, orderBy: { uploadedAt: "desc" } }),
    db.energyObservation.aggregate({ where: { propertyId }, _count: { _all: true }, _min: { ts: true, intervalMinutes: true }, _max: { ts: true } }),
    db.$queryRaw<DayRow[]>`
      SELECT to_char((ts AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day,
             SUM(import_kwh)::float8 AS kwh, COUNT(*)::int AS n, MIN(interval_minutes)::int AS interval
      FROM energy_observations WHERE property_id = ${propertyId}::uuid
      GROUP BY 1 ORDER BY 1 DESC LIMIT 400`,
    latestDna(db, propertyId),
  ]);
  const count = agg._count._all;
  const dailyKwh = days
    .map((d) => {
      const expected = Math.round(1440 / d.interval);
      return { date: d.day, kwh: Math.round(d.kwh * 1000) / 1000, readings: d.n, expectedReadings: expected, complete: d.n >= 0.95 * expected };
    })
    .reverse();
  let reason: string | null = null;
  if (!dna) reason = count === 0 ? "Import a meter file to build your Energy DNA." : (await recomputeReason(db, propertyId));
  return {
    imports: imports.map(toImportDto),
    coverage:
      count > 0
        ? { observations: count, from: agg._min.ts!.toISOString(), to: agg._max.ts!.toISOString(), days: days.length, intervalMinutes: agg._min.intervalMinutes! }
        : null,
    dailyKwh,
    dna: dna ? toDnaDto(dna) : null,
    dnaUnavailableReason: reason,
  };
}

/** Why there is no fingerprint although readings exist: run the computation and report its refusal. */
async function recomputeReason(db: Db, propertyId: string): Promise<string> {
  const rows = await db.energyObservation.findMany({ where: { propertyId }, select: { ts: true, importKwh: true, intervalMinutes: true }, orderBy: { ts: "asc" } });
  const out = computeDna(rows.map((r) => ({ ts: r.ts, kwh: r.importKwh, intervalMinutes: r.intervalMinutes })));
  return out.ok ? "The fingerprint is being rebuilt; refresh in a moment." : out.reason;
}
