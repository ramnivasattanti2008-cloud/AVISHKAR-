import { describe, expect, it } from "vitest";
import { tariffPlan } from "@/test/fixtures";
import { formatInr } from "./format";
import { CONSUMER_LABELS, USAGE_PATTERNS, describePlan, hourShareFor, rateSummary } from "./tariff";

describe("hourShareFor", () => {
  it("is undefined for an even spread, so the API applies its own default", () => {
    expect(hourShareFor("even")).toBeUndefined();
  });

  it.each(["daytime", "evening"] as const)("%s sums to 1 over 24 hours", (p) => {
    const s = hourShareFor(p)!;
    expect(s).toHaveLength(24);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("puts 70% of a daytime month between 08:00 and 18:00", () => {
    const s = hourShareFor("daytime")!;
    expect(s.slice(8, 18).reduce((a, b) => a + b, 0)).toBeCloseTo(0.7, 12);
    expect(s[3]).toBeCloseTo(0.3 / 14, 12);
  });

  it("puts 60% of an evening month between 18:00 and midnight", () => {
    const s = hourShareFor("evening")!;
    expect(s.slice(18).reduce((a, b) => a + b, 0)).toBeCloseTo(0.6, 12);
    expect(s[9]).toBeCloseTo(0.4 / 18, 12);
  });

  it("describes each pattern in the words the person sees, including the numbers it assumes", () => {
    expect(USAGE_PATTERNS.map((p) => p.id)).toEqual(["even", "daytime", "evening"]);
    expect(USAGE_PATTERNS.find((p) => p.id === "daytime")!.note).toContain("70%");
    expect(USAGE_PATTERNS.find((p) => p.id === "evening")!.note).toContain("60%");
  });
});

describe("rateSummary", () => {
  it("reports the range and whether the rate changes through the day", () => {
    expect(rateSummary(tariffPlan())).toEqual({ min: 6.52, max: 9.49, timeOfDay: true });
    expect(rateSummary(tariffPlan({ hourlyRates: Array(24).fill(8.1) }))).toEqual({ min: 8.1, max: 8.1, timeOfDay: false });
  });
  it("reads a slabbed plan's range from its slabs", () => {
    const slabbed = tariffPlan({ hourlyRates: Array(24).fill(7), slabs: [{ upToKwhPerMonth: 100, rate: 3 }, { upToKwhPerMonth: null, rate: 7 }] });
    expect(rateSummary(slabbed)).toEqual({ min: 3, max: 7, timeOfDay: false });
  });
});

describe("describePlan", () => {
  it("joins state name, distribution company, category and consumer type, skipping what is not known", () => {
    expect(describePlan(tariffPlan())).toBe("Maharashtra · MSEDCL · LT II (0-20 kW) · Commercial");
    expect(describePlan(tariffPlan({ discom: null, state: null, category: null, consumerType: "RESIDENTIAL" }))).toBe("Residential");
    expect(CONSUMER_LABELS.AGRICULTURAL).toBe("Agricultural");
  });
});

describe("formatInr", () => {
  it("uses Indian grouping and shows paise only when they exist", () => {
    expect(formatInr(78000)).toBe("₹78,000");
    expect(formatInr(123456)).toBe("₹1,23,456");
    expect(formatInr(7.88125)).toBe("₹7.88");
    expect(formatInr(2364.4)).toBe("₹2,364.40");
    expect(formatInr(0)).toBe("₹0");
  });
});
