/**
 * Data quality engine (spec section 41) and reality checks (section 83).
 *
 * Nothing here repairs data. A value that fails a check is reported as rejected with a reason and is not served.
 */

export type WeatherKind =
  | "air_temperature_c"
  | "relative_humidity_pct"
  | "cloud_cover_pct"
  | "wind_speed_ms"
  | "precipitation_mm"
  | "shortwave_radiation_wm2"
  | "pressure_hpa";

interface Limit {
  min: number;
  max: number;
  /** Largest believable change between consecutive points, per hour. Absent: not tested for spikes. */
  maxStepPerHour?: number;
}

/** Physical limits, wide enough to admit any real reading on Earth and tight enough to catch sensor garbage. */
export const LIMITS: Record<WeatherKind, Limit> = {
  air_temperature_c: { min: -90, max: 60, maxStepPerHour: 15 },
  relative_humidity_pct: { min: 0, max: 100, maxStepPerHour: 60 },
  cloud_cover_pct: { min: 0, max: 100 },
  wind_speed_ms: { min: 0, max: 120, maxStepPerHour: 40 },
  precipitation_mm: { min: 0, max: 500 },
  shortwave_radiation_wm2: { min: 0, max: 1500 },
  pressure_hpa: { min: 300, max: 1100, maxStepPerHour: 20 },
};

export type Check = { ok: true } | { ok: false; reason: string };

export function checkValue(kind: WeatherKind, value: unknown): Check {
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, reason: "not a finite number" };
  const l = LIMITS[kind];
  if (value < l.min || value > l.max) {
    return { ok: false, reason: `${value} is outside the physically possible range ${l.min}..${l.max} for ${kind}` };
  }
  return { ok: true };
}

export function checkCoordinates(latitude: unknown, longitude: unknown): Check {
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, reason: "latitude and longitude must be finite numbers" };
  }
  if (latitude < -90 || latitude > 90) return { ok: false, reason: `latitude ${latitude} is outside -90..90` };
  if (longitude < -180 || longitude > 180) return { ok: false, reason: `longitude ${longitude} is outside -180..180` };
  return { ok: true };
}

/** A rough box around India, its islands and nearby waters. Used to warn, never to refuse: AVISHKAR is not India-only. */
export function isNearIndia(latitude: number, longitude: number): boolean {
  return latitude >= 5 && latitude <= 38 && longitude >= 67 && longitude <= 98;
}

export interface SeriesPoint {
  time: Date;
  value: number | null;
}

export interface Rejected {
  time: Date;
  value: number | null;
  reason: string;
}

export interface SeriesAssessment {
  accepted: SeriesPoint[];
  rejected: Rejected[];
  duplicates: number;
  /** Expected-step gaps between accepted points. */
  gaps: number;
  newest: Date | null;
  /** True when the newest accepted point is older than maxAgeMinutes. */
  stale: boolean;
  ageMinutes: number | null;
}

export interface AssessOptions {
  now: Date;
  /** Treat the series as stale if its newest accepted point is older than this. */
  maxAgeMinutes: number;
  expectedStepMinutes: number;
}

