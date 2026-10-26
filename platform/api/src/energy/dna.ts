/**
 * Energy DNA (spec section 9): a fingerprint of how a property uses electricity, computed only from its own imported
 * readings. Plain statistics, no model, no filling: where the data cannot support a number it is absent and says why.
 *
 * Days are local (India Standard Time). A day is "complete" when at least 95% of its readings are present; its daily total is
 * then scaled by the missing share (at most 5%), which is the one estimate made, and the result is labelled ESTIMATED.
 */
import { IST_OFFSET_MINUTES } from "./parse.js";

export const MIN_COMPLETE_DAYS = 7;
export const COMPLETE_DAY_COVERAGE = 0.95;
export const MIN_MONTH_DAYS = 7;
/** Hourly patterns need at least hourly readings. */
export const MAX_DNA_INTERVAL_MINUTES = 60;

export interface Obs {
  ts: Date;
  kwh: number;
  intervalMinutes: number;
}

export interface Patterns {
  hourly: number[];
  weekdayHourly: number[] | null;
  weekendHourly: number[] | null;
  /** Mean daily kWh per month (YYYY-MM) for months with at least seven complete days. */
  monthlyDailyKwh: Record<string, number>;
}

export interface Gap {
  what: string;
  reason: string;
}

export interface DnaResult {
  fromTs: Date;
  toTs: Date;
  intervalMinutes: number;
  completeDays: number;
  totalDays: number;
  meanDailyKwh: number;
  weekdayDailyKwh: number | null;
  weekendDailyKwh: number | null;
  peakKw: number;
  peakHour: number;
  baseloadKw: number;
  patterns: Patterns;
  unavailable: Gap[];
}

export type DnaOutcome = { ok: true; dna: DnaResult } | { ok: false; reason: string };

const local = (d: Date) => new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
const dayKey = (l: Date) => l.toISOString().slice(0, 10);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/** Linear-interpolated percentile (0..1) of unsorted numbers. */
export function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

/** Monday is 0 ... Sunday is 6, from a local date key. */
function weekdayOf(key: string): number {
  return (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function computeDna(all: Obs[]): DnaOutcome {
  if (all.length === 0) return { ok: false, reason: "There are no meter readings yet." };

  // The dominant interval; readings at another interval are not mixed in.
  const byInterval = new Map<number, number>();
  for (const o of all) byInterval.set(o.intervalMinutes, (byInterval.get(o.intervalMinutes) ?? 0) + 1);
  const intervalMinutes = [...byInterval.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  if (intervalMinutes > MAX_DNA_INTERVAL_MINUTES) {
    return { ok: false, reason: `Your readings are ${intervalMinutes} minutes apart. A daily pattern needs readings at least hourly: coarser totals can give an average but not when the energy is used.` };
  }
  const obs = all.filter((o) => o.intervalMinutes === intervalMinutes);
  const perDay = 1440 / intervalMinutes;

  const days = new Map<string, Obs[]>();
  for (const o of obs) {
    const k = dayKey(local(o.ts));
    (days.get(k) ?? days.set(k, []).get(k)!).push(o);
  }
  const complete = [...days.entries()].filter(([, v]) => v.length >= COMPLETE_DAY_COVERAGE * perDay).sort(([a], [b]) => (a < b ? -1 : 1));
  if (complete.length < MIN_COMPLETE_DAYS) {
    return { ok: false, reason: `A usage fingerprint needs at least ${MIN_COMPLETE_DAYS} complete days (95% of the readings present). Your readings have ${complete.length} out of ${days.size} day${days.size === 1 ? "" : "s"}.` };
  }

  const kw = (o: Obs) => (o.kwh * 60) / o.intervalMinutes;
  const dailyKwh = new Map(complete.map(([k, v]) => [k, v.reduce((s, o) => s + o.kwh, 0) * (perDay / v.length)]));
  const completeObs = complete.flatMap(([, v]) => v);

  const hourlyOf = (sel: (key: string) => boolean): number[] | null => {
    const buckets: number[][] = Array.from({ length: 24 }, () => []);
    for (const [k, v] of complete) {
      if (!sel(k)) continue;
      for (const o of v) buckets[local(o.ts).getUTCHours()]!.push(kw(o));
    }
    return buckets.every((b) => b.length > 0) ? buckets.map((b) => round(mean(b))) : null;
  };
  const isWeekday = (k: string) => weekdayOf(k) < 5;
  const weekdayKeys = complete.map(([k]) => k).filter(isWeekday);
  const weekendKeys = complete.map(([k]) => k).filter((k) => !isWeekday(k));
  const hourly = hourlyOf(() => true);
  if (!hourly) return { ok: false, reason: "Some hours of the day have no readings at all, so a daily pattern cannot be built." };

  const months = new Map<string, number[]>();
  for (const [k, v] of dailyKwh) (months.get(k.slice(0, 7)) ?? months.set(k.slice(0, 7), []).get(k.slice(0, 7))!).push(v);
  const monthlyDailyKwh: Record<string, number> = {};
  for (const [m, v] of [...months.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) if (v.length >= MIN_MONTH_DAYS) monthlyDailyKwh[m] = round(mean(v));

  const peakKw = Math.max(...completeObs.map(kw));
  const peakHour = hourly.indexOf(Math.max(...hourly));
  const baseloadKw = Math.min(percentile(completeObs.map(kw), 0.1), peakKw);

  const unavailable: Gap[] = [
    { what: "Flexible consumption", reason: "Which part of the load can be moved needs the appliances: add them, with their flexibility, on the property." },
    { what: "Weather sensitivity", reason: "How use follows temperature needs a temperature history for the place, which AVISHKAR does not ingest yet." },
  ];
  const monthsCovered = new Set(complete.map(([k]) => k.slice(0, 7))).size;
  if (monthsCovered < 12) unavailable.push({ what: "Seasonal behaviour", reason: `Seasons need about a year of readings; these cover ${monthsCovered} calendar month${monthsCovered === 1 ? "" : "s"}.` });

  const first = obs.reduce((a, o) => (o.ts < a ? o.ts : a), obs[0]!.ts);
  const last = obs.reduce((a, o) => (o.ts > a ? o.ts : a), obs[0]!.ts);
  return {
    ok: true,
    dna: {
      fromTs: first,
      toTs: last,
      intervalMinutes,
      completeDays: complete.length,
      totalDays: days.size,
      meanDailyKwh: round(mean([...dailyKwh.values()])),
      weekdayDailyKwh: weekdayKeys.length >= 2 ? round(mean(weekdayKeys.map((k) => dailyKwh.get(k)!))) : null,
      weekendDailyKwh: weekendKeys.length >= 2 ? round(mean(weekendKeys.map((k) => dailyKwh.get(k)!))) : null,
      peakKw: round(peakKw),
      peakHour,
      baseloadKw: round(baseloadKw),
      patterns: {
        hourly,
        weekdayHourly: weekdayKeys.length >= 2 ? hourlyOf(isWeekday) : null,
        weekendHourly: weekendKeys.length >= 2 ? hourlyOf((k) => !isWeekday(k)) : null,
        monthlyDailyKwh,
      },
      unavailable,
    },
  };
}
