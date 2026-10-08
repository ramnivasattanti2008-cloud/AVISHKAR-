/**
 * The Today view (spec sections 97 and 98): where the property stands today, what is likely next, what to do, and what that is
 * expected to be worth, every figure from something already stored or cached and labelled as what it is. It never recomputes a plan
 * or a forecast: it reads the latest ones, says how old they are, and says what to do when there is none. The one live call is the
 * weather, which is cached for ten minutes.
 */
import { AppError } from "../errors.js";
import { latestDna } from "../energy/service.js";
import type { ForecastDeps } from "../forecast/service.js";
import { HOUR_MS, local, localMidnight, resample } from "../plan/horizon.js";
import type { PlanDto } from "../plan/schemas.js";
import { getProperty } from "../properties/service.js";
import { estimated, forecast as forecastOf, simulated, unavailable } from "../provenance/index.js";
import { autonomyOf, resilienceReport } from "../resilience/service.js";
import { type Point, RISK_RULE, dayEnergy, hours24, surplus, weatherRisk } from "./calc.js";
import type { TodayDto } from "./schemas.js";

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
const STALE_PLAN_MS = 24 * HOUR_MS;

interface Series {
  times: string[];
  p50Kw: number[];
}

const points = (s: Series): Point[] => s.times.map((time, i) => ({ time, value: s.p50Kw[i]! }));

