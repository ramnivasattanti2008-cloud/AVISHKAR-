/**
 * Where every kWh of a plan came from and went to (spec section 19).
 *
 * The optimiser does not track electrons: it balances energy in each hour, and nothing in its answer says which kWh of sun went to
 * the kettle and which went into the battery. So this is an **accounting convention**, applied in a stated order, and every page
 * that shows it says so. The order is:
 *
 *   1. the sun serves what the property is using now;
 *   2. what is left of the sun charges the battery;
 *   3. what is still left is sold;
 *   4. demand the sun did not cover is taken from the battery, and only then bought from the grid;
 *   5. charging the sun did not cover was bought from the grid.
 *
 * The battery is a queue: energy goes in labelled with where it came from, and comes out first in, first out. That is what lets the
 * ledger say "the 2.1 kWh your evening took from the battery was sun you stored at noon", and value it at the price of the hour it
 * displaced rather than at some average. A battery loses energy between charging and discharging, so each kWh delivered consumes a
 * little more than a kWh of what was put in; the ledger works that ratio out from the plan's own charge, discharge and charge level
 * rather than assuming an efficiency, and reports the loss on its own line.
 *
 * Solar the plan could not use at all (curtailed) is kept separate from the battery's losses. Neither is hidden.
 */
import type { PlanDto } from "../plan/schemas.js";

export interface HourRow {
  time: string;
  /** What the property, the car and the shifted appliances used, kWh. */
  demandKwh: number;
  /** The part of it the plan could serve; below `demandKwh` only in an outage. */
  servedKwh: number;
  solarToDemandKwh: number;
  batteryToDemandKwh: number;
  gridToDemandKwh: number;
  solarToBatteryKwh: number;
  gridToBatteryKwh: number;
  solarToGridKwh: number;
  batteryToGridKwh: number;
  solarCurtailedKwh: number;
  importPriceInr: number;
  exportPriceInr: number;
}

export interface LedgerTotals {
  /** Where the sun went. The four add up to everything the forecast said the panels would make. */
  solar: { madeKwh: number; toDemandKwh: number; toBatteryKwh: number; soldKwh: number; thrownAwayKwh: number };
  /** What met the demand. The three add up to what was served. */
  demand: { kwh: number; servedKwh: number; fromSolarKwh: number; fromBatteryKwh: number; fromGridKwh: number };
  /** What the battery handled, and where what came out of it had come from. Null when there is no battery. */
  battery: { inKwh: number; outKwh: number; lostKwh: number; levelChangeKwh: number; outFromSolarKwh: number; outFromGridKwh: number } | null;
  /** What was bought and sold, and what the buying was for. */
  grid: { boughtKwh: number; forDemandKwh: number; forBatteryKwh: number; soldKwh: number };
  money: {
    /** What the bought energy cost, split by what it was for. The two add up to the plan's import cost. */
    boughtForDemandInr: number;
    boughtForBatteryInr: number;
    soldInr: number;
    /** What the energy taken from the battery would have cost at the import price of the hour it was used. */
    batteryDisplacedInr: number;
    /** The same for the part of it that had come from the sun. Not a saving on its own: the plan's saving is what it is. */
    storedSolarDisplacedInr: number;
  };
}

export interface Ledger {
  rows: HourRow[];
  totals: LedgerTotals;
  /** Every kWh of each hour is in exactly one place: the largest hour's imbalance, and whether it is within rounding. */
  check: { balanced: boolean; maxHourErrorKwh: number; note: string };
}

const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;
const positive = (v: number): number => (v > 1e-9 ? v : 0);

/** A parcel of energy in the battery: how much went in, and whether it came from the sun. */
interface Parcel {
  kwh: number;
  fromSolar: boolean;
}

interface Flows {
  demand: number;
  served: number;
  solar: number;
  curtailed: number;
  charge: number;
  discharge: number;
  bought: number;
  sold: number;
  importPrice: number;
  exportPrice: number;
  solarToDemand: number;
  batteryToDemand: number;
  gridToDemand: number;
  solarToBattery: number;
  gridToBattery: number;
  solarToGrid: number;
  batteryToGrid: number;
}

