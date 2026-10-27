import { csvField } from "../plan/export.js";
import type { ScenarioDto } from "./schemas.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A stored what-if as CSV (spec section 64: export of results): one row per month, today's setup beside the changed one, then the
 * year. The lines starting with `#` say what it is: an ESTIMATE from typical days, with the economics and their assumptions.
 */
export function scenarioCsv(s: ScenarioDto): string {
  const c = s.comparison.value;
  const e = s.economics.value;
  const a = s.economicsAssumptions;
  const eq = (x: ScenarioDto["equipment"]["base"]) => `${x.solarKwp} kWp solar, ${x.batteryKwh} kWh battery, tariff ${x.tariff}`;
  const meta = [
    `# AVISHKAR what-if "${s.name}" (${s.id}), made ${s.createdAt}`,
    "# ESTIMATED: a year built from typical days (a weekday and a weekend day per month), each planned hour by hour; not a measurement.",
    `# Today: ${eq(s.equipment.base)}. Changed: ${eq(s.equipment.scenario)}.`,
    ...(c ? [`# Yearly saving ${c.annualSavingsInr.toFixed(2)} INR.`] : ["# Yearly saving: not available."]),
    ...(e
      ? [`# Without subsidy: NPV ${e.npvInr.toFixed(2)} INR, payback ${e.paybackYears === null ? "not within the period" : `${e.paybackYears} years`}, over ${a.years} years at ${a.discountRatePercent}% discount, ${a.tariffEscalationPercent}% tariff rise, ${a.degradationPercent}% ageing a year.`]
      : ["# Economics: not available (no costs were entered)."]),
  ].map((l) => l.replace(/[\r\n]+/g, " "));
  const header = ["month", "days", "today_net_cost_inr", "changed_net_cost_inr", "saving_inr", "today_import_kwh", "changed_import_kwh", "today_export_kwh", "changed_export_kwh", "changed_pv_kwh", "load_kwh"];
  const byMonth = new Map(s.scenario.months.map((m) => [m.month, m]));
  const rows = s.base.months.map((b) => {
    const x = byMonth.get(b.month);
    return [MONTHS[b.month - 1] ?? String(b.month), b.days, b.netCostInr, x?.netCostInr ?? Number.NaN, x ? b.netCostInr - x.netCostInr : Number.NaN, b.importKwh, x?.importKwh ?? Number.NaN, b.exportKwh, x?.exportKwh ?? Number.NaN, x?.pvKwh ?? Number.NaN, b.loadKwh];
  });
  const year = ["Year", s.base.months.reduce((t, m) => t + m.days, 0), s.base.netCostInr, s.scenario.netCostInr, s.base.netCostInr - s.scenario.netCostInr, s.base.importKwh, s.scenario.importKwh, s.base.exportKwh, s.scenario.exportKwh, s.scenario.pvKwh, s.base.loadKwh];
  return [...meta, header.join(","), ...[...rows, year].map((r) => r.map((v) => csvField(v)).join(","))].join("\r\n") + "\r\n";
}