/** Validate a time series: impossible values, missing timestamps, duplicates, spikes, gaps and staleness. */
export function assessSeries(kind: WeatherKind, points: SeriesPoint[], opts: AssessOptions): SeriesAssessment {
  const rejected: Rejected[] = [];
  const seen = new Set<number>();
  let duplicates = 0;
  const candidates: SeriesPoint[] = [];

  for (const p of points) {
    if (!(p.time instanceof Date) || Number.isNaN(p.time.getTime())) {
      rejected.push({ time: p.time, value: p.value, reason: "missing or invalid timestamp" });
      continue;
    }
    const t = p.time.getTime();
    if (seen.has(t)) {
      duplicates++;
      rejected.push({ time: p.time, value: p.value, reason: "duplicate timestamp" });
      continue;
    }
    seen.add(t);
    if (p.value === null) {
      rejected.push({ time: p.time, value: null, reason: "no value" });
      continue;
    }
    const c = checkValue(kind, p.value);
    if (!c.ok) {
      rejected.push({ time: p.time, value: p.value, reason: c.reason });
      continue;
    }
    candidates.push(p);
  }
  candidates.sort((a, b) => a.time.getTime() - b.time.getTime());

  const limit = LIMITS[kind].maxStepPerHour;
  const accepted: SeriesPoint[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const cur = candidates[i]!;
    const prev = candidates[i - 1];
    const next = candidates[i + 1];
    if (limit !== undefined && prev && next && cur.value !== null && prev.value !== null && next.value !== null) {
      const hp = Math.max((cur.time.getTime() - prev.time.getTime()) / 3_600_000, 1e-6);
      const hn = Math.max((next.time.getTime() - cur.time.getTime()) / 3_600_000, 1e-6);
      const jumpIn = Math.abs(cur.value - prev.value) / hp;
      const jumpOut = Math.abs(cur.value - next.value) / hn;
      const neighboursAgree = Math.abs(next.value - prev.value) / (hp + hn) <= limit;
      if (jumpIn > limit && jumpOut > limit && neighboursAgree) {
        rejected.push({ time: cur.time, value: cur.value, reason: `spike: jumps ${jumpIn.toFixed(1)}/h from its neighbours` });
        continue;
      }
    }
    accepted.push(cur);
  }

  let gaps = 0;
  const stepMs = opts.expectedStepMinutes * 60_000;
  for (let i = 1; i < accepted.length; i++) {
    if (accepted[i]!.time.getTime() - accepted[i - 1]!.time.getTime() > stepMs * 1.5) gaps++;
  }
  const newest = accepted.length ? accepted[accepted.length - 1]!.time : null;
  const ageMinutes = newest ? Math.round((opts.now.getTime() - newest.getTime()) / 60_000) : null;
  return { accepted, rejected, duplicates, gaps, newest, ageMinutes, stale: ageMinutes === null || ageMinutes > opts.maxAgeMinutes };
}

export interface RealityInput {
  /** 1. Is the source known and available? */
  sourceAvailable: boolean;
  /** 2. Is the timestamp valid (present, a real date, not in the future)? */
  timestampValid: boolean;
  /** 3. Is the value physically possible? */
  valuePossible: boolean;
  /** 4. Is the location valid and the one the user asked about? */
  locationValid: boolean;
  /** 5. Is the model applicable to this situation (inside its training or design envelope)? */
  modelApplicable: boolean;
  /** 6. Is an uncertainty or confidence available? */
  uncertaintyAvailable: boolean;
  /** 7. Is it labelled as simulation versus reality? (true when the status label matches what it really is) */
  statusLabelCorrect: boolean;
}

export interface RealityReport {
  passed: boolean;
  checks: { id: number; name: string; ok: boolean }[];
  /** The failures, in words, for the user. */
  failures: string[];
}

const REALITY_NAMES: [keyof RealityInput, string][] = [
  ["sourceAvailable", "source is available"],
  ["timestampValid", "timestamp is valid"],
  ["valuePossible", "value is physically possible"],
  ["locationValid", "location is correct"],
  ["modelApplicable", "model is applicable"],
  ["uncertaintyAvailable", "uncertainty is available"],
  ["statusLabelCorrect", "labelled correctly as measurement, forecast, estimate or simulation"],
];

/** The seven checks of spec section 83. Callers downgrade or withhold a result when `passed` is false. */
export function realityReport(input: RealityInput): RealityReport {
  const checks = REALITY_NAMES.map(([key, name], i) => ({ id: i + 1, name, ok: input[key] }));
  return { passed: checks.every((c) => c.ok), checks, failures: checks.filter((c) => !c.ok).map((c) => `Check ${c.id} failed: ${c.name}`) };
}
