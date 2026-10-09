/**
 * Energy health and energy waste (spec sections 35 and 36), read from the latest stored plan. Nothing is recomputed and nothing is
 * assumed: a plan is a simulation of a day on forecasts, so every figure here is SIMULATED, and what the data cannot support is
 * UNAVAILABLE with the reason and what would fill it in. See calc.ts for the arithmetic.
 */
import { AppError } from "../errors.js";
import type { ForecastDeps } from "../forecast/service.js";
import { HOUR_MS } from "../plan/horizon.js";
import type { PlanDto } from "../plan/schemas.js";
import { getProperty } from "../properties/service.js";
import { estimated, simulated, unavailable } from "../provenance/index.js";
import { resilienceOnStoredSun } from "../resilience/service.js";
import type { ScenarioDto } from "../scenarios/schemas.js";
import { healthMetrics, wasteFindings } from "./calc.js";
import type { HealthDto, WasteDto } from "./schemas.js";

const STALE_PLAN_MS = 24 * HOUR_MS;
const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

async function context(deps: ForecastDeps, userId: string, propertyId: string, provider: string) {
  const at = deps.now();
  const property = await getProperty(deps.db, userId, propertyId, deps.policy);
  const planRow = await deps.db.optimizationRun.findFirst({ where: { propertyId }, orderBy: { createdAt: "desc" } });
  const base = { provider, source: "AVISHKAR's latest stored plan for this property", location: { latitude: property.latitude, longitude: property.longitude }, now: at };
  const plan = planRow ? (planRow.plan as unknown as PlanDto) : null;
  const stale = planRow ? at.getTime() - planRow.createdAt.getTime() > STALE_PLAN_MS : false;
  const basedOn = planRow
    ? {
        planId: planRow.id,
        madeAt: planRow.createdAt.toISOString(),
        stale,
        note: stale ? "This plan is more than a day old: make a new one to see today." : "Read from this plan; nothing was recomputed.",
      }
    : null;
  return { at, base, planRow, plan, basedOn, stale };
}

const nextPlan = (propertyId: string, why: string) => [{ label: "Make a plan", href: `/property/${propertyId}/plan`, why }];

export async function energyHealth(deps: ForecastDeps, userId: string, propertyId: string, ctx: { requestId?: string } = {}): Promise<HealthDto> {
  const { at, base, plan, basedOn, stale } = await context(deps, userId, propertyId, "avishkar-insight");
  const out: HealthDto = {
    label: "ENERGY HEALTH",
    propertyId,
    madeAt: at.toISOString(),
    basedOn,
    metrics: [],
    noOverallScore:
      "These are not added into one number. Doing so would need a weight for each, and any weights would be my judgement, not a measurement. Each metric is a ratio that means what its formula says.",
    next: [],
  };
  if (!plan || !plan.result.value) {
    out.next = nextPlan(propertyId, "The health metrics are worked out from the latest plan's hour-by-hour flows; there is none yet.");
    return out;
  }
  const notes = [`A simulated day: the plan made ${basedOn!.madeAt}. It is not a measurement of what the property did.`, ...(stale ? ["The plan is more than a day old."] : [])];
  const calc = healthMetrics(plan);
  const metric = (c: (typeof calc)[number]) => ({
    key: c.key,
    label: c.label,
    direction: c.direction,
    formula: c.formula,
    detail: c.detail,
    result:
      c.value === null
        ? unavailable<number>(c.detail, { ...base, dataType: `health_${c.key}`, unit: "%" })
        : simulated(c.value, { ...base, dataType: `health_${c.key}`, unit: "%", notes }),
  });
  const bykey = new Map(calc.map((c) => [c.key, c]));
  const order = ["efficiency", "solarUtilisation", "peakManagement", "storageUtilisation"] as const;
  for (const k of order) out.metrics.push(metric(bykey.get(k)!));

  // resilience is hours, not a ratio, and comes from the battery and the stored sun forecast
  const solarRun = await deps.db.forecastRun.findFirst({ where: { propertyId, kind: "SOLAR" }, orderBy: { issuedAt: "desc" } });
  const res = {
    key: "resilience" as const,
    label: "Resilience",
    direction: "HIGHER_IS_BETTER" as const,
    formula: "Hours the critical load could be carried if the grid failed at the start of the next hour: the battery, plus the forecast sun",
    detail: "",
    result: unavailable<number>("not worked out", { ...base, dataType: "health_resilience", unit: "h" }),
  };
  try {
    const series = solarRun ? (solarRun.series as unknown as { times: string[]; p50Kw: number[] }) : null;
    const rep = await resilienceOnStoredSun(deps, userId, propertyId, series ? series.times.map((time, i) => ({ time, value: series.p50Kw[i]! })) : null, ctx);
    const v = rep.resilience.value;
    if (v) {
      res.result = { value: v.backupHours.withForecastSun, unit: "h", provenance: rep.resilience.provenance };
      res.detail = `${round(v.backupHours.withForecastSun, 1)} hours${v.backupHours.atLeast ? " at least (it lasted the whole horizon)" : ""}${v.battery?.startSocBasis === "ASSUMPTION" ? "; the battery's charge is assumed" : ""}.`;
    } else {
      res.detail = rep.resilience.provenance.notes[0] ?? "No backup figure could be worked out.";
      res.result = unavailable<number>(res.detail, { ...base, dataType: "health_resilience", unit: "h" });
    }
  } catch (e) {
    res.detail = e instanceof AppError ? e.message : "Backup could not be worked out.";
    res.result = unavailable<number>(res.detail, { ...base, dataType: "health_resilience", unit: "h" });
    if (e instanceof AppError && e.code === "PLAN_INPUTS_MISSING") out.next.push({ label: "Mark critical appliances", href: `/property/${propertyId}/assets`, why: "Resilience is how long what must stay on would last; none is marked CRITICAL." });
  }
  out.metrics.push(res);

  for (const k of ["gridDependence", "flexibility"] as const) out.metrics.push(metric(bykey.get(k)!));
  return out;
}

