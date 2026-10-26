import { describe, expect, it } from "vitest";
import { buildLedger } from "../src/allocation/ledger.js";
import type { PlanDto } from "../src/plan/schemas.js";

/**
 * A four-hour plan small enough to check by hand, with hourly steps:
 *
 *   hour      0     1     2     3
 *   use       1     1     3     3     (plus a 1 kW washer in hour 1, so demand is 1, 2, 3, 3)
 *   sun       0     4     2     0     (hour 1 makes 4: 2 to demand, 1.5 stored, 0.5 sold)
 *   battery   charges 1.5 kWh in hour 1, gives 1 kWh in hour 2
 *   grid      buys 1, 0, 0, 3; sells 0.5 in hour 1
 *   price     buy 6, 6, 10, 10; sell 3 throughout
 */
function plan(over: { battery?: boolean; pv?: boolean; curtail?: boolean; gridCharge?: boolean } = {}): PlanDto {
  const { battery = true, pv = true, curtail = false, gridCharge = false } = over;
  const load = [1, 1, 3, 3];
  const washer = [0, 1, 0, 0];
  const sun = pv ? [0, 4, 2, 0] : [0, 0, 0, 0];
  const curtailed = curtail ? [0, 0.5, 0, 0] : [0, 0, 0, 0];
  const used = sun.map((v, i) => v - curtailed[i]!);
  const chg = battery ? (gridCharge ? [2, 1.5, 0, 0] : [0, 1.5, 0, 0]) : [0, 0, 0, 0];
  const dis = battery ? [0, 0, 1, 0] : [0, 0, 0, 0];
  // the books must close each hour: used + discharge + import = demand + charge + export, so the grid takes up the slack either way
  const demand = load.map((l, i) => l + washer[i]!);
  const surplus = demand.map((d, i) => used[i]! + dis[i]! - d - chg[i]!);
  const exp = surplus.map((v) => Math.max(0, v));
  const imp = surplus.map((v) => Math.max(0, -v));
  const soc = battery ? [gridCharge ? 2 : 0, gridCharge ? 3.5 : 1.5, gridCharge ? 2.5 : 0.5, gridCharge ? 2.5 : 0.5] : [];

  return {
    horizon: { start: "2026-10-20T00:00:00+05:30", stepHours: 1, steps: 4 },
    schedule: {
      times: ["2026-10-20T00:00:00+05:30", "2026-10-20T01:00:00+05:30", "2026-10-20T02:00:00+05:30", "2026-10-20T03:00:00+05:30"],
      loadKw: load,
      pvForecastKw: sun,
      pvUsedKw: used,
      pvCurtailedKw: curtailed,
      gridImportKw: imp,
      gridExportKw: exp,
      batteryChargeKw: chg,
      batteryDischargeKw: dis,
      batterySocKwh: soc,
      evChargeKw: [0, 0, 0, 0],
      applianceKw: { washer },
      importPrice: [6, 6, 10, 10],
      exportPrice: [3, 3, 3, 3],
    },
    result: { value: { netCostInr: 0, baselineNetCostInr: 0, savingsInr: 0, importKwh: 0, exportKwh: 0, loadKwh: 0, pvKwh: 0, pvUsedKwh: 0, curtailedKwh: 0, batteryCycles: 0, unservedKwh: 0, evShortfallKwh: 0, selfConsumptionRatio: null, selfSufficiencyRatio: null } },
    inputs: { battery: battery ? { capacityKwh: 5.5, usableKwh: 5, maxChargeKw: 3, maxDischargeKw: 3, startSocKwh: gridCharge ? 0 : 0, startSocBasis: "ASSUMPTION", reserveKwh: null } : null },
    decisions: [],
  } as unknown as PlanDto;
}

