import { z } from "zod";
import { measured } from "../schemas.js";
import { UNITS } from "./parse.js";

export const ImportInput = z.object({
  csv: z.string().min(10).max(24_000_000).describe("The text of the CSV file: a header line, a timestamp column and one usage column."),
  filename: z.string().trim().max(200).optional(),
  unit: z.enum(UNITS as [string, ...string[]]).optional().describe("Needed only when the usage column's header does not say kWh, Wh, kW or W. AVISHKAR will not guess."),
});

export const ImportSchema = z
  .object({
    id: z.uuid(),
    filename: z.string().nullable(),
    uploadedAt: z.string(),
    rows: z.number().describe("Data rows in the file."),
    accepted: z.number().describe("Readings stored."),
    rejected: z.number().describe("Rows refused, each counted under a reason."),
    duplicates: z.number().describe("Readings whose time already existed for this property; the existing ones were kept."),
    intervalMinutes: z.number(),
    usageColumn: z.string(),
    unit: z.string(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    rejectedByReason: z.record(z.string(), z.number()),
    gaps: z.object({ missingIntervals: z.number(), longestGapMinutes: z.number() }),
    notes: z.array(z.string()),
  })
  .meta({ id: "EnergyImport" });

const GapSchema = z.object({ what: z.string(), reason: z.string() });

export const EnergyDnaSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    computedAt: z.string(),
    period: z.object({ from: z.string(), to: z.string(), completeDays: z.number(), totalDays: z.number(), intervalMinutes: z.number() }),
    baseline: z.object({
      meanDailyKwh: measured(z.number()),
      weekdayDailyKwh: measured(z.number()),
      weekendDailyKwh: measured(z.number()),
      baseloadKw: measured(z.number()),
      peakKw: measured(z.number()),
      peakHour: measured(z.number()),
    }),
    patterns: z.object({
      hourlyKw: z.array(z.number()).length(24),
      weekdayHourlyKw: z.array(z.number()).length(24).nullable(),
      weekendHourlyKw: z.array(z.number()).length(24).nullable(),
      monthlyDailyKwh: z.record(z.string(), z.number()),
    }),
    unavailable: z.array(GapSchema),
  })
  .meta({ id: "EnergyDna" });

export const ImportResultSchema = z.object({
  import: ImportSchema,
  dna: EnergyDnaSchema.nullable(),
  dnaUnavailableReason: z.string().nullable().describe("Why no Energy DNA was built from the readings, when none was."),
});

export const EnergySummarySchema = z.object({
  imports: z.array(ImportSchema),
  coverage: z.object({ observations: z.number(), from: z.string(), to: z.string(), days: z.number(), intervalMinutes: z.number() }).nullable(),
  dailyKwh: z.array(z.object({ date: z.string(), kwh: z.number(), readings: z.number(), expectedReadings: z.number(), complete: z.boolean() })).describe("Local-day totals of what was read: a day that is not complete is a partial total, not a day's consumption."),
  dna: EnergyDnaSchema.nullable(),
  dnaUnavailableReason: z.string().nullable(),
});
