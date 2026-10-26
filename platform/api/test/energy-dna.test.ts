import { describe, expect, it } from "vitest";
import { type Obs, computeDna, percentile } from "../src/energy/dna.js";
import { IST_OFFSET_MINUTES } from "../src/energy/parse.js";

/**
 * `days` days of readings from the local date `start` (00:00 IST), at `interval` minutes, where `kw(day, hour, weekday)`
 * gives the average power. Weekday 0 is Monday. 2026-03-02 is a Monday.
 */
function series(start: string, days: number, kw: (day: number, hour: number, weekday: number) => number, interval = 60, skip: (day: number, slot: number) => boolean = () => false): Obs[] {
  const out: Obs[] = [];
  const t0 = Date.parse(`${start}T00:00:00Z`) - IST_OFFSET_MINUTES * 60_000;
  const perDay = 1440 / interval;
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < perDay; s++) {
      if (skip(d, s)) continue;
      const ts = new Date(t0 + (d * 1440 + s * interval) * 60_000);
      const hour = Math.floor((s * interval) / 60);
      const weekday = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6 + d) % 7;
      out.push({ ts, kwh: (kw(d, hour, weekday) * interval) / 60, intervalMinutes: interval });
    }
  }
  return out;
}

const MONDAY = "2026-03-02";
const ok = (o: Obs[]) => {
  const r = computeDna(o);
  if (!r.ok) throw new Error(r.reason);
  return r.dna;
};

describe("computeDna", () => {
  it("works out the baseline from days whose answer is known: weekdays 1 kW (24 kWh), weekends 2 kW (48 kWh)", () => {
    const d = ok(series(MONDAY, 14, (_d, _h, wd) => (wd >= 5 ? 2 : 1)));
    expect(d.completeDays).toBe(14);
    expect(d.weekdayDailyKwh).toBe(24);
    expect(d.weekendDailyKwh).toBe(48);
    expect(d.meanDailyKwh).toBeCloseTo((10 * 24 + 4 * 48) / 14, 3); // 30.857
    expect(d.intervalMinutes).toBe(60);
  });

  it("finds the evening peak in the daily pattern, with weekday and weekend patterns apart", () => {
    const d = ok(series(MONDAY, 14, (_d, h, wd) => (wd < 5 ? 0.5 : 0.8) + (h === 19 ? 2 : 0)));
    expect(d.peakHour).toBe(19);
    expect(d.peakKw).toBe(2.8);
    expect(d.patterns.hourly).toHaveLength(24);
    expect(d.patterns.hourly[19]).toBeCloseTo((10 * 2.5 + 4 * 2.8) / 14, 3);
    expect(d.patterns.weekdayHourly![19]).toBe(2.5);
    expect(d.patterns.weekendHourly![19]).toBe(2.8);
    expect(d.patterns.weekdayHourly![3]).toBe(0.5);
    expect(d.patterns.weekendHourly![3]).toBe(0.8);
  });

  it("takes the baseload as the 10th percentile of power, not the minimum", () => {
    // 21 of 24 hours at 1 kW, three overnight hours at 0.2 kW: the 10th percentile sits inside the 0.2 kW hours
    const d = ok(series(MONDAY, 7, (_d, h) => (h < 3 ? 0.2 : 1)));
    expect(d.baseloadKw).toBe(0.2);
    // one lone 0.05 kW hour in 24 is less than 10% of readings, so it does not set the baseload
    const e = ok(series(MONDAY, 7, (_d, h) => (h === 4 ? 0.05 : 1)));
    expect(e.baseloadKw).toBe(1);
  });

  it("treats a day with under 95% of its readings as incomplete and leaves it out", () => {
    const half = series(MONDAY, 8, (d) => (d === 7 ? 9 : 1), 60, (d, s) => d === 7 && s % 2 === 0); // day 8 has half its readings
    const d = ok(half);
    expect(d.completeDays).toBe(7);
    expect(d.totalDays).toBe(8);
    expect(d.meanDailyKwh).toBe(24); // the 9 kW day, half present, did not leak in
  });

  it("scales a day that is 95% or more present by the missing share, and no more", () => {
    // 15-minute data, one reading of 96 missing (99%): the day's total is scaled by 96/95
    const d = ok(series(MONDAY, 7, () => 1, 15, (day, s) => day === 0 && s === 40));
    expect(d.completeDays).toBe(7);
    expect(d.meanDailyKwh).toBeCloseTo(24, 6); // (95 x 0.25 x 96/95) = 24
  });

  it("builds monthly means only for months with at least seven complete days", () => {
    // 2026-03-25 (Wed) for 14 days: 7 days in March, 7 in April
    expect(Object.keys(ok(series("2026-03-25", 14, () => 1)).patterns.monthlyDailyKwh)).toEqual(["2026-03", "2026-04"]);
    // 2026-03-27: 5 days in March, 9 in April: March is left out
    const d = ok(series("2026-03-27", 14, (day) => (day < 5 ? 1 : 2)));
    expect(d.patterns.monthlyDailyKwh).toEqual({ "2026-04": 48 });
  });

  it("assigns hours and days in local time: a reading at 18:30 UTC is 00:00 IST the next day", () => {
    const d = ok(series(MONDAY, 7, (_d, h) => (h === 0 ? 5 : 1)));
    expect(d.patterns.hourly[0]).toBe(5); // midnight IST, not 18:30 UTC
    expect(d.peakHour).toBe(0);
  });

  it("states what it cannot know, and when seasons need more data", () => {
    const d = ok(series(MONDAY, 14, () => 1));
    expect(d.unavailable.map((g) => g.what)).toEqual(["Flexible consumption", "Weather sensitivity", "Seasonal behaviour"]);
    expect(d.unavailable[2]!.reason).toContain("1 calendar month");
    const year = ok(series("2026-01-01", 365, () => 1));
    expect(year.unavailable.map((g) => g.what)).not.toContain("Seasonal behaviour");
    expect(Object.keys(year.patterns.monthlyDailyKwh)).toHaveLength(12);
  });

  it("works from half-hourly and 15-minute readings", () => {
    expect(ok(series(MONDAY, 7, () => 1, 30)).meanDailyKwh).toBe(24);
    expect(ok(series(MONDAY, 7, () => 1, 15)).meanDailyKwh).toBe(24);
  });

  it("gives no weekend figures when fewer than two weekend days are complete, rather than averaging one day", () => {
    // Monday to Tuesday of the next week: nine days, but Sunday (day index 6) has no readings, so only Saturday is a complete weekend day
    const d = ok(series(MONDAY, 9, () => 1, 60, (day) => day === 6));
    expect(d.completeDays).toBe(8);
    expect(d.weekendDailyKwh).toBeNull();
    expect(d.patterns.weekendHourly).toBeNull();
    expect(d.weekdayDailyKwh).toBe(24);
    expect(d.patterns.weekdayHourly).not.toBeNull();
  });

  it("always has both weekend days in any seven consecutive days", () => {
    const d = ok(series("2026-03-04", 7, () => 1)); // Wednesday to Tuesday
    expect(d.weekendDailyKwh).toBe(24);
    expect(d.weekdayDailyKwh).toBe(24);
  });
});

