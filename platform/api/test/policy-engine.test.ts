import { describe, expect, it } from "vitest";
import { ResidentialCfaRule, residentialSubsidy } from "../src/policy/pmsg.js";

// The schedule as stated on the official portal (data/policy/pm_surya_ghar.json).
const rule = ResidentialCfaRule.parse({
  tiers: [
    { upToKw: 2, inrPerKw: 30000 },
    { upToKw: 3, inrPerKw: 18000 },
  ],
  capInr: 78000,
});

describe("residentialSubsidy", () => {
  it.each([
    [0.5, 15000],
    [1, 30000],
    [2, 60000],
    [2.5, 69000],
    [3, 78000],
    [5, 78000],
    [100, 78000],
  ])("%d kWp gets %d", (kwp, expected) => expect(residentialSubsidy(rule, kwp).subsidyInr).toBe(expected));

  it("shows each step of the sum", () => {
    expect(residentialSubsidy(rule, 2.5).steps).toEqual([
      { fromKw: 0, toKw: 2, kw: 2, inrPerKw: 30000, amountInr: 60000 },
      { fromKw: 2, toKw: 2.5, kw: 0.5, inrPerKw: 18000, amountInr: 9000 },
    ]);
  });

  it("gives nothing for no system or a nonsense size", () => {
    for (const kw of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(residentialSubsidy(rule, kw).subsidyInr).toBe(0);
  });

  it("applies the cap when the tiers would pay more, and reports it", () => {
    const generous = ResidentialCfaRule.parse({ tiers: [{ upToKw: 10, inrPerKw: 30000 }], capInr: 100000 });
    const r = residentialSubsidy(generous, 8);
    expect(r).toMatchObject({ subsidyInr: 100000, uncappedInr: 240000, capApplied: true });
  });

  it("does not depend on the order the tiers are stored in", () => {
    const shuffled = ResidentialCfaRule.parse({ tiers: [{ upToKw: 3, inrPerKw: 18000 }, { upToKw: 2, inrPerKw: 30000 }], capInr: 78000 });
    expect(residentialSubsidy(shuffled, 2.5).subsidyInr).toBe(69000);
  });

  it("rejects a rule that is not in the expected shape", () => {
    expect(ResidentialCfaRule.safeParse({ tiers: [], capInr: 1 }).success).toBe(false);
    expect(ResidentialCfaRule.safeParse({ tiers: [{ upToKw: 2, inrPerKw: -1 }], capInr: 1 }).success).toBe(false);
  });
});
