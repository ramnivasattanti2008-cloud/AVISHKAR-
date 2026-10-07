/**
 * Provenance envelope (platform/ARCHITECTURE.md D6, D7; spec sections 3, 40, 76, 83).
 *
 * Every value the API returns that came from a provider, a model or a simulation is wrapped in `Measured<T>` so a
 * consumer can always see where it came from, when, and how far to trust it. `LIVE` is not a label anyone may choose:
 * `observed()` assigns it only when the observation is fresh for the provider's own update cadence.
 */

export const DATA_STATUSES = ["LIVE", "UPDATED", "FORECAST", "ESTIMATED", "SIMULATED", "DEMO", "REFERENCE", "UNAVAILABLE"] as const;
export type DataStatus = (typeof DATA_STATUSES)[number];

/** A new observation is called LIVE when its age is within this many provider update intervals. */
export const FRESHNESS_FACTOR = 1.5;
/** Clock skew we tolerate before a timestamp in the future is treated as invalid. */
export const FUTURE_TOLERANCE_SECONDS = 300;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Provenance {
  provider: string;
  source: string;
  dataType: string;
  status: DataStatus;
  /** When the provider observed the value (observations only). */
  observedAt?: string;
  /** When this platform fetched or produced it. */
  generatedAt: string;
  /** The instant a forecast refers to. */
  validFor?: string;
  location?: GeoPoint;
  quality?: number;
  confidence?: number;
  processingVersion: string;
  modelVersion?: string;
  /** Age of the observation at the moment of serving, in seconds. */
  ageSeconds?: number;
  /** Plain-language caveats shown to the user: why stale, what was estimated, why unavailable. */
  notes: string[];
}

export interface Measured<T> {
  value: T | null;
  unit?: string;
  provenance: Provenance;
}

export const PROCESSING_VERSION = "api-0.1.0";

export function isDataStatus(s: string): s is DataStatus {
  return (DATA_STATUSES as readonly string[]).includes(s);
}

export function ageSeconds(observedAt: Date, now: Date): number {
  return Math.round((now.getTime() - observedAt.getTime()) / 1000);
}

export interface FreshnessInput {
  observedAt: Date;
  /** How often the provider publishes a new value, in seconds. */
  cadenceSeconds: number;
  now: Date;
}

export type Freshness =
  | { ok: true; status: "LIVE" | "UPDATED"; ageSeconds: number }
  | { ok: false; reason: string };

/** LIVE only if fresh for the cadence; UPDATED (with an explicit age) if older; invalid if from the future. */
export function classifyObservation({ observedAt, cadenceSeconds, now }: FreshnessInput): Freshness {
  if (Number.isNaN(observedAt.getTime())) return { ok: false, reason: "timestamp is not a valid date" };
  const age = ageSeconds(observedAt, now);
  if (age < -FUTURE_TOLERANCE_SECONDS) return { ok: false, reason: `timestamp is ${-age}s in the future` };
  const limit = cadenceSeconds * FRESHNESS_FACTOR;
  return { ok: true, status: age <= limit ? "LIVE" : "UPDATED", ageSeconds: Math.max(age, 0) };
}

interface BaseInput {
  provider: string;
  source: string;
  dataType: string;
  location?: GeoPoint;
  quality?: number;
  confidence?: number;
  now?: Date;
  notes?: string[];
  modelVersion?: string;
}

function base(i: BaseInput, status: DataStatus): Provenance {
  const now = i.now ?? new Date();
  return {
    provider: i.provider,
    source: i.source,
    dataType: i.dataType,
    status,
    generatedAt: now.toISOString(),
    location: i.location,
    quality: i.quality,
    confidence: i.confidence,
    processingVersion: PROCESSING_VERSION,
    modelVersion: i.modelVersion,
    notes: [...(i.notes ?? [])],
  };
}

/** A measured value from a provider. Status is derived from freshness; an invalid timestamp makes it UNAVAILABLE. */
export function observed<T>(
  value: T,
  input: BaseInput & { unit?: string; observedAt: Date; cadenceSeconds: number },
): Measured<T> {
  const now = input.now ?? new Date();
  const f = classifyObservation({ observedAt: input.observedAt, cadenceSeconds: input.cadenceSeconds, now });
  if (!f.ok) {
    return unavailable(`${input.dataType}: ${f.reason}`, { ...input, now });
  }
  const p = base(input, f.status);
  p.observedAt = input.observedAt.toISOString();
  p.ageSeconds = f.ageSeconds;
  if (f.status === "UPDATED") {
    p.notes.push(`Last observation is ${humanAge(f.ageSeconds)} old; the provider updates about every ${humanAge(input.cadenceSeconds)}.`);
  }
  return { value, unit: input.unit, provenance: p };
}

export function forecast<T>(value: T, input: BaseInput & { unit?: string; validFor: Date }): Measured<T> {
  const p = base(input, "FORECAST");
  p.validFor = input.validFor.toISOString();
  return { value, unit: input.unit, provenance: p };
}

export function estimated<T>(value: T, input: BaseInput & { unit?: string; basis: string }): Measured<T> {
  const p = base(input, "ESTIMATED");
  p.notes.push(`Estimated: ${input.basis}`);
  return { value, unit: input.unit, provenance: p };
}

export function simulated<T>(value: T, input: BaseInput & { unit?: string }): Measured<T> {
  const p = base(input, "SIMULATED");
  p.notes.push("Simulated result, not a measurement.");
  return { value, unit: input.unit, provenance: p };
}

/** Looked-up reference data that does not vary with time (a geocoded address, a mapped building outline). */
export function reference<T>(value: T, input: BaseInput & { unit?: string }): Measured<T> {
  return { value, unit: input.unit, provenance: base(input, "REFERENCE") };
}

export function demo<T>(value: T, input: BaseInput & { unit?: string }): Measured<T> {
  const p = base(input, "DEMO");
  p.notes.push("DEMO DATA: deterministic sample data, not real.");
  return { value, unit: input.unit, provenance: p };
}

/** There is no value, and we say why. Never replaced by a made-up number. */
export function unavailable<T = never>(reason: string, input: BaseInput & { unit?: string }): Measured<T> {
  const p = base(input, "UNAVAILABLE");
  p.notes.push(reason);
  return { value: null, unit: input.unit, provenance: p };
}

export function humanAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/** Re-derive the age of a stored observation at serving time (cached values age while they wait). */
export function reage<T>(m: Measured<T>, now: Date, cadenceSeconds: number): Measured<T> {
  if (m.provenance.observedAt === undefined || m.provenance.status === "UNAVAILABLE") return m;
  const re = observed(m.value as T, {
    provider: m.provenance.provider,
    source: m.provenance.source,
    dataType: m.provenance.dataType,
    location: m.provenance.location,
    quality: m.provenance.quality,
    confidence: m.provenance.confidence,
    modelVersion: m.provenance.modelVersion,
    unit: m.unit,
    observedAt: new Date(m.provenance.observedAt),
    cadenceSeconds,
    now,
  });
  return re;
}
