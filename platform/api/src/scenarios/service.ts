import { DEFAULTS, param } from "../assets/defaults.js";
import { ownProperty } from "../assets/service.js";
import type { Db } from "../db.js";
import { latestDna } from "../energy/service.js";
import { requireEngine } from "../engine/index.js";
import { AppError } from "../errors.js";
import type { Battery, Prisma, SolarSystem } from "../generated/prisma/client.js";
import { type ForecastDeps } from "../forecast/service.js";
import { aggregateBatteries, exportBasisNote } from "../plan/service.js";
import { evaluateEligibility } from "../policy/service.js";
import { getProperty } from "../properties/service.js";
import { type Measured, estimated, reference, unavailable } from "../provenance/index.js";
import { getTariff } from "../tariff/service.js";
import { type AnnualResult, type Config, type LoadModel, type PvSystemSpec, type YearContext, simulateYear } from "./annual.js";
import { nextYearDays } from "./calendar.js";
import { type Economics, economics } from "./economics.js";
import type { ScenarioDto, ScenarioRequest } from "./schemas.js";

interface Ctx {
  requestId?: string;
}

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------------------- the property's setup

const solarSpec = (s: SolarSystem): PvSystemSpec => ({
  capacityKwp: s.capacityKwp,
  tiltDeg: s.tiltDeg,
  azimuthDeg: s.azimuthDeg,
  lossFraction: param(s.lossFraction, DEFAULTS.solar.lossFraction).value as number,
  inverterKw: s.inverterKw,
});

/** A battery as the optimiser sees one for a typical day: the day repeats, so it ends at least where it began, at a charge the planner picks. */
function dayBattery(rows: Battery[], at: Date) {
  const a = aggregateBatteries(rows, at, null);
  if (!a) return null;
  const b = a.input;
  const mid = Math.max(b.reserveSocKwh ?? b.minSocKwh, (b.minSocKwh + b.maxSocKwh) / 2);
  return { ...b, initialSocKwh: round(mid, 6), terminalSocKwh: round(mid, 6), cyclic: true };
}

function virtualBattery(propertyId: string, kwh: number, kw: number, at: Date): Battery {
  return {
    id: "scenario-battery",
    propertyId,
    name: "Added battery",
    status: "EXISTING",
    capacityKwh: kwh,
    maxChargeKw: kw,
    maxDischargeKw: kw,
    chargeEfficiency: null,
    dischargeEfficiency: null,
    minSoc: null,
    maxSoc: null,
    reserveSoc: null,
    maxCyclesPerDay: null,
    ratedCycles: null,
    wearInrPerKwh: null,
    currentSoc: null,
    currentSocAt: null,
    installedOn: null,
    notes: null,
    createdAt: at,
    updatedAt: at,
  } as Battery;
}

/** The property's own average weekday and weekend day, scaled to each month's use. Months with no readings use the average month. */
export function loadModel(dna: { meanDailyKwh: number; patterns: unknown }): LoadModel {
  const p = dna.patterns as { hourly: number[]; weekdayHourly: number[] | null; weekendHourly: number[] | null; monthlyDailyKwh?: Record<string, number> };
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const [key, v] of Object.entries(p.monthlyDailyKwh ?? {})) byMonth[Number(key.slice(5, 7)) - 1]?.push(v);
  const filled: number[] = [];
  const monthFactor = byMonth.map((vs, i) => {
    if (vs.length === 0 || dna.meanDailyKwh <= 0) {
      filled.push(i + 1);
      return 1;
    }
    return vs.reduce((a, b) => a + b, 0) / vs.length / dna.meanDailyKwh;
  });
  return { weekday: p.weekdayHourly ?? p.hourly, weekend: p.weekendHourly ?? p.hourly, monthFactor, filledMonths: filled, meanDailyKwh: dna.meanDailyKwh };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// --------------------------------------------------------------------------------------- the run

