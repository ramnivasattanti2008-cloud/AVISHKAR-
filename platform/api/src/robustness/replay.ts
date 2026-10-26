/**
 * How the plan that was chosen holds up if the day turns out differently (spec sections 17 and 18).
 *
 * This is not the futures page. That one plans each day from scratch with the planner told what the day will be, which says how
 * well the equipment *could* do. This keeps **the schedule the plan committed to** - the same battery moves, the same appliance
 * starts - and asks what it costs when the sun and the demand are not what was forecast. It is the question a person actually
 * has: not "what if I had known", but "what happens to the plan I am following".
 *
 * Following those moves is always possible: a battery told to charge 2 kW charges 2 kW whether the sun is out or not, and the
 * grid makes up whatever the sun does not cover. So nothing here fails; what changes is the bill, and that is the whole point.
 * The battery's charge therefore follows the plan's own path in every scenario and is not re-simulated: re-simulating it from a
 * round-trip efficiency reconstructed out of the plan's totals only made the charge drift, and reported the plan as impossible to
 * follow on the very day it was made for.
 *
 * Scope: the grid is taken to be there throughout, because the plans this replays are made without an outage (the planner is told
 * of none, there being no outage data). An outage is a question the futures page asks, and it re-plans rather than replaying.
 */
import type { PlanDto } from "../plan/schemas.js";

export interface ReplayInputs {
  /** Solar output per step, kW. Covers the plan's horizon. */
  pvKw: number[];
  /** What the property uses per step, kW, before the car and the shifted appliances. */
  loadKw: number[];
}

export interface ReplayResult {
  netCostInr: number;
  importKwh: number;
  exportKwh: number;
}

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

/**
 * What the plan's own schedule costs on a given day. Energy is priced at the plan's own prices, and the battery's wear at the
 * figure the plan itself implies: its net cost less what it paid for energy. That figure is the same in every scenario, because
 * the battery's moves are, so it never distorts a comparison; it is there so these numbers can be read beside the plan's own bill
 * without one contradicting the other.
 */
export function replay(plan: PlanDto, actual: ReplayInputs): ReplayResult {
  const s = plan.schedule;
  const dt = plan.horizon.stepHours;
  const n = s.times.length;

  const planEnergyCost =
    s.gridImportKw.reduce((a, v, i) => a + v * dt * (s.importPrice[i] ?? 0), 0) - s.gridExportKw.reduce((a, v, i) => a + v * dt * (s.exportPrice[i] ?? 0), 0);
  const impliedWear = (plan.result.value?.netCostInr ?? planEnergyCost) - planEnergyCost;

  let cost = impliedWear > 0 ? impliedWear : 0;
  let importKwh = 0;
  let exportKwh = 0;

  for (let t = 0; t < n; t++) {
    const appliances = Object.values(s.applianceKw).reduce((a, k) => a + (k[t] ?? 0), 0);
    const demand = ((actual.loadKw[t] ?? 0) + (s.evChargeKw[t] ?? 0) + appliances) * dt;
    const sun = (actual.pvKw[t] ?? 0) * dt;
    const charge = (s.batteryChargeKw[t] ?? 0) * dt;
    const discharge = (s.batteryDischargeKw[t] ?? 0) * dt;

    // what the hour needs from the grid once the sun has done what it can and the battery has done what it was told
    const net = demand + charge - sun - discharge;
    if (net > 1e-9) {
      importKwh += net;
      cost += net * (s.importPrice[t] ?? 0);
    } else if (net < -1e-9) {
      exportKwh += -net;
      cost -= -net * (s.exportPrice[t] ?? 0);
    }
  }

  return { netCostInr: round(cost), importKwh: round(importKwh), exportKwh: round(exportKwh) };
}
