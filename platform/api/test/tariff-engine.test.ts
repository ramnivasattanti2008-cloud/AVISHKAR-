import { describe, expect, it } from "vitest";
import { type TariffShape, computeBill, hourlyRates, normaliseShare, rateAtMinute, validateShape, validityOn } from "../src/tariff/engine.js";

const flat = (rate: number): TariffShape => ({ touBlocks: [{ startHour: 0, endHour: 24, rate }], slabs: null, fixedCharge: null });

// MSEDCL LT II FY2025-26 as recorded in data/tariffs/shop-pune.json
const pune: TariffShape = {
  touBlocks: [
    { startHour: 0, endHour: 9, rate: 7.84 },
    { startHour: 9, endHour: 17, rate: 6.52 },
    { startHour: 17, endHour: 24, rate: 9.49 },
  ],
  slabs: null,
  fixedCharge: { amountInr: 520, basis: "PER_CONNECTION_MONTH" },
};

describe("validateShape: time-of-day blocks", () => {
  it("accepts a flat tariff, a three-block tariff and blocks that wrap midnight", () => {
    expect(validateShape(flat(7))).toEqual([]);
    expect(validateShape(pune)).toEqual([]);
    expect(
      validateShape({ touBlocks: [{ startHour: 22, endHour: 6, rate: 5 }, { startHour: 6, endHour: 22, rate: 8 }], slabs: null, fixedCharge: null }),
    ).toEqual([]);
  });

  it("names the exact times that have no rate", () => {
    const p = validateShape({ touBlocks: [{ startHour: 0, endHour: 10, rate: 5 }, { startHour: 12, endHour: 24, rate: 7 }], slabs: null, fixedCharge: null });
    expect(p).toEqual(["The blocks leave these times without a rate: 10:00 to 12:00."]);
  });

  it("names the exact times where blocks overlap", () => {
    const p = validateShape({ touBlocks: [{ startHour: 0, endHour: 14, rate: 5 }, { startHour: 12, endHour: 24, rate: 7 }], slabs: null, fixedCharge: null });
    expect(p).toEqual(["The blocks overlap at: 12:00 to 14:00."]);
  });

  it("rejects an empty list, zero-length blocks, out-of-range hours, and absurd or negative rates", () => {
    expect(validateShape({ touBlocks: [], slabs: null, fixedCharge: null })[0]).toContain("at least one");
    expect(validateShape({ touBlocks: [{ startHour: 5, endHour: 5, rate: 5 }], slabs: null, fixedCharge: null })[0]).toContain("covers nothing");
    expect(validateShape({ touBlocks: [{ startHour: -1, endHour: 25, rate: 5 }], slabs: null, fixedCharge: null })[0]).toContain("between 0 and 24");
    expect(validateShape(flat(-1))[0]).toContain("outside 0 to 100");
    expect(validateShape(flat(250))[0]).toContain("outside 0 to 100");
    expect(validateShape(flat(Number.NaN))[0]).toContain("not a number");
  });
});

describe("validateShape: slabs and fixed charges", () => {
  const slabbed = (slabs: TariffShape["slabs"]): TariffShape => ({ touBlocks: [{ startHour: 0, endHour: 24, rate: 7 }], slabs, fixedCharge: null });

  it("accepts ascending slabs with an open-ended last one", () => {
    expect(validateShape(slabbed([{ upToKwhPerMonth: 100, rate: 3 }, { upToKwhPerMonth: 300, rate: 5 }, { upToKwhPerMonth: null, rate: 7 }]))).toEqual([]);
    expect(validateShape(slabbed([{ upToKwhPerMonth: null, rate: 6 }]))).toEqual([]);
  });

  it("rejects slabs that are not ascending, not closed by an open slab, or open before the end", () => {
    expect(validateShape(slabbed([{ upToKwhPerMonth: 300, rate: 5 }, { upToKwhPerMonth: 100, rate: 7 }, { upToKwhPerMonth: null, rate: 9 }]))[0]).toContain("above the previous slab");
    expect(validateShape(slabbed([{ upToKwhPerMonth: 100, rate: 3 }]))[0]).toContain("must be open-ended");
    expect(validateShape(slabbed([{ upToKwhPerMonth: null, rate: 3 }, { upToKwhPerMonth: null, rate: 5 }]))[0]).toContain("only the last slab");
  });

  it("does not allow slabs together with several time-of-day blocks", () => {
    const both: TariffShape = { ...pune, slabs: [{ upToKwhPerMonth: null, rate: 7 }], fixedCharge: null };
    expect(validateShape(both)).toContain("A plan has either slabs or several time-of-day blocks, not both: enter one flat block with the slabs.");
  });

  it("rejects a negative fixed charge", () => {
    expect(validateShape({ ...flat(7), fixedCharge: { amountInr: -5, basis: "PER_KW_MONTH" } })[0]).toContain("zero or more");
  });
});

