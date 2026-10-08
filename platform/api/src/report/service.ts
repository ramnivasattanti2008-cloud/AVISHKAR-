/**
 * A report of everything AVISHKAR holds for a property (spec section 96: "export a report"). It is assembled from what is already
 * stored (the tariff, the readings and their fingerprint, the equipment, the latest plan, the latest what-if, how the forecasts
 * have done), so nothing is recomputed and nothing is added: where a part does not exist the report says so and says why, and
 * every figure carries the label that tells a reader whether it was measured, forecast, estimated or simulated.
 */
import { ownProperty } from "../assets/service.js";
import { energySummary } from "../energy/service.js";
import { AppError } from "../errors.js";
import { type ForecastDeps, forecastAccuracy } from "../forecast/service.js";
import { getPlan } from "../plan/service.js";
import { getProperty } from "../properties/service.js";
import { STATUS_MEANING } from "./legend.js";
import { getScenario, listScenarios } from "../scenarios/service.js";
import { getTariff } from "../tariff/service.js";

const inr = (v: number): string => `INR ${Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(2)}`;
const n = (v: number, d = 1): string => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("en-IN", { maximumFractionDigits: d });
const day = (iso: string): string => iso.slice(0, 10);
const kindLabel: Record<string, string> = { charge_battery: "charge the battery", discharge_battery: "use the battery", export: "sell to the grid", curtail: "leave solar unused", ev_charge: "charge the car", appliance: "run an appliance", import_peak: "buy at a high price", shed: "switch off non-critical load" };

