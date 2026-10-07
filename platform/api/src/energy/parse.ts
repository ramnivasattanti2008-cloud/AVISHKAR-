/**
 * Reads a household's or business's own meter file into readings (spec sections 10 and 14).
 *
 * The rules, in order of importance:
 *  - Nothing is invented or repaired. A row that fails a check is counted under a named reason and left out; a gap stays a
 *    gap (the Python EMS fills short gaps for its own replay, the platform does not, because a stored reading must be a
 *    reading).
 *  - A unit is never guessed. kW and kWh differ by a factor of four for 15-minute data, so a usage column whose header does
 *    not say which it is must be told by the caller, and otherwise the file is refused with that explanation.
 *  - A timestamp is the START of its reading interval, and a timestamp with no offset is India Standard Time.
 */
import { parseCsv } from "./csv.js";

export type Unit = "kWh" | "Wh" | "kW" | "W";
export const UNITS: readonly Unit[] = ["kWh", "Wh", "kW", "W"];

/** India Standard Time, which has no daylight saving: UTC+5:30. */
export const IST_OFFSET_MINUTES = 330;
export const MAX_ROWS = 300_000;
/** A reading that implies more than this average power is not a home or a small business: refused, not clipped. */
export const MAX_KW = 5000;
/** Readings dated further than this beyond the upload time are refused. */
export const FUTURE_TOLERANCE_MS = 3_600_000;

export class MeterFileError extends Error {}

export interface Reading {
  /** Start of the interval, UTC. */
  ts: Date;
  /** Energy used in the interval, kWh. */
  kwh: number;
}

export type RejectReason = "bad_timestamp" | "missing_value" | "bad_value" | "negative_value" | "implausible_value" | "future_timestamp" | "duplicate_in_file";

export interface MeterParse {
  /** Accepted readings, oldest first, one per timestamp. */
  readings: Reading[];
  rows: number;
  rejected: Partial<Record<RejectReason, number>>;
  intervalMinutes: number;
  timestampColumn: string;
  usageColumn: string;
  unit: Unit;
  unitSource: "header" | "request";
  /** Intervals between the first and last reading that have no reading, and the longest run of them in minutes. */
  gaps: { missingIntervals: number; longestGapMinutes: number };
  notes: string[];
}

export interface ParseOptions {
  /** Required when the usage column's header does not state its unit. */
  unit?: Unit;
  now: Date;
  offsetMinutes?: number;
}

const TS_NAMES = ["timestamp", "datetime", "date_time", "date time", "date and time", "datetimestamp", "reading_time", "reading time", "x_timestamp", "start", "from", "time", "date"];
const USE_NAMES = ["load_kw", "kw", "power", "consumption", "usage", "kwh", "wh", "load", "energy", "t_kwh", "active_power", "import", "import_kwh", "units", "demand"];

/** The unit a header states, or null. kWh is tested before kW and Wh before W so "kWh" is never read as "kW". */
export function unitFromHeader(h: string): Unit | null {
  const s = h.toLowerCase();
  if (/kwh/.test(s)) return "kWh";
  if (/(^|[^k])wh\b|\(wh\)/.test(s) || s === "wh") return "Wh";
  if (/\bkw\b|\(kw\)|_kw$|^kw$/.test(s)) return "kW";
  if (/\(w\)|\bwatts?\b|^w$|_w$/.test(s)) return "W";
  return null;
}

/** A calendar date and time to a UTC instant, or null when the date does not exist (31 February, month 13, hour 25). */
function toInstant(y: number, mo: number, d: number, h: number, mi: number, s: number, offsetMinutes: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return new Date(utc - offsetMinutes * 60_000);
}

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[T ]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i;

/**
 * ISO 8601 (with or without an offset) or day-first dates such as 31/03/2026 14:30 (the Indian convention, also used by the
 * Python EMS). A timestamp with no offset is read in `defaultOffsetMinutes`. Anything else, including month-first guesses, is null.
 */
export function parseTimestamp(raw: string, defaultOffsetMinutes = IST_OFFSET_MINUTES): Date | null {
  const s = raw.trim();
  let m = ISO.exec(s);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", sec = "0", off] = m;
    let offset = defaultOffsetMinutes;
    if (off) {
      if (off.toUpperCase() === "Z") offset = 0;
      else {
        const sign = off.startsWith("-") ? -1 : 1;
        const digits = off.replace(/[+-]|:/g, "");
        offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
      }
    }
    return toInstant(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(sec), offset);
  }
  m = DMY.exec(s);
  if (m) {
    const [, d, mo, yy, h = "0", mi = "0", sec = "0", ampm] = m;
    let hour = Number(h);
    if (ampm) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (ampm.toUpperCase() === "PM" ? 12 : 0);
    }
    const year = yy!.length === 2 ? 2000 + Number(yy) : Number(yy);
    return toInstant(year, Number(mo), Number(d), hour, Number(mi), Number(sec), defaultOffsetMinutes);
  }
  return null;
}

