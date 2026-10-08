import { describe, expect, it } from "vitest";
import { nextYearDays } from "../src/scenarios/calendar.js";
import { economics, yearlySavings } from "../src/scenarios/economics.js";

const base = { investmentInr: 1000, annualSavingsInr: 250, years: 10, discountRate: 0, tariffEscalation: 0, degradation: 0 };

describe("economics: answers worked out by hand", () => {
  it("pays back in 4 years when 250 a year returns 1000, with the net gain and the annuity rate of return", () => {
    const e = economics(base);
    expect(e.paybackYears).toBe(4);
    expect(e.npvInr).toBe(1500);
    expect(e.netGainInr).toBe(1500);
    expect(e.irrPercent).toBeGreaterThan(21.3); // the rate at which a 10-year annuity of 250 is worth 1000 is 21.4%
    expect(e.irrPercent).toBeLessThan(21.6);
    expect(e.cashflows).toHaveLength(10);
    expect(e.cashflows[3]).toMatchObject({ year: 4, cumulativeInr: 0 });
    expect(e.cashflows[9]!.cumulativeInr).toBe(1500);
  });

  it("discounts: at 10% the same investment is worth 536.14 more than it cost and takes 5.37 years to repay", () => {
    const e = economics({ ...base, discountRate: 0.1 });
    expect(e.npvInr).toBeCloseTo(536.14, 1); // 250 x 6.1446 - 1000
    expect(e.discountedPaybackYears).toBeCloseTo(5.37, 2);
    expect(e.paybackYears).toBe(4); // the undiscounted payback does not change with the rate
  });

  it("counts part of a year", () => {
    expect(economics({ ...base, annualSavingsInr: 400 }).paybackYears).toBe(2.5);
  });

  it("says never, with a negative rate of return, when the savings do not repay the investment in the life given", () => {
    const e = economics({ ...base, investmentInr: 10_000, annualSavingsInr: 100 });
    expect(e.paybackYears).toBeNull();
    expect(e.discountedPaybackYears).toBeNull();
    expect(e.netGainInr).toBe(-9000);
    expect(e.irrPercent).toBeLessThan(0);
    expect(e.npvInr).toBeLessThan(-9000 + 1000);
  });

  it("lets the saving grow with the tariff and shrink with ageing, year by year", () => {
    const flows = yearlySavings({ annualSavingsInr: 100, years: 3, tariffEscalation: 0.1, degradation: 0.1 });
    expect(flows[0]).toBeCloseTo(100, 9);
    expect(flows[1]).toBeCloseTo(99, 9); // 100 x 1.1 x 0.9
    expect(flows[2]).toBeCloseTo(98.01, 9);
  });

  it("has no rate of return and an immediate payback when nothing was invested, and never pays back a saving of nothing", () => {
    const free = economics({ ...base, investmentInr: 0 });
    expect(free.paybackYears).toBe(0);
    expect(free.irrPercent).toBeNull();
    expect(free.npvInr).toBe(2500);
    expect(economics({ ...base, annualSavingsInr: 0 }).paybackYears).toBeNull();
  });

  it("is not made to look better by a longer life than was asked for", () => {
    expect(economics({ ...base, years: 3 }).paybackYears).toBeNull(); // 750 in 3 years does not cover 1000
    expect(economics({ ...base, years: 4 }).paybackYears).toBe(4);
  });
});

describe("nextYearDays: weekdays and weekend days per month on the Indian clock", () => {
  const total = (xs: ReturnType<typeof nextYearDays>) => ({ weekdays: xs.reduce((a, m) => a + m.weekdays, 0), weekends: xs.reduce((a, m) => a + m.weekends, 0) });

  it("covers 365 days, which is 104 weekend days and 261 weekdays when the year starts on a Wednesday", () => {
    expect(total(nextYearDays(new Date("2026-10-07T10:10:00Z")))).toEqual({ weekdays: 261, weekends: 104 });
  });

  it("gives October both ends of the year: 25 days from this October and 6 from the next", () => {
    const oct = nextYearDays(new Date("2026-10-07T10:10:00Z"))[9]!;
    expect(oct.month).toBe(10);
    expect(oct.weekdays + oct.weekends).toBe(31);
    const nov = nextYearDays(new Date("2026-10-07T10:10:00Z"))[10]!;
    expect(nov.weekdays + nov.weekends).toBe(30);
  });

  it("starts the year at the local date: 23:59 Friday and 00:00 Saturday India time are different days", () => {
    // a year has one more day than 52 weeks, and it is the weekday the year starts on
    expect(total(nextYearDays(new Date("2026-10-09T18:29:00Z")))).toEqual({ weekdays: 261, weekends: 104 }); // 23:59 on Friday 9 October
    expect(total(nextYearDays(new Date("2026-10-09T18:30:00Z")))).toEqual({ weekdays: 260, weekends: 105 }); // 00:00 on Saturday 10 October
  });
});
