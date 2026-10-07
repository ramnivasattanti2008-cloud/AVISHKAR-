/**
 * Estimation rules for the Energy Twin. Pure functions; every number they produce is labelled ESTIMATED by the caller.
 *
 * ASSUMPTIONS are deliberate, documented and surfaced to the user with every result (spec sections 62, 99). They are
 * defaults for a typical Indian flat-roof installation and are meant to be replaced by the property's real values.
 */

export interface Assumption {
  key: string;
  value: number;
  unit: string;
  rationale: string;
}

export const ASSUMPTIONS = {
  usableRoofFraction: {
    key: "usable_roof_fraction",
    value: 0.5,
    unit: "share of roof area",
    rationale:
      "Water tanks, stair covers, parapets, shading and walkways typically leave about half of a flat roof usable. Replace with a surveyed value.",
  },
  kwpPerM2Usable: {
    key: "kwp_per_m2_usable_roof",
    value: 0.1,
    unit: "kWp per m2",
    rationale: "About 10 m2 of usable roof per kWp for a fixed-tilt array including row spacing (modules alone need about 5 to 6 m2).",
  },
  performanceRatio: {
    key: "performance_ratio",
    value: 0.75,
    unit: "ratio",
    rationale:
      "Typical system losses (temperature, soiling, wiring, inverter, mismatch). Irradiation is for a horizontal surface; the small gain from tilting the array is ignored, which errs on the low side.",
  },
} as const satisfies Record<string, Assumption>;

export interface PvEstimate {
  usableAreaM2: number | null;
  capacityKw: number | null;
  /** kWh produced per kWp installed per average day. */
  yieldKwhPerKwpDay: number | null;
  dailyGenerationKwh: number | null;
}

const ok = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;

/** Rooftop PV potential from roof area and the average daily irradiation. Anything unknown stays null, never guessed. */
export function estimatePv(i: { roofAreaM2: number | null; ghiKwhM2Day: number | null }): PvEstimate {
  const yieldKwhPerKwpDay = ok(i.ghiKwhM2Day) ? i.ghiKwhM2Day * ASSUMPTIONS.performanceRatio.value : null;
  if (!ok(i.roofAreaM2) || i.roofAreaM2 === 0) return { usableAreaM2: null, capacityKw: null, yieldKwhPerKwpDay, dailyGenerationKwh: null };
  const usableAreaM2 = i.roofAreaM2 * ASSUMPTIONS.usableRoofFraction.value;
  const capacityKw = usableAreaM2 * ASSUMPTIONS.kwpPerM2Usable.value;
  return { usableAreaM2, capacityKw, yieldKwhPerKwpDay, dailyGenerationKwh: yieldKwhPerKwpDay === null ? null : capacityKw * yieldKwhPerKwpDay };
}

/**
 * Horizontal irradiation in the next 24 hours from an hourly W/m2 forecast (each value is the mean of the preceding hour,
 * so its numeric value equals Wh/m2 for that hour). Needs nearly the whole day; otherwise null: no extrapolation.
 */
export function nextDayIrradiation(points: { time: string; value: number }[], now: Date): { kwhPerM2: number; hours: number } | null {
  const from = now.getTime();
  const to = from + 24 * 3_600_000;
  const inWindow = points.filter((p) => {
    const t = new Date(p.time).getTime();
    return t > from && t <= to;
  });
  if (inWindow.length < 20) return null;
  return { kwhPerM2: inWindow.reduce((s, p) => s + p.value, 0) / 1000, hours: inWindow.length };
}

export interface CompletenessInput {
  location: boolean;
  solarResource: boolean;
  weather: boolean;
  geometry: boolean;
  satellite: boolean;
  loadProfile: boolean;
  tariff: boolean;
}

export interface Completeness {
  confidence: number;
  quality: "MINIMAL" | "PARTIAL" | "FULL";
  basis: { item: string; weight: number; available: boolean }[];
}

const WEIGHTS: [keyof CompletenessInput, string, number][] = [
  ["location", "Location of the property", 0.1],
  ["solarResource", "Solar resource for the location", 0.2],
  ["weather", "Current weather and forecast", 0.15],
  ["geometry", "Roof or plot outline", 0.2],
  ["satellite", "Recent satellite scene", 0.05],
  ["loadProfile", "Household or business electricity use", 0.2],
  ["tariff", "Electricity tariff", 0.1],
];

/**
 * Share of the inputs a complete twin needs that are actually available (a data-completeness measure, not a probability).
 * MINIMAL below 0.4, FULL from 0.95: a twin without consumption (0.2) or without a tariff (0.1) can never be FULL; only the
 * minor satellite scene (0.05) may be missing.
 */
export function completeness(flags: CompletenessInput): Completeness {
  const basis = WEIGHTS.map(([k, item, weight]) => ({ item, weight, available: flags[k] }));
  const confidence = Math.round(basis.reduce((s, b) => s + (b.available ? b.weight : 0), 0) * 100) / 100;
  return { confidence, quality: confidence >= 0.95 ? "FULL" : confidence >= 0.4 ? "PARTIAL" : "MINIMAL", basis };
}
