/**
 * The community allocation engine, as pure arithmetic: no database, no provider, no clock.
 *
 * The first block is the worked example the project owner specified, checked number for number. The rest holds the engine to
 * the rules it claims: energy is conserved, a kW is never allocated twice, every cap binds, and a failure is reported
 * rather than smoothed away.
 */
import { describe, expect, it } from "vitest";
import { type AllocationResult, type CommunityLimits, type MemberBattery, type MemberInput, type MemberResult, allocateInterval } from "../src/community/allocate.js";

const LIMITS: CommunityLimits = {
  feederLimitKw: 1000,
  networkLossFraction: 0,
  rule: "PROPORTIONAL",
  batteryPolicy: "SHARE_FIRST",
  stepHours: 1,
};

function member(name: string, generationKw: number, demandKw: number, over: Partial<MemberInput> = {}): MemberInput {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    generationKw,
    demandKw,
    criticalKw: 0,
    battery: null,
    exportLimitKw: 1000,
    importLimitKw: 1000,
    lineLossFraction: 0,
    ...over,
  };
}

function battery(over: Partial<MemberBattery> = {}): MemberBattery {
  return { usableKwh: 10, socKwh: 5, reserveKwh: 0, maxChargeKw: 5, maxDischargeKw: 5, roundTripEfficiency: 0.9, ...over };
}

const byName = (r: AllocationResult, name: string): MemberResult => r.members.find((m) => m.name === name)!;

describe("the specified three-building scenario", () => {
  /**
   * A generates 8 kW and uses 3; B generates 2 and uses 4; C generates nothing and uses 3. Lossless, no battery
   * charging, sharing permitted. Generation and demand are both 10 kW, so the community should buy nothing.
   */
  const buildings = () => [member("Building A", 8, 3), member("Building B", 2, 4), member("Building C", 0, 3)];

  it("allocates 2 kW to B and 3 kW to C, and the community imports nothing", () => {
    const r = allocateInterval(buildings(), LIMITS);

    expect(byName(r, "Building A").offeredKw).toBe(5);
    expect(byName(r, "Building B").requestedKw).toBe(2);
    expect(byName(r, "Building C").requestedKw).toBe(3);

    expect(byName(r, "Building B").receivedKw).toBe(2);
    expect(byName(r, "Building C").receivedKw).toBe(3);
    expect(byName(r, "Building A").sentKw).toBe(5);

    expect(r.totals.gridImportKw).toBe(0);
    expect(r.totals.gridExportKw).toBe(0);
    expect(r.totals.curtailedKw).toBe(0);
    expect(r.totals.unservedKw).toBe(0);
    expect(r.totals.selfSufficiency).toBe(1);
    expect(r.totals.selfConsumption).toBe(1);
  });

  it("totals the surplus and the deficits the way the brief states them", () => {
    const r = allocateInterval(buildings(), LIMITS);
    expect(r.totals.generationKw).toBe(10);
    expect(r.totals.demandKw).toBe(10);
    // A's 3 kW on itself, B's own 2 kW on itself: 5 kW never went near the shared node.
    expect(r.totals.selfUseKw).toBe(5);
    expect(r.totals.offeredKw).toBe(5);
    expect(r.totals.requestedKw).toBe(5);
    expect(r.totals.sharedSentKw).toBe(5);
    expect(r.totals.sharedDeliveredKw).toBe(5);
    expect(r.totals.transferLossKw).toBe(0);
  });

  it("names who sent to whom, and the pairs add up to what was sent", () => {
    const r = allocateInterval(buildings(), LIMITS);
    expect(r.transfers).toHaveLength(2);
    const toB = r.transfers.find((t) => t.toName === "Building B")!;
    const toC = r.transfers.find((t) => t.toName === "Building C")!;
    expect(toB.fromName).toBe("Building A");
    expect(toB.deliveredKw).toBe(2);
    expect(toC.deliveredKw).toBe(3);
    expect(toB.sentKw + toC.sentKw).toBeCloseTo(5, 9);
  });

  it("balances every property and the community", () => {
    const r = allocateInterval(buildings(), LIMITS);
    expect(r.check.balanced).toBe(true);
    expect(r.check.maxMemberErrorKw).toBeLessThanOrEqual(1e-6);
    expect(r.check.communityErrorKw).toBeLessThanOrEqual(1e-6);
  });

  it("explains each step rather than only reporting the answer", () => {
    const r = allocateInterval(buildings(), LIMITS);
    expect(r.decisions.length).toBeGreaterThanOrEqual(5);
    expect(r.decisions.join(" ")).toContain("never allocated twice");
    expect(byName(r, "Building C").explanation).toContain("Received");
  });
});

