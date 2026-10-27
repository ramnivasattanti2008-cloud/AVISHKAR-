import type { PlanDto } from "./schemas.js";

/** Quote a field when it needs it, and defuse text a spreadsheet would run as a formula. */
export function csvField(v: string | number): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "";
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * A stored plan as CSV (spec section 64: export of results), one row per step, exactly the numbers that were shown. The lines
 * starting with `#` say what the file is: a SIMULATED outcome of forecast inputs, not a measurement.
 */
export function planCsv(plan: PlanDto): string {
  const s = plan.schedule;
  const names = new Map(plan.appliances.map((a) => [a.id, a.name]));
  const applianceIds = Object.keys(s.applianceKw);
  const columns: [string, number[]][] = [
    ["load_kw", s.loadKw],
    ["pv_forecast_kw", s.pvForecastKw],
    ["pv_used_kw", s.pvUsedKw],
    ["pv_curtailed_kw", s.pvCurtailedKw],
    ["grid_import_kw", s.gridImportKw],
    ["grid_export_kw", s.gridExportKw],
    ["battery_charge_kw", s.batteryChargeKw],
    ["battery_discharge_kw", s.batteryDischargeKw],
    ["battery_soc_kwh", s.batterySocKwh],
    ["ev_charge_kw", s.evChargeKw],
    ...applianceIds.map((id): [string, number[]] => [`appliance_kw: ${names.get(id) ?? id}`, s.applianceKw[id]!]),
    ["import_price_inr_per_kwh", s.importPrice],
    ["export_price_inr_per_kwh", s.exportPrice],
  ];
  const r = plan.result.value;
  const meta = [
    `# AVISHKAR plan ${plan.id}, made ${plan.createdAt}, mode ${plan.mode}`,
    `# SIMULATED: what the planner chose for forecast inputs, not a measurement. Step ${plan.horizon.stepHours} h, ${plan.horizon.steps} steps from ${plan.horizon.start}.`,
    `# Tariff: ${plan.inputs.tariff.name}. Model: ${plan.result.provenance.modelVersion ?? "unknown"}.`,
    ...(r ? [`# Net cost ${r.netCostInr.toFixed(2)} INR against ${r.baselineNetCostInr.toFixed(2)} INR with no control (saving ${r.savingsInr.toFixed(2)} INR).`] : []),
  ].map((l) => l.replace(/[\r\n]+/g, " "));
  const header = ["time", ...columns.map(([c]) => c)].map(csvField).join(",");
  const rows = s.times.map((t, i) => [t, ...columns.map(([, v]) => v[i] ?? Number.NaN)].map(csvField).join(","));
  return [...meta, header, ...rows].join("\r\n") + "\r\n";
}
