import { describe, expect, it } from "vitest";
import { calculateDrift, compareHours } from "../src/plan/drift.js";

const T0 = Date.parse("2026-10-07T00:30:00Z");
const times = [0, 1, 2, 3].map((h) => new Date(T0 + h * 3_600_000).toISOString());
const at = (h: number, m = 0) => new Date(T0 + h * 3_600_000 + m * 60_000);
const quarterHours = (h: number, kwh: number, n = 4) => Array.from({ length: n }, (_, q) => ({ ts: at(h, q * 15), intervalMinutes: 15, importKwh: kwh }));

describe("calculateDrift", () => {
  it("is signed: positive when more was used than planned", () => {
    expect(calculateDrift(10, 10.5, 15)).toEqual({ driftPercent: 5, replanRecommended: false });
    expect(calculateDrift(10, 12.5, 15)).toEqual({ driftPercent: 25, replanRecommended: true });
    expect(calculateDrift(10, 7, 15)).toEqual({ driftPercent: -30, replanRecommended: true });
  });

  it("uses the tolerance it is given", () => {
    expect(calculateDrift(10, 12, 25).replanRecommended).toBe(false);
    expect(calculateDrift(10, 12, 10).replanRecommended).toBe(true);
  });
});

describe("compareHours", () => {
  const load = [1, 2, 3, 4];

  it("compares only hours that have ended, as energy (kW x hours)", () => {
    const readings = [...quarterHours(0, 0.25), ...quarterHours(1, 0.5), ...quarterHours(2, 1)];
    const out = compareHours(times, load, 1, readings, at(2, 30));
    expect(out).toEqual([
      { time: times[0], plannedKwh: 1, observedKwh: 1 },
      { time: times[1], plannedKwh: 2, observedKwh: 2 },
    ]);
  });

  it("leaves out an hour whose readings do not cover it, rather than filling it in", () => {
    const readings = [...quarterHours(0, 0.25, 3), ...quarterHours(1, 0.5)];
    expect(compareHours(times, load, 1, readings, at(4)).map((h) => h.time)).toEqual([times[1]]);
  });

  it("leaves out an hour when a reading spills past its end", () => {
    const readings = [{ ts: at(0, 30), intervalMinutes: 60, importKwh: 1 }, ...quarterHours(1, 0.5)];
    expect(compareHours(times, load, 1, readings, at(4)).map((h) => h.time)).toEqual([times[1]]);
  });

  it("accepts one hourly reading per hour", () => {
    const readings = [{ ts: at(0), intervalMinutes: 60, importKwh: 1.2 }, { ts: at(1), intervalMinutes: 60, importKwh: 1.8 }];
    expect(compareHours(times, load, 1, readings, at(3))).toEqual([
      { time: times[0], plannedKwh: 1, observedKwh: 1.2 },
      { time: times[1], plannedKwh: 2, observedKwh: 1.8 },
    ]);
  });

  it("returns nothing before the first hour has ended", () => {
    expect(compareHours(times, load, 1, quarterHours(0, 0.25), at(0, 59))).toEqual([]);
  });
});