describe("scenario two: generation falls and the community must handle a deficit", () => {
  /** The same three buildings on a dull evening: A makes 1 kW, B 0.5, C nothing, and demand is unchanged. */
  const dull = () => [member("Building A", 1, 3), member("Building B", 0.5, 4), member("Building C", 0, 3)];

  it("buys the shortfall and reports it, with nothing shared", () => {
    const r = allocateInterval(dull(), LIMITS);
    expect(r.totals.offeredKw).toBe(0);
    expect(r.totals.sharedDeliveredKw).toBe(0);
    // 10 kW of demand, 1.5 kW generated on site: 8.5 kW has to be bought.
    expect(r.totals.gridImportKw).toBe(8.5);
    expect(r.totals.unservedKw).toBe(0);
    expect(r.totals.selfSufficiency).toBe(0.15);
    expect(r.check.balanced).toBe(true);
  });

  it("uses the batteries that are there before buying, and stops at the reserve floor", () => {
    const withStorage = [
      member("Building A", 1, 3, { battery: battery({ usableKwh: 10, socKwh: 8, reserveKwh: 2, maxDischargeKw: 4 }) }),
      member("Building B", 0.5, 4, { battery: battery({ usableKwh: 5, socKwh: 1, reserveKwh: 1, maxDischargeKw: 3 }) }),
      member("Building C", 0, 3),
    ];
    const r = allocateInterval(withStorage, LIMITS);
    const a = byName(r, "Building A");
    // A is 2 kW short, has 6 kWh above its reserve and may deliver 4 kW: it covers the lot from its own battery.
    expect(a.batteryDischargeKw).toBe(2);
    expect(a.batterySocKwh).toBe(6);
    expect(a.gridImportKw).toBe(0);
    // B sits at its reserve floor, so its battery gives nothing however short it is.
    const b = byName(r, "Building B");
    expect(b.batteryDischargeKw).toBe(0);
    expect(b.binding).toBe("BATTERY_EMPTY");
    expect(b.gridImportKw).toBe(3.5);
    expect(r.check.balanced).toBe(true);
  });

  it("reports demand as unserved when the import limit cannot cover it, instead of inventing supply", () => {
    const r = allocateInterval([member("Building C", 0, 3, { importLimitKw: 1 })], LIMITS);
    const c = byName(r, "Building C");
    expect(c.gridImportKw).toBe(1);
    expect(c.unservedKw).toBe(2);
    expect(c.binding).toBe("IMPORT_LIMIT");
    expect(r.check.balanced).toBe(true);
  });
});

describe("scenario three: a transfer constraint prevents full allocation", () => {
  const buildings = () => [member("Building A", 8, 3), member("Building B", 2, 4), member("Building C", 0, 3)];

  it("holds the shared node to the feeder limit and buys the rest", () => {
    const r = allocateInterval(buildings(), { ...LIMITS, feederLimitKw: 3 });
    expect(r.feederBinding).toBe(true);
    expect(r.feederFlowKw).toBe(3);
    expect(r.totals.sharedDeliveredKw).toBe(3);
    // 5 kW of deficit, 3 kW of it shared: 2 kW bought.
    expect(r.totals.gridImportKw).toBe(2);
    // Divided in proportion to the asks of 2 and 3 kW.
    expect(byName(r, "Building B").receivedKw).toBeCloseTo(1.2, 6);
    expect(byName(r, "Building C").receivedKw).toBeCloseTo(1.8, 6);
    // A could not place the other 2 kW of its surplus, so it sold it.
    expect(byName(r, "Building A").gridExportKw).toBe(2);
    expect(r.check.balanced).toBe(true);
    expect(r.decisions.join(" ")).toContain("binding constraint");
  });

  it("names the feeder as the cap that bound the properties left short", () => {
    const r = allocateInterval(buildings(), { ...LIMITS, feederLimitKw: 3 });
    expect(byName(r, "Building B").binding).toBe("FEEDER_LIMIT");
    expect(byName(r, "Building C").binding).toBe("FEEDER_LIMIT");
    expect(byName(r, "Building C").explanation).toContain("feeder limit");
  });

  it("holds a sender to its own export limit and curtails what will not fit", () => {
    const r = allocateInterval([member("Building A", 8, 3, { exportLimitKw: 1 }), member("Building C", 0, 3)], LIMITS);
    const a = byName(r, "Building A");
    expect(a.sentKw).toBe(1);
    expect(a.gridExportKw).toBe(0);
    // 5 kW of surplus, 1 kW of which the meter let out: the other 4 kW is thrown away, not sold.
    expect(a.curtailedKw).toBe(4);
    expect(a.binding).toBe("EXPORT_LIMIT");
    expect(byName(r, "Building C").gridImportKw).toBe(2);
    expect(r.check.balanced).toBe(true);
  });

  it("caps a receiver at its own import limit", () => {
    const r = allocateInterval([member("Building A", 8, 3), member("Building C", 0, 3, { importLimitKw: 1 })], LIMITS);
    expect(byName(r, "Building C").receivedKw).toBe(1);
    expect(byName(r, "Building C").unservedKw).toBe(2);
    expect(r.check.balanced).toBe(true);
  });
});

