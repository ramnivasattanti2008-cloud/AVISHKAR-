/**
 * Opportunities (spec sections 20 and 21): what is worth doing, found by trying a few changes on the property's own year and by
 * looking at what its data lacks. Every money figure comes from the same yearly simulation as the What-if tab; where no price
 * exists the answer is the most the equipment could cost and still pay for itself, never a guess at what it does cost.
 */
import { z } from "zod";
import type { ForecastDeps } from "../forecast/service.js";
import { estimated, reference } from "../provenance/index.js";
import { ProvenanceSchema } from "../schemas.js";
import { simulateYear } from "../scenarios/annual.js";
import { economics } from "../scenarios/economics.js";
import { applyChange, prepareYear } from "../scenarios/service.js";
import { listTariffs } from "../tariff/service.js";

export const OpportunityKinds = ["ADD_SOLAR", "ADD_BATTERY", "CHANGE_TARIFF", "PROVIDE_DATA"] as const;

export const OpportunitySchema = z
  .object({
    id: z.string(),
    kind: z.enum(OpportunityKinds),
    title: z.string(),
    detail: z.string(),
    annualSavingsInr: z.number().nullable().describe("A typical year's saving; null for a suggestion about data."),
    breakEven: z
      .object({ totalInr: z.number(), perUnitInr: z.number(), unit: z.string(), basis: z.string() })
      .nullable()
      .describe("The most it could cost and still repay itself over its life. Compare it with a quote; AVISHKAR has no price list."),
    provenance: ProvenanceSchema,
    /** What to put into the What-if form to see the money. */
    scenario: z.object({ addSolarKwp: z.number().optional(), addBatteryKwh: z.number().optional(), tariffPlanId: z.uuid().optional() }).nullable(),
    /** The part of the property's pages that deals with it, as a path suffix: "/tariff". */
    href: z.string().nullable(),
  })
  .meta({ id: "Opportunity" });
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const OpportunitiesSchema = z
  .object({
    propertyId: z.uuid(),
    generatedAt: z.string(),
    items: z.array(OpportunitySchema),
    checked: z.array(z.object({ title: z.string(), annualSavingsInr: z.number() })).describe("Changes that were tried and did not save enough to list, with what they would save (it can be negative)."),
    notes: z.array(z.string()),
  })
  .meta({ id: "Opportunities" });

interface Ctx {
  requestId?: string;
}

const MIN_WORTH_INR = 100;
const round = (v: number, d = 0): number => Math.round(v * 10 ** d) / 10 ** d;

/** The present value of a yearly saving over 20 years at 8%, falling 0.5% a year: the price above which it would not repay itself. */
export function breakEvenInr(annualSavingsInr: number): number {
  return economics({ investmentInr: 0, annualSavingsInr, years: 20, discountRate: 0.08, tariffEscalation: 0, degradation: 0.005 }).npvInr;
}