export async function today(deps: ForecastDeps, userId: string, propertyId: string, ctx: { requestId?: string } = {}): Promise<TodayDto> {
  const { db } = deps;
  const at = deps.now();
  const property = await getProperty(db, userId, propertyId, deps.policy);
  const dayStart = localMidnight(at.getTime());
  const where = { latitude: property.latitude, longitude: property.longitude };
  const base = { provider: "avishkar-today", source: "AVISHKAR's latest stored forecasts and plan for this property", location: where, now: at };
  const next: TodayDto["next"] = [];
  // listed in the order things depend on each other: a tariff and readings before a plan, equipment before a forecast
  const RANK = ["/tariff", "/meter-data", "/assets", "/forecast", "/plan"];
  const need = (label: string, href: string, why: string) => {
    if (!next.some((n) => n.label === label)) next.push({ label, href: `/property/${propertyId}${href}`, why });
    next.sort((a, b) => RANK.indexOf(a.href.slice(`/property/${propertyId}`.length)) - RANK.indexOf(b.href.slice(`/property/${propertyId}`.length)));
  };

  // ---- what the property has, so that what to do next is something that can be done
  const [solarCount, tariffId] = await Promise.all([
    db.solarSystem.count({ where: { propertyId } }),
    db.property.findUniqueOrThrow({ where: { id: propertyId }, select: { tariffPlanId: true } }).then((r) => r.tariffPlanId),
  ]);

  // ---- the stored forecasts (the latest of each kind), and the plan
  const [solarRun, loadRun, planRow] = await Promise.all([
    db.forecastRun.findFirst({ where: { propertyId, kind: "SOLAR" }, orderBy: { issuedAt: "desc" } }),
    db.forecastRun.findFirst({ where: { propertyId, kind: "LOAD" }, orderBy: { issuedAt: "desc" } }),
    db.optimizationRun.findFirst({ where: { propertyId }, orderBy: { createdAt: "desc" } }),
  ]);
  const solarPts = solarRun ? points(solarRun.series as unknown as Series) : [];
  const loadPts = loadRun ? points(loadRun.series as unknown as Series) : [];

  // ---- generation
  let generation: TodayDto["generation"];
  const gen = solarRun ? dayEnergy(solarPts, "end", dayStart) : null;
  if (solarRun && gen && gen.hoursCovered > 0) {
    generation = forecastOf(
      { kwh: round(gen.kwh, 1), hoursCovered: round(gen.hoursCovered, 1), forecastIssuedAt: solarRun.issuedAt.toISOString() },
      { ...base, dataType: "solar_energy_today", unit: "kWh", validFor: new Date(dayStart), notes: [`From the solar forecast issued ${solarRun.issuedAt.toISOString()}, central estimate${gen.hoursCovered < 23.5 ? `; it covers ${round(gen.hoursCovered, 1)} of today's 24 hours` : ""}.`] },
    );
  } else {
    generation = unavailable(solarRun ? "The latest stored solar forecast does not reach today." : "No solar forecast has been made for this property yet.", { ...base, dataType: "solar_energy_today", unit: "kWh" });
    if (solarCount === 0) need("Add your solar system", "/assets", "Generation is forecast for a solar system, and none is entered for this property.");
    else need("Make a solar forecast", "/forecast", "Today's generation is read from the latest solar forecast; this property has none that covers today.");
  }

  // ---- consumption: the load forecast if there is one, else the property's own typical day
  let consumption: TodayDto["consumption"];
  let loadHours: (number | null)[] | null = null;
  const lo = loadRun ? dayEnergy(loadPts, "start", dayStart) : null;
  if (loadRun && lo && lo.hoursCovered > 0) {
    consumption = forecastOf(
      { kwh: round(lo.kwh, 1), hoursCovered: round(lo.hoursCovered, 1), basis: "FORECAST" as const },
      { ...base, dataType: "load_energy_today", unit: "kWh", validFor: new Date(dayStart), notes: [`From the load forecast issued ${loadRun.issuedAt.toISOString()}, central estimate.`] },
    );
    loadHours = hours24(loadPts, "start", dayStart);
  } else {
    const dna = await latestDna(db, propertyId);
    if (dna) {
      const p = dna.patterns as { hourly: number[]; weekdayHourly: number[] | null; weekendHourly: number[] | null };
      const weekend = local(dayStart + 12 * HOUR_MS).weekday >= 5;
      const hourly = (weekend ? p.weekendHourly : p.weekdayHourly) ?? p.hourly;
      loadHours = hourly.map((v) => v);
      consumption = estimated(
        { kwh: round(hourly.reduce((a, b) => a + b, 0), 1), hoursCovered: 24, basis: "TYPICAL_DAY" as const },
        { ...base, dataType: "load_energy_today", unit: "kWh", basis: `your typical ${weekend ? "weekend" : "weekday"} from your Energy DNA (${dna.completeDays} complete days): a pattern, not a forecast` },
      );
    } else {
      consumption = unavailable("No meter readings have been imported, so there is no pattern of use to read.", { ...base, dataType: "load_energy_today", unit: "kWh" });
      need("Import meter readings", "/meter-data", "Consumption is read from your own meter data; none has been imported.");
    }
  }

  // ---- surplus
  let surplusM: TodayDto["surplus"];
  const pvHours = solarRun ? hours24(solarPts, "end", dayStart) : null;
  if (pvHours && loadHours) {
    const s = surplus(pvHours, loadHours);
    surplusM = forecastOf({ kwh: round(s.kwh, 1), note: `Over the ${s.hours} hours of today for which both the solar forecast and the use are known.` }, { ...base, dataType: "solar_surplus_today", unit: "kWh", validFor: new Date(dayStart), notes: ["Solar beyond use, hour by hour: what is free to store, sell or shift a load into."] });
  } else {
    surplusM = unavailable("Needs both a solar forecast and a pattern of use for today.", { ...base, dataType: "solar_surplus_today", unit: "kWh" });
  }

  // ---- weather risk: the one live call (cached ten minutes)
  let weather: TodayDto["weatherRisk"];
  try {
    const w = await deps.providers.weather.forecast(property.latitude, property.longitude, { days: 2 }, { requestId: ctx.requestId, now: deps.now });
    const risk = weatherRisk(w.hourly.cloud_cover?.value ?? [], w.hourly.precipitation?.value ?? [], w.hourly.global_horizontal_irradiance?.value ?? [], at.getTime());
    weather = risk
      ? forecastOf({ ...risk, rule: RISK_RULE }, { ...base, provider: "open-meteo", source: "Open-Meteo hourly forecast, read by a stated rule", dataType: "weather_risk", validFor: at, notes: w.stale ? ["The provider did not answer; this is an older copy."] : [] })
      : unavailable("The weather forecast has no daylight hours ahead to judge.", { ...base, dataType: "weather_risk" });
  } catch (e) {
    weather = unavailable(`The weather could not be read: ${e instanceof AppError ? e.message : "error"}.`, { ...base, dataType: "weather_risk" });
  }

  // ---- the plan, autonomy and the recommendation
  let plan: TodayDto["plan"];
  let recommendation: TodayDto["recommendation"] = null;
  let achieved: TodayDto["achieved"]["expectedSavingsInr"] = null;
  if (planRow) {
    const p = planRow.plan as unknown as PlanDto;
    const r = p.result.value;
    const a = autonomyOf(planRow, null, { ...base, dataType: "autonomy" });
    const stale = at.getTime() - planRow.createdAt.getTime() > STALE_PLAN_MS;
    plan = r
      ? simulated(
          { planId: planRow.id, madeAt: planRow.createdAt.toISOString(), stale, savingsInr: r.savingsInr, baselineNetCostInr: r.baselineNetCostInr, netCostInr: r.netCostInr, importKwh: r.importKwh, autonomyScore: a.value?.score ?? null },
          { ...base, dataType: "plan_summary", unit: "INR", notes: [stale ? "This plan is more than a day old: make a new one for today." : "An outcome expected from forecasts, not a measurement."] },
        )
      : unavailable("The latest plan has no result.", { ...base, dataType: "plan_summary" });
    recommendation = p.recommendation ?? null;
    achieved = r?.savingsInr ?? null;
    if (stale) need("Make a new plan", "/plan", "The latest plan is more than a day old.");
  } else {
    plan = unavailable("No plan has been made yet.", { ...base, dataType: "plan_summary" });
    if (!tariffId) need("Choose a tariff", "/tariff", "A plan optimises against the prices you pay, and AVISHKAR does not assume a tariff for you.");
    need("Make a plan", "/plan", "A plan gives the recommendation, what it is expected to save and the autonomy score.");
  }

  // ---- resilience, from the stored solar forecast so it needs no engine call
  let resilience: TodayDto["resilience"];
  try {
    const pv = solarRun ? resample(solarPts, "end", Math.ceil((at.getTime() + 330 * 60_000) / HOUR_MS) * HOUR_MS - 330 * 60_000, 48).map((v) => v ?? 0) : new Array<number>(48).fill(0);
    const rep = await resilienceReport(deps, userId, propertyId, { targetHours: 4, startSocPercent: null }, ctx, { pv, solarNote: solarRun ? null : "No solar forecast is stored, so only the battery is counted." });
    const v = rep.resilience.value;
    resilience = v ? { value: { hours: v.backupHours.withForecastSun, atLeast: v.backupHours.atLeast, score: v.score }, unit: "h", provenance: rep.resilience.provenance } : unavailable("No resilience figure could be made.", { ...base, dataType: "resilience" });
  } catch (e) {
    const why = e instanceof AppError ? e.message : "error";
    resilience = unavailable(why, { ...base, dataType: "resilience" });
    if (e instanceof AppError && e.code === "PLAN_INPUTS_MISSING") need("Mark critical appliances", "/assets", "Resilience is how long what must stay on would last; none is marked CRITICAL.");
  }

  return {
    label: "TODAY",
    propertyId,
    madeAt: at.toISOString(),
    localDate: local(at.getTime()).date,
    generation,
    consumption,
    surplus: surplusM,
    weatherRisk: weather,
    resilience,
    plan,
    recommendation,
    achieved: {
      expectedSavingsInr: achieved,
      basis: achieved === null ? "No plan yet." : "What the latest plan is expected to save against the same hours with no control. A forecast, not a measurement: AVISHKAR has no device feed to measure what actually happened.",
      carbon: { status: "UNAVAILABLE", reason: "No emission-factor table has been read from a source, so no carbon figure is stated." },
    },
    next,
  };
}
