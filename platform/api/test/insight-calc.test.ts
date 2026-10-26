import { describe, expect, it } from "vitest";
import { batteryLossKwh, boughtBack, demandKw, healthMetrics, wasteFindings } from "../src/insight/calc.js";
import type { PlanDto } from "../src/plan/schemas.js";

/**
 * A four-hour plan small enough to check by hand. Hour by hour (kW, 1 h steps):
 *   use       1  1  3  3      the washer takes 1 kW in hour 1, so demand is 1 2 3 3 (9 kWh)
 *   sun       0  4  2  0      6 kWh, of which 0.5 kWh in hour 1 is thrown away
 *   battery   charges 1 kWh in hour 1, gives 0.81 kWh in hour 2; both ways 0.9 efficient, so 0.19 kWh is lost
 *   grid      buys 1, 0, 0.19, 3 (4.19 kWh); sells 0.5 in hour 1
 *   prices    buy 6 6 10 10, sell 3 throughout
 */
function plan(over: { battery?: boolean; pv?: boolean; flexible?: boolean; resultNull?: boolean } = {}): PlanDto {
  const { battery = true, pv = true, flexible = true, resultNull = false } = over;
  const load = [1, 1, 3, 3];
  const sun = pv ? [0, 4, 2, 0] : [0, 0, 0, 0];
  const curtailed = pv ? [0, 0.5, 0, 0] : [0, 0, 0, 0];
  const used = sun.map((v, i) => v - curtailed[i]!);
  const chg = battery ? [0, 1, 0, 0] : [0, 0, 0, 0];
  const dis = battery ? [0, 0, 0.81, 0] : [0, 0, 0, 0];
  const imp = pv ? (battery ? [1, 0, 0.19, 3] : [1, 0, 1, 3]) : [1, 1, 3, 3];
  const exp = pv ? (battery ? [0, 0.5, 0, 0] : [0, 1.5, 0, 0]) : [0, 0, 0, 0];
  const washer = flexible ? [0, 1, 0, 0] : [0, 0, 0, 0];
  const sumOf = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const totals = {
    netCostInr: 0,
    baselineNetCostInr: 0,
    savingsInr: 0,
    importKwh: sumOf(imp),
    exportKwh: sumOf(exp),
    loadKwh: 8,
    pvKwh: sumOf(sun),
    pvUsedKwh: sumOf(used),
    curtailedKwh: sumOf(curtailed),
    batteryCycles: battery ? 0.2 : 0,
    unservedKwh: 0,
    evShortfallKwh: 0,
    selfConsumptionRatio: pv ? sumOf(used) / sumOf(sun) : null,
    selfSufficiencyRatio: 0.5,
  };
  return {
    horizon: { start: "2026-10-09T00:00:00+05:30", stepHours: 1, steps: 4 },
    schedule: {
      times: [],
      loadKw: load,
      pvForecastKw: sun,
      pvUsedKw: used,
      pvCurtailedKw: curtailed,
      gridImportKw: imp,
      gridExportKw: exp,
      batteryChargeKw: chg,
      batteryDischargeKw: dis,
      batterySocKwh: battery ? [0, 0.9, 0, 0] : [],
      evChargeKw: [0, 0, 0, 0],
      applianceKw: flexible ? { washer } : {},
      importPrice: [6, 6, 10, 10],
      exportPrice: [3, 3, 3, 3],
    },
    result: resultNull ? { value: null } : { value: totals },
    inputs: { battery: battery ? { capacityKwh: 5.5, usableKwh: 5, maxChargeKw: 2, maxDischargeKw: 2, startSocKwh: 0, startSocBasis: "ASSUMPTION", reserveKwh: null } : null },
    decisions: pv ? [{ time: "2026-10-09T01:00:00+05:30", kind: "curtail", kwh: 0.5, reason: "solar was curtailed at 01:00 because the battery was full and nothing was bought then" }] : [],
  } as unknown as PlanDto;
}

const byKey = <T extends { key: string }>(xs: T[], key: string): T => xs.find((x) => x.key === key)!;

describe("the energy used and the battery's losses", () => {
  it("adds the car and the appliances to the property's use, hour by hour", () => {
    expect(demandKw(plan())).toEqual([1, 2, 3, 3]);
  });

  it("finds the energy lost in the battery from what went in, what came out and what stayed", () => {
    expect(batteryLossKwh(plan())).toBeCloseTo(0.19, 10);
    expect(batteryLossKwh(plan({ battery: false }))).toBe(0);
  });
});