describe("losses", () => {
  it("charges the sender's line, the shared network and the receiver's line exactly once each", () => {
    const r = allocateInterval([member("A", 8, 3, { lineLossFraction: 0.02 }), member("C", 0, 3, { lineLossFraction: 0.03 })], { ...LIMITS, networkLossFraction: 0.05 });
    const c = byName(r, "C");
    // C needs 3 kW past its meter, so it must draw 3 / 0.97 at the node. Reported figures are rounded to four decimals.
    expect(c.allocatedKw).toBeCloseTo(3 / 0.97, 4);
    expect(c.receivedKw).toBeCloseTo(3, 4);
    // Which the node must receive 3/0.97/0.95 of, and A must send 3/0.97/0.95/0.98 of.
    expect(byName(r, "A").sentKw).toBeCloseTo(3 / 0.97 / 0.95 / 0.98, 4);
    expect(r.totals.transferLossKw).toBeCloseTo(byName(r, "A").sentKw - 3, 4);
    expect(r.check.balanced).toBe(true);
  });

  it("never lets a loss create or destroy energy", () => {
    const r = allocateInterval(
      [member("A", 9, 2, { lineLossFraction: 0.04 }), member("B", 1, 5, { lineLossFraction: 0.07 }), member("C", 0, 4, { lineLossFraction: 0.01 })],
      { ...LIMITS, networkLossFraction: 0.08 },
    );
    expect(r.check.balanced).toBe(true);
    expect(r.totals.transferLossKw).toBeCloseTo(r.totals.sharedSentKw - r.totals.sharedDeliveredKw, 9);
    const paired = r.transfers.reduce((a, t) => a + t.lossKw, 0);
    expect(paired).toBeCloseTo(r.totals.transferLossKw, 6);
  });

  it("refuses a loss above half rather than quietly clamping it", () => {
    expect(() => allocateInterval([member("A", 8, 3, { lineLossFraction: 1 }), member("C", 0, 3)], LIMITS)).toThrow(/line loss must be between 0 and 0.5/);
    expect(() => allocateInterval([member("A", 8, 3), member("C", 0, 3)], { ...LIMITS, networkLossFraction: 1 })).toThrow(/loss must be between 0 and 0.5/);
    expect(() => allocateInterval([member("A", 8, 3, { lineLossFraction: -0.1 })], LIMITS)).toThrow(/line loss/);
  });

  it("stays finite at the worst loss it does allow", () => {
    const r = allocateInterval([member("A", 8, 3, { lineLossFraction: 0.5 }), member("C", 0, 3, { lineLossFraction: 0.5 })], { ...LIMITS, networkLossFraction: 0.5 });
    // A may send at most its 5 kW surplus; an eighth of that survives three halvings.
    expect(byName(r, "C").receivedKw).toBeCloseTo(5 / 8, 6);
    expect(byName(r, "C").gridImportKw).toBeCloseTo(3 - 5 / 8, 6);
    expect(Number.isFinite(r.totals.sharedDeliveredKw)).toBe(true);
    expect(r.check.balanced).toBe(true);
  });

  it("refuses an impossible limit or interval", () => {
    expect(() => allocateInterval([member("A", 1, 1)], { ...LIMITS, feederLimitKw: -1 })).toThrow(/feeder limit/);
    expect(() => allocateInterval([member("A", 1, 1)], { ...LIMITS, stepHours: 0 })).toThrow(/interval/);
    expect(() => allocateInterval([member("A", 1, 1, { exportLimitKw: -1 })], LIMITS)).toThrow(/export limit/);
    expect(() => allocateInterval([member("A", 1, 1, { importLimitKw: -1 })], LIMITS)).toThrow(/import limit/);
  });
});

