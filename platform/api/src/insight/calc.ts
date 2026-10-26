/**
 * Energy health (spec section 35) and energy waste (section 36), as arithmetic on one stored plan.
 *
 * Nothing here is a score somebody chose: each health metric is a ratio that means what its formula says, built from the plan's own hourly
 * flows, and where a ratio does not exist (no solar, no battery, no consumption) the metric is not there, with the reason. There is no
 * overall number, because adding these up would need weights, and any weights would be a judgement dressed as a measurement.
 *
 * A plan is a simulation of a day on forecasts. These figures describe that simulated day, not what the property measurably did.
 */
import type { PlanDto } from "../plan/schemas.js";

export const HEALTH_KEYS = ["efficiency", "solarUtilisation", "peakManagement", "storageUtilisation", "gridDependence", "flexibility"] as const;
export type HealthKey = (typeof HEALTH_KEYS)[number];

export interface HealthCalc {
  key: HealthKey;
  label: string;
  direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
  /** A percentage, 0 to 100, or null when it does not exist for this plan. */
  value: number | null;
  /** The formula in words, so a reader can check it. */
  formula: string;
  /** The figures that went into it, or the reason there is no value. */
  detail: string;
}

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
const pct = (x: number): number => Math.round(Math.min(Math.max(x, 0), 1) * 1000) / 10;
const kwh = (x: number): string => `${Math.round(x * 100) / 100} kWh`;

/** Hourly use by the property, the car and the shiftable appliances together (kW per step). */
export function demandKw(p: PlanDto): number[] {
  const s = p.schedule;
  return s.loadKw.map((l, t) => l + (s.evChargeKw[t] ?? 0) + Object.values(s.applianceKw).reduce((a, k) => a + (k[t] ?? 0), 0));
}

/** Energy lost inside the battery over the plan: charging losses and discharging losses, kWh. Zero when there is no battery. */
export function batteryLossKwh(p: PlanDto): number {
  const b = p.inputs.battery;
  if (!b) return 0;
  const dt = p.horizon.stepHours;
  const soc = p.schedule.batterySocKwh;
  const charged = sum(p.schedule.batteryChargeKw) * dt;
  const discharged = sum(p.schedule.batteryDischargeKw) * dt;
  const stored = (soc.length ? soc[soc.length - 1]! : b.startSocKwh) - b.startSocKwh;
  return Math.max(charged - discharged - stored, 0);
}

