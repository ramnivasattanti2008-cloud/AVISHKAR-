import { describe, expect, it } from "vitest";
import { MIN_SCORED_HOURS, type Reading, hourlyActuals, scoreLoad } from "../src/forecast/evaluate.js";

const HOUR = 3_600_000;
/** 2026-03-02 00:00 IST. */
const T0 = Date.parse("2026-03-01T18:30:00Z");
const reading = (offsetMin: number, kwh: number, interval: number): Reading => ({ ts: new Date(T0 + offsetMin * 60_000), kwh, intervalMinutes: interval });

describe("hourlyActuals: mean power per local hour, only where the readings cover the whole hour", () => {
  it("takes an hourly reading as its kW", () => {
    const m = hourlyActuals([reading(0, 1.5, 60), reading(60, 2, 60)]);
    expect(m.get(T0)).toBe(1.5);
    expect(m.get(T0 + HOUR)).toBe(2);
  });

  it("adds finer readings up to the hour, and drops an hour with one missing", () => {
    const quarter = [0, 15, 30, 45].map((m) => reading(m, 0.25, 15));
    const partial = [60, 75, 105].map((m) => reading(m, 0.25, 15)); // the 90-minute reading is missing
    const m = hourlyActuals([...quarter, ...partial]);
    expect(m.get(T0)).toBe(1);
    expect(m.has(T0 + HOUR)).toBe(false);
  });

  it("puts hours on the local clock, not the UTC one", () => {
    const m = hourlyActuals([reading(0, 1, 60)]);
    expect([...m.keys()][0]! % HOUR).toBe(30 * 60_000); // IST hours begin at :30 UTC
  });

  it("does not use readings that cannot be placed in a whole hour", () => {
    expect(hourlyActuals([reading(0, 3, 120)]).size).toBe(0); // two-hour readings
    expect(hourlyActuals([reading(0, 1, 45)]).size).toBe(0); // 45 does not divide an hour
    expect(hourlyActuals([reading(30, 1, 60)]).size).toBe(0); // an hourly reading that straddles two local hours
  });
});

function forecast(n: number, p50: number, band: [number, number], start = T0) {
  return {
    times: Array.from({ length: n }, (_, i) => new Date(start + i * HOUR).toISOString()),
    p10Kw: Array.from({ length: n }, () => band[0]),
    p50Kw: Array.from({ length: n }, () => p50),
    p90Kw: Array.from({ length: n }, () => band[1]),
  };
}
const actuals = (n: number, f: (i: number) => number, start = T0) => new Map(Array.from({ length: n }, (_, i) => [start + i * HOUR, f(i)] as const));

describe("scoreLoad: a forecast against what the meter recorded", () => {
  it("measures the error and the bias in kW, and whether the band held", () => {
    const s = scoreLoad(forecast(24, 1.2, [1.1, 1.5]), actuals(24, () => 1.0))!; // 1.0 is below the band
    expect(s).toMatchObject({ hours: 24, maeKw: 0.2, rmseKw: 0.2, biasKw: 0.2, coverage80: 0, wapePct: 20 });
    // the same forecast against actual 1.3: inside the band, and now runs low
    const t = scoreLoad(forecast(24, 1.2, [0.9, 1.5]), actuals(24, () => 1.3))!;
    expect(t).toMatchObject({ coverage80: 1, biasKw: -0.1, maeKw: 0.1 });
  });

  it("is RMSE-sensitive to a single large miss while MAE is not", () => {
    const a = actuals(24, (i) => (i === 0 ? 5 : 1));
    const s = scoreLoad(forecast(24, 1, [0.5, 1.5]), a)!;
    expect(s.maeKw).toBeCloseTo(4 / 24, 4);
    expect(s.rmseKw).toBeCloseTo(Math.sqrt(16 / 24), 4);
    expect(s.coverage80).toBeCloseTo(23 / 24, 4);
  });

  it("scores only the hours that have a reading", () => {
    const a = actuals(24, () => 1);
    for (const i of [3, 4, 5]) a.delete(T0 + i * HOUR);
    expect(scoreLoad(forecast(24, 2, [1, 3]), a)!.hours).toBe(21);
  });

  it("will not score fewer hours than there are to say anything", () => {
    expect(scoreLoad(forecast(24, 1, [0, 2]), actuals(MIN_SCORED_HOURS - 1, () => 1))).toBeNull();
    expect(scoreLoad(forecast(24, 1, [0, 2]), actuals(MIN_SCORED_HOURS, () => 1))!.hours).toBe(MIN_SCORED_HOURS);
  });

  it("compares with repeating the same hour a week earlier, on the hours where both exist", () => {
    const week = 168 * HOUR;
    const start = T0 + week;
    const a = actuals(24, () => 1.0, start); // this week
    for (const [t, v] of actuals(24, () => 0.5, T0)) a.set(t, v); // a week earlier: 0.5, so repeating it misses by 0.5
    const good = scoreLoad(forecast(24, 1.1, [0.9, 1.3], start), a)!; // misses by 0.1
    expect(good.lastWeek).toEqual({ hours: 24, maeKw: 0.5, modelMaeKw: 0.1 });
    expect(good.skillVsLastWeek).toBeCloseTo(0.8, 4); // 1 - 0.1/0.5
    const bad = scoreLoad(forecast(24, 2, [1.5, 2.5], start), a)!; // misses by 1.0: worse than last week
    expect(bad.skillVsLastWeek).toBeCloseTo(-1, 4);
  });

  it("has no baseline figure when there is no week-earlier data", () => {
    const s = scoreLoad(forecast(24, 1, [0.5, 1.5]), actuals(24, () => 1))!;
    expect(s.lastWeek).toBeNull();
    expect(s.skillVsLastWeek).toBeNull();
  });
});