describe("computeDna refusals", () => {
  it("refuses with fewer than seven complete days, saying how many it found", () => {
    const r = computeDna(series(MONDAY, 5, () => 1));
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("at least 7 complete days") });
    expect((r as { reason: string }).reason).toContain("5 out of 5 days");
  });

  it("refuses coarse readings: daily totals cannot give a daily pattern", () => {
    const r = computeDna(series(MONDAY, 30, () => 1, 1440));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("at least hourly");
  });

  it("refuses when there is nothing", () => {
    expect(computeDna([])).toEqual({ ok: false, reason: "There are no meter readings yet." });
  });

  it("refuses when whole hours are missing from every day", () => {
    const r = computeDna(series(MONDAY, 10, () => 1, 15, (_d, s) => s >= 8 && s < 12)); // 02:00 to 03:00 never read: 92/96 = 95.8% so days are complete
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("no readings at all");
  });

  it("uses the dominant interval and ignores readings at another one", () => {
    const hourly = series(MONDAY, 8, () => 1, 60);
    const stray = series(MONDAY, 1, () => 100, 15).slice(0, 10);
    const d = ok([...hourly, ...stray]);
    expect(d.intervalMinutes).toBe(60);
    expect(d.meanDailyKwh).toBe(24);
  });
});

describe("percentile", () => {
  it("interpolates", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10], 0.9)).toBe(10);
    expect(percentile([0, 10], 0.1)).toBe(1);
  });
});