/** A number as written in the file: "1,234.5" (thousands commas) or "12,5" (decimal comma, only when the delimiter is not a comma). */
export function parseNumber(raw: string, delimiter: string): number | null {
  let s = raw.trim();
  if (s === "") return null;
  if (/^-?\d{1,3}( \d{3})+([.,]\d+)?$/.test(s)) s = s.replace(/ /g, ""); // "1 234,5": a space is a thousands separator only in this exact shape
  if (delimiter !== "," && /^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

function pickColumn(header: string[], names: string[]): number {
  const low = header.map((h) => h.toLowerCase().trim());
  for (const n of names) {
    const i = low.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

export function parseMeterFile(text: string, opts: ParseOptions): MeterParse {
  const offset = opts.offsetMinutes ?? IST_OFFSET_MINUTES;
  const csv = parseCsv(text);
  if (csv.header.length === 0 || csv.rows.length === 0) throw new MeterFileError("The file has no data rows. It needs a header line and at least a few readings.");
  if (csv.rows.length > MAX_ROWS) throw new MeterFileError(`The file has ${csv.rows.length.toLocaleString("en-IN")} rows; the limit is ${MAX_ROWS.toLocaleString("en-IN")}. Split it by year and import the parts.`);
  const notes: string[] = [];

  // ---- columns
  let tsIdx = pickColumn(csv.header, TS_NAMES);
  let dateTimeFromTwo: [number, number] | null = null;
  const dateIdx = pickColumn(csv.header, ["date"]);
  const timeIdx = pickColumn(csv.header, ["time"]);
  if (dateIdx >= 0 && timeIdx >= 0 && dateIdx !== timeIdx && pickColumn(csv.header, TS_NAMES.filter((n) => n !== "date" && n !== "time")) < 0) {
    dateTimeFromTwo = [dateIdx, timeIdx];
    tsIdx = dateIdx;
    notes.push(`The date (“${csv.header[dateIdx]}”) and time (“${csv.header[timeIdx]}”) columns were combined.`);
  } else if (tsIdx < 0) {
    tsIdx = 0;
    notes.push(`No column is named like a timestamp, so the first column (“${csv.header[0]}”) was used.`);
  }
  let useIdx = pickColumn(csv.header, USE_NAMES);
  if (useIdx === tsIdx || useIdx < 0) {
    // headers like "Consumption (kWh)": match by a usage word or a stated unit
    useIdx = csv.header.findIndex((h, i) => i !== tsIdx && i !== (dateTimeFromTwo?.[1] ?? -1) && (unitFromHeader(h) !== null || /consum|usage|load|energy|power|import|demand|units/i.test(h)));
  }
  if (useIdx < 0) {
    const sample = csv.rows.slice(0, 50);
    useIdx = csv.header.findIndex((_, i) => i !== tsIdx && i !== (dateTimeFromTwo?.[1] ?? -1) && sample.length > 0 && sample.every((r) => (r[i] ?? "").trim() === "" || parseNumber(r[i]!, csv.delimiter) !== null));
    if (useIdx >= 0) notes.push(`No column is named like a usage column, so the first numeric one (“${csv.header[useIdx]}”) was used.`);
  }
  if (useIdx < 0) throw new MeterFileError("No usage column was found. Name it kWh, kW, consumption or usage, and give it a number in every row.");

  const usageColumn = csv.header[useIdx]!;
  const headerUnit = unitFromHeader(usageColumn);
  const unit = headerUnit ?? opts.unit;
  if (!unit) {
    throw new MeterFileError(
      `The usage column “${usageColumn}” does not say its unit. Tell AVISHKAR whether it is kWh, Wh, kW or W: guessing would be wrong by a factor of four for 15-minute readings.`,
    );
  }
  const unitSource = headerUnit ? "header" : "request";
  if (headerUnit && opts.unit && opts.unit !== headerUnit) {
    throw new MeterFileError(`You said the unit is ${opts.unit}, but the column “${usageColumn}” says ${headerUnit}. Fix one of them.`);
  }

  // ---- rows
  const rejected: Partial<Record<RejectReason, number>> = {};
  const reject = (r: RejectReason) => void (rejected[r] = (rejected[r] ?? 0) + 1);
  const raw: { ts: Date; value: number }[] = [];
  const futureLimit = opts.now.getTime() + FUTURE_TOLERANCE_MS;
  for (const r of csv.rows) {
    const tsText = dateTimeFromTwo ? `${r[dateTimeFromTwo[0]] ?? ""} ${r[dateTimeFromTwo[1]] ?? ""}` : (r[tsIdx] ?? "");
    const ts = parseTimestamp(tsText, offset);
    if (!ts) {
      reject("bad_timestamp");
      continue;
    }
    if (ts.getTime() > futureLimit) {
      reject("future_timestamp");
      continue;
    }
    const cell = r[useIdx] ?? "";
    if (cell.trim() === "") {
      reject("missing_value");
      continue;
    }
    const v = parseNumber(cell, csv.delimiter);
    if (v === null) {
      reject("bad_value");
      continue;
    }
    if (v < 0) {
      reject("negative_value");
      continue;
    }
    raw.push({ ts, value: v });
  }

  // ---- one reading per timestamp, oldest first
  raw.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const unique: { ts: Date; value: number }[] = [];
  for (const x of raw) {
    if (unique.length && unique[unique.length - 1]!.ts.getTime() === x.ts.getTime()) reject("duplicate_in_file");
    else unique.push(x);
  }
  if (unique.length < 3) throw new MeterFileError(`Only ${unique.length} usable reading${unique.length === 1 ? "" : "s"} found out of ${csv.rows.length} rows (${describeRejects(rejected) || "none refused"}). At least 3 are needed to work out the reading interval.`);

  // ---- interval
  const diffs: number[] = [];
  for (let i = 1; i < unique.length; i++) diffs.push((unique[i]!.ts.getTime() - unique[i - 1]!.ts.getTime()) / 60_000);
  const step = median(diffs);
  const intervalMinutes = Math.round(step);
  if (Math.abs(step - intervalMinutes) > 0.01 || intervalMinutes < 1) throw new MeterFileError(`The readings are about ${step.toFixed(2)} minutes apart, which is not a whole number of minutes, so the interval cannot be used.`);
  if (intervalMinutes > 1440) throw new MeterFileError("The readings are more than a day apart. AVISHKAR needs at least daily readings.");
  const irregular = diffs.filter((d) => Math.abs(d - intervalMinutes) > 0.01).length / diffs.length;
  if (irregular > 0.05) notes.push(`${Math.round(irregular * 100)}% of the readings are not exactly ${intervalMinutes} minutes after the previous one: the file has gaps or mixed intervals.`);

  // ---- energy per interval, kWh
  const toKwh = (v: number): number => {
    const hours = intervalMinutes / 60;
    switch (unit) {
      case "kWh":
        return v;
      case "Wh":
        return v / 1000;
      case "kW":
        return v * hours;
      case "W":
        return (v / 1000) * hours;
    }
  };
  const readings: Reading[] = [];
  for (const x of unique) {
    const kwh = toKwh(x.value);
    if ((kwh * 60) / intervalMinutes > MAX_KW) reject("implausible_value");
    else readings.push({ ts: x.ts, kwh });
  }
  if (readings.length < 3) throw new MeterFileError(`After the checks only ${readings.length} readings remain (${describeRejects(rejected)}).`);

  // ---- gaps
  const first = readings[0]!.ts.getTime();
  const last = readings[readings.length - 1]!.ts.getTime();
  const expected = Math.floor((last - first) / (intervalMinutes * 60_000)) + 1;
  let longest = 0;
  for (let i = 1; i < readings.length; i++) longest = Math.max(longest, (readings[i]!.ts.getTime() - readings[i - 1]!.ts.getTime()) / 60_000 - intervalMinutes);

  notes.push("Each timestamp is taken as the start of its reading interval.");
  if (!/[zZ]|[+-]\d{2}:?\d{2}\s*$/.test(csv.rows[0]?.[tsIdx] ?? "")) notes.push("Timestamps with no time zone were read as India Standard Time (UTC+5:30).");
  notes.push(unitSource === "header" ? `The unit (${unit}) was taken from the column header.` : `The unit (${unit}) is the one you stated; the column header does not give one.`);
  if (unit === "kW" || unit === "W") notes.push(`Power readings were turned into energy by multiplying by the ${intervalMinutes}-minute interval.`);

  return {
    readings,
    rows: csv.rows.length,
    rejected,
    intervalMinutes,
    timestampColumn: dateTimeFromTwo ? `${csv.header[dateTimeFromTwo[0]]} + ${csv.header[dateTimeFromTwo[1]]}` : csv.header[tsIdx]!,
    usageColumn,
    unit,
    unitSource,
    gaps: { missingIntervals: Math.max(expected - readings.length, 0), longestGapMinutes: Math.max(longest, 0) },
    notes,
  };
}

const REASON_TEXT: Record<RejectReason, string> = {
  bad_timestamp: "unreadable timestamp",
  missing_value: "empty usage",
  bad_value: "usage that is not a number",
  negative_value: "negative usage",
  implausible_value: `usage above ${MAX_KW} kW`,
  future_timestamp: "timestamp in the future",
  duplicate_in_file: "repeated timestamp",
};

export function describeRejects(r: Partial<Record<RejectReason, number>>): string {
  return Object.entries(r)
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${REASON_TEXT[k as RejectReason]}`)
    .join(", ");
}
