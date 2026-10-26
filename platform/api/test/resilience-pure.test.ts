import { describe, expect, it } from "vitest";
import { type BatterySpec, hoursWithoutSun, reserveFor, surviveOutage } from "../src/resilience/simulate.js";

// 10 kWh battery with 1 kWh never used, 90% to discharge, 100% to charge to keep the sums exact, 5 kW each way
const B: BatterySpec = { minSocKwh: 1, maxSocKwh: 10, maxChargeKw: 5, maxDischargeKw: 5, chargeEfficiency: 1, dischargeEfficiency: 0.9 };
const none = (n: number) => new Array<number>(n).fill(0);

describe("surviveOutage", () => {
  it("lasts as long as the usable charge divided by what the load draws, counting discharge losses, to the fraction of an hour", () => {
    // from 6 kWh: 5 usable x 0.9 = 4.5 kWh delivered, at 1 kW that is 4.5 hours
    const r = surviveOutage({ pvKw: none(24), criticalKw: 1, battery: B, startSocKwh: 6 });
    expect(r.hoursCovered).toBeCloseTo(4.5, 9);
    expect(r.survivesHorizon).toBe(false);
    expect(r.socKwh).toHaveLength(5); // four whole hours, then the one that runs out
    expect(r.socKwh[0]).toBeCloseTo(6 - 1 / 0.9, 9);
    expect(r.socKwh[4]).toBeCloseTo(1, 9); // down to the floor and no lower
  });

  it("survives the whole horizon when the charge covers it, and says so", () => {
    const r = surviveOutage({ pvKw: none(3), criticalKw: 1, battery: B, startSocKwh: 6 });
    expect(r).toMatchObject({ hoursCovered: 3, survivesHorizon: true });
    expect(r.socKwh[2]).toBeCloseTo(6 - 3 / 0.9, 9);
  });

  it("lets the sun serve the load first and charge the battery with what is left", () => {
    // 3 kW of sun against 1 kW of load: 2 kW goes into a battery that can take 5, so +2 kWh in each of the two sunny hours
    const sunny = surviveOutage({ pvKw: [3, 3, ...none(8)], criticalKw: 1, battery: B, startSocKwh: 2 });
    expect(sunny.socKwh[0]).toBeCloseTo(4, 9);
    expect(sunny.socKwh[1]).toBeCloseTo(6, 9);
    // then the dark: from 6 kWh that is 4.5 more hours, so 2 sunny hours plus 4.5 dark ones
    expect(sunny.survivesHorizon).toBe(false);
    expect(sunny.hoursCovered).toBeCloseTo(6.5, 9);
  });

  it("never charges past the ceiling or faster than the battery allows", () => {
    const r = surviveOutage({ pvKw: [20, 20], criticalKw: 1, battery: { ...B, maxChargeKw: 2 }, startSocKwh: 9 });
    expect(r.socKwh[0]).toBeCloseTo(10, 9); // 1 kWh of room, not 2
    expect(r.socKwh[1]).toBeCloseTo(10, 9);
    const slow = surviveOutage({ pvKw: [20], criticalKw: 1, battery: { ...B, maxChargeKw: 2 }, startSocKwh: 2 });
    expect(slow.socKwh[0]).toBeCloseTo(4, 9); // 2 kW in, however much sun there is
  });

  it("cannot deliver more than the battery's power: a load above it is served only in part, at once", () => {
    const r = surviveOutage({ pvKw: none(5), criticalKw: 8, battery: B, startSocKwh: 10 });
    expect(r.hoursCovered).toBeCloseTo(5 / 8, 9); // 5 of the 8 kW in the first hour
    expect(r.survivesHorizon).toBe(false);
  });

  it("gives no backup at all without a battery, whatever the sun", () => {
    expect(surviveOutage({ pvKw: [5, 5, 5], criticalKw: 1, battery: null, startSocKwh: 0 })).toEqual({ hoursCovered: 0, survivesHorizon: false, socKwh: [] });
  });

  it("starts from the charge it is given, held between the floor and the ceiling", () => {
    expect(surviveOutage({ pvKw: none(24), criticalKw: 1, battery: B, startSocKwh: 0 }).hoursCovered).toBe(0); // below the floor is the floor
    expect(surviveOutage({ pvKw: none(24), criticalKw: 1, battery: B, startSocKwh: 99 }).hoursCovered).toBeCloseTo(8.1, 9); // above the ceiling is the ceiling: 9 x 0.9
  });
});

describe("hoursWithoutSun", () => {
  it("is the battery alone against the load, to the fraction of an hour", () => {
    expect(hoursWithoutSun(1, B, 6)).toBeCloseTo(4.5, 9);
    expect(hoursWithoutSun(0.5, B, 6)).toBeCloseTo(9, 9);
    expect(hoursWithoutSun(1, null, 6)).toBe(0);
  });
});

describe("reserveFor", () => {
  it("is the floor plus what the load draws in the time asked, counting discharge losses", () => {
    const r = reserveFor(1, 4, B);
    expect(r.reserveKwh).toBeCloseTo(1 + 4 / 0.9, 9);
    expect(r.feasible).toBe(true);
    expect(r.longestPossibleHours).toBeCloseTo(8.1, 9);
  });

  it("says it is not possible when the battery cannot hold that much", () => {
    const r = reserveFor(2, 6, B); // 1 + 12/0.9 = 14.3 kWh in a 10 kWh battery
    expect(r.feasible).toBe(false);
    expect(r.longestPossibleHours).toBeCloseTo(4.05, 9);
  });
});