export function healthMetrics(p: PlanDto): HealthCalc[] {
  const r = p.result.value;
  if (!r) return [];
  const s = p.schedule;
  const dt = p.horizon.stepHours;
  const demand = demandKw(p);
  const consumption = sum(demand) * dt;
  const out: HealthCalc[] = [];

  // efficiency: of what came in (sun made on site plus what was bought), the part that was neither lost in the battery nor thrown away
  const inflow = r.pvKwh + r.importKwh;
  const lossKwh = batteryLossKwh(p);
  out.push({
    key: "efficiency",
    label: "Efficiency",
    direction: "HIGHER_IS_BETTER",
    value: inflow > 0 ? pct(1 - (lossKwh + r.curtailedKwh) / inflow) : null,
    formula: "100 × (1 − (energy lost inside the battery + solar thrown away) ÷ (solar made + energy bought))",
    detail: inflow > 0 ? `Lost in the battery ${kwh(lossKwh)}, solar thrown away ${kwh(r.curtailedKwh)}, of ${kwh(inflow)} that came in.` : "Nothing came in over this plan.",
  });

  // solar utilisation: the share of the sun that was put to use (used, stored or sold), not curtailed
  out.push({
    key: "solarUtilisation",
    label: "Solar utilisation",
    direction: "HIGHER_IS_BETTER",
    value: r.pvKwh > 0 ? pct(r.pvUsedKwh / r.pvKwh) : null,
    formula: "100 × solar put to use (used, stored or sold) ÷ solar available",
    detail: r.pvKwh > 0 ? `${kwh(r.pvUsedKwh)} of ${kwh(r.pvKwh)}; ${kwh(r.exportKwh)} was sold, so this is not the share used at home.` : "There is no solar in this plan.",
  });

  // peak management: how much of the property's own busiest hour the grid has to carry
  const peakDemand = Math.max(0, ...demand);
  const peakImport = Math.max(0, ...s.gridImportKw);
  out.push({
    key: "peakManagement",
    label: "Peak management",
    direction: "HIGHER_IS_BETTER",
    value: peakDemand > 0 ? pct(1 - peakImport / peakDemand) : null,
    formula: "100 × (1 − the grid's highest hour ÷ the property's highest hour of use)",
    detail: peakDemand > 0 ? `The property peaks at ${Math.round(peakDemand * 100) / 100} kW; the most it buys in one hour is ${Math.round(peakImport * 100) / 100} kW.` : "The property uses nothing in this plan.",
  });

  // storage utilisation: how much of the battery's usable range the plan actually moves through
  const b = p.inputs.battery;
  let storage: number | null = null;
  let storageDetail = "There is no battery in this plan.";
  if (b && b.usableKwh > 0 && s.batterySocKwh.length > 0) {
    const levels = [b.startSocKwh, ...s.batterySocKwh];
    const range = Math.max(...levels) - Math.min(...levels);
    storage = pct(range / b.usableKwh);
    storageDetail = `The charge moves across ${kwh(range)} of the ${kwh(b.usableKwh)} usable; ${Math.round(r.batteryCycles * 100) / 100} full cycles over the plan.`;
  }
  out.push({
    key: "storageUtilisation",
    label: "Storage utilisation",
    direction: "HIGHER_IS_BETTER",
    value: storage,
    formula: "100 × (highest − lowest charge reached) ÷ usable capacity",
    detail: storageDetail,
  });

  // grid dependence: the share of what was used that the grid supplied
  out.push({
    key: "gridDependence",
    label: "Grid dependence",
    direction: "LOWER_IS_BETTER",
    value: consumption > 0 ? pct(r.importKwh / consumption) : null,
    formula: "100 × energy bought from the grid ÷ energy used (the property, the car and the shifted appliances)",
    detail: consumption > 0 ? `Bought ${kwh(r.importKwh)} of ${kwh(consumption)} used; energy the grid put into the battery counts as bought.` : "The property uses nothing in this plan.",
  });

  // flexibility: the share of use that can be moved in time: the car and appliances that were given a window
  const car = sum(s.evChargeKw) * dt;
  const appliances = Object.values(s.applianceKw).reduce((a, k) => a + sum(k) * dt, 0);
  out.push({
    key: "flexibility",
    label: "Flexibility",
    direction: "HIGHER_IS_BETTER",
    value: consumption > 0 ? pct((car + appliances) / consumption) : null,
    formula: "100 × (car charging + appliances that were given a window) ÷ energy used",
    detail:
      consumption > 0
        ? car + appliances > 0
          ? `Movable ${kwh(car + appliances)} of ${kwh(consumption)}: the car ${kwh(car)}, appliances ${kwh(appliances)}.`
          : "Nothing was entered that can be moved: no car and no appliance with a window."
        : "The property uses nothing in this plan.",
  });
  return out;
}

// ---- waste

export type WasteKey = "solarCurtailment" | "surplusSold" | "soldThenBoughtBack" | "dearHoursImport" | "applianceSchedule" | "batteryOpportunity";

export interface WasteCalc {
  key: WasteKey;
  label: string;
  state: "FOUND" | "NONE" | "UNAVAILABLE";
  kwh: number | null;
  valueInr: number | null;
  explanation: string;
  how: string;
}

const inr = (x: number): string => `₹${(Math.round(x * 100) / 100).toFixed(2)}`;
const EPS = 0.005;

/**
 * Energy sold in an earlier hour and bought back in a later one, matched first-in first-out, and the gap between the two prices on the
 * energy matched. An upper bound on what keeping it would have been worth: it ignores battery losses and size.
 */
export function boughtBack(p: PlanDto): { kwh: number; valueInr: number } {
  const s = p.schedule;
  const dt = p.horizon.stepHours;
  const sold: { kwh: number; price: number }[] = [];
  let matched = 0;
  let value = 0;
  for (let t = 0; t < s.gridImportKw.length; t++) {
    let buy = (s.gridImportKw[t] ?? 0) * dt;
    while (buy > 1e-9 && sold.length > 0) {
      const head = sold[0]!;
      const take = Math.min(buy, head.kwh);
      const gap = (s.importPrice[t] ?? 0) - head.price;
      if (gap > 0) {
        matched += take;
        value += take * gap;
      }
      head.kwh -= take;
      buy -= take;
      if (head.kwh <= 1e-9) sold.shift();
    }
    const sell = (s.gridExportKw[t] ?? 0) * dt;
    if (sell > 1e-9) sold.push({ kwh: sell, price: s.exportPrice[t] ?? 0 });
  }
  return { kwh: matched, valueInr: value };
}

