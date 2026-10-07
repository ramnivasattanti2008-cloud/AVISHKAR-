import type { DataStatus } from "./types";

export interface StatusMeta {
  label: string;
  /** What the label promises, in plain words. Shown on hover and to screen readers. */
  meaning: string;
  /** CSS custom property names (defined in globals.css) for the badge colours. */
  tone: "live" | "updated" | "forecast" | "estimated" | "simulated" | "demo" | "reference" | "unavailable";
}

/** One place that defines what each data label means (platform/ARCHITECTURE.md D6, D7; spec section 76). */
export const STATUS: Record<DataStatus, StatusMeta> = {
  LIVE: { label: "LIVE", meaning: "Fresh: observed within the provider's own update interval.", tone: "live" },
  UPDATED: { label: "UPDATED", meaning: "Real data, but older than the provider's update interval; its age is shown.", tone: "updated" },
  FORECAST: { label: "FORECAST", meaning: "A prediction for a future time, not something that happened.", tone: "forecast" },
  ESTIMATED: { label: "ESTIMATED", meaning: "Calculated from real inputs and stated assumptions; not measured.", tone: "estimated" },
  SIMULATED: { label: "SIMULATED", meaning: "Produced by a simulation; not a measurement of the real world.", tone: "simulated" },
  DEMO: { label: "DEMO", meaning: "Deterministic sample data, not real.", tone: "demo" },
  REFERENCE: { label: "REFERENCE", meaning: "Looked-up reference data that does not change with time, such as an address or a building outline.", tone: "reference" },
  UNAVAILABLE: { label: "UNAVAILABLE", meaning: "No value: the source is down or the data does not exist. Nothing has been made up.", tone: "unavailable" },
};

export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

export function formatNumber(v: number, unit?: string): string {
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 10 ? 1 : 2;
  // a tiny negative rounds to "-0": say "0"
  const text = v.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).replace(/^-(0(\.0*)?)$/, "$1");
  return unit ? `${text} ${unit}` : text;
}

/** Rupees in the Indian grouping: "₹1,23,456" and "₹7.88" (paise only when they matter). */
export function formatInr(v: number): string {
  const whole = Number.isInteger(v);
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function formatDateTime(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone });
}

const POSITION_LABELS: Record<string, string> = {
  "browser-geolocation": "Browser geolocation",
  manual: "Entered coordinates",
  "map-click": "Chosen on the map",
  geocoded: "Address lookup",
  imported: "Imported location",
  navic: "NavIC receiver",
};

/** The line shown beside a position (spec section 4). Browser geolocation is never labelled NavIC. */
export function positionLabel(source: string, accuracyM?: number | null): string {
  const acc = accuracyM === undefined || accuracyM === null ? "accuracy not reported" : `accuracy ${Math.round(accuracyM)} m`;
  return `POSITION SOURCE: ${POSITION_LABELS[source] ?? source}, ${acc}`;
}

/** "12.9716, 77.5946" or "12.9716 77.5946" or "12.9716°N 77.5946°E" into numbers; null when it is not a coordinate pair. */
export function parseCoordinates(text: string): { latitude: number; longitude: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latitude: lat, longitude: lon };
}

const POINTS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
/** "south" for 180: the direction a panel faces, in words, from degrees clockwise from north. */
export function compass(azimuthDeg: number): string {
  return POINTS[Math.round((((azimuthDeg % 360) + 360) % 360) / 45) % 8]!;
}

/** A share between 0 and 1 as a percentage: "80%". */
export function formatPercent(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}