/** One hour, split by the order at the top of this file. Pure, and the only place the order is applied. */
function hourFlows(plan: PlanDto, t: number): Flows {
  const s = plan.schedule;
  const dt = plan.horizon.stepHours;
  const appliances = Object.values(s.applianceKw).reduce((a, k) => a + (k[t] ?? 0), 0);
  const demand = ((s.loadKw[t] ?? 0) + (s.evChargeKw[t] ?? 0) + appliances) * dt;
  const solar = (s.pvUsedKw[t] ?? 0) * dt;
  const discharge = (s.batteryDischargeKw[t] ?? 0) * dt;
  const charge = (s.batteryChargeKw[t] ?? 0) * dt;
  const bought = (s.gridImportKw[t] ?? 0) * dt;
  const sold = (s.gridExportKw[t] ?? 0) * dt;

  const solarToDemand = Math.min(solar, demand);
  let unmet = positive(demand - solarToDemand);
  const batteryToDemand = Math.min(discharge, unmet);
  unmet = positive(unmet - batteryToDemand);
  const gridToDemand = Math.min(bought, unmet);

  let solarLeft = positive(solar - solarToDemand);
  const solarToBattery = Math.min(solarLeft, charge);
  solarLeft = positive(solarLeft - solarToBattery);
  const gridToBattery = positive(charge - solarToBattery);

  const solarToGrid = Math.min(solarLeft, sold);
  const batteryToGrid = positive(sold - solarToGrid);

  return {
    demand,
    served: solarToDemand + batteryToDemand + gridToDemand,
    solar,
    curtailed: (s.pvCurtailedKw[t] ?? 0) * dt,
    charge,
    discharge,
    bought,
    sold,
    importPrice: s.importPrice[t] ?? 0,
    exportPrice: s.exportPrice[t] ?? 0,
    solarToDemand,
    batteryToDemand,
    gridToDemand,
    solarToBattery,
    gridToBattery,
    solarToGrid,
    batteryToGrid,
  };
}