describe("allocation rules", () => {
  // 3 kW to divide between asks of 1 and 4 kW.
  const scarce = () => [member("Big", 6, 3), member("Small ask", 0, 1), member("Large ask", 0, 4)];

  it("PROPORTIONAL divides in proportion to the asks", () => {
    const r = allocateInterval(scarce(), { ...LIMITS, feederLimitKw: 3, rule: "PROPORTIONAL" });
    expect(byName(r, "Small ask").receivedKw).toBeCloseTo(0.6, 6);
    expect(byName(r, "Large ask").receivedKw).toBeCloseTo(2.4, 6);
  });

  it("EQUAL_SHARE meets the smaller ask in full and gives the rest to the other", () => {
    const r = allocateInterval(scarce(), { ...LIMITS, feederLimitKw: 3, rule: "EQUAL_SHARE" });
    expect(byName(r, "Small ask").receivedKw).toBe(1);
    expect(byName(r, "Large ask").receivedKw).toBe(2);
  });

  it("CRITICAL_FIRST covers critical demand before anything else", () => {
    const members = [member("Big", 6, 3), member("Has a clinic", 0, 4, { criticalKw: 2.5 }), member("Ordinary", 0, 1)];
    const r = allocateInterval(members, { ...LIMITS, feederLimitKw: 3, rule: "CRITICAL_FIRST" });
    expect(byName(r, "Has a clinic").receivedKw).toBeGreaterThanOrEqual(2.5);
    expect(r.decisions.join(" ")).toContain("critical");
    expect(r.check.balanced).toBe(true);
  });

  it("NEAREST_FIRST fills the property with the smallest line loss first", () => {
    const members = [member("Big", 6, 3), member("Far", 0, 2, { lineLossFraction: 0.1 }), member("Near", 0, 2, { lineLossFraction: 0.01 })];
    const r = allocateInterval(members, { ...LIMITS, feederLimitKw: 2, rule: "NEAREST_FIRST" });
    expect(byName(r, "Near").receivedKw).toBeGreaterThan(byName(r, "Far").receivedKw);
    expect(r.check.balanced).toBe(true);
  });

  it("gives no rule more than the askers asked for", () => {
    for (const rule of ["PROPORTIONAL", "EQUAL_SHARE", "CRITICAL_FIRST", "NEAREST_FIRST"] as const) {
      const r = allocateInterval([member("Big", 20, 0), member("B", 0, 2), member("C", 0, 3)], { ...LIMITS, rule });
      expect(byName(r, "B").receivedKw).toBeCloseTo(2, 6);
      expect(byName(r, "C").receivedKw).toBeCloseTo(3, 6);
      expect(r.check.balanced).toBe(true);
    }
  });
});

