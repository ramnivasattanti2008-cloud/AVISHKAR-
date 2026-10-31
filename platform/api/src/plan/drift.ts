import type { Db } from "../db.js";
import type { PlanDriftDto } from "./schemas.js";
import { getPlan, requireOwner } from "./service.js";

/** One plan hour that has ended and is fully covered by meter readings. */
export interface ComparedHour {
  time: string;
  plannedKwh: number;
  observedKwh: number;
}

interface Reading {
  ts: Date;
  intervalMinutes: number;
  importKwh: number;
}

/**
 * Pair each plan step that ended by `now` with the readings inside it. A step counts only when its readings cover it exactly
 * (minutes add up to the step, none spills over its end): a partly read hour is left out, never filled in.
 * Planned energy is the plan's demand forecast for the step (`loadKw` x step length), the same quantity the meter reports.
 */
export function compareHours(times: string[], loadKw: number[], stepHours: number, readings: Reading[], now: Date): ComparedHour[] {
  const stepMs = stepHours * 3_600_000;
  const out: ComparedHour[] = [];
  for (let i = 0; i < Math.min(times.length, loadKw.length); i++) {
    const start = Date.parse(times[i]!);
    const end = start + stepMs;
    if (end > now.getTime()) break;
    let minutes = 0;
    let kwh = 0;
    let spills = false;
    for (const r of readings) {
      const t = r.ts.getTime();
      if (t < start || t >= end) continue;
      if (t + r.intervalMinutes * 60_000 > end) spills = true;
      minutes += r.intervalMinutes;
      kwh += r.importKwh;
    }
    if (spills || Math.abs(minutes - stepHours * 60) > 1e-6) continue;
    out.push({ time: times[i]!, plannedKwh: loadKw[i]! * stepHours, observedKwh: kwh });
  }
  return out;
}

/** Signed drift of the metered total from the planned total, in percent (positive: more was used than planned). */
export function calculateDrift(
  plannedKwh: number,
  observedKwh: number,
  thresholdPercent = 15,
): { driftPercent: number; replanRecommended: boolean } {
  const driftPercent = Math.round(((observedKwh - plannedKwh) / plannedKwh) * 1000) / 10;
  return { driftPercent, replanRecommended: Math.abs(driftPercent) > thresholdPercent };
}

/** Below this much planned energy a percentage says nothing useful. */
const MIN_PLANNED_KWH = 0.1;

/**
 * Compare the latest plan's demand forecast with the meter readings imported for the hours of it that have passed. The
 * tolerance is a setting, not a fact about the property. Not your property reads as missing (404).
 */
export async function checkPlanDrift(db: Db, userId: string, propertyId: string, now: Date, thresholdPercent = 15): Promise<PlanDriftDto> {
  const evaluatedAt = now.toISOString();
  const empty = { driftPercent: null, replanRecommended: false, hoursCompared: 0, plannedKwh: null, observedKwh: null, evaluatedAt, thresholdPercent };
  await requireOwner(db, userId, propertyId);
  if ((await db.optimizationRun.count({ where: { propertyId } })) === 0) {
    return { ...empty, status: "NO_PLAN", planId: null, reason: "No plan has been made for this property yet." };
  }
  const plan = await getPlan(db, userId, propertyId);
  const { times, loadKw } = plan.schedule;
  const start = new Date(plan.horizon.start);
  const end = new Date(start.getTime() + plan.horizon.steps * plan.horizon.stepHours * 3_600_000);
  const readings = await db.energyObservation.findMany({
    where: { propertyId, ts: { gte: start, lt: end } },
    orderBy: { ts: "asc" },
    select: { ts: true, intervalMinutes: true, importKwh: true },
  });
  const hours = compareHours(times, loadKw, plan.horizon.stepHours, readings, now);
  const plannedKwh = hours.reduce((a, h) => a + h.plannedKwh, 0);
  const observedKwh = hours.reduce((a, h) => a + h.observedKwh, 0);
  const round = (x: number) => Math.round(x * 1000) / 1000;

  if (hours.length < 2) {
    return {
      ...empty,
      status: "INSUFFICIENT_OBSERVATIONS",
      planId: plan.id,
      hoursCompared: hours.length,
      reason: `Only ${hours.length} hour${hours.length === 1 ? "" : "s"} of this plan ${hours.length === 1 ? "has" : "have"} passed with complete meter readings; at least 2 are needed.`,
    };
  }
  if (plannedKwh < MIN_PLANNED_KWH) {
    return {
      ...empty,
      status: "INSUFFICIENT_OBSERVATIONS",
      planId: plan.id,
      hoursCompared: hours.length,
      plannedKwh: round(plannedKwh),
      observedKwh: round(observedKwh),
      reason: `The plan expected almost no demand (${round(plannedKwh)} kWh) in the ${hours.length} hours compared, so a percentage would mean nothing.`,
    };
  }
  const { driftPercent, replanRecommended } = calculateDrift(plannedKwh, observedKwh, thresholdPercent);
  const dir = driftPercent >= 0 ? "more" : "less";
  return {
    status: replanRecommended ? "DRIFT_DETECTED" : "ON_TRACK",
    planId: plan.id,
    driftPercent,
    replanRecommended,
    hoursCompared: hours.length,
    plannedKwh: round(plannedKwh),
    observedKwh: round(observedKwh),
    thresholdPercent,
    reason: `Over ${hours.length} hours the meter read ${round(observedKwh)} kWh against ${round(plannedKwh)} kWh planned (${Math.abs(driftPercent)}% ${dir}); ${
      replanRecommended ? `that is beyond the ${thresholdPercent}% tolerance, so a new plan is suggested.` : `that is within the ${thresholdPercent}% tolerance.`
    }`,
    evaluatedAt,
  };
}