export function buildLedger(plan: PlanDto): Ledger {
  const s = plan.schedule;
  const n = s.times.length;
  const b = plan.inputs.battery;
  const flows = Array.from({ length: n }, (_, t) => hourFlows(plan, t));

  // What the battery took in, gave out, and how its level moved: the difference is what it lost. Each kWh delivered therefore
  // consumed `perDelivered` kWh of what was put in, worked out from the plan itself rather than from an assumed efficiency.
  const inKwh = flows.reduce((a, f) => a + f.charge, 0);
  const outKwh = flows.reduce((a, f) => a + f.discharge, 0);
  const levelChange = b && s.batterySocKwh.length > 0 ? (s.batterySocKwh[n - 1] ?? b.startSocKwh) - b.startSocKwh : 0;
  const lost = positive(inKwh - outKwh - levelChange);
  const perDelivered = outKwh + positive(levelChange) > 1e-9 ? inKwh / (outKwh + positive(levelChange)) : 1;

  const store: Parcel[] = [];
  if (b && b.startSocKwh > 1e-9) store.push({ kwh: b.startSocKwh, fromSolar: false }); // what was there before the plan began is not the plan's doing
  let outFromSolar = 0;
  let outFromGrid = 0;
  let batteryDisplacedInr = 0;
  let storedSolarDisplacedInr = 0;
  let maxErr = 0;

  for (const f of flows) {
    if (f.solarToBattery > 1e-9) store.push({ kwh: f.solarToBattery, fromSolar: true });
    if (f.gridToBattery > 1e-9) store.push({ kwh: f.gridToBattery, fromSolar: false });

    const delivered = f.batteryToDemand + f.batteryToGrid;
    let consume = delivered * perDelivered;
    let fromSolarHere = 0;
    while (consume > 1e-9 && store.length > 0) {
      const head = store[0]!;
      const take = Math.min(consume, head.kwh);
      if (head.fromSolar) fromSolarHere += take;
      head.kwh -= take;
      consume -= take;
      if (head.kwh <= 1e-9) store.shift();
    }
    // report what was DELIVERED, split by where it came from, not the larger amount the battery had to consume to deliver it
    const solarShare = delivered > 1e-9 && perDelivered > 0 ? Math.min(1, fromSolarHere / (delivered * perDelivered)) : 0;
    outFromSolar += delivered * solarShare;
    outFromGrid += delivered * (1 - solarShare);
    batteryDisplacedInr += f.batteryToDemand * f.importPrice;
    storedSolarDisplacedInr += f.batteryToDemand * solarShare * f.importPrice;

    // every kWh of the hour is in exactly one place
    maxErr = Math.max(maxErr, Math.abs(f.solar + f.discharge + f.bought - (f.served + f.charge + f.sold)));
  }

  const rows: HourRow[] = flows.map((f, t) => ({
    time: s.times[t] ?? "",
    demandKwh: round(f.demand),
    servedKwh: round(f.served),
    solarToDemandKwh: round(f.solarToDemand),
    batteryToDemandKwh: round(f.batteryToDemand),
    gridToDemandKwh: round(f.gridToDemand),
    solarToBatteryKwh: round(f.solarToBattery),
    gridToBatteryKwh: round(f.gridToBattery),
    solarToGridKwh: round(f.solarToGrid),
    batteryToGridKwh: round(f.batteryToGrid),
    solarCurtailedKwh: round(f.curtailed),
    importPriceInr: f.importPrice,
    exportPriceInr: f.exportPrice,
  }));

  const sum = (pick: (f: Flows) => number) => round(flows.reduce((a, f) => a + pick(f), 0), 3);

  return {
    rows,
    totals: {
      solar: {
        madeKwh: round(flows.reduce((a, f) => a + f.solar + f.curtailed, 0), 3),
        toDemandKwh: sum((f) => f.solarToDemand),
        toBatteryKwh: sum((f) => f.solarToBattery),
        soldKwh: sum((f) => f.solarToGrid),
        thrownAwayKwh: sum((f) => f.curtailed),
      },
      demand: {
        kwh: sum((f) => f.demand),
        servedKwh: sum((f) => f.served),
        fromSolarKwh: sum((f) => f.solarToDemand),
        fromBatteryKwh: sum((f) => f.batteryToDemand),
        fromGridKwh: sum((f) => f.gridToDemand),
      },
      battery: b
        ? {
            inKwh: round(inKwh, 3),
            outKwh: round(outKwh, 3),
            lostKwh: round(lost, 3),
            levelChangeKwh: round(levelChange, 3),
            outFromSolarKwh: round(outFromSolar, 3),
            outFromGridKwh: round(outFromGrid, 3),
          }
        : null,
      grid: {
        boughtKwh: sum((f) => f.gridToDemand + f.gridToBattery),
        forDemandKwh: sum((f) => f.gridToDemand),
        forBatteryKwh: sum((f) => f.gridToBattery),
        soldKwh: sum((f) => f.solarToGrid + f.batteryToGrid),
      },
      money: {
        boughtForDemandInr: round(flows.reduce((a, f) => a + f.gridToDemand * f.importPrice, 0), 2),
        boughtForBatteryInr: round(flows.reduce((a, f) => a + f.gridToBattery * f.importPrice, 0), 2),
        soldInr: round(flows.reduce((a, f) => a + (f.solarToGrid + f.batteryToGrid) * f.exportPrice, 0), 2),
        batteryDisplacedInr: round(batteryDisplacedInr, 2),
        storedSolarDisplacedInr: round(storedSolarDisplacedInr, 2),
      },
    },
    check: {
      balanced: maxErr <= 1e-6,
      maxHourErrorKwh: round(maxErr, 9),
      note: "Every kWh of each hour is put in exactly one place, by the order this ledger states. The optimiser does not record which kWh went where, so this is an accounting convention, not a measurement.",
    },
  };
}
