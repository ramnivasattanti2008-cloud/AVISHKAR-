import type { Db } from "../db.js";
import type { ObservationKind } from "../generated/prisma/client.js";
import { checkValue } from "../quality.js";
import { type RawWeather, VARIABLES, cellOf } from "./weather.js";

const CHUNK = 2000;

/**
 * Keep what the provider told us, as issued (spec sections 13, 38, 39): the current model analysis and the hourly forecast,
 * stamped with the fetch time, so a later job can compare each forecast with what actually happened. Values that fail the
 * physical checks are not stored.
 */
export async function persistWeather(db: Db, provider: string, raw: RawWeather, fetchedAt: Date): Promise<number> {
  const latCell = cellOf(raw.latitude);
  const lonCell = cellOf(raw.longitude);
  const rows: {
    provider: string;
    latCell: number;
    lonCell: number;
    variable: string;
    kind: ObservationKind;
    validAt: Date;
    value: number;
    unit: string;
    fetchedAt: Date;
  }[] = [];
  const utc = (t: string) => new Date(t.endsWith("Z") ? t : `${t}Z`);
  for (const v of VARIABLES) {
    const cur = raw.current.values[v.api];
    if (v.current && typeof cur === "number" && checkValue(v.kind, cur).ok) {
      rows.push({ provider, latCell, lonCell, variable: v.name, kind: "ANALYSIS", validAt: utc(raw.current.time), value: cur, unit: v.unit, fetchedAt });
    }
    const series = raw.hourly.values[v.api];
    if (!series) continue;
    raw.hourly.times.forEach((t, i) => {
      const value = series[i];
      if (typeof value === "number" && checkValue(v.kind, value).ok) {
        rows.push({ provider, latCell, lonCell, variable: v.name, kind: "FORECAST", validAt: utc(t), value, unit: v.unit, fetchedAt });
      }
    });
  }
  let stored = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    stored += (await db.weatherObservation.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true })).count;
  }
  return stored;
}
