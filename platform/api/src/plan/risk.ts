import type { OptimiseRequest, OptimiseResponse } from "../engine/schemas.js";
import type { PlanDto } from "./schemas.js";

/** The CVaR level: the tail averaged is the worst fifth of weight. A setting, stated with every risk-aware plan. */
export const RISK_ALPHA = 0.8;
/** The central forecast's weight; the band days share the rest equally. A preference, not a measured probability. */
export const CENTRAL_WEIGHT = 0.5;

interface Bands {
  pvLow: number[] | null;
  pvHigh: number[] | null;
  loadLow: number[] | null;
  loadHigh: number[] | null;
}

export interface RiskDay {
  label: string;
  built: string;
  loadKw: number[];
  pvKw: number[];
}

/**
 * The days a risk-aware plan is made for, beside the central forecast: the bad ends of the forecasts' own bands, measured from the
 * place's own past errors. Only bands that exist are used; nothing is invented. More sun is not a risk to the bill, so it is left out.
 */
export function riskDays(bands: Bands, pv: number[], loadKw: number[]): RiskDay[] {
  const out: RiskDay[] = [];
  if (bands.pvLow) out.push({ label: "Less sun than expected", built: "The lower end of the solar forecast's own band; the demand as expected.", loadKw, pvKw: bands.pvLow });
  if (bands.loadHigh) out.push({ label: "More demand than expected", built: "The upper end of the load forecast's own band; the sun as expected.", loadKw: bands.loadHigh, pvKw: pv });
  if (bands.pvLow && bands.loadHigh) out.push({ label: "Less sun and more demand", built: "Both bands at their bad ends at once, which is rarer than either alone.", loadKw: bands.loadHigh, pvKw: bands.pvLow });
  return out;
}

/** The engine's `risk` block for these days, or null when there is nothing to plan against. */
export function riskRequest(days: RiskDay[], aversion: number): NonNullable<OptimiseRequest["risk"]> | null {
  if (days.length === 0 || aversion <= 0) return null;
  const w = (1 - CENTRAL_WEIGHT) / days.length;
  return { scenarios: days.map((d) => ({ label: d.label, loadKw: d.loadKw, pvKw: d.pvKw, weight: w })), centralWeight: CENTRAL_WEIGHT, alpha: RISK_ALPHA, aversion };
}

/** The engine's report, worded for the owner, with how each day was built. */
export function riskSummary(out: NonNullable<OptimiseResponse["risk"]>, days: RiskDay[]): NonNullable<PlanDto["risk"]> {
  const built = new Map(days.map((d) => [d.label, d.built]));
  const worst = out.scenarios.reduce((a, b) => (b.netCostInr > a.netCostInr ? b : a));
  return {
    aversion: out.aversion,
    alpha: out.alpha,
    scenarios: out.scenarios.map((s) => ({ label: s.label, built: built.get(s.label) ?? "The forecast's central estimate for sun and demand.", weight: s.weight, netCostInr: s.netCostInr, importKwh: s.importKwh, unservedKwh: s.unservedKwh })),
    expectedNetCostInr: out.expectedNetCostInr,
    cvarNetCostInr: out.cvarNetCostInr,
    statement: `One battery schedule was chosen for ${out.scenarios.length} possible days at once, weighing the average cost against the cost of the worst ${Math.round((1 - out.alpha) * 100)}% of weight (aversion ${out.aversion}). The dearest of them, "${worst.label}", would cost ₹${worst.netCostInr.toFixed(2)}. The weights are preferences, not probabilities, and the schedule shown is for the central forecast.`,
  };
}
