import type { EnergyHealth, EnergyWaste } from "@/lib/types";
import { PROPERTY_ID, provenance } from "./fixtures";

const sim = (dataType: string, notes: string[] = ["A simulated day: the plan made 2026-10-08T09:00:00.000Z. It is not a measurement of what the property did."]) =>
  provenance({ status: "SIMULATED", provider: "avishkar-insight", dataType, notes });
const gone = (dataType: string, reason: string) => provenance({ status: "UNAVAILABLE", provider: "avishkar-insight", dataType, notes: [reason] });
const PLAN_BASIS = { planId: "44444444-4444-4444-8444-444444444444", madeAt: "2026-10-08T09:00:00.000Z", stale: false, note: "Read from this plan; nothing was recomputed." };

export function energyHealth(over: Partial<EnergyHealth> = {}): EnergyHealth {
  return {
    label: "ENERGY HEALTH",
    propertyId: PROPERTY_ID,
    madeAt: "2026-10-08T10:00:00.000Z",
    basedOn: PLAN_BASIS,
    metrics: [
      { key: "efficiency", label: "Efficiency", direction: "HIGHER_IS_BETTER", formula: "100 × (1 − (energy lost inside the battery + solar thrown away) ÷ (solar made + energy bought))", detail: "Lost in the battery 0.62 kWh, solar thrown away 0 kWh, of 31.4 kWh that came in.", result: { value: 98, unit: "%", provenance: sim("health_efficiency") } },
      { key: "solarUtilisation", label: "Solar utilisation", direction: "HIGHER_IS_BETTER", formula: "100 × solar put to use (used, stored or sold) ÷ solar available", detail: "19.1 kWh of 19.1 kWh; 0 kWh was sold, so this is not the share used at home.", result: { value: 100, unit: "%", provenance: sim("health_solarUtilisation") } },
      { key: "peakManagement", label: "Peak management", direction: "HIGHER_IS_BETTER", formula: "100 × (1 − the grid's highest hour ÷ the property's highest hour of use)", detail: "The property peaks at 2.5 kW; the most it buys in one hour is 1.5 kW.", result: { value: 40, unit: "%", provenance: sim("health_peakManagement") } },
      { key: "storageUtilisation", label: "Storage utilisation", direction: "HIGHER_IS_BETTER", formula: "100 × (highest − lowest charge reached) ÷ usable capacity", detail: "There is no battery in this plan.", result: { value: null, unit: "%", provenance: gone("health_storageUtilisation", "There is no battery in this plan.") } },
      { key: "resilience", label: "Resilience", direction: "HIGHER_IS_BETTER", formula: "Hours the critical load could be carried if the grid failed at the start of the next hour: the battery, plus the forecast sun", detail: "9.5 hours; the battery's charge is assumed.", result: { value: 9.5, unit: "h", provenance: provenance({ status: "SIMULATED", provider: "avishkar-resilience", dataType: "resilience" }) } },
      { key: "gridDependence", label: "Grid dependence", direction: "LOWER_IS_BETTER", formula: "100 × energy bought from the grid ÷ energy used", detail: "Bought 12.5 kWh of 28.2 kWh used.", result: { value: 44.3, unit: "%", provenance: sim("health_gridDependence") } },
      { key: "flexibility", label: "Flexibility", direction: "HIGHER_IS_BETTER", formula: "100 × (car charging + appliances that were given a window) ÷ energy used", detail: "Nothing was entered that can be moved: no car and no appliance with a window.", result: { value: 0, unit: "%", provenance: sim("health_flexibility") } },
    ],
    noOverallScore: "These are not added into one number. Doing so would need a weight for each, and any weights would be my judgement, not a measurement.",
    next: [],
    ...over,
  };
}

export function energyWaste(over: Partial<EnergyWaste> = {}): EnergyWaste {
  const amount = (dataType: string, kwh: number | null, valueInr: number | null) => ({ value: { kwh, valueInr }, unit: "INR", provenance: sim(dataType) });
  return {
    label: "ENERGY WASTE",
    propertyId: PROPERTY_ID,
    madeAt: "2026-10-08T10:00:00.000Z",
    basedOn: PLAN_BASIS,
    findings: [
      { key: "solarCurtailment", label: "Solar thrown away", state: "FOUND", explanation: "0.8 kWh of solar could be neither used, stored nor sold, worth ₹2.40 at the export price.", how: "Solar available minus solar put to use in the plan, valued at the export price.", amount: amount("waste_solarCurtailment", 0.8, 2.4) },
      { key: "surplusSold", label: "Surplus sold to the grid", state: "NONE", explanation: "Nothing was sold.", how: "Energy exported in the plan and what it earned.", amount: amount("waste_surplusSold", 0, 0) },
      { key: "dearHoursImport", label: "Bought in the dearest hours", state: "FOUND", explanation: "7.2 kWh was bought at the day's highest price, ₹10.00 per kWh, costing ₹72.00.", how: "Energy bought in the hours where the import price equals the highest.", amount: amount("waste_dearHoursImport", 7.2, 72) },
      { key: "batteryOpportunity", label: "Battery opportunity lost", state: "UNAVAILABLE", explanation: "AVISHKAR has no record of what the battery actually did (no device feed).", how: "Needs a measured battery history.", amount: { value: null, unit: "INR", provenance: gone("waste_batteryOpportunity", "AVISHKAR has no record of what the battery actually did (no device feed).") } },
    ],
    avoidable: {
      perDay: { value: 40.4, unit: "INR", provenance: sim("avoidable_cost_day", ["The latest plan's saving over the same day with no control."]) },
      averageMonth: { value: null, unit: "INR", provenance: gone("avoidable_cost_month", "No what-if run has worked out a year for this property, and a month's figure needs one.") },
    },
    note: "A plan is a simulation of a day on forecasts: these are what that day shows, not what was measured.",
    next: [{ label: "Run a what-if", href: `/property/${PROPERTY_ID}/what-if`, why: "A year worked out hour by hour gives the average month's avoidable cost." }],
    ...over,
  };
}
