import { describe, expect, it } from "vitest";
import { MIN_ACTION_KWH, advise, eveningDemand, frontScale, stepsThroughFront } from "../src/cloudfront/front.js";

const H = 3_600_000;
const IST = 330 * 60_000;
/** An instant given as an IST wall-clock time. */
const at = (hhmm: string, day = "2026-10-08") => Date.parse(`${day}T${hhmm}:00Z`) - IST;

describe("frontScale", () => {
  // now 12:54, the plan starts at 13:00; the front arrives in 38 minutes (13:32), takes 22% of the sun, and takes 3 hours (to 16:32)
  const now = at("12:54");
  const start = at("13:00");
  const f = { arrivalMinutes: 38, reductionPercent: 22, durationHours: 3 };

  it("takes the stated share only for the part of each hour the front is overhead", () => {
    const s = frontScale(now, start, 6, f);
    expect(s[0]).toBeCloseTo(1 - 0.22 * (28 / 60), 12); // 13:32 to 14:00 is 28 of the 60 minutes
    expect(s[1]).toBeCloseTo(0.78, 12);
    expect(s[2]).toBeCloseTo(0.78, 12);
    expect(s[3]).toBeCloseTo(1 - 0.22 * (32 / 60), 12); // 16:00 to 16:32
    expect(s[4]).toBe(1);
    expect(s[5]).toBe(1);
  });

  it("leaves hours before the front untouched, and takes nothing from a front that has not begun by the end of the plan", () => {
    const late = frontScale(now, start, 4, { arrivalMinutes: 720, reductionPercent: 50, durationHours: 1 });
    expect(late).toEqual([1, 1, 1, 1]);
    const s = frontScale(now, at("11:00"), 3, f); // 11:00 and 12:00 are before the front; 13:00 is where it arrives
    expect(s.slice(0, 2)).toEqual([1, 1]);
    expect(s[2]).toBeLessThan(1);
  });

  it("takes the sun in proportion: the energy lost is the reduction times the hours covered, times the sun of those hours", () => {
    const sun = [1, 2, 3, 4, 5, 6];
    const s = frontScale(now, start, 6, f);
    const lost = sun.reduce((acc, v, i) => acc + v * (1 - s[i]!), 0);
    const expected = 0.22 * (1 * (28 / 60) + 2 * 1 + 3 * 1 + 4 * (32 / 60));
    expect(lost).toBeCloseTo(expected, 12);
  });
});

describe("stepsThroughFront", () => {
  it("counts the plan steps up to and including the one the front ends in", () => {
    const now = at("12:54");
    expect(stepsThroughFront(now, at("13:00"), 24, { arrivalMinutes: 38, reductionPercent: 22, durationHours: 3 })).toBe(4); // ends 16:32: steps 13, 14, 15, 16
    expect(stepsThroughFront(now, at("13:00"), 24, { arrivalMinutes: 6, reductionPercent: 22, durationHours: 1 })).toBe(1); // ends exactly 14:00
    expect(stepsThroughFront(now, at("13:00"), 3, { arrivalMinutes: 38, reductionPercent: 22, durationHours: 12 })).toBe(3); // cut at the horizon
  });
});

describe("eveningDemand", () => {
  const day = (evening: number, rest: number) => Array.from({ length: 24 }, (_, h) => (h >= 18 && h < 22 ? evening : rest));

  it("is HIGH when the evening's mean is at least 1.25 times the day's mean", () => {
    const r = eveningDemand(day(2, 1), at("00:00"))!;
    expect(r.eveningMeanKw).toBe(2);
    expect(r.meanKw).toBeCloseTo(28 / 24, 12);
    expect(r.ratio).toBeCloseTo(2 / (28 / 24), 12);
    expect(r.level).toBe("HIGH");
  });

  it("is NORMAL for a flat day and LOW when the evening is quiet", () => {
    expect(eveningDemand(day(1, 1), at("00:00"))!.level).toBe("NORMAL");
    expect(eveningDemand(day(0.5, 1), at("00:00"))!.level).toBe("LOW");
  });

  it("finds the evening by the local clock wherever the plan starts, and gives nothing for no load", () => {
    const shifted = Array.from({ length: 24 }, (_, i) => ((13 + i) % 24 >= 18 && (13 + i) % 24 < 22 ? 2 : 1)); // a plan starting at 13:00
    expect(eveningDemand(shifted, at("13:00"))!.level).toBe("HIGH");
    expect(eveningDemand(Array(24).fill(0), at("00:00"))).toBeNull();
    expect(eveningDemand([1, 1, 1], at("08:00"))).toBeNull(); // a horizon with no evening in it
  });
});

describe("advise", () => {
  const plan = (chargeKw: number[], dischargeKw: number[]) => ({ chargeKw, dischargeKw });

  it("says charge now when the plan that knows about the front stores more before and during it, with the amount", () => {
    const a = advise(true, 4, plan([1, 1, 0, 0, 5], [0, 0, 0, 0, 0]), plan([0, 0.5, 0, 0, 0], [0, 0, 0, 0, 0]));
    expect(a.code).toBe("CHARGE_NOW");
    expect(a.extraChargeKwh).toBe(1.5); // the 5 kW in the fifth hour is outside the window
    expect(a.text).toContain("1.5 kWh more");
  });

  it("says hold the charge when it discharges less instead", () => {
    const a = advise(true, 3, plan([0, 0, 0], [0, 0, 0.5]), plan([0, 0, 0], [1, 1, 0.5]));
    expect(a.code).toBe("HOLD_CHARGE");
    expect(a.extraHeldKwh).toBe(2);
    expect(a.text).toContain("2 kWh less");
  });

  it("says no change, plainly, when the two plans do the same, and ignores differences below rounding", () => {
    expect(advise(true, 3, plan([1, 0, 0], [0, 1, 0]), plan([1, 0, 0], [0, 1, 0])).code).toBe("NO_CHANGE");
    expect(advise(true, 3, plan([MIN_ACTION_KWH / 2, 0, 0], [0, 0, 0]), plan([0, 0, 0], [0, 0, 0])).code).toBe("NO_CHANGE");
    expect(advise(true, 3, plan([MIN_ACTION_KWH, 0, 0], [0, 0, 0]), plan([0, 0, 0], [0, 0, 0])).code).toBe("CHARGE_NOW");
  });

  it("says there is no battery to charge when there is none", () => {
    const a = advise(false, 3, plan([0, 0, 0], [0, 0, 0]), plan([0, 0, 0], [0, 0, 0]));
    expect(a.code).toBe("NO_BATTERY");
    expect(a.text).toContain("no battery");
  });

  it("uses only the window it is given", () => {
    expect(H).toBe(3_600_000); // hours are the plan's step, so kW in a step is kWh
    expect(advise(true, 0, plan([9], [0]), plan([0], [0])).code).toBe("NO_CHANGE");
  });
});