describe("batteries", () => {
  it("SHARE_FIRST gives a neighbour the surplus before charging the sender's own battery", () => {
    const r = allocateInterval([member("A", 8, 3, { battery: battery({ socKwh: 0, maxChargeKw: 5 }) }), member("C", 0, 3)], { ...LIMITS, batteryPolicy: "SHARE_FIRST" });
    expect(byName(r, "C").receivedKw).toBe(3);
    // 5 kW of surplus, 3 shared, and the 2 nobody wanted goes into the battery rather than being sold.
    expect(byName(r, "A").batteryChargeKw).toBe(2);
    expect(byName(r, "A").gridExportKw).toBe(0);
    expect(r.check.balanced).toBe(true);
  });

  it("BATTERY_FIRST fills the sender's own battery before the neighbour gets anything", () => {
    const r = allocateInterval([member("A", 8, 3, { battery: battery({ socKwh: 0, maxChargeKw: 5 }) }), member("C", 0, 3)], { ...LIMITS, batteryPolicy: "BATTERY_FIRST" });
    expect(byName(r, "A").batteryChargeKw).toBe(5);
    expect(byName(r, "C").receivedKw).toBe(0);
    expect(byName(r, "C").gridImportKw).toBe(3);
    expect(r.check.balanced).toBe(true);
  });

  it("puts the round-trip loss on the charge leg and respects the usable band", () => {
    // 1 kWh of headroom at 80% efficiency takes 1.25 kWh of input to fill.
    const r = allocateInterval([member("A", 5, 0, { battery: battery({ usableKwh: 10, socKwh: 9, reserveKwh: 0, maxChargeKw: 5, roundTripEfficiency: 0.8 }) })], { ...LIMITS, batteryPolicy: "BATTERY_FIRST", stepHours: 1 });
    const a = byName(r, "A");
    expect(a.batteryChargeKw).toBeCloseTo(1.25, 6);
    expect(a.batterySocKwh).toBeCloseTo(10, 6);
    expect(a.gridExportKw).toBeCloseTo(3.75, 6);
    expect(a.binding).toBe("BATTERY_FULL");
    expect(r.check.balanced).toBe(true);
  });

  it("scales a battery's energy by the length of the interval", () => {
    const quarter = allocateInterval([member("A", 0, 4, { battery: battery({ usableKwh: 10, socKwh: 10, reserveKwh: 0, maxDischargeKw: 10 }) })], { ...LIMITS, stepHours: 0.25 });
    // Four kW for a quarter of an hour is one kWh off the charge level.
    expect(byName(quarter, "A").batteryDischargeKw).toBe(4);
    expect(byName(quarter, "A").batterySocKwh).toBe(9);
    const hour = allocateInterval([member("A", 0, 4, { battery: battery({ usableKwh: 10, socKwh: 10, reserveKwh: 0, maxDischargeKw: 10 }) })], { ...LIMITS, stepHours: 1 });
    expect(byName(hour, "A").batterySocKwh).toBe(6);
  });

  it("never discharges below the reserve the owner asked to keep", () => {
    const r = allocateInterval([member("A", 0, 10, { battery: battery({ usableKwh: 10, socKwh: 10, reserveKwh: 4, maxDischargeKw: 10 }) })], LIMITS);
    expect(byName(r, "A").batteryDischargeKw).toBe(6);
    expect(byName(r, "A").batterySocKwh).toBe(4);
    expect(byName(r, "A").gridImportKw).toBe(4);
  });
});

describe("homes of every shape", () => {
  it("handles solar with no battery", () => {
    const r = allocateInterval([member("Solar only", 5, 2)], LIMITS);
    expect(byName(r, "Solar only").batterySocKwh).toBeNull();
    expect(byName(r, "Solar only").gridExportKw).toBe(3);
    expect(r.check.balanced).toBe(true);
  });

  it("handles a battery with no solar, which can still shift when it buys", () => {
    const r = allocateInterval([member("Battery only", 0, 2, { battery: battery({ socKwh: 5, reserveKwh: 1, maxDischargeKw: 3 }) })], LIMITS);
    expect(byName(r, "Battery only").batteryDischargeKw).toBe(2);
    expect(byName(r, "Battery only").gridImportKw).toBe(0);
    expect(r.check.balanced).toBe(true);
  });

  it("handles a home with neither, which simply buys what it uses", () => {
    const r = allocateInterval([member("Neither", 0, 2)], LIMITS);
    expect(byName(r, "Neither").gridImportKw).toBe(2);
    expect(byName(r, "Neither").status).toBe("DEFICIT");
    expect(r.check.balanced).toBe(true);
  });

  it("handles a community of one, and of none", () => {
    expect(allocateInterval([member("Alone", 4, 1)], LIMITS).totals.gridExportKw).toBe(3);
    const empty = allocateInterval([], LIMITS);
    expect(empty.totals.members).toBe(0);
    expect(empty.totals.selfSufficiency).toBeNull();
    expect(empty.totals.selfConsumption).toBeNull();
    expect(empty.check.balanced).toBe(true);
  });

  it("handles a property doing nothing at all", () => {
    const r = allocateInterval([member("Empty", 0, 0)], LIMITS);
    expect(byName(r, "Empty").status).toBe("BALANCED");
    expect(r.totals.selfSufficiency).toBeNull();
    expect(r.check.balanced).toBe(true);
  });
});