export async function energyWaste(deps: ForecastDeps, userId: string, propertyId: string): Promise<WasteDto> {
  const { at, base, planRow, plan, basedOn } = await context(deps, userId, propertyId, "avishkar-insight");
  const out: WasteDto = {
    label: "ENERGY WASTE",
    propertyId,
    madeAt: at.toISOString(),
    basedOn,
    findings: [],
    avoidable: {
      perDay: unavailable<number>("No plan has been made yet.", { ...base, dataType: "avoidable_cost_day", unit: "INR" }),
      averageMonth: unavailable<number>("No plan has been made yet.", { ...base, dataType: "avoidable_cost_month", unit: "INR" }),
    },
    note: "A plan is a simulation of a day on forecasts: these are what that day shows, not what was measured. A figure is given only where the data supports one.",
    next: [],
  };
  if (!plan || !plan.result.value || !planRow) {
    out.next = nextPlan(propertyId, "Waste is read from the latest plan's hour-by-hour flows; there is none yet.");
    return out;
  }
  const notes = [`From the plan made ${basedOn!.madeAt}: a simulated day, not a measurement.`];
  for (const f of wasteFindings(plan)) {
    out.findings.push({
      key: f.key,
      label: f.label,
      state: f.state,
      explanation: f.explanation,
      how: f.how,
      amount:
        f.state === "UNAVAILABLE"
          ? unavailable<{ kwh: number | null; valueInr: number | null }>(f.explanation, { ...base, dataType: `waste_${f.key}`, unit: "INR" })
          : simulated({ kwh: f.kwh === null ? null : round(f.kwh, 2), valueInr: f.valueInr === null ? null : round(f.valueInr, 2) }, { ...base, dataType: `waste_${f.key}`, unit: "INR", notes }),
    });
  }

  // the avoidable cost: the plan against the same day with no control, and a month's worth only where a year has been worked out
  const day = plan.result.value.savingsInr;
  out.avoidable.perDay = simulated(round(day, 2), {
    ...base,
    dataType: "avoidable_cost_day",
    unit: "INR",
    notes: [`The latest plan's saving over the same day with no battery control, appliance shifting or car scheduling. A forecast outcome, not a measurement.`],
  });
  const scenario = await deps.db.scenario.findFirst({ where: { propertyId }, orderBy: { createdAt: "desc" } });
  if (scenario) {
    const year = scenario.result as unknown as ScenarioDto;
    const avoidable = year.base.uncontrolledCostInr - year.base.netCostInr;
    out.avoidable.averageMonth = estimated(round(Math.max(avoidable, 0) / 12, 2), {
      ...base,
      source: `AVISHKAR's what-if run "${scenario.name}" of ${scenario.createdAt.toISOString().slice(0, 10)}`,
      dataType: "avoidable_cost_month",
      unit: "INR",
      basis: "a typical year of today's equipment planned hour by hour, against the same equipment with no control, divided by twelve",
      notes: [
        avoidable <= 0 ? "In that year control saves nothing, so the avoidable cost is zero." : "An average month, not this month: the run has 24 typical days and no weather variability.",
        "If the equipment or the tariff has changed since that run, run it again.",
      ],
    });
  } else {
    out.avoidable.averageMonth = unavailable<number>("No what-if run has worked out a year for this property, and a month's figure needs one.", { ...base, dataType: "avoidable_cost_month", unit: "INR" });
    out.next.push({ label: "Run a what-if", href: `/property/${propertyId}/what-if`, why: "A year worked out hour by hour gives the average month's avoidable cost." });
  }
  return out;
}
