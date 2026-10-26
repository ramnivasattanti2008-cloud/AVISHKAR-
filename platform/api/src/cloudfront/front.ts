/**
 * The arithmetic of the cloud-front scenario (spec section 75). Pure: the time of "now" and every size is an input.
 *
 * AVISHKAR has no cloud nowcast (a Sentinel-2 revisit of days cannot see a front 40 minutes away: see `/api/cloud-nowcast`), so a
 * front is never observed here. It is a scenario the person sets (when it arrives, how much sun it takes, how long it lasts),
 * and everything that follows from it comes from the planner.
 */
import { HOUR_MS, local } from "../plan/horizon.js";

export interface FrontShape {
  /** Minutes from now until the front's leading edge reaches the property. */
  arrivalMinutes: number;
  /** Share of the sun lost while it is overhead, 0 to 100. */
  reductionPercent: number;
  /** How long it takes to pass, in hours. */
  durationHours: number;
}

/**
 * The share of the forecast sun that remains in each plan step (1 is untouched). A step the front covers for part of the hour loses
 * that part of the reduction: arrival at 13:32 with a 22% cut leaves 1 - 0.22 x 28/60 of the 13:00 hour.
 */
export function frontScale(nowMs: number, startMs: number, steps: number, f: FrontShape): number[] {
  const from = nowMs + f.arrivalMinutes * 60_000;
  const to = from + f.durationHours * HOUR_MS;
  const r = f.reductionPercent / 100;
  return Array.from({ length: steps }, (_, i) => {
    const a = startMs + i * HOUR_MS;
    const covered = Math.max(0, Math.min(a + HOUR_MS, to) - Math.max(a, from)) / HOUR_MS;
    return 1 - r * covered;
  });
}

/** The first plan step that begins after the front has passed: the plan's "before and during the front" window is steps [0, this). */
export function stepsThroughFront(nowMs: number, startMs: number, steps: number, f: FrontShape): number {
  const to = nowMs + f.arrivalMinutes * 60_000 + f.durationHours * HOUR_MS;
  return Math.max(0, Math.min(steps, Math.ceil((to - startMs) / HOUR_MS)));
}

export type DemandLevel = "HIGH" | "NORMAL" | "LOW";
/** Evening is 18:00 to 22:00 local. The rule is stated with the answer: the evening's mean power against the whole horizon's mean. */
export const EVENING = { fromHour: 18, toHour: 22, highRatio: 1.25, lowRatio: 0.9 } as const;

export function eveningDemand(loadKw: number[], startMs: number): { level: DemandLevel; eveningMeanKw: number; meanKw: number; ratio: number } | null {
  const evening: number[] = [];
  loadKw.forEach((kw, i) => {
    const h = local(startMs + i * HOUR_MS).hour;
    if (h >= EVENING.fromHour && h < EVENING.toHour) evening.push(kw);
  });
  const mean = loadKw.reduce((a, b) => a + b, 0) / (loadKw.length || 1);
  if (evening.length === 0 || mean <= 0) return null;
  const eveningMean = evening.reduce((a, b) => a + b, 0) / evening.length;
  const ratio = eveningMean / mean;
  return { level: ratio >= EVENING.highRatio ? "HIGH" : ratio < EVENING.lowRatio ? "LOW" : "NORMAL", eveningMeanKw: eveningMean, meanKw: mean, ratio };
}

export type AdviceCode = "CHARGE_NOW" | "HOLD_CHARGE" | "NO_CHANGE" | "NO_BATTERY";
/** Below this, a difference between two plans is rounding, not a change of action. */
export const MIN_ACTION_KWH = 0.1;

export interface Advice {
  code: AdviceCode;
  text: string;
  /** Extra kWh the plan that knows about the front charges (or keeps back) in the window, against the one that does not. */
  extraChargeKwh: number;
  extraHeldKwh: number;
}

/**
 * What the plan does differently because it knows the front is coming, read from the two plans over the same window. Charging more
 * is "charge now"; discharging less is "hold the charge"; neither is "no change", and that is said as plainly.
 */
export function advise(hasBattery: boolean, window: number, informed: { chargeKw: number[]; dischargeKw: number[] }, unaware: { chargeKw: number[]; dischargeKw: number[] }): Advice {
  if (!hasBattery) {
    return { code: "NO_BATTERY", text: "There is no battery to charge: the front can only change when flexible loads run, and the figures below show what it costs.", extraChargeKwh: 0, extraHeldKwh: 0 };
  }
  const sum = (a: number[]) => a.slice(0, window).reduce((x, y) => x + y, 0);
  const extraCharge = sum(informed.chargeKw) - sum(unaware.chargeKw);
  const extraHeld = sum(unaware.dischargeKw) - sum(informed.dischargeKw);
  const r = (v: number) => Math.round(v * 100) / 100;
  if (extraCharge >= MIN_ACTION_KWH) {
    return { code: "CHARGE_NOW", text: `Charge the battery now: knowing the front is coming, the plan stores ${r(extraCharge)} kWh more before and during it than it would otherwise.`, extraChargeKwh: r(extraCharge), extraHeldKwh: r(Math.max(extraHeld, 0)) };
  }
  if (extraHeld >= MIN_ACTION_KWH) {
    return { code: "HOLD_CHARGE", text: `Hold the battery's charge: knowing the front is coming, the plan discharges ${r(extraHeld)} kWh less before and during it, keeping it for after.`, extraChargeKwh: 0, extraHeldKwh: r(extraHeld) };
  }
  return { code: "NO_CHANGE", text: "No change: the plan does the same with or without the front, because the battery was already going to be used this way.", extraChargeKwh: 0, extraHeldKwh: 0 };
}
