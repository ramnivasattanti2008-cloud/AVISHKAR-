/**
 * The arithmetic behind the Today view (spec sections 97 and 98). Pure: the day, the clock and the series are inputs.
 */
import { HOUR_MS, resample } from "../plan/horizon.js";

export interface Point {
  time: string;
  value: number;
}

/**
 * The energy of an hourly power series (kW per hour) inside one day, counting each hour in proportion to the part of it that falls in
 * the day, and how many hours of the day the series covers. `label` says whether an hour is labelled by its start (a load forecast)
 * or its end (irradiance, and the solar forecast built on it).
 */
export function dayEnergy(points: Point[], label: "start" | "end", dayStartMs: number): { kwh: number; hoursCovered: number } {
  const dayEnd = dayStartMs + 24 * HOUR_MS;
  let kwh = 0;
  let hours = 0;
  for (const p of points) {
    const t = Date.parse(p.time);
    const from = label === "end" ? t - HOUR_MS : t;
    const share = (Math.min(from + HOUR_MS, dayEnd) - Math.max(from, dayStartMs)) / HOUR_MS;
    if (share <= 0) continue;
    kwh += p.value * share;
    hours += share;
  }
  return { kwh, hoursCovered: hours };
}

/** The day as 24 local hours, null where the series does not cover the whole hour: nothing is invented. */
export const hours24 = (points: Point[], label: "start" | "end", dayStartMs: number): (number | null)[] => resample(points, label, dayStartMs, 24);

/** Solar beyond use, hour by hour, over the hours where both are known: what is free to store, sell or shift into. */
export function surplus(pv: (number | null)[], load: (number | null)[]): { kwh: number; hours: number } {
  let kwh = 0;
  let hours = 0;
  for (let i = 0; i < Math.min(pv.length, load.length); i++) {
    const a = pv[i];
    const b = load[i];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    kwh += Math.max(a - b, 0);
    hours++;
  }
  return { kwh, hours };
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export const RISK = { sunWm2: 50, hours: 12, mediumCloud: 40, highCloud: 75, moderateRainMmPerHour: 2.5 } as const;
export const RISK_RULE = `Over the next ${RISK.hours} hours of daylight: LOW when the mean cloud cover is under ${RISK.mediumCloud}%, MEDIUM from ${RISK.mediumCloud}%, HIGH from ${RISK.highCloud}%; one level higher when any hour has ${RISK.moderateRainMmPerHour} mm of rain or more (the WMO's moderate rain). A rule of this page, not a standard.`;

/**
 * The risk the weather poses to the sun, from the provider's own cloud, rain and irradiance, whose hours are labelled by their END: an hour
 * that ended at or before now is behind us. Null when there is no daylight in the series ahead.
 */
export function weatherRisk(cloud: Point[], rain: Point[], sun: Point[], nowMs: number): { level: RiskLevel; meanCloudPercent: number; maxRainMmPerHour: number; hours: number } | null {
  const daylight = sun
    .filter((p) => Date.parse(p.time) > nowMs && p.value > RISK.sunWm2)
    .map((p) => p.time)
    .slice(0, RISK.hours);
  if (daylight.length === 0) return null;
  const at = (series: Point[]) => new Map(series.map((p) => [p.time, p.value]));
  const c = at(cloud);
  const r = at(rain);
  const clouds = daylight.map((t) => c.get(t)).filter((v): v is number => v !== undefined);
  if (clouds.length === 0) return null;
  const mean = clouds.reduce((a, b) => a + b, 0) / clouds.length;
  const maxRain = Math.max(0, ...daylight.map((t) => r.get(t) ?? 0));
  let rank = mean >= RISK.highCloud ? 2 : mean >= RISK.mediumCloud ? 1 : 0;
  if (maxRain >= RISK.moderateRainMmPerHour) rank = Math.min(2, rank + 1);
  return { level: (["LOW", "MEDIUM", "HIGH"] as const)[rank]!, meanCloudPercent: Math.round(mean), maxRainMmPerHour: Math.round(maxRain * 10) / 10, hours: daylight.length };
}
