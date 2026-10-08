/**
 * The explanation of a plan's first move (spec section 45): what to do, why, from what data, on what assumptions, worth how much,
 * and how far to trust it. Pure: the plans it reads were made by the planner.
 *
 * Confidence here is not a probability and is not typed in. The same day is planned again with the sun and the load at the low and
 * high ends of their forecast bands, and the advice is called steady when the planner would do the same thing in the next few hours
 * under each. "The same advice in 4 of 5 forecasts" says exactly that and nothing more; with no band to vary, it says it was not
 * assessed.
 */
import { HOUR_MS, local } from "./horizon.js";

/** The hours whose battery moves make up the advice. Moves later in the day can still change with a forecast; the next ones are what is asked now. */
export const ADVICE_STEPS = 3;
/** Below this many kW a battery is idle: the planner's own decision list ignores anything under 0.02 kWh. */
export const MOVE_KW = 0.05;

export type BatteryMove = "charge" | "discharge" | "idle";

export function batteryMoves(chargeKw: number[], dischargeKw: number[], steps = ADVICE_STEPS): BatteryMove[] {
  return Array.from({ length: Math.min(steps, chargeKw.length) }, (_, i) => {
    const c = chargeKw[i] ?? 0;
    const d = dischargeKw[i] ?? 0;
    return c > MOVE_KW && c >= d ? "charge" : d > MOVE_KW ? "discharge" : "idle";
  });
}

export const sameMoves = (a: BatteryMove[], b: BatteryMove[]): boolean => a.length === b.length && a.every((m, i) => m === b[i]);

export interface Bands {
  pvLow: number[] | null;
  pvHigh: number[] | null;
  loadLow: number[] | null;
  loadHigh: number[] | null;
}

export interface ScenarioSpec {
  key: "solar_low" | "solar_high" | "load_low" | "load_high";
  label: string;
  pvKw: number[];
  loadKw: number[];
}

/** One scenario for each end of each band that exists. A band that does not exist is not invented, so its scenarios are not run. */
export function scenarioSpecs(pv: number[], load: number[], b: Bands): ScenarioSpec[] {
  const out: ScenarioSpec[] = [];
  if (b.pvLow) out.push({ key: "solar_low", label: "Less sun than forecast (10th percentile)", pvKw: b.pvLow, loadKw: load });
  if (b.pvHigh) out.push({ key: "solar_high", label: "More sun than forecast (90th percentile)", pvKw: b.pvHigh, loadKw: load });
  if (b.loadLow) out.push({ key: "load_low", label: "Less demand than forecast (10th percentile)", pvKw: pv, loadKw: b.loadLow });
  if (b.loadHigh) out.push({ key: "load_high", label: "More demand than forecast (90th percentile)", pvKw: pv, loadKw: b.loadHigh });
  return out;
}

export interface ScenarioResult {
  key: ScenarioSpec["key"];
  label: string;
  /** False when the planner found no usable plan for this scenario; it then counts for nothing either way. */
  usable: boolean;
  moves: BatteryMove[];
  chargeKwh: number;
  dischargeKwh: number;
}

export interface Confidence {
  assessed: boolean;
  /** Scenarios (the central forecast included) in which the planner gives the same advice. */
  agreeing: number;
  total: number;
  statement: string;
  scenarios: { label: string; agrees: boolean | null; chargeKwh: number | null; dischargeKwh: number | null; moves: BatteryMove[] }[];
}

/** The window's battery energy: charge and discharge over the advice steps, kWh (a step is an hour). */
export function windowKwh(chargeKw: number[], dischargeKw: number[], steps = ADVICE_STEPS): { chargeKwh: number; dischargeKwh: number } {
  const sum = (a: number[]) => Math.round(a.slice(0, steps).reduce((x, y) => x + y, 0) * 100) / 100;
  return { chargeKwh: sum(chargeKw), dischargeKwh: sum(dischargeKw) };
}

