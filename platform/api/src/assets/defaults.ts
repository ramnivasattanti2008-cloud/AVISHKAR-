/**
 * Documented defaults for the parameters a person may leave blank (spec sections 25 and 31). A default is never written to
 * the database and never passed off as the owner's figure: it is returned beside the stored value with its basis, so every
 * consumer can tell "you said so" from "we assumed".
 *
 * Battery and solar defaults are the values of the Python EMS (`src/avishkar_ems/site.py`), which its tests and results use:
 * round-trip efficiency 0.90 (split evenly between charging and discharging), 90% usable depth of discharge, 14% fixed
 * system losses, 2 INR per kWh of battery wear.
 */

export type Basis = "USER_ENTERED" | "ASSUMPTION" | "PLANNER";

export interface Param {
  value: number | null;
  basis: Basis;
  note: string;
}

export const ROUND_TRIP_EFFICIENCY = 0.9;
export const ONE_WAY_EFFICIENCY = Math.sqrt(ROUND_TRIP_EFFICIENCY);

export const DEFAULTS = {
  battery: {
    oneWayEfficiency: { value: ONE_WAY_EFFICIENCY, note: `Round-trip efficiency ${ROUND_TRIP_EFFICIENCY} split evenly between charging and discharging: the default of the AVISHKAR Python EMS. Enter your battery's figure from its datasheet.` },
    minSoc: { value: 0.1, note: "10% kept unused (90% usable depth of discharge): the default of the AVISHKAR Python EMS." },
    maxSoc: { value: 1, note: "Charged to full." },
    wearInrPerKwh: { value: 2, note: "Cost of battery wear per kWh cycled, 2 INR: the default of the AVISHKAR Python EMS. Work it out from the price and rated cycles of your battery for a better figure." },
  },
  solar: {
    lossFraction: { value: 0.14, note: "Wiring, mismatch, soiling and other fixed losses of 14%: the default of the AVISHKAR Python EMS." },
  },
  ev: {
    chargerEfficiency: { value: 0.9, note: "A typical figure for AC charging; no source for it is recorded in this repository. Enter your charger's efficiency if you know it." },
  },
} as const;

/** One parameter: the owner's value when given, otherwise the labelled default. */
export function param(entered: number | null | undefined, fallback: { value: number; note: string }, enteredNote = "Entered by you."): Param {
  return entered === null || entered === undefined
    ? { value: fallback.value, basis: "ASSUMPTION", note: fallback.note }
    : { value: entered, basis: "USER_ENTERED", note: enteredNote };
}

/** A parameter with no default: the owner's value, or "decided later by the planner". */
export function plannerParam(entered: number | null | undefined, note: string): Param {
  return entered === null || entered === undefined ? { value: null, basis: "PLANNER", note } : { value: entered, basis: "USER_ENTERED", note: "Entered by you." };
}