export function wasteFindings(p: PlanDto): WasteCalc[] {
  const r = p.result.value;
  if (!r) return [];
  const s = p.schedule;
  const dt = p.horizon.stepHours;
  const out: WasteCalc[] = [];

  // solar thrown away, valued at what it could have been sold for
  const curtailValue = s.pvCurtailedKw.reduce((a, k, t) => a + k * dt * (s.exportPrice[t] ?? 0), 0);
  const curtailReasons = p.decisions.filter((d) => d.kind === "curtail").map((d) => d.reason);
  out.push({
    key: "solarCurtailment",
    label: "Solar thrown away",
    state: r.pvKwh <= 0 ? "UNAVAILABLE" : r.curtailedKwh > EPS ? "FOUND" : "NONE",
    kwh: r.pvKwh <= 0 ? null : r.curtailedKwh,
    valueInr: r.pvKwh <= 0 ? null : curtailValue,
    explanation:
      r.pvKwh <= 0
        ? "There is no solar in this plan."
        : r.curtailedKwh > EPS
          ? `${kwh(r.curtailedKwh)} of solar could be neither used, stored nor sold, worth ${inr(curtailValue)} at the export price. ${curtailReasons[0] ?? ""}`.trim()
          : "All the solar was used, stored or sold.",
    how: "Solar available minus solar put to use in the plan, valued at the export price of each hour it happened (nothing where there is no export credit).",
  });

  // what was sold, informationally: selling is not waste
  const sellRevenue = s.gridExportKw.reduce((a, k, t) => a + k * dt * (s.exportPrice[t] ?? 0), 0);
  out.push({
    key: "surplusSold",
    label: "Surplus sold to the grid",
    state: r.exportKwh > EPS ? "FOUND" : "NONE",
    kwh: r.exportKwh,
    valueInr: sellRevenue,
    explanation: r.exportKwh > EPS ? `${kwh(r.exportKwh)} was sold for ${inr(sellRevenue)} (${inr(sellRevenue / r.exportKwh)} per kWh). Selling is not waste; the next line says whether the same energy was bought back dearer.` : "Nothing was sold.",
    how: "Energy exported in the plan and what it earned.",
  });

  const bb = boughtBack(p);
  out.push({
    key: "soldThenBoughtBack",
    label: "Sold, then bought back dearer",
    state: r.exportKwh <= EPS ? "NONE" : bb.kwh > EPS ? "FOUND" : "NONE",
    kwh: r.exportKwh <= EPS ? 0 : bb.kwh,
    valueInr: r.exportKwh <= EPS ? 0 : bb.valueInr,
    explanation:
      bb.kwh > EPS
        ? `${kwh(bb.kwh)} was sold in one hour and a like amount bought in a later hour at a higher price: at most ${inr(bb.valueInr)} could have been kept by storing it, before the battery's losses and size.`
        : "No energy was sold in one hour and bought dearer in a later one.",
    how: "Sold energy matched first-in first-out to later purchases; counted only where the later price is higher; the sum of the price gaps. An upper bound.",
  });

  // what was bought in the dearest hours
  const prices = s.importPrice;
  const hi = Math.max(0, ...prices);
  const lo = prices.length ? Math.min(...prices) : 0;
  if (hi > lo + 1e-9) {
    let boughtKwh = 0;
    let cost = 0;
    prices.forEach((pr, t) => {
      if (Math.abs(pr - hi) < 1e-9) {
        const k = (s.gridImportKw[t] ?? 0) * dt;
        boughtKwh += k;
        cost += k * pr;
      }
    });
    out.push({
      key: "dearHoursImport",
      label: "Bought in the dearest hours",
      state: boughtKwh > EPS ? "FOUND" : "NONE",
      kwh: boughtKwh,
      valueInr: cost,
      explanation: boughtKwh > EPS ? `${kwh(boughtKwh)} was bought at the day's highest price, ${inr(hi)} per kWh, costing ${inr(cost)}; the cheapest hour is ${inr(lo)}. What the plan could not move or cover from the sun or the battery.` : `Nothing was bought at the day's highest price, ${inr(hi)} per kWh.`,
      how: "Energy bought in the hours where the import price equals the highest of the plan's horizon, and its cost. Not all of it is avoidable: it is what remains after the plan has already shifted what it can.",
    });
  } else {
    out.push({ key: "dearHoursImport", label: "Bought in the dearest hours", state: "UNAVAILABLE", kwh: null, valueInr: null, explanation: "The price does not change across this plan's hours, so no hour is dearer than another.", how: "Needs a time-of-day tariff." });
  }

  out.push({
    key: "applianceSchedule",
    label: "Appliances run at a dear time",
    state: "UNAVAILABLE",
    kwh: null,
    valueInr: null,
    explanation: "The plan chooses each appliance's start together with the battery and the sun, so its saving is inside the plan's saving and cannot be split out without counting it twice. The Plan tab lists the start chosen for each.",
    how: "Not separable from the plan's saving.",
  });
  out.push({
    key: "batteryOpportunity",
    label: "Battery opportunity lost",
    state: "UNAVAILABLE",
    kwh: null,
    valueInr: null,
    explanation: "AVISHKAR has no record of what the battery actually did (no device feed), so it cannot say what an unused price spread cost. The plan shows what the battery should do.",
    how: "Needs a measured battery history.",
  });
  return out;
}