export async function runScenario(deps: ForecastDeps, userId: string, propertyId: string, req: ScenarioRequest, ctx: Ctx = {}): Promise<ScenarioDto> {
  const { db, now } = deps;
  const engine = requireEngine(deps.engine);
  const at = now();
  const property = await getProperty(db, userId, propertyId, deps.policy);

  const row = await db.property.findUniqueOrThrow({ where: { id: propertyId }, select: { tariffPlanId: true } });
  const missing: { what: string; why: string }[] = [];
  const baseTariff = row.tariffPlanId ? await getTariff(db, userId, row.tariffPlanId, at) : null;
  if (!baseTariff) missing.push({ what: "tariff", why: "Choose the tariff you pay on the Tariff tab: the estimate is worked out against its prices." });
  const dna = await latestDna(db, propertyId);
  if (!dna) missing.push({ what: "load", why: "Import at least a week of meter readings on the Meter data tab: the estimate needs to know when and how much you use." });
  if (missing.length > 0 || !baseTariff || !dna) throw new AppError("PLAN_INPUTS_MISSING", `A yearly estimate cannot be made yet: ${missing.map((m) => m.why).join(" ")}`, { missing });
  const scenarioTariff = req.tariffPlanId ? await getTariff(db, userId, req.tariffPlanId, at) : baseTariff;

  const resource = await deps.providers.solarResource.climatology(property.latitude, property.longitude, { requestId: ctx.requestId, now });
  if (!resource.value) {
    throw new AppError("PLAN_INPUTS_MISSING", "The solar resource for this place could not be read, so a year of solar output cannot be estimated.", { missing: [{ what: "solar_resource", why: resource.provenance.notes[0] ?? "Unavailable." }] });
  }

  const [solarRows, batteryRows] = await Promise.all([db.solarSystem.findMany({ where: { propertyId, status: "EXISTING" }, orderBy: { createdAt: "asc" } }), db.battery.findMany({ where: { propertyId, status: "EXISTING" }, orderBy: { createdAt: "asc" } })]);
  const assumptions: string[] = [];

  const baseCfg: Config = { solar: solarRows.map(solarSpec), battery: dayBattery(batteryRows, at), tariff: baseTariff };
  const scenCfg: Config = { solar: [...baseCfg.solar], battery: baseCfg.battery, tariff: scenarioTariff };
  if (req.addSolarKwp) {
    const tilt = req.solarTiltDeg ?? Math.min(40, Math.max(5, Math.round(Math.abs(property.latitude))));
    const azimuth = req.solarAzimuthDeg ?? 180;
    scenCfg.solar.push({ capacityKwp: req.addSolarKwp, tiltDeg: tilt, azimuthDeg: azimuth, lossFraction: DEFAULTS.solar.lossFraction.value, inverterKw: null });
    if (req.solarTiltDeg === undefined) assumptions.push(`The added panels are tilted ${tilt} degrees, the latitude, a common rule for a fixed array; you did not give a tilt.`);
    if (req.solarAzimuthDeg === undefined) assumptions.push("The added panels face south (180 degrees); you did not give a direction.");
    assumptions.push(`The added panels lose ${round(DEFAULTS.solar.lossFraction.value * 100, 1)}% to wiring, mismatch and soiling: the default of the AVISHKAR Python EMS.`);
  }
  if (req.addBatteryKwh) {
    const kw = req.batteryPowerKw ?? req.addBatteryKwh / 2;
    scenCfg.battery = dayBattery([...batteryRows, virtualBattery(propertyId, req.addBatteryKwh, kw, at)], at);
    if (req.batteryPowerKw === undefined) assumptions.push(`The added battery charges and discharges at up to ${round(kw, 2)} kW, half its capacity per hour; you did not give a power.`);
    assumptions.push("Battery efficiency, usable range and wear cost use the documented defaults.");
  }
  if (scenarioTariff.id !== baseTariff.id) assumptions.push(`The changed tariff is ${scenarioTariff.name}.`);

  const load = loadModel(dna);
  if (load.filledMonths.length > 0) assumptions.push(`Your readings have fewer than seven complete days in ${load.filledMonths.map((m) => MONTH_NAMES[m - 1]).join(", ")}, so those months use your average month.`);
  const profiles = new Map<string, Promise<number[][]>>();
  const yctx: YearContext = { engine, latitude: property.latitude, longitude: property.longitude, elevationM: resource.value.elevationM, climate: resource.value.months, load, days: nextYearDays(at), requestId: ctx.requestId, profiles };
  const [base, scenario] = await Promise.all([simulateYear(yctx, baseCfg), simulateYear(yctx, scenCfg)]);

  assumptions.push(
    "A year is one typical weekday and one typical weekend day for each month, planned hour by hour for the lowest bill, then weighted by how many such days the next 12 months have.",
    "Each typical solar day is the clear-sky day of mid-month scaled to NASA POWER's monthly mean irradiation: the energy of each month is right, but cloudy-day variability is not captured.",
    "Your load on a typical day is your own average weekday or weekend pattern, scaled to each month's use. EVs and flexible appliances are not part of the yearly estimate.",
    "Each typical day is one that repeats: the battery ends it at least as charged as it began, at a starting charge the planner chooses.",
    "Fixed monthly charges, duties and taxes do not change with the equipment, so they are not in any figure.",
  );
  if (baseTariff.validity.status === "EXPIRED" || baseTariff.validity.status === "UNKNOWN") assumptions.push(`Tariff: ${baseTariff.validity.message}`);

  const savings = round(base.netCostInr - scenario.netCostInr);
  if (scenario.exportKwh > 0 || base.exportKwh > 0) {
    assumptions.push(exportBasisNote(scenarioTariff));
    const share = scenario.pvKwh > 0 ? scenario.exportKwh / scenario.pvKwh : 0;
    if (share > 0.3) assumptions.push(`${Math.round(share * 100)}% of the solar is sent to the grid, so the saving leans heavily on the export credit.`);
  }
  const src = { provider: "avishkar-scenarios", source: "AVISHKAR typical-year simulation (a typical weekday and weekend day per month, planned by the optimiser)", dataType: "scenario_comparison", location: { latitude: property.latitude, longitude: property.longitude }, now: at };
  const comparison = estimated(
    {
      annualSavingsInr: savings,
      savingsPercent: base.netCostInr > 0 ? round((savings / base.netCostInr) * 100, 1) : null,
      importKwhChange: round(scenario.importKwh - base.importKwh, 1),
      exportKwhChange: round(scenario.exportKwh - base.exportKwh, 1),
      selfSufficiencyChange: base.selfSufficiencyRatio !== null && scenario.selfSufficiencyRatio !== null ? round(scenario.selfSufficiencyRatio - base.selfSufficiencyRatio, 4) : null,
    },
    { ...src, unit: "INR", basis: "typical days from your own readings and the monthly solar climatology: an estimate for a typical year, not a forecast of any particular one." },
  );

  // ------------------------------------------------------------------ the money
  const costs = req.costs ?? {};
  const needsSolar = Boolean(req.addSolarKwp);
  const needsBattery = Boolean(req.addBatteryKwh);
  const lacks: string[] = [];
  if (needsSolar && costs.solarInrPerKwp === undefined) lacks.push("the price of solar per kWp");
  if (needsBattery && costs.batteryInrPerKwh === undefined) lacks.push("the price of the battery per kWh");
  const solarInr = needsSolar ? (costs.solarInrPerKwp ?? 0) * (req.addSolarKwp ?? 0) : 0;
  const batteryInr = needsBattery ? (costs.batteryInrPerKwh ?? 0) * (req.addBatteryKwh ?? 0) : 0;
  const otherInr = costs.otherInr ?? 0;
  const total = round(solarInr + batteryInr + otherInr);
  const capital = needsSolar || needsBattery;
  const investment: Measured<{ totalInr: number; solarInr: number; batteryInr: number; otherInr: number }> =
    lacks.length > 0
      ? unavailable(`Give ${lacks.join(" and ")} from a quote: AVISHKAR has no price list, so it will not guess what the equipment costs.`, { ...src, unit: "INR" })
      : reference({ totalInr: total, solarInr: round(solarInr), batteryInr: round(batteryInr), otherInr: round(otherInr) }, { ...src, unit: "INR", notes: capital ? ["Entered by you, from a quote; AVISHKAR has not checked it."] : ["No equipment is bought: only the tariff changes."] });

  const e = req.economics ?? {};
  const econ = { years: e.years ?? 20, discountRatePercent: e.discountRatePercent ?? 8, tariffEscalationPercent: e.tariffEscalationPercent ?? 0, degradationPercent: e.degradationPercent ?? 0.5 };
  assumptions.push(
    `Money: the saving lasts ${econ.years} years, falls ${econ.degradationPercent}% a year as equipment ages, ${econ.tariffEscalationPercent === 0 ? "does not rise with the tariff" : `rises ${econ.tariffEscalationPercent}% a year with the tariff`}, and is discounted at ${econ.discountRatePercent}% a year${req.economics ? "" : " (these are assumptions, not data: change them to see how much they matter)"}.`,
  );
  if (needsBattery && econ.years > 12) assumptions.push("A battery does not last as long as panels; replacing it is not modelled, so a long life flatters a battery.");
  const run = (invest: number): Economics => economics({ investmentInr: invest, annualSavingsInr: savings, years: econ.years, discountRate: econ.discountRatePercent / 100, tariffEscalation: econ.tariffEscalationPercent / 100, degradation: econ.degradationPercent / 100 });
  const econBasis = "the yearly saving above, the investment you gave and the assumptions listed; not a guarantee.";
  const econMeasured = (v: Economics | null, why: string): Measured<Economics> => (v ? estimated(v, { ...src, basis: econBasis }) : unavailable<Economics>(why, src));
  const economicsM = econMeasured(lacks.length === 0 ? run(total) : null, investment.provenance.notes[0] ?? "No investment figure.");

  // a published subsidy on added solar, only for a new installation
  let subsidy: Measured<number>;
  if (!needsSolar) subsidy = unavailable("No solar is added.", { ...src, unit: "INR" });
  else if (solarRows.length > 0) subsidy = unavailable("A subsidy is not estimated for an addition to an existing system: the published scheme is written for new installations.", { ...src, unit: "INR" });
  else {
    const r = await evaluateEligibility(db, { consumerType: baseTariff.consumerType, systemKwp: req.addSolarKwp as number }, at);
    const p = r.programs.find((x) => x.program === "PM_SURYA_GHAR");
    subsidy = p ? p.subsidy : unavailable("No sourced subsidy rule applies.", { ...src, unit: "INR" });
    if (p && p.caveats.length > 0) assumptions.push(`Subsidy: ${p.caveats[0]}`);
  }
  const subsidised = subsidy.value !== null && lacks.length === 0 ? econMeasured(run(Math.max(0, total - subsidy.value)), "") : null;

  const carbon: Measured<{ avoidedKgPerYear: number }> =
    req.gridCarbonKgPerKwh === undefined
      ? unavailable("No grid emission factor is built in: a sourced figure for your region has not been loaded. Enter your utility's or a published factor to see the carbon change.", src)
      : estimated({ avoidedKgPerYear: round((base.importKwh - scenario.importKwh) * req.gridCarbonKgPerKwh, 0) }, { ...src, unit: "kg CO2", basis: `the change in energy bought from the grid times the factor you gave (${req.gridCarbonKgPerKwh} kg per kWh); exported solar is not credited with avoided emissions.` });

  const summary = (c: Config) => ({ solarKwp: round(c.solar.reduce((a, s) => a + s.capacityKwp, 0), 3), batteryKwh: c.battery ? round(c.battery.capacityKwh, 3) : 0, tariff: c.tariff === baseTariff ? baseTariff.name : scenarioTariff.name });
  const name = req.name ?? ([req.addSolarKwp ? `Add ${req.addSolarKwp} kWp solar` : null, req.addBatteryKwh ? `Add ${req.addBatteryKwh} kWh battery` : null, req.tariffPlanId ? "Change tariff" : null].filter(Boolean).join(" and ") || "Scenario");

  const dto: ScenarioDto = {
    id: "00000000-0000-0000-0000-000000000000",
    propertyId,
    createdAt: at.toISOString(),
    name,
    request: req,
    equipment: { base: summary(baseCfg), scenario: summary(scenCfg) },
    base: base as AnnualResult,
    scenario: scenario as AnnualResult,
    comparison,
    investment,
    subsidy,
    economics: economicsM,
    economicsIfSubsidised: subsidised,
    carbon,
    economicsAssumptions: econ,
    assumptions: [...new Set(assumptions)],
    notes: [],
  };
  const version = (await engine.health({ requestId: ctx.requestId })).version;
  const saved = await db.scenario.create({ data: { propertyId, createdAt: at, name, request: req as unknown as Prisma.InputJsonValue, result: dto as unknown as Prisma.InputJsonValue, annualSavingsInr: savings, engineVersion: version } });
  return { ...dto, id: saved.id };
}

