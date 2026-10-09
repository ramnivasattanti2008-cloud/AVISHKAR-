/**
 * The futures (spec section 16): the same 24 hours planned against several different days. Each future says what it is built from,
 * and that is one of three things: the day the forecasts expect (REFERENCE), an end of a band that the forecast itself measured from
 * this place's own past errors (DATA), or a figure the person sets, which is an assumption and says so (ASSUMPTION).
 *
 * They are not predictions and carry no probability: the ends of a band are where 1 hour in 10 falls beyond, and a stated outage is
 * a question ("what if the grid fails from 6 pm for 4 hours?"), not a forecast: no outage data exists.
 */
import { HOUR_MS, local } from "../plan/horizon.js";
import type { OptimiseRequest } from "../engine/schemas.js";

export const FUTURE_KEYS = ["expected", "sunny", "heavyCloud", "rain", "highDemand", "batteryOffline", "outage", "stress"] as const;
export type FutureKey = (typeof FUTURE_KEYS)[number];

export interface FutureInputs {
  startMs: number;
  steps: number;
  pv: number[];
  pvLow: number[] | null;
  pvHigh: number[] | null;
  loadHigh: number[] | null;
  hasBattery: boolean;
  criticalKw: number;
}

export interface FutureParams {
  /** The share of the expected solar output that comes through on a rainy day. An assumption: nothing here measures it. */
  rainSolarPercent: number;
  /** A grid outage to ask about: local clock hour it starts and how many hours it lasts. */
  outage: { startHour: number; hours: number };
}

export interface FutureDef {
  key: FutureKey;
  label: string;
  basis: "REFERENCE" | "DATA" | "ASSUMPTION";
  /** What the day is built from, in words. */
  built: string;
  /** Why the future cannot be run, or null. */
  unavailable: string | null;
  /** What replaces the expected inputs. */
  patch: Pick<Partial<OptimiseRequest>, "pvKw" | "loadKw" | "battery" | "grid">;
}

const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;

/** The steps an outage covers: it begins at the first step that starts at `startHour` on the local clock, and is cut at the horizon's end. */
export function outageSteps(startMs: number, steps: number, startHour: number, hours: number): { startStep: number; endStep: number; cut: boolean } {
  let s = 0;
  while (s < steps && local(startMs + s * HOUR_MS).hour !== startHour) s++;
  if (s >= steps) s = 0;
  const end = Math.min(steps, s + Math.max(1, Math.round(hours)));
  return { startStep: s, endStep: end, cut: s + Math.round(hours) > steps };
}

const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

export function futureDefs(i: FutureInputs, p: FutureParams): FutureDef[] {
  const hasSun = i.pv.some((v) => v > 0);
  const out = outageSteps(i.startMs, i.steps, p.outage.startHour, p.outage.hours);
  const outageText = `the grid is down from ${hourLabel(p.outage.startHour)} for ${Math.min(p.outage.hours, out.endStep - out.startStep)} hour(s)${out.cut ? " (cut at the end of the 24 hours)" : ""}; only the critical load is kept on`;
  const noBand = "The solar forecast has no calibrated band for this place yet, so its sunny and cloudy ends cannot be stated.";
  const noSun = "There is no solar system, or no sun in the forecast, so there is nothing for the weather to change.";
  const noCritical = "No appliance is marked CRITICAL, so there is no critical load to keep on in an outage: mark them on the Assets tab.";

  const outage = { grid: { outages: [{ startStep: out.startStep, endStep: out.endStep }] } };
  const stressReason = !hasSun || i.pvLow === null ? noBand : i.loadHigh === null ? "The load forecast has no band to take a high-demand day from." : i.criticalKw <= 0 ? noCritical : null;

  return [
    { key: "expected", label: "Expected day", basis: "REFERENCE", built: "The forecasts' central estimates for the sun and the demand: the day the plan is made for.", unavailable: null, patch: {} },
    {
      key: "sunny",
      label: "Sunny",
      basis: "DATA",
      built: "Solar output at the upper end of the forecast's own band (the level 1 hour in 10 exceeds), measured from this place's past forecast errors. Demand as expected.",
      unavailable: !hasSun ? noSun : i.pvHigh === null ? noBand : null,
      patch: i.pvHigh ? { pvKw: i.pvHigh } : {},
    },
    {
      key: "heavyCloud",
      label: "Heavy cloud",
      basis: "DATA",
      built: "Solar output at the lower end of the forecast's own band (the level 1 hour in 10 falls below). Demand as expected.",
      unavailable: !hasSun ? noSun : i.pvLow === null ? noBand : null,
      patch: i.pvLow ? { pvKw: i.pvLow } : {},
    },
    {
      key: "rain",
      label: "Rain",
      basis: "ASSUMPTION",
      built: `Solar output at ${p.rainSolarPercent}% of the expected output in every hour. The share is your assumption: nothing here measures what rain does to this roof. Demand as expected.`,
      unavailable: !hasSun ? noSun : null,
      patch: { pvKw: i.pv.map((v) => round((v * p.rainSolarPercent) / 100)) },
    },
    {
      key: "highDemand",
      label: "High demand",
      basis: "DATA",
      built: "Demand at the upper end of the load forecast's own band, measured from this property's past forecast errors. The sun as expected.",
      unavailable: i.loadHigh === null ? "The load forecast has no band to take a high-demand day from." : null,
      patch: i.loadHigh ? { loadKw: i.loadHigh } : {},
    },
    {
      key: "batteryOffline",
      label: "Battery offline",
      basis: "ASSUMPTION",
      built: "The battery cannot be used for the whole 24 hours. Sun and demand as expected.",
      unavailable: i.hasBattery ? null : "There is no battery entered, so nothing can go offline.",
      patch: { battery: null },
    },
    {
      key: "outage",
      label: "Grid outage",
      basis: "ASSUMPTION",
      built: `A question, not a forecast: ${outageText}. The planner is told about it in advance, so this is the best a battery could do; an outage with no warning would be worse. Sun and demand as expected.`,
      unavailable: i.criticalKw <= 0 ? noCritical : null,
      patch: outage,
    },
    {
      key: "stress",
      label: "Heavy cloud, high demand and an outage together",
      basis: "ASSUMPTION",
      built: `The three together: the lower end of the solar band, the upper end of the demand band, and ${outageText}. Each is unlikely alone and the three together more so: it shows how much room there is.`,
      unavailable: stressReason,
      patch: { ...(i.pvLow ? { pvKw: i.pvLow } : {}), ...(i.loadHigh ? { loadKw: i.loadHigh } : {}), ...outage },
    },
  ];
}