export async function buildReport(deps: ForecastDeps, userId: string, propertyId: string): Promise<{ markdown: string; filename: string }> {
  const { db } = deps;
  await ownProperty(db, userId, propertyId);
  const at = deps.now();
  const p = await getProperty(db, userId, propertyId, deps.policy);
  const L: string[] = [];
  const h = (t: string) => L.push("", `## ${t}`, "");
  const gap = (what: string, why: string) => L.push(`*${what}: not available. ${why}*`);

  L.push(`# AVISHKAR report: ${p.name}`, "", `Made ${at.toISOString().slice(0, 16).replace("T", " ")} UTC from what AVISHKAR holds for this property. Nothing in it was recomputed for the report, and nothing was added: where something is missing it says so.`);

  h("The property");
  L.push(`- Location: ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}${p.address ? ` (${p.address})` : ""}.`, `- How the position was obtained: ${p.position.label}${p.position.accuracyM ? `, accurate to about ${Math.round(p.position.accuracyM)} m` : ""}. ${p.position.note}`);
  if (p.warnings.length) for (const w of p.warnings) L.push(`- Note: ${w}`);

  h("Tariff");
  if (!p.tariffPlanId) gap("Tariff", "No tariff has been chosen for this property.");
  else {
    const t = await getTariff(db, userId, p.tariffPlanId, at);
    const rates = t.hourlyRates;
    L.push(`- ${t.name}${t.state ? ` (${t.state})` : ""}${t.discom ? `, ${t.discom}` : ""}; ${t.consumerType.toLowerCase()}.`, `- Energy rate: INR ${Math.min(...rates).toFixed(2)} to INR ${Math.max(...rates).toFixed(2)} per kWh depending on the hour.`, `- Export credit: ${t.export.rate === null ? "none stated" : `INR ${t.export.rate.toFixed(2)} per kWh`} (${t.export.basis === "ASSUMPTION" ? "an assumption: the source states no export rate" : t.export.basis === "USER_ENTERED" ? "entered by the owner" : "from the source"}).`, `- Source: ${t.source}. ${t.validity.message}`);
  }

  h("Electricity use");
  const e = await energySummary(db, userId, propertyId);
  if (!e.coverage) gap("Meter readings", "None have been imported.");
  else {
    L.push(`- Readings: ${e.coverage.observations.toLocaleString("en-IN")} every ${e.coverage.intervalMinutes} minutes, ${day(e.coverage.from)} to ${day(e.coverage.to)} (${e.coverage.days} days). The owner's own data; gaps are left as gaps.`);
    if (e.dna) {
      const b = e.dna.baseline;
      L.push(`- Energy DNA (version ${e.dna.version}, ${e.dna.period.completeDays} complete days): average day ${n(b.meanDailyKwh.value ?? 0)} kWh [${b.meanDailyKwh.provenance.status}]; weekday ${b.weekdayDailyKwh.value === null ? "not available" : `${n(b.weekdayDailyKwh.value)} kWh`}, weekend ${b.weekendDailyKwh.value === null ? "not available" : `${n(b.weekendDailyKwh.value)} kWh`}; base load ${n(b.baseloadKw.value ?? 0, 2)} kW; peak ${n(b.peakKw.value ?? 0, 2)} kW at ${String(Math.round(b.peakHour.value ?? 0)).padStart(2, "0")}:00.`);
      for (const g of e.dna.unavailable) L.push(`- Not known yet: ${g.what}: ${g.reason}`);
    } else L.push(`- Energy DNA: not available. ${e.dnaUnavailableReason ?? ""}`);
  }

  h("Equipment entered");
  const [batteries, solar, evs, appliances] = await Promise.all([db.battery.findMany({ where: { propertyId } }), db.solarSystem.findMany({ where: { propertyId } }), db.ev.findMany({ where: { propertyId } }), db.appliance.findMany({ where: { propertyId } })]);
  if (!batteries.length && !solar.length && !evs.length && !appliances.length) gap("Equipment", "Nothing has been entered.");
  for (const s of solar) L.push(`- Solar: ${s.name}, ${n(s.capacityKwp, 2)} kWp, tilt ${n(s.tiltDeg, 0)} degrees, azimuth ${n(s.azimuthDeg, 0)} degrees (${s.status.toLowerCase()}).`);
  for (const b of batteries) L.push(`- Battery: ${b.name}, ${n(b.capacityKwh, 1)} kWh, up to ${n(b.maxChargeKw, 1)} kW in and ${n(b.maxDischargeKw, 1)} kW out (${b.status.toLowerCase()}).`);
  for (const v of evs) L.push(`- Vehicle: ${v.name}, ${n(v.batteryKwh, 0)} kWh battery, ${n(v.chargerKw, 1)} kW charger.`);
  if (appliances.length) L.push(`- Appliances: ${appliances.length} entered (${appliances.filter((a) => a.priority === "CRITICAL").length} critical, ${appliances.filter((a) => a.priority === "FLEXIBLE").length} flexible).`);

  h("The latest plan");
  try {
    const plan = await getPlan(db, userId, propertyId);
    const r = plan.result.value;
    L.push(`- Made ${plan.createdAt.slice(0, 16).replace("T", " ")} UTC; ${plan.mode.toLowerCase().replace("_", " ")} mode; ${plan.horizon.steps} hours from ${plan.horizon.start.slice(0, 16).replace("T", " ")} UTC. [${plan.result.provenance.status}]`);
    if (r) L.push(`- Expected cost ${inr(r.netCostInr)} against ${inr(r.baselineNetCostInr)} with no control: a saving of ${inr(r.savingsInr)}. Bought from the grid ${n(r.importKwh)} kWh; solar put to use ${n(r.pvUsedKwh)} of ${n(r.pvKwh)} kWh.`);
    L.push("- This is a simulated outcome of forecasts, not a measurement.");
    if (plan.decisions.length) {
      L.push("", "Decisions (each with the planner's own reason):", "");
      for (const d of plan.decisions.slice(0, 12)) L.push(`- ${d.time.slice(0, 16).replace("T", " ")} UTC: ${kindLabel[d.kind] ?? d.kind}, ${n(d.kwh, 2)} kWh. ${d.reason}`);
      if (plan.decisions.length > 12) L.push(`- ... and ${plan.decisions.length - 12} more.`);
    }
    if (plan.assumptions.length) L.push("", "Assumptions:", "", ...plan.assumptions.map((a) => `- ${a}`));
  } catch (err) {
    if (!(err instanceof AppError && err.code === "NOT_FOUND")) throw err;
    gap("Plan", "None has been made yet.");
  }

  h("The latest what-if");
  const sc = (await listScenarios(db, userId, propertyId))[0];
  if (!sc) gap("What-if", "None has been run yet.");
  else {
    const s = await getScenario(db, userId, propertyId, sc.id);
    const c = s.comparison.value;
    L.push(`- ${s.name} (${s.createdAt.slice(0, 10)}): over a typical year ${c ? `${c.annualSavingsInr >= 0 ? "saves" : "costs"} about ${inr(Math.abs(c.annualSavingsInr))}` : "no figure"} [${s.comparison.provenance.status}].`);
    L.push(`- Planned yearly cost today ${inr(s.base.netCostInr)}; with the change ${inr(s.scenario.netCostInr)}.`);
    if (s.economics.value && s.investment.value) L.push(`- You would pay ${inr(s.investment.value.totalInr)} (your quote); payback ${s.economics.value.paybackYears === null ? "not within the life given" : `${n(s.economics.value.paybackYears, 1)} years`}; net present value ${inr(s.economics.value.npvInr)}; rate of return ${s.economics.value.irrPercent === null ? "not defined" : `${n(s.economics.value.irrPercent, 1)}% a year`}.`);
    else L.push(`- Money: not available. ${s.investment.provenance.notes[0] ?? ""}`);
    if (s.subsidy.value !== null) L.push(`- If you qualify, the published subsidy could pay about ${inr(s.subsidy.value)}. It is not netted off the cost and is not a confirmed entitlement.`);
    L.push("", "Assumptions:", "", ...s.assumptions.map((a) => `- ${a}`));
  }

  h("How the forecasts have done");
  const acc = await forecastAccuracy(deps, userId, propertyId);
  const sum = acc.load.summary.value;
  if (!sum) gap("Forecast accuracy", acc.load.summary.provenance.notes[0] ?? "Nothing has been scored.");
  else L.push(`- ${sum.scored} stored electricity-use forecast(s) scored against the readings that followed them: typical error ${n(sum.meanMaeKw, 2)} kW, bias ${n(sum.meanBiasKw, 2)} kW, the 10 to 90% band held on ${n(sum.meanCoverage80 * 100, 0)}% of hours.`);
  L.push(`- Solar: ${acc.solar.reason}`);

  h("What the labels mean");
  L.push(...Object.entries(STATUS_MEANING).map(([k, v]) => `- **${k}**: ${v}`));
  L.push("", "---", "", "AVISHKAR applies published rules and its own calculations to the numbers above. It does not confirm a subsidy or an eligibility, and a simulated or estimated figure is not a measurement.");

  const safe = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "property";
  return { markdown: `${L.join("\n")}\n`, filename: `avishkar-report-${safe}-${at.toISOString().slice(0, 10)}.md` };
}