describe("the every-kWh ledger", () => {
  const l = buildLedger(plan());

  it("puts every kWh of every hour in exactly one place", () => {
    expect(l.check.balanced).toBe(true);
    expect(l.check.maxHourErrorKwh).toBeLessThanOrEqual(1e-6);
    expect(l.check.note).toMatch(/accounting convention, not a measurement/);
  });

  it("serves demand from the sun first, then the battery, then the grid", () => {
    const [h0, h1, h2, h3] = l.rows;
    expect(h0).toMatchObject({ demandKwh: 1, solarToDemandKwh: 0, batteryToDemandKwh: 0, gridToDemandKwh: 1 }); // no sun at all
    expect(h1).toMatchObject({ demandKwh: 2, solarToDemandKwh: 2, gridToDemandKwh: 0 }); // the sun covers it
    expect(h2).toMatchObject({ demandKwh: 3, solarToDemandKwh: 2, batteryToDemandKwh: 1, gridToDemandKwh: 0 }); // sun, then battery
    expect(h3).toMatchObject({ demandKwh: 3, solarToDemandKwh: 0, batteryToDemandKwh: 0, gridToDemandKwh: 3 }); // nothing left but the grid
  });

  it("sends what the sun has left to the battery before it sells any", () => {
    const h1 = l.rows[1]!;
    expect(h1.solarToBatteryKwh).toBe(1.5);
    expect(h1.solarToGridKwh).toBe(0.5);
    expect(h1.gridToBatteryKwh).toBe(0);
  });

  it("adds the sun's four destinations back up to everything the panels made", () => {
    const s = l.totals.solar;
    expect(s.toDemandKwh + s.toBatteryKwh + s.soldKwh + s.thrownAwayKwh).toBeCloseTo(s.madeKwh, 6);
    expect(s.madeKwh).toBe(6);
  });

  it("adds the three sources of the demand back up to what was served", () => {
    const d = l.totals.demand;
    expect(d.fromSolarKwh + d.fromBatteryKwh + d.fromGridKwh).toBeCloseTo(d.servedKwh, 6);
    expect(d.servedKwh).toBe(d.kwh); // nothing was shed in this plan
    expect(d.kwh).toBe(9);
  });

  it("says what the battery took in, gave out, lost and still holds", () => {
    const b = l.totals.battery!;
    expect(b.inKwh).toBe(1.5);
    expect(b.outKwh).toBe(1);
    expect(b.levelChangeKwh).toBe(0.5); // it ends 0.5 kWh fuller than it began
    expect(b.lostKwh).toBe(0); // in = out + what it kept, so this plan shows no loss
    expect(b.outFromSolarKwh + b.outFromGridKwh).toBeCloseTo(b.outKwh, 6);
  });

  it("knows the evening came out of the sun, because that is what went in", () => {
    const b = l.totals.battery!;
    expect(b.outFromSolarKwh).toBeCloseTo(1, 6);
    expect(b.outFromGridKwh).toBeCloseTo(0, 6);
    // 1 kWh used in hour 2, when buying would have cost INR 10
    expect(l.totals.money.batteryDisplacedInr).toBe(10);
    expect(l.totals.money.storedSolarDisplacedInr).toBe(10);
  });

  it("splits what was bought by what it was for, and prices each at the hour it happened", () => {
    const g = l.totals.grid;
    expect(g.forDemandKwh + g.forBatteryKwh).toBeCloseTo(g.boughtKwh, 6);
    expect(g.boughtKwh).toBe(4); // 1 kWh at hour 0 and 3 at hour 3
    expect(l.totals.money.boughtForDemandInr).toBe(1 * 6 + 3 * 10);
    expect(l.totals.money.boughtForBatteryInr).toBe(0);
    expect(l.totals.money.soldInr).toBe(0.5 * 3);
  });

  it("counts grid energy that went into the battery as the battery's, not the demand's", () => {
    const g = buildLedger(plan({ gridCharge: true }));
    expect(g.rows[0]!.gridToBatteryKwh).toBe(2); // hour 0 charges 2 kWh with no sun about
    expect(g.rows[0]!.gridToDemandKwh).toBe(1);
    expect(g.totals.grid.forBatteryKwh).toBeGreaterThan(0);
    expect(g.totals.money.boughtForBatteryInr).toBe(2 * 6);
    expect(g.check.balanced).toBe(true);
    // and what comes out of the battery is then grid energy, first in first out
    expect(g.totals.battery!.outFromGridKwh).toBeGreaterThan(0);
  });

  it("keeps solar that was thrown away out of what was used, and names it", () => {
    const c = buildLedger(plan({ curtail: true }));
    expect(c.totals.solar.thrownAwayKwh).toBe(0.5);
    expect(c.totals.solar.madeKwh).toBe(6);
    expect(c.totals.solar.toDemandKwh + c.totals.solar.toBatteryKwh + c.totals.solar.soldKwh).toBeCloseTo(5.5, 6);
    expect(c.check.balanced).toBe(true);
  });

  it("works with no battery and with no solar, without inventing either", () => {
    const noBattery = buildLedger(plan({ battery: false }));
    expect(noBattery.totals.battery).toBeNull();
    expect(noBattery.totals.demand.fromBatteryKwh).toBe(0);
    expect(noBattery.check.balanced).toBe(true);

    const noSun = buildLedger(plan({ pv: false, battery: false }));
    expect(noSun.totals.solar).toMatchObject({ madeKwh: 0, toDemandKwh: 0, soldKwh: 0, thrownAwayKwh: 0 });
    expect(noSun.totals.demand.fromGridKwh).toBe(noSun.totals.demand.servedKwh);
    expect(noSun.check.balanced).toBe(true);
  });

  it("gives a row for every hour of the plan, with its prices", () => {
    expect(l.rows).toHaveLength(4);
    expect(l.rows.map((r) => r.importPriceInr)).toEqual([6, 6, 10, 10]);
    expect(l.rows[0]!.time).toBe("2026-10-20T00:00:00+05:30");
  });
});
