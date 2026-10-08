/**
 * How long the critical load survives when the grid is down (spec section 26). Pure arithmetic, hour by hour, no solver: for
 * survival time the best policy has no choices in it. The sun serves the critical load first, any sun beyond that charges the
 * battery (up to its power and its ceiling), and any shortfall comes out of the battery (down to its floor, within its power).
 *
 * Nothing here predicts an outage. It answers "if the grid failed now, how long?", and the page says it is not a forecast.
 */

export interface BatterySpec {
  minSocKwh: number;
  maxSocKwh: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  chargeEfficiency: number;
  dischargeEfficiency: number;
}

export interface OutageRun {
  /** Hours from the start of the outage until the critical load first goes unserved, counted to the fraction of an hour. */
  hoursCovered: number;
  /** True when the critical load was served through every hour given. */
  survivesHorizon: boolean;
  /** The battery's charge at the end of each hour that was run, kWh. */
  socKwh: number[];
}

const EPS = 1e-9;

/**
 * One outage, starting at the first hour of `pvKw`, with the battery at `startSocKwh`. Without a battery the critical load is not
 * supported at all: a grid-tied solar inverter shuts down when the grid does, so the sun alone does not keep the lights on.
 */
export function surviveOutage(opts: { pvKw: number[]; criticalKw: number; battery: BatterySpec | null; startSocKwh: number }): OutageRun {
  const { pvKw, criticalKw, battery } = opts;
  if (!battery) return { hoursCovered: 0, survivesHorizon: false, socKwh: [] };
  let soc = Math.min(Math.max(opts.startSocKwh, battery.minSocKwh), battery.maxSocKwh);
  const socKwh: number[] = [];
  for (let t = 0; t < pvKw.length; t++) {
    const pv = Math.max(pvKw[t] ?? 0, 0);
    const direct = Math.min(pv, criticalKw);
    const surplus = pv - direct;
    const deficit = criticalKw - direct;
    if (surplus > EPS) {
      const kw = Math.min(surplus, battery.maxChargeKw, (battery.maxSocKwh - soc) / battery.chargeEfficiency);
      soc += Math.max(kw, 0) * battery.chargeEfficiency;
    }
    if (deficit > EPS) {
      const available = Math.min(battery.maxDischargeKw, Math.max(soc - battery.minSocKwh, 0) * battery.dischargeEfficiency);
      const delivered = Math.min(deficit, available);
      soc -= delivered / battery.dischargeEfficiency;
      if (deficit - delivered > 1e-6) {
        socKwh.push(soc);
        return { hoursCovered: t + (direct + delivered) / criticalKw, survivesHorizon: false, socKwh };
      }
    }
    socKwh.push(soc);
  }
  return { hoursCovered: pvKw.length, survivesHorizon: true, socKwh };
}

/** The hours the battery alone could carry the critical load from this charge: no sun, as at night or under heavy cloud. */
export function hoursWithoutSun(criticalKw: number, battery: BatterySpec | null, startSocKwh: number, horizon = 72): number {
  return surviveOutage({ pvKw: new Array<number>(horizon).fill(0), criticalKw, battery, startSocKwh }).hoursCovered;
}

/**
 * The charge to keep back so the critical load lasts `targetHours` with no sun: the battery's floor plus what the critical load
 * draws in that time, counting what discharging loses. `feasible` is false when that is more than the battery can hold.
 */
export function reserveFor(criticalKw: number, targetHours: number, battery: BatterySpec): { reserveKwh: number; feasible: boolean; longestPossibleHours: number } {
  const need = criticalKw * targetHours;
  const reserveKwh = battery.minSocKwh + need / battery.dischargeEfficiency;
  const longest = ((battery.maxSocKwh - battery.minSocKwh) * battery.dischargeEfficiency) / criticalKw;
  return { reserveKwh, feasible: reserveKwh <= battery.maxSocKwh + EPS, longestPossibleHours: longest };
}
