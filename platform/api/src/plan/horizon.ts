/**
 * The planning horizon on the India Standard Time clock, and the arithmetic that places things on it. Steps are whole local
 * hours, because that is how the tariff, the load profile and appliance windows are written. Pure: `now` is an input.
 */
import { IST_OFFSET_MINUTES } from "../energy/parse.js";

export const HOUR_MS = 3_600_000;
const OFFSET_MS = IST_OFFSET_MINUTES * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** The next whole local hour at or after `now`: step 0 of a plan. */
export function planStart(now: Date): number {
  return Math.ceil((now.getTime() + OFFSET_MS) / HOUR_MS) * HOUR_MS - OFFSET_MS;
}

/** Local clock fields of an instant. Weekday: Monday is 0 ... Sunday is 6. */
export function local(ms: number): { hour: number; minute: number; weekday: number; date: string } {
  const d = new Date(ms + OFFSET_MS);
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: (d.getUTCDay() + 6) % 7, date: d.toISOString().slice(0, 10) };
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

/** An instant as a local ISO 8601 time with its offset, "2026-10-07T23:00:00+05:30": the engine words its reasons with this clock. */
export function istIso(ms: number): string {
  const sign = IST_OFFSET_MINUTES < 0 ? "-" : "+";
  const abs = Math.abs(IST_OFFSET_MINUTES);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${new Date(ms + OFFSET_MS).toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

/** The start of the local day containing `ms`. */
const localMidnight = (ms: number): number => Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;

export interface StepWindow {
  startStep: number;
  endStep: number;
}

/**
 * Where a daily window (local "HH:MM" to "HH:MM", possibly past midnight) falls in the horizon: the first occurrence that has
 * not finished by step 0. Null when it does not fit: it ends beyond the horizon only in part (it is then cut at the horizon's
 * end), but a window with no whole step inside the horizon is not placed.
 */
export function windowInHorizon(from: string, to: string, startMs: number, steps: number): StepWindow | null {
  const len = (minutesOf(to) - minutesOf(from) + 1440) % 1440 || 1440;
  if (len === 1440) return steps > 0 ? { startStep: 0, endStep: steps } : null; // a window that never closes covers the whole horizon
  const first = localMidnight(startMs) - DAY_MS; // a window that began yesterday may still be open
  for (let k = 0; k < 4; k++) {
    const s = first + k * DAY_MS + minutesOf(from) * 60_000;
    const e = s + len * 60_000;
    if (e <= startMs) continue;
    const startStep = Math.max(0, Math.ceil((s - startMs) / HOUR_MS));
    const endStep = Math.min(steps, Math.floor((e - startMs) / HOUR_MS));
    return endStep > startStep ? { startStep, endStep } : null;
  }
  return null;
}

/** The step at which the next departure at a local time on one of the given weekdays (Monday is 0) falls; null if none within 8 days. */
export function departureStep(time: string, days: number[], startMs: number, steps: number): { step: number; beyondHorizon: boolean } | null {
  const day0 = localMidnight(startMs);
  for (let k = 0; k < 8; k++) {
    const t = day0 + k * DAY_MS + minutesOf(time) * 60_000;
    if (t <= startMs || !days.includes(local(t).weekday)) continue;
    const step = Math.floor((t - startMs) / HOUR_MS);
    return step >= steps ? { step: steps, beyondHorizon: true } : { step, beyondHorizon: false };
  }
  return null;
}

/**
 * Put hourly values that cover [label - 1 h, label] (labelled by the END of the hour, as irradiance is) or [label, label + 1 h]
 * (labelled by its start, as the load forecast is) onto the plan's steps, which are whole IST hours. The provider's hours may sit
 * half an hour off the local clock (UTC against IST), so a step can overlap two of them; each counts in proportion to the time
 * it shares with the step. Null where the hours given do not cover the whole step: nothing is invented.
 */
export function resample(points: { time: string; value: number }[], label: "start" | "end", startMs: number, steps: number): (number | null)[] {
  const intervals = points.map((p) => {
    const t = Date.parse(p.time);
    const s = label === "end" ? t - HOUR_MS : t;
    return { s, e: s + HOUR_MS, v: p.value };
  });
  const out: (number | null)[] = [];
  for (let i = 0; i < steps; i++) {
    const a = startMs + i * HOUR_MS;
    const b = a + HOUR_MS;
    let acc = 0;
    let share = 0;
    for (const iv of intervals) {
      const overlap = (Math.min(b, iv.e) - Math.max(a, iv.s)) / HOUR_MS;
      if (overlap <= 0) continue;
      acc += iv.v * overlap;
      share += overlap;
    }
    out.push(share >= 1 - 1e-9 ? acc / share : null);
  }
  return out;
}
