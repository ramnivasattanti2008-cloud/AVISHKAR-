import { describe, expect, it } from "vitest";
import { replay } from "../src/robustness/replay.js";
import type { PlanDto } from "../src/plan/schemas.js";

/**
 * A four-hour plan, one hour per step, built so every number below can be checked by hand:
 *
 *   hour       0     1     2     3
 *   load       1     1     3     3
 *   sun        0     4     2     0
 *   battery    charges 1.5 kWh in hour 1, gives 1 kWh in hour 2
 *   price buy  6     6    10    10          sell 3 throughout
 *
 * The plan's own balance then buys 1 kWh in hour 0, sells 1.5 in hour 1, needs nothing in hour 2 and buys 3 in hour 3.
 */
function plan(over: { battery?: boolean; wearInr?: number } = {}): PlanDto {
  const { battery = true, wearInr = 0 } = over;
  const load = [1, 1, 3, 3];
  const sun = [0, 4, 2, 0];
  const chg = battery ? [0, 1.5, 0, 0] : [0, 0, 0, 0];
  const dis = battery ? [0, 0, 1, 0] : [0, 0, 0, 0];
  const surplus = load.map((l, i) => sun[i]! + dis[i]! - l - chg[i]!);
  const imp = surplus.map((v) => Math.max(0, -v));
  const exp = surplus.map((v) => Math.max(0, v));
  const price = [6, 6, 10, 10];
  const energyCost = imp.reduce((a, v, i) => a + v * price[i]!, 0) - exp.reduce((a, v) => a + v * 3, 0);
  return {
    horizon: { start: "2026-10-20T00:00:00+05:30", stepHours: 1, steps: 4 },
    schedule: {
      times: ["a", "b", "c", "d"],
      loadKw: load,
      pvForecastKw: sun,
      pvUsedKw: sun,
      pvCurtailedKw: [0, 0, 0, 0],
      gridImportKw: imp,
      gridExportKw: exp,
      batteryChargeKw: chg,
      batteryDischargeKw: dis,
      batterySocKwh: battery ? [0, 1.5, 0.5, 0.5] : [],
      evChargeKw: [0, 0, 0, 0],
      applianceKw: {},
      importPrice: price,
      exportPrice: [3, 3, 3, 3],
    },
    // the plan's bill is what it paid for energy plus whatever it charged for wear; the replay reads the wear back out of this
    result: { value: { netCostInr: energyCost + wearInr, baselineNetCostInr: 0, savingsInr: 0, importKwh: 0, exportKwh: 0, loadKwh: 0, pvKwh: 0, pvUsedKwh: 0, curtailedKwh: 0, batteryCycles: 0, unservedKwh: 0, evShortfallKwh: 0, selfConsumptionRatio: null, selfSufficiencyRatio: null } },
    inputs: { battery: battery ? { capacityKwh: 5.5, usableKwh: 5, maxChargeKw: 3, maxDischargeKw: 3, startSocKwh: 0, startSocBasis: "ASSUMPTION", reserveKwh: null } : null },
    decisions: [],
  } as unknown as PlanDto;
}

const EXPECTED = { pvKw: [0, 4, 2, 0], loadKw: [1, 1, 3, 3] };

describe("replaying the plan that was chosen against a different day", () => {
  it("reproduces the plan's own bill when the day turns out as forecast", () => {
    const p = plan();
    const r = replay(p, EXPECTED);
    expect(r.importKwh).toBeCloseTo(4, 6); // 1 kWh in hour 0, 3 in hour 3
    expect(r.exportKwh).toBeCloseTo(1.5, 6);
    expect(r.netCostInr).toBeCloseTo(p.result.value!.netCostInr, 6);
  });

  it("reads the battery's wear back out of the plan, so the figures sit beside the plan's own bill", () => {
    const p = plan({ wearInr: 4.5 });
    const r = replay(p, EXPECTED);
    expect(r.netCostInr).toBeCloseTo(p.result.value!.netCostInr, 6);
    // and the same wear is carried into a different day, so it never distorts a comparison
    const dull = replay(p, { ...EXPECTED, pvKw: [0, 2, 1, 0] });
    const dullNoWear = replay(plan(), { ...EXPECTED, pvKw: [0, 2, 1, 0] });
    expect(dull.netCostInr - dullNoWear.netCostInr).toBeCloseTo(4.5, 6);
  });

  it("costs more when the sun is poorer, because the same moves now need the grid", () => {
    const dull = replay(plan(), { ...EXPECTED, pvKw: [0, 2, 1, 0] });
    const bright = replay(plan(), EXPECTED);
    expect(dull.netCostInr).toBeGreaterThan(bright.netCostInr);
    expect(dull.importKwh).toBeGreaterThan(bright.importKwh);
    expect(dull.exportKwh).toBeLessThan(bright.exportKwh);
  });

  it("costs more when the demand is higher", () => {
    const busy = replay(plan(), { ...EXPECTED, loadKw: [2, 2, 4, 4] });
    const r = replay(plan(), EXPECTED);
    expect(busy.netCostInr).toBeGreaterThan(r.netCostInr);
    // one more kWh is wanted in each of the four hours, but the extra in the sunny hour comes out of what would have been sold
    expect(busy.importKwh).toBeCloseTo(7, 6);
    expect(busy.exportKwh).toBeCloseTo(r.exportKwh - 1, 6);
  });

  it("costs less when there is more sun, and sells the surplus", () => {
    const bright = replay(plan(), { ...EXPECTED, pvKw: [0, 6, 4, 0] });
    const r = replay(plan(), EXPECTED);
    expect(bright.netCostInr).toBeLessThan(r.netCostInr);
    expect(bright.exportKwh).toBeGreaterThan(r.exportKwh);
  });

  it("keeps the plan's battery moves whatever the day, so the charge follows the plan's own path", () => {
    // the hour the plan discharges still discharges, even on a day with no sun at all, and the grid covers the rest
    const dark = replay(plan(), { pvKw: [0, 0, 0, 0], loadKw: [1, 1, 3, 3] });
    // hour 0: 1; hour 1: 1 + 1.5 charge = 2.5; hour 2: 3 - 1 discharge = 2; hour 3: 3
    expect(dark.importKwh).toBeCloseTo(1 + 2.5 + 2 + 3, 6);
    expect(dark.exportKwh).toBe(0);
  });

  it("works for a property with no battery, and then differs only by the day", () => {
    const r = replay(plan({ battery: false }), { pvKw: [0, 1, 1, 0], loadKw: [1, 1, 3, 3] });
    expect(r.importKwh).toBeCloseTo(1 + 0 + 2 + 3, 6);
    expect(r.exportKwh).toBe(0);
  });

  it("takes the grid as being there throughout, because the plans it replays are made that way", () => {
    const r = replay(plan(), { pvKw: [0, 0, 0, 0], loadKw: [5, 5, 5, 5] }); // a dreadful day
    expect(r.importKwh).toBeGreaterThan(15); // nothing is ever refused: it is bought instead
  });
});
