/**
 * Turn stored meter readings into the regular series the load forecaster takes: one value per interval from the first reading
 * to the last, with null where there is no reading. Nothing is filled in. Readings at a different interval from the dominant one
 * are not mixed in (the same rule as the Energy DNA), and are counted so the caller can say so.
 */
import type { Obs } from "../energy/dna.js";
import { IST_OFFSET_MINUTES } from "../energy/parse.js";

export const ENGINE_INTERVALS = [15, 30, 60] as const;
export type EngineInterval = (typeof ENGINE_INTERVALS)[number];

/** The longest history the engine takes: 400 days at 15 minutes. */
export const MAX_HISTORY_DAYS = 400;

export interface LoadSeries {
  startTime: string;
  intervalMinutes: EngineInterval;
  kwh: (number | null)[];
}

export interface SeriesReport {
  /** First instant not covered by the series: the end of the last reading. */
  endsAt: Date;
  /** Readings placed in the series. */
  used: number;
  /** Readings at another interval than the dominant one. */
  otherInterval: number;
  /** Readings that do not sit on the interval grid of the first one. */
  offGrid: number;
  /** Finer readings combined into hours (only when every reading of the hour was present). */
  aggregatedFrom: number | null;
  /** Hours (or intervals) left empty because a part of them had no reading. */
  gaps: number;
}

export type SeriesOutcome = { ok: true; series: LoadSeries; report: SeriesReport } | { ok: false; reason: string };

const MIN_MS = 60_000;

export function buildLoadSeries(all: Obs[]): SeriesOutcome {
  if (all.length === 0) return { ok: false, reason: "There are no meter readings yet." };

  const counts = new Map<number, number>();
  for (const o of all) counts.set(o.intervalMinutes, (counts.get(o.intervalMinutes) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  const otherInterval = all.length - (counts.get(dominant) ?? 0);

  let step: EngineInterval;
  let aggregatedFrom: number | null = null;
  if ((ENGINE_INTERVALS as readonly number[]).includes(dominant)) {
    step = dominant as EngineInterval;
  } else if (dominant < 15 && 60 % dominant === 0) {
    step = 60;
    aggregatedFrom = dominant;
  } else if (dominant > 60) {
    return { ok: false, reason: `Your readings are ${dominant} minutes apart. A load forecast needs readings at least hourly: coarser totals give an average but not when the energy is used.` };
  } else {
    return { ok: false, reason: `Readings ${dominant} minutes apart cannot be combined into whole hours, so a load forecast cannot be made from them. A meter export at 15, 30 or 60 minutes works.` };
  }

  const same = all.filter((o) => o.intervalMinutes === dominant).sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const gridMs = dominant * MIN_MS;
  const t0 = same[0]!.ts.getTime();
  // Combined hours are India Standard Time hours (they start at :30 UTC), the same clock the Energy DNA and the engine use.
  const zone = IST_OFFSET_MINUTES * MIN_MS;
  const first = aggregatedFrom ? Math.floor((t0 + zone) / 3_600_000) * 3_600_000 - zone : t0;

  let offGrid = 0;
  const place = new Map<number, number>();
  for (const o of same) {
    if ((o.ts.getTime() - t0) % gridMs !== 0) {
      offGrid++;
      continue;
    }
    place.set(o.ts.getTime(), o.kwh);
  }

  const stepMs = step * MIN_MS;
  const last = same[same.length - 1]!.ts.getTime();
  const n = Math.floor((last + gridMs - first) / stepMs);
  const kwh: (number | null)[] = new Array<number | null>(n).fill(null);
  let used = 0;
  let gaps = 0;
  if (aggregatedFrom) {
    const per = 60 / aggregatedFrom;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let have = 0;
      for (let j = 0; j < per; j++) {
        const v = place.get(first + i * stepMs + j * gridMs);
        if (v !== undefined) {
          sum += v;
          have++;
        }
      }
      if (have === per) {
        kwh[i] = round(sum);
        used += per;
      } else {
        gaps++; // an hour with any reading missing stays empty; the readings it did have are not used
      }
    }
  } else {
    for (let i = 0; i < n; i++) {
      const v = place.get(first + i * stepMs);
      if (v === undefined) gaps++;
      else {
        kwh[i] = v;
        used++;
      }
    }
  }

  return {
    ok: true,
    series: { startTime: new Date(first).toISOString().replace(".000Z", "Z"), intervalMinutes: step, kwh },
    report: { endsAt: new Date(first + n * stepMs), used, otherInterval, offGrid, aggregatedFrom, gaps },
  };
}

const round = (v: number): number => Math.round(v * 1e6) / 1e6;