export function confidence(central: { moves: BatteryMove[]; chargeKwh: number; dischargeKwh: number }, results: ScenarioResult[], hasBattery: boolean): Confidence {
  const usable = results.filter((r) => r.usable);
  const centralRow = { label: "The forecast as it is (central estimate)", agrees: true as boolean | null, chargeKwh: central.chargeKwh, dischargeKwh: central.dischargeKwh, moves: central.moves };
  if (!hasBattery) {
    return { assessed: false, agreeing: 0, total: 0, statement: "Not assessed: there is no battery, so the advice has no battery move to test against the forecast bands.", scenarios: [centralRow] };
  }
  if (usable.length === 0) {
    const why = results.length === 0 ? "the forecasts carry no bands to vary (they need enough history to measure their own errors)" : "the planner found no usable plan in any varied forecast";
    return { assessed: false, agreeing: 0, total: 0, statement: `Not assessed: ${why}.`, scenarios: [centralRow] };
  }
  const rows = results.map((r) => ({ label: r.label, agrees: r.usable ? sameMoves(r.moves, central.moves) : null, chargeKwh: r.usable ? r.chargeKwh : null, dischargeKwh: r.usable ? r.dischargeKwh : null, moves: r.moves }));
  const agreeing = 1 + rows.filter((r) => r.agrees === true).length;
  const total = 1 + usable.length;
  return {
    assessed: true,
    agreeing,
    total,
    statement:
      agreeing === total
        ? `Steady: the planner gives the same advice for the next ${central.moves.length} hours in all ${total} forecasts tried (the central estimate and the sun and the demand at each end of their bands).`
        : `Less steady: the planner gives the same advice for the next ${central.moves.length} hours in ${agreeing} of ${total} forecasts tried. It changes if the sun or the demand lands at the edge of its band.`,
    scenarios: [centralRow, ...rows],
  };
}

const clock = (ms: number): string => {
  const l = local(ms);
  return `${String(l.hour).padStart(2, "0")}:${String(l.minute).padStart(2, "0")}`;
};

export interface DecisionLike {
  time: string;
  kind: string;
  kwh: number;
  reason: string;
}

export interface Headline {
  kind: "CHARGE_BATTERY" | "USE_BATTERY" | "HOLD" | "NO_BATTERY_MOVE";
  text: string;
  /** The planner's own reasons for the moves that make up the advice (prices and flows, in words). */
  why: string[];
}

/** What to do in the next hours, from the plan's battery moves, with the planner's reasons for it. */
export function headline(hasBattery: boolean, startMs: number, chargeKw: number[], dischargeKw: number[], decisions: DecisionLike[]): Headline {
  const moves = batteryMoves(chargeKw, dischargeKw);
  const w = windowKwh(chargeKw, dischargeKw);
  const until = clock(startMs + moves.length * HOUR_MS);
  const inWindow = (d: DecisionLike) => Date.parse(d.time) < startMs + moves.length * HOUR_MS;
  const reasonsFor = (kind: string) => decisions.filter((d) => d.kind === kind && inWindow(d)).slice(0, 2).map((d) => d.reason);
  if (!hasBattery) {
    return { kind: "NO_BATTERY_MOVE", text: "There is no battery, so there is nothing to store or release: the plan's value here is in when flexible loads run and in using the sun directly.", why: [] };
  }
  if (moves.includes("charge")) {
    return { kind: "CHARGE_BATTERY", text: `Charge the battery from ${clock(startMs)}: ${w.chargeKwh} kWh before ${until}.`, why: reasonsFor("charge_battery") };
  }
  if (moves.includes("discharge")) {
    return { kind: "USE_BATTERY", text: `Use the battery from ${clock(startMs)}: ${w.dischargeKwh} kWh before ${until}.`, why: reasonsFor("discharge_battery") };
  }
  const next = decisions.find((d) => d.kind === "charge_battery" || d.kind === "discharge_battery");
  return {
    kind: "HOLD",
    text: `Leave the battery as it is until ${until}: the plan neither charges nor uses it in that time.`,
    why: next ? [`The battery's next move is at ${clock(Date.parse(next.time))}: ${next.reason}.`] : ["The plan does not move the battery at all in this period."],
  };
}