describe("hourlyRates and rateAtMinute", () => {
  it("gives each hour the rate of the block it falls in", () => {
    const r = hourlyRates(pune.touBlocks);
    expect(r).toHaveLength(24);
    expect(r.slice(0, 9)).toEqual(Array(9).fill(7.84));
    expect(r.slice(9, 17)).toEqual(Array(8).fill(6.52));
    expect(r.slice(17)).toEqual(Array(7).fill(9.49));
  });

  it("handles a block that wraps midnight", () => {
    const blocks = [{ startHour: 22, endHour: 6, rate: 5 }, { startHour: 6, endHour: 22, rate: 8 }];
    expect(rateAtMinute(blocks, 23 * 60)).toBe(5);
    expect(rateAtMinute(blocks, 3 * 60)).toBe(5);
    expect(rateAtMinute(blocks, 12 * 60)).toBe(8);
    expect(rateAtMinute(blocks, 6 * 60)).toBe(8); // the end of a block is exclusive
    const r = hourlyRates(blocks);
    expect([r[21], r[22], r[5], r[6]]).toEqual([8, 5, 5, 8]);
  });

  it("weights an hour by time when a block starts inside it", () => {
    const r = hourlyRates([{ startHour: 0, endHour: 6.5, rate: 5 }, { startHour: 6.5, endHour: 24, rate: 8 }]);
    expect(r[6]).toBe(6.5); // half an hour at 5 and half at 8
    expect(r[5]).toBe(5);
    expect(r[7]).toBe(8);
  });

  it("returns null where no block covers the minute", () => {
    expect(rateAtMinute([{ startHour: 0, endHour: 10, rate: 5 }], 12 * 60)).toBeNull();
  });
});