export async function findOpportunities(deps: ForecastDeps, userId: string, propertyId: string, ctx: Ctx = {}) {
  const { db } = deps;
  const items: Opportunity[] = [];
  const checked: { title: string; annualSavingsInr: number }[] = [];
  const notes: string[] = [];

  // ---- what the data lacks (does not need the engine)
  const [row, batteries, appliances, last] = await Promise.all([
    db.property.findUniqueOrThrow({ where: { id: propertyId }, select: { tariffPlanId: true } }),
    db.battery.findMany({ where: { propertyId, status: "EXISTING" } }),
    db.appliance.findMany({ where: { propertyId } }),
    db.energyObservation.findFirst({ where: { propertyId }, orderBy: { ts: "desc" }, select: { ts: true, intervalMinutes: true } }),
  ]);
  const at = deps.now();
  const data = (id: string, title: string, detail: string, href: string) =>
    items.push({ id, kind: "PROVIDE_DATA", title, detail, annualSavingsInr: null, breakEven: null, provenance: reference(null, { provider: "avishkar-opportunities", source: "What this property's records lack", dataType: "data_suggestion", now: at }).provenance, scenario: null, href });
  if (!row.tariffPlanId) data("data-tariff", "Choose your tariff", "Plans, forecasts of your bill and every what-if are worked out against your tariff's prices.", "/tariff");
  if (!last) data("data-meter", "Import your meter readings", "Without them there is no forecast of your use and no plan: AVISHKAR will not guess when you use electricity.", "/meter-data");
  else if (at.getTime() - (last.ts.getTime() + last.intervalMinutes * 60_000) > 3 * 86_400_000) data("data-meter-old", "Import newer meter readings", "Your readings end more than three days ago, so a forecast covers the hours after them, not the days ahead. A recent file gives a plan for tomorrow.", "/meter-data");
  const staleCharge = batteries.length > 0 && batteries.some((b) => b.currentSoc === null || b.currentSocAt === null || at.getTime() - b.currentSocAt.getTime() > 24 * 3_600_000);
  if (staleCharge) data("data-battery-charge", "Enter your battery's charge", "The plan assumes the battery starts at its reserve level when it does not know its charge. Entering it gives a plan that fits tonight.", "/assets");
  if (!appliances.some((a) => a.priority === "FLEXIBLE" && a.earliestStart && a.durationMin)) data("data-flexible", "Add the loads that can wait", "Give a washing machine, geyser or pump a window and a run time and the plan can move it to the cheapest or sunniest hours.", "/assets");

  // ---- what to try on the year (needs the tariff, the readings and the engine)
  if (!row.tariffPlanId || !last) {
    notes.push("Money opportunities need your tariff and meter readings first.");
    return { propertyId, generatedAt: at.toISOString(), items, checked, notes };
  }
  const p = await prepareYear(deps, userId, propertyId, ctx);
  const base = await simulateYear(p.yctx, p.baseCfg);
  const src = { provider: "avishkar-opportunities", source: "AVISHKAR typical-year simulation of a change to this property", dataType: "opportunity", location: { latitude: p.property.latitude, longitude: p.property.longitude }, now: at };
  const basis = "a typical year from your readings and the monthly solar climatology: an estimate, not a forecast of any particular year.";

  const hasSolar = p.solarRows.length > 0;
  const hasBattery = p.batteryRows.length > 0;
  const tries: { id: string; kind: "ADD_SOLAR" | "ADD_BATTERY"; size: number; unit: string; req: { addSolarKwp?: number; addBatteryKwh?: number } }[] = [
    ...(hasSolar ? [2, 4] : [3, 5]).map((k) => ({ id: `solar-${k}`, kind: "ADD_SOLAR" as const, size: k, unit: "kWp", req: { addSolarKwp: k } })),
    ...(hasBattery ? [5] : [5, 10]).map((k) => ({ id: `battery-${k}`, kind: "ADD_BATTERY" as const, size: k, unit: "kWh", req: { addBatteryKwh: k } })),
  ];
  for (const t of tries) {
    const assumptions: string[] = [];
    const cfg = applyChange(p, propertyId, t.req, p.baseTariff, assumptions);
    const r = await simulateYear(p.yctx, cfg);
    const saving = round(base.netCostInr - r.netCostInr);
    const label = t.kind === "ADD_SOLAR" ? `${hasSolar ? "Add" : "Install"} ${t.size} kWp of solar` : `${hasBattery ? "Add" : "Install"} a ${t.size} kWh battery`;
    if (saving < MIN_WORTH_INR) {
      checked.push({ title: label, annualSavingsInr: saving });
      continue;
    }
    const be = breakEvenInr(saving);
    items.push({
      id: t.id,
      kind: t.kind,
      title: label,
      detail:
        t.kind === "ADD_SOLAR"
          ? `Saves about ₹${round(saving).toLocaleString("en-IN")} a year${r.exportKwh > base.exportKwh ? `, with ${Math.round((r.exportKwh / Math.max(r.pvKwh, 1)) * 100)}% of the solar sent to the grid` : ""}. ${p.baseTariff.export.basis === "ASSUMPTION" ? "The export credit is an assumption, so check it first." : ""}`.trim()
          : `Saves about ₹${round(saving).toLocaleString("en-IN")} a year by moving cheap or free energy into the dear hours.`,
      annualSavingsInr: saving,
      breakEven: { totalInr: round(be), perUnitInr: round(be / t.size), unit: t.unit, basis: "the present value of the saving over 20 years at 8% a year, falling 0.5% a year: above this price it does not repay itself in that time" },
      provenance: estimated(null, { ...src, basis }).provenance,
      scenario: t.req,
      href: "/what-if",
    });
  }

  // ---- another tariff the owner could really be on: the same kind of consumer, in the same state (or the owner's own plan)
  const alternatives = (await listTariffs(db, userId, { consumerType: p.baseTariff.consumerType }, at))
    .filter((t) => t.id !== p.baseTariff.id && (t.origin === "USER" || (t.state !== null && t.state === p.baseTariff.state)))
    .slice(0, 4);
  for (const t of alternatives) {
    const cfg = applyChange(p, propertyId, {}, t, []);
    const r = await simulateYear(p.yctx, cfg);
    const saving = round(base.netCostInr - r.netCostInr);
    const title = `Switch to ${t.name}`;
    if (saving < MIN_WORTH_INR) {
      checked.push({ title, annualSavingsInr: saving });
      continue;
    }
    items.push({
      id: `tariff-${t.id}`,
      kind: "CHANGE_TARIFF",
      title,
      detail: `Would cost about ₹${round(saving).toLocaleString("en-IN")} a year less for the same use. Whether you are allowed to switch is up to your distribution company.${t.validity.status === "EXPIRED" ? " This plan's order has expired: check it is still offered." : ""}`,
      annualSavingsInr: saving,
      breakEven: null,
      provenance: estimated(null, { ...src, basis }).provenance,
      scenario: { tariffPlanId: t.id },
      href: "/what-if",
    });
  }
  if (alternatives.length === 0) notes.push("No other tariff in your state is on file for your kind of connection, so none was compared.");

  items.sort((a, b) => (b.annualSavingsInr ?? -1) - (a.annualSavingsInr ?? -1));
  notes.push("These are a few example sizes, not a recommendation: AVISHKAR has no price list, so the break-even price is the most it could cost and still repay itself. The What-if tab takes your own quote.");
  return { propertyId, generatedAt: at.toISOString(), items, checked: checked.sort((a, b) => b.annualSavingsInr - a.annualSavingsInr), notes };
}