describe("invalid input is refused, not repaired", () => {
  it("refuses negative generation and negative demand", () => {
    expect(() => allocateInterval([member("Bad", -1, 2)], LIMITS)).toThrow(/generation must be zero or more/);
    expect(() => allocateInterval([member("Bad", 1, -2)], LIMITS)).toThrow(/demand must be zero or more/);
  });

  it("refuses a battery whose reserve or charge level is above its capacity", () => {
    expect(() => allocateInterval([member("Bad", 0, 1, { battery: battery({ usableKwh: 5, reserveKwh: 6 }) })], LIMITS)).toThrow(/reserve/);
    expect(() => allocateInterval([member("Bad", 0, 1, { battery: battery({ usableKwh: 5, socKwh: 6 }) })], LIMITS)).toThrow(/charge level/);
  });

  it("refuses an impossible efficiency", () => {
    expect(() => allocateInterval([member("Bad", 0, 1, { battery: battery({ roundTripEfficiency: 0 }) })], LIMITS)).toThrow(/efficiency/);
    expect(() => allocateInterval([member("Bad", 0, 1, { battery: battery({ roundTripEfficiency: 1.2 }) })], LIMITS)).toThrow(/efficiency/);
  });
});

describe("energy is conserved whatever the inputs", () => {
  /** A small deterministic sweep: every combination below must balance and must never allocate a kW twice. */
  it("balances across a sweep of generation, demand, limits, losses, rules and policies", () => {
    const rules = ["PROPORTIONAL", "EQUAL_SHARE", "CRITICAL_FIRST", "NEAREST_FIRST"] as const;
    const policies = ["SHARE_FIRST", "BATTERY_FIRST"] as const;
    let checked = 0;
    for (const gen of [0, 2, 7.5]) {
      for (const dem of [0, 3, 9]) {
        for (const feeder of [0, 1.5, 100]) {
          for (const loss of [0, 0.06]) {
            for (const rule of rules) {
              for (const policy of policies) {
                const members = [
                  member("A", gen, dem, { battery: battery({ socKwh: 3, reserveKwh: 1 }), exportLimitKw: 4, lineLossFraction: loss }),
                  member("B", 1, 5, { criticalKw: 2, importLimitKw: 6, lineLossFraction: loss / 2 }),
                  member("C", 0, 3, { battery: battery({ usableKwh: 4, socKwh: 0, reserveKwh: 0 }), lineLossFraction: loss }),
                ];
                const r = allocateInterval(members, { feederLimitKw: feeder, networkLossFraction: loss, rule, batteryPolicy: policy, stepHours: 0.25 });
                checked++;
                expect(r.check.balanced, `${rule}/${policy} gen=${gen} dem=${dem} feeder=${feeder} loss=${loss}`).toBe(true);
                // Nothing is received that was not sent, and nothing is delivered beyond what was asked.
                expect(r.totals.sharedDeliveredKw).toBeLessThanOrEqual(r.totals.sharedSentKw + 1e-6);
                expect(r.totals.sharedDeliveredKw).toBeLessThanOrEqual(r.totals.requestedKw + 1e-6);
                expect(r.totals.sharedSentKw).toBeLessThanOrEqual(r.totals.offeredKw + 1e-6);
                for (const m of r.members) {
                  expect(m.receivedKw).toBeLessThanOrEqual(m.requestedKw + 1e-6);
                  expect(m.sentKw).toBeLessThanOrEqual(m.offeredKw + 1e-6);
                  expect(m.unservedKw).toBeGreaterThanOrEqual(0);
                  expect(m.curtailedKw).toBeGreaterThanOrEqual(0);
                }
                // The feeder is never exceeded.
                expect(r.feederFlowKw).toBeLessThanOrEqual(feeder + 1e-6);
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(3 * 3 * 3 * 2 * 4 * 2);
  });

  it("is deterministic: the same inputs give the same answer", () => {
    const build = () => [member("A", 8, 3, { battery: battery() }), member("B", 2, 4), member("C", 0, 3)];
    const a = allocateInterval(build(), LIMITS);
    const b = allocateInterval(build(), LIMITS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