describe("computeBill", () => {
  it("prices a flat tariff: 300 kWh at 7 INR is 2100", () => {
    const b = computeBill(flat(7), { monthlyKwh: 300 });
    expect(b.energyChargeInr).toBe(2100);
    expect(b.totalInr).toBe(2100);
    expect(b.effectiveRate).toBe(7);
    expect(b.fixedChargeIncluded).toBe(false);
    expect(b.assumptions.join(" ")).toContain("No fixed charge is recorded");
    expect(b.assumptions.join(" ")).toContain("duty, taxes");
  });

  it("weights a time-of-day tariff by when the energy is used", () => {
    // Even usage: (9 h x 7.84 + 8 h x 6.52 + 7 h x 9.49) / 24 = 189.15 / 24 = 7.88125 INR/kWh
    const even = computeBill(pune, { monthlyKwh: 300 });
    expect(even.energyChargeInr).toBeCloseTo(2364.375, 1);
    expect(even.fixedChargeInr).toBe(520);
    expect(even.totalInr).toBeCloseTo(2884.375, 1);
    expect(even.assumptions.join(" ")).toContain("spread evenly");

    // Everything used at noon (the cheap block): 300 x 6.52 = 1956
    const noon = Array.from({ length: 24 }, (_, h) => (h === 12 ? 1 : 0));
    const cheap = computeBill(pune, { monthlyKwh: 300, hourShare: noon });
    expect(cheap.energyChargeInr).toBe(1956);
    expect(cheap.assumptions.join(" ")).not.toContain("spread evenly");

    // Everything used at 19:00 (the peak block): 300 x 9.49 = 2847
    const peak = Array.from({ length: 24 }, (_, h) => (h === 19 ? 5 : 0)); // any scale: it is normalised
    expect(computeBill(pune, { monthlyKwh: 300, hourShare: peak }).energyChargeInr).toBe(2847);
  });

  it("applies telescopic slabs: 450 kWh over 100@3, 200@5, rest@7 is 2350", () => {
    const shape: TariffShape = { touBlocks: [{ startHour: 0, endHour: 24, rate: 7 }], slabs: [{ upToKwhPerMonth: 100, rate: 3 }, { upToKwhPerMonth: 300, rate: 5 }, { upToKwhPerMonth: null, rate: 7 }], fixedCharge: null };
    const b = computeBill(shape, { monthlyKwh: 450 });
    expect(b.lines.map((l) => [l.kwh, l.rate, l.amountInr])).toEqual([[100, 3, 300], [200, 5, 1000], [150, 7, 1050]]);
    expect(b.energyChargeInr).toBe(2350);
    expect(computeBill(shape, { monthlyKwh: 80 }).energyChargeInr).toBe(240);
    expect(computeBill(shape, { monthlyKwh: 300 }).energyChargeInr).toBe(1300); // exactly at the slab edge: 300 + 1000
    const none = computeBill(shape, { monthlyKwh: 0 });
    expect(none.lines).toEqual([]);
    expect(none.totalInr).toBe(0);
    expect(none.effectiveRate).toBeNull();
  });

  it("bills a per-kW fixed charge only when the sanctioned load is given, and says so otherwise", () => {
    const shape: TariffShape = { ...flat(6.5), fixedCharge: { amountInr: 110, basis: "PER_KW_MONTH" } };
    const withLoad = computeBill(shape, { monthlyKwh: 200, sanctionedLoadKw: 3 });
    expect(withLoad.fixedChargeInr).toBe(330);
    expect(withLoad.totalInr).toBe(1300 + 330);
    const without = computeBill(shape, { monthlyKwh: 200 });
    expect(without.fixedChargeInr).toBeNull();
    expect(without.fixedChargeIncluded).toBe(false);
    expect(without.totalInr).toBe(1300);
    expect(without.assumptions.join(" ")).toContain("give the sanctioned load");
  });

  it("refuses an unusable tariff or impossible inputs instead of producing a number", () => {
    expect(() => computeBill({ touBlocks: [{ startHour: 0, endHour: 10, rate: 5 }], slabs: null, fixedCharge: null }, { monthlyKwh: 100 })).toThrow(/not usable/);
    expect(() => computeBill(flat(7), { monthlyKwh: -1 })).toThrow(/zero or more/);
    expect(() => computeBill(pune, { monthlyKwh: 100, hourShare: [1, 2, 3] })).toThrow(/24 non-negative/);
    expect(() => computeBill(pune, { monthlyKwh: 100, hourShare: Array(24).fill(0) })).toThrow(/24 non-negative/);
  });
});

describe("normaliseShare", () => {
  it("is uniform by default, normalises any scale, and rejects bad shapes", () => {
    expect(normaliseShare(undefined)!.every((v) => Math.abs(v - 1 / 24) < 1e-12)).toBe(true);
    const s = normaliseShare(Array.from({ length: 24 }, (_, h) => (h < 12 ? 2 : 0)))!;
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(s[0]).toBeCloseTo(1 / 12, 12);
    expect(normaliseShare([1, 2])).toBeNull();
    expect(normaliseShare(Array(24).fill(-1))).toBeNull();
    expect(normaliseShare(Array(24).fill(0))).toBeNull();
  });
});

describe("validityOn", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const on = new Date("2026-10-07T09:00:00Z");

  it("flags a tariff whose published period has ended", () => {
    const v = validityOn(null, d("2026-03-31"), on);
    expect(v.status).toBe("EXPIRED");
    expect(v.message).toContain("2026-03-31");
    expect(v.message).toContain("latest bill");
  });
  it("accepts one still inside its period, and one that has not started", () => {
    expect(validityOn(d("2026-04-01"), d("2027-03-31"), on).status).toBe("WITHIN");
    expect(validityOn(d("2026-11-01"), null, on).status).toBe("NOT_YET_EFFECTIVE");
  });
  it("calls a plan with a start but no end open-ended, and one with no dates unknown, never current", () => {
    expect(validityOn(d("2025-10-01"), null, on).status).toBe("OPEN_ENDED");
    expect(validityOn(null, null, on).status).toBe("UNKNOWN");
  });
  it("treats the last day as still valid", () => {
    expect(validityOn(null, d("2026-10-07"), on).status).toBe("WITHIN");
  });
});
