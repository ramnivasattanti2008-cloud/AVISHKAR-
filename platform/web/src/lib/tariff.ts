import type { TariffPlan } from "./types";
import { stateName } from "./states";

export const CONSUMER_LABELS: Record<TariffPlan["consumerType"], string> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  INDUSTRIAL: "Industrial",
  AGRICULTURAL: "Agricultural",
  OTHER: "Other",
};

export const EXPORT_BASIS_LABELS: Record<TariffPlan["export"]["basis"], string> = {
  REGULATOR_ORDER: "from the regulator's order",
  USER_ENTERED: "entered by you",
  ASSUMPTION: "an assumption: the source states none",
  NONE: "none recorded",
};

export const METERING_LABELS: Record<TariffPlan["export"]["meteringMode"], string> = {
  NET_METERING: "Net metering",
  NET_BILLING: "Net billing",
  GROSS_METERING: "Gross metering",
  NONE: "No export",
  UNKNOWN: "Not recorded for this plan",
};

/** "Maharashtra · MSEDCL · LT II (0-20 kW) · Commercial" */
export function describePlan(p: Pick<TariffPlan, "state" | "discom" | "category" | "consumerType">): string {
  return [stateName(p.state), p.discom, p.category, CONSUMER_LABELS[p.consumerType]].filter(Boolean).join(" · ");
}

export type UsagePattern = "even" | "daytime" | "evening";

/**
 * Illustrative shapes of when a month's energy is used. They are assumptions the person picks, not measurements, and the bill
 * says which one it used. A real profile (meter data) replaces them when AVISHKAR has one.
 */
export const USAGE_PATTERNS: { id: UsagePattern; label: string; note: string }[] = [
  { id: "even", label: "Spread evenly over the day", note: "The same amount every hour." },
  { id: "daytime", label: "Mostly daytime", note: "70% between 08:00 and 18:00, the rest spread over the other hours." },
  { id: "evening", label: "Mostly evening", note: "60% between 18:00 and midnight, the rest spread over the other hours." },
];

/** 24 shares that sum to 1 for the pattern; undefined for "even" (the API's own default). */
export function hourShareFor(pattern: UsagePattern): number[] | undefined {
  if (pattern === "even") return undefined;
  const [from, to, inside] = pattern === "daytime" ? [8, 18, 0.7] : [18, 24, 0.6];
  const n = to - from;
  return Array.from({ length: 24 }, (_, h) => (h >= from && h < to ? inside / n : (1 - inside) / (24 - n)));
}

/** Lowest and highest rate a plan charges, and whether it changes during the day. */
export function rateSummary(p: Pick<TariffPlan, "hourlyRates" | "slabs">): { min: number; max: number; timeOfDay: boolean } {
  const rates = p.slabs ? p.slabs.map((s) => s.rate) : p.hourlyRates;
  return { min: Math.min(...rates), max: Math.max(...rates), timeOfDay: new Set(p.hourlyRates).size > 1 };
}