describe("energy health: each metric is a ratio that means what its formula says", () => {
  const m = healthMetrics(plan());

  it("has no overall score and every metric states its formula", () => {
    expect(m.map((x) => x.key)).toEqual(["efficiency", "solarUtilisation", "peakManagement", "storageUtilisation", "gridDependence", "flexibility"]);
    for (const x of m) expect(x.formula.length, x.key).toBeGreaterThan(20);
  });

  it("efficiency: what came in, less the battery's losses and the solar thrown away", () => {
    // 1 - (0.19 + 0.5) / (6 + 4.19)
    expect(byKey(m, "efficiency").value).toBeCloseTo(93.2, 1);
    expect(byKey(m, "efficiency").detail).toContain("0.19 kWh");
  });

  it("solar utilisation: sun put to use over sun available, and it says that selling counts", () => {
    expect(byKey(m, "solarUtilisation").value).toBeCloseTo(91.7, 1); // 5.5 / 6
    expect(byKey(m, "solarUtilisation").detail).toMatch(/not the share used at home/);
  });

  it("peak management: zero when the grid carries the property's whole peak hour", () => {
    expect(byKey(m, "peakManagement").value).toBe(0); // it peaks at 3 kW, in hours 2 and 3, and the grid supplies the whole 3 kW in hour 3
  });

  it("storage utilisation: the range of charge moved over the usable range", () => {
    expect(byKey(m, "storageUtilisation").value).toBe(18); // 0.9 of 5 kWh
  });

  it("grid dependence: bought over used, lower being better", () => {
    expect(byKey(m, "gridDependence").value).toBeCloseTo(46.6, 1); // 4.19 / 9
    expect(byKey(m, "gridDependence").direction).toBe("LOWER_IS_BETTER");
  });

  it("flexibility: the share of use that has a window to move in", () => {
    expect(byKey(m, "flexibility").value).toBeCloseTo(11.1, 1); // 1 / 9
  });

  it("says a metric does not exist, with the reason, instead of showing zero, when there is no solar, no battery or nothing movable", () => {
    const bare = healthMetrics(plan({ pv: false, battery: false, flexible: false }));
    expect(byKey(bare, "solarUtilisation").value).toBeNull();
    expect(byKey(bare, "solarUtilisation").detail).toMatch(/no solar/i);
    expect(byKey(bare, "storageUtilisation").value).toBeNull();
    expect(byKey(bare, "storageUtilisation").detail).toMatch(/no battery/i);
    expect(byKey(bare, "flexibility").value).toBe(0); // a real zero: nothing was entered that can be moved
    expect(byKey(bare, "flexibility").detail).toMatch(/Nothing was entered/);
    expect(byKey(bare, "gridDependence").value).toBe(100);
  });

  it("gives nothing for a plan without a result", () => {
    expect(healthMetrics(plan({ resultNull: true }))).toEqual([]);
    expect(wasteFindings(plan({ resultNull: true }))).toEqual([]);
  });
});

describe("energy waste: what the plan itself shows was thrown away or bought dear", () => {
  const w = wasteFindings(plan());

  it("solar thrown away is valued at the export price and carries the planner's own reason", () => {
    const f = byKey(w, "solarCurtailment");
    expect(f).toMatchObject({ state: "FOUND", kwh: 0.5 });
    expect(f.valueInr).toBeCloseTo(1.5, 10); // 0.5 kWh at 3 per kWh
    expect(f.explanation).toContain("the battery was full");
  });

  it("surplus sold is reported as what it earned, and not called waste", () => {
    const f = byKey(w, "surplusSold");
    expect(f).toMatchObject({ state: "FOUND", kwh: 0.5, valueInr: 1.5 });
    expect(f.explanation).toMatch(/Selling is not waste/);
  });

  it("matches energy sold early to energy bought later at a higher price, first in first out, and values the gap", () => {
    const f = byKey(w, "soldThenBoughtBack");
    expect(f.state).toBe("FOUND");
    expect(f.kwh).toBeCloseTo(0.5, 10); // the 0.5 kWh sold in hour 1 is matched by 0.19 kWh in hour 2 and 0.31 in hour 3
    expect(f.valueInr).toBeCloseTo(3.5, 10); // 0.5 × (10 − 3)
    expect(f.explanation).toMatch(/at most/);
  });

  it("does not count a purchase made at a lower price than the sale", () => {
    const p = plan();
    p.schedule.importPrice = [2, 2, 2, 2]; // everything bought is cheaper than the 3 it was sold for
    expect(boughtBack(p)).toEqual({ kwh: 0, valueInr: 0 });
  });

  it("totals what was bought at the day's highest price, and what it cost", () => {
    const f = byKey(w, "dearHoursImport");
    expect(f.state).toBe("FOUND");
    expect(f.kwh).toBeCloseTo(3.19, 10); // hours 2 and 3 are at 10
    expect(f.valueInr).toBeCloseTo(31.9, 10);
  });

  it("declines to name a dearest hour when the price never changes", () => {
    const p = plan();
    p.schedule.importPrice = [7, 7, 7, 7];
    const f = byKey(wasteFindings(p), "dearHoursImport");
    expect(f.state).toBe("UNAVAILABLE");
    expect(f.valueInr).toBeNull();
  });

  it("says plainly what it cannot work out, and why", () => {
    expect(byKey(w, "applianceSchedule")).toMatchObject({ state: "UNAVAILABLE", kwh: null, valueInr: null });
    expect(byKey(w, "applianceSchedule").explanation).toMatch(/twice/);
    expect(byKey(w, "batteryOpportunity")).toMatchObject({ state: "UNAVAILABLE", valueInr: null });
    expect(byKey(w, "batteryOpportunity").explanation).toMatch(/no device feed/);
  });

  it("finds none when nothing was thrown away or sold, and is unavailable for solar when there is none", () => {
    const none = wasteFindings(plan({ pv: false }));
    expect(byKey(none, "solarCurtailment").state).toBe("UNAVAILABLE");
    expect(byKey(none, "surplusSold").state).toBe("NONE");
    expect(byKey(none, "soldThenBoughtBack")).toMatchObject({ state: "NONE", kwh: 0, valueInr: 0 });
  });
});
