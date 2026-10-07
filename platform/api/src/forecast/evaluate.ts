/**
 * Close the loop (spec sections 38 and 39): a stored load forecast is scored against what the meter later recorded for the same
 * hours, next to the plainest baseline (the same hour a week earlier). Pure arithmetic over stored forecasts and stored readings;
 * nothing is estimated or filled in: an hour with a reading missing is not scored.
 */
import type { Db } from "../db.js";
import { IST_OFFSET_MINUTES } from "../energy/parse.js";
import type { Prisma } from "../generated/prisma/client.js";

const HOUR = 3_600_000;
const WEEK_H = 168;
const OFFSET = IST_OFFSET_MINUTES * 60_000;
/** A forecast is scored when at least this many of its hours have a complete reading; fewer is not enough to say anything. */
export const MIN_SCORED_HOURS = 12;

export interface Reading {
  ts: Date;
  kwh: number;
  intervalMinutes: number;
}

/** Hourly mean power in kW by local-hour start, only for hours whose readings cover the whole hour. Pure. */
export function hourlyActuals(rows: Reading[]): Map<number, number> {
  const acc = new Map<number, { kwh: number; minutes: number }>();
  for (const r of rows) {
    if (r.intervalMinutes > 60 || 60 % r.intervalMinutes !== 0) continue; // cannot be placed in whole hours
    const t = r.ts.getTime();
    const hour = Math.floor((t + OFFSET) / HOUR) * HOUR - OFFSET;
    if (t + r.intervalMinutes * 60_000 > hour + HOUR) continue; // a reading that straddles two local hours is not used
    const a = acc.get(hour) ?? { kwh: 0, minutes: 0 };
    a.kwh += r.kwh;
    a.minutes += r.intervalMinutes;
    acc.set(hour, a);
  }
  const out = new Map<number, number>();
  for (const [h, a] of acc) if (a.minutes === 60) out.set(h, a.kwh);
  return out;
}

export interface ForecastSeries {
  times: string[];
  p10Kw: number[];
  p50Kw: number[];
  p90Kw: number[];
}

export interface Scores {
  hours: number;
  maeKw: number;
  rmseKw: number;
  wapePct: number | null;
  /** Mean of forecast minus actual: positive means the forecast ran high. */
  biasKw: number;
  coverage80: number;
  /** The same hour a week earlier, on the hours where it exists. */
  lastWeek: { hours: number; maeKw: number; modelMaeKw: number } | null;
  skillVsLastWeek: number | null;
}

const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;

/** Score a forecast against the hours that have a full reading. Null when too few hours can be scored. Pure. */
export function scoreLoad(f: ForecastSeries, actual: Map<number, number>): Scores | null {
  let n = 0;
  let abs = 0;
  let sq = 0;
  let bias = 0;
  let inside = 0;
  let total = 0;
  let wn = 0;
  let wAbs = 0;
  let wModel = 0;
  for (let i = 0; i < f.times.length; i++) {
    const t = Date.parse(f.times[i]!);
    const a = actual.get(t);
    if (a === undefined) continue;
    const e = f.p50Kw[i]! - a;
    n++;
    abs += Math.abs(e);
    sq += e * e;
    bias += e;
    total += Math.abs(a);
    if (a >= f.p10Kw[i]! && a <= f.p90Kw[i]!) inside++;
    const week = actual.get(t - WEEK_H * HOUR);
    if (week !== undefined) {
      wn++;
      wAbs += Math.abs(week - a);
      wModel += Math.abs(e);
    }
  }
  if (n < MIN_SCORED_HOURS) return null;
  const mae = abs / n;
  const lastWeek = wn >= MIN_SCORED_HOURS ? { hours: wn, maeKw: round(wAbs / wn), modelMaeKw: round(wModel / wn) } : null;
  return {
    hours: n,
    maeKw: round(mae),
    rmseKw: round(Math.sqrt(sq / n)),
    wapePct: total > 0 ? round((abs / total) * 100, 2) : null,
    biasKw: round(bias / n),
    coverage80: round(inside / n),
    lastWeek,
    skillVsLastWeek: lastWeek && lastWeek.maeKw > 0 ? round(1 - lastWeek.modelMaeKw / lastWeek.maeKw) : null,
  };
}

export type Evaluation = { status: "SCORED"; scoredAt: string; scores: Scores } | { status: "NOT_SCORABLE"; scoredAt: string; reason: string };

/**
 * Score every stored load forecast of a property whose whole horizon the meter data now covers. Each is scored once: a forecast
 * whose hours were mostly missing is closed as NOT_SCORABLE, with the reason, rather than left waiting for ever.
 */
export async function evaluateDueForecasts(db: Db, propertyId: string, now: Date): Promise<{ scored: number; notScorable: number; waiting: number }> {
  const runs = await db.forecastRun.findMany({ where: { propertyId, kind: "LOAD", evaluatedAt: null }, orderBy: { issuedAt: "asc" }, take: 200 });
  if (runs.length === 0) return { scored: 0, notScorable: 0, waiting: 0 };
  const last = await db.energyObservation.findFirst({ where: { propertyId }, orderBy: { ts: "desc" }, select: { ts: true, intervalMinutes: true } });
  const lastEnd = last ? last.ts.getTime() + last.intervalMinutes * 60_000 : 0;
  const out = { scored: 0, notScorable: 0, waiting: 0 };
  for (const run of runs) {
    const first = run.firstHour.getTime();
    const end = first + run.hours * HOUR;
    if (end > lastEnd) {
      out.waiting++;
      continue;
    }
    const rows = await db.energyObservation.findMany({
      where: { propertyId, ts: { gte: new Date(first - (WEEK_H + 1) * HOUR), lt: new Date(end) } },
      select: { ts: true, importKwh: true, intervalMinutes: true },
      orderBy: { ts: "asc" },
    });
    const series = run.series as unknown as ForecastSeries;
    const scores = scoreLoad(series, hourlyActuals(rows.map((r) => ({ ts: r.ts, kwh: r.importKwh, intervalMinutes: r.intervalMinutes }))));
    const evaluation: Evaluation = scores
      ? { status: "SCORED", scoredAt: now.toISOString(), scores }
      : { status: "NOT_SCORABLE", scoredAt: now.toISOString(), reason: `Fewer than ${MIN_SCORED_HOURS} of its ${run.hours} hours have a complete meter reading, so there is not enough to score it against.` };
    await db.forecastRun.update({ where: { id: run.id }, data: { evaluatedAt: now, evaluation: evaluation as unknown as Prisma.InputJsonValue } });
    if (scores) out.scored++;
    else out.notScorable++;
  }
  return out;
}