// ------------------------------------------------------------------------------------- history

export async function listScenarios(db: Db, userId: string, propertyId: string) {
  await ownProperty(db, userId, propertyId);
  const rows = await db.scenario.findMany({ where: { propertyId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => {
    const q = r.request as unknown as ScenarioRequest;
    return { id: r.id, createdAt: r.createdAt.toISOString(), name: r.name, annualSavingsInr: r.annualSavingsInr, addSolarKwp: q.addSolarKwp ?? null, addBatteryKwh: q.addBatteryKwh ?? null, tariffChanged: q.tariffPlanId !== undefined };
  });
}

export async function getScenario(db: Db, userId: string, propertyId: string, id: string): Promise<ScenarioDto> {
  await ownProperty(db, userId, propertyId);
  const r = await db.scenario.findFirst({ where: { id, propertyId } });
  if (!r) throw new AppError("NOT_FOUND", "No such scenario.");
  return { ...(r.result as unknown as ScenarioDto), id: r.id };
}

export async function deleteScenario(db: Db, userId: string, propertyId: string, id: string): Promise<void> {
  await ownProperty(db, userId, propertyId);
  const { count } = await db.scenario.deleteMany({ where: { id, propertyId } });
  if (count === 0) throw new AppError("NOT_FOUND", "No such scenario.");
}
