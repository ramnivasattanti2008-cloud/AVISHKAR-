/**
 * How the plan that was chosen holds up if the day turns out differently (spec sections 17 and 18).
 *
 * The scenarios are not invented: they are the ends of the bands the forecasts measured from this place's own past errors, taken
 * from the forecast runs as they stand now and lined up with the plan's own hours. Where a band does not exist, or does not reach
 * the plan's hours, the answer is UNAVAILABLE with the reason rather than a guess.
 *
 * What this says that the futures page does not: the futures re-plan each day with the planner told what the day will be, so they
 * show how well the equipment could do. This keeps the plan's own moves and asks what they then cost.
 */
import type { ForecastDeps } from "../forecast/service.js";
import { HOUR_MS, resample } from "../plan/horizon.js";
import type { PlanDto } from "../plan/schemas.js";
import { getProperty } from "../properties/service.js";
import { simulated, unavailable } from "../provenance/index.js";
import { replay } from "./replay.js";
import type { RobustnessDto } from "./schemas.js";

const STALE_PLAN_MS = 24 * HOUR_MS;
type Value = NonNullable<RobustnessDto["result"]["value"]>;

interface Series {
  times: string[];
  p10Kw: (number | null)[];
  p50Kw: number[];
  p90Kw: (number | null)[];
}

/** One end of a stored forecast's band, lined up with the plan's hours. Null when the band does not exist or does not reach them. */
function band(series: Series | null, pick: "p10Kw" | "p50Kw" | "p90Kw", startMs: number, steps: number): number[] | null {
  if (!series) return null;
  const values = series[pick];
  if (values.some((v) => v === null || v === undefined)) return null;
  const points = series.times.map((time, i) => ({ time, value: Number(values[i]) }));
  const r = resample(points, pick === "p50Kw" || series === null ? "end" : "end", startMs, steps);
  return r.some((v) => v === null) ? null : r.map((v) => Number(v));
}

export async function robustness(deps: ForecastDeps, userId: string, propertyId: string): Promise<RobustnessDto> {
  const at = deps.now();
  const property = await getProperty(deps.db, userId, propertyId, deps.policy);
  const base = {
    provider: "avishkar-robustness",
    source: "AVISHKAR's latest stored plan, replayed against the ends of its forecasts' own bands",
    dataType: "plan_robustness",
    location: { latitude: property.latitude, longitude: property.longitude },
    now: at,
    unit: "INR",
  };
  const shell = { label: "IF THE DAY TURNS OUT DIFFERENTLY" as const, propertyId, madeAt: at.toISOString() };

  const row = await deps.db.optimizationRun.findFirst({ where: { propertyId }, orderBy: { createdAt: "desc" } });
  if (!row) {
    return { ...shell, basedOn: null, scenarios: [], result: unavailable<Value>("No plan has been made yet, and this follows the plan that was chosen.", base), next: [{ label: "Make a plan", href: `/property/${propertyId}/plan`, why: "There is no plan to put under pressure yet." }] };
  }

  const plan = row.plan as unknown as PlanDto;
  const stale = at.getTime() - row.createdAt.getTime() > STALE_PLAN_MS;
  const basedOn = { planId: row.id, madeAt: row.createdAt.toISOString(), stale, note: stale ? "This plan is more than a day old: make a new one before leaning on this." : "The plan as it stands; nothing was recomputed." };
  const startMs = Date.parse(plan.horizon.start);
  const steps = plan.schedule.times.length;

  const [solarRun, loadRun] = await Promise.all([
    deps.db.forecastRun.findFirst({ where: { propertyId, kind: "SOLAR" }, orderBy: { issuedAt: "desc" } }),
    deps.db.forecastRun.findFirst({ where: { propertyId, kind: "LOAD" }, orderBy: { issuedAt: "desc" } }),
  ]);
  const solar = solarRun ? (solarRun.series as unknown as Series) : null;
  const load = loadRun ? (loadRun.series as unknown as Series) : null;

  const pvLow = band(solar, "p10Kw", startMs, steps);
  const pvHigh = band(solar, "p90Kw", startMs, steps);
  const loadHigh = band(load, "p90Kw", startMs, steps);
  const expectedPv = plan.schedule.pvForecastKw;
  const expectedLoad = plan.schedule.loadKw;

  if (!pvLow && !loadHigh) {
    const why = !solar && !load ? "No forecast is stored for this property, so there are no bands to put the plan under." : "Neither the solar nor the load forecast has a band that covers this plan's hours.";
    return { ...shell, basedOn, scenarios: [], result: unavailable<Value>(why, base), next: [{ label: "Make a forecast", href: `/property/${propertyId}/forecast`, why: "The bands come from the forecasts, and none covers this plan's hours." }] };
  }

  const expected = replay(plan, { pvKw: expectedPv, loadKw: expectedLoad });
  const cases: { key: Value["scenarios"][number]["key"]; label: string; built: string; pv: number[] | null; load: number[] | null }[] = [
    { key: "lowSun", label: "Less sun than expected", built: "The lower end of the solar forecast's own band, the level 1 hour in 10 falls below. The demand as expected.", pv: pvLow, load: null },
    { key: "highDemand", label: "More demand than expected", built: "The upper end of the load forecast's own band. The sun as expected.", pv: null, load: loadHigh },
    { key: "both", label: "Less sun and more demand together", built: "Both ends at once. Less likely than either alone, and it shows how much room the plan has.", pv: pvLow, load: loadHigh },
    { key: "moreSun", label: "More sun than expected", built: "The upper end of the solar forecast's own band. The demand as expected.", pv: pvHigh, load: null },
  ];

  const scenarios: Value["scenarios"] = [];
  for (const c of cases) {
    const needsPv = c.key !== "highDemand";
    const needsLoad = c.key === "highDemand" || c.key === "both";
    if ((needsPv && !c.pv) || (needsLoad && !c.load)) {
      scenarios.push({ key: c.key, label: c.label, built: c.built, state: "UNAVAILABLE", reason: needsPv && !c.pv ? "The solar forecast has no calibrated band for this place yet." : "The load forecast has no band that covers these hours.", result: null });
      continue;
    }
    const r = replay(plan, { pvKw: c.pv ?? expectedPv, loadKw: c.load ?? expectedLoad });
    scenarios.push({
      key: c.key,
      label: c.label,
      built: c.built,
      state: "RUN",
      reason: null,
      result: { ...r, vsExpectedInr: Math.round((r.netCostInr - expected.netCostInr) * 100) / 100 },
    });
  }

  const run = scenarios.filter((x) => x.result !== null);
  const worst = run.reduce<(typeof run)[number] | null>((a, x) => (a === null || x.result!.netCostInr > a.result!.netCostInr ? x : a), null);

  return {
    ...shell,
    basedOn,
    scenarios,
    result: simulated(
      {
        expected: { ...expected, vsExpectedInr: 0 },
        scenarios,
        worst: worst ? { key: worst.key, label: worst.label, netCostInr: worst.result!.netCostInr, vsExpectedInr: worst.result!.vsExpectedInr } : null,
        statement:
          worst === null
            ? "No end of a band could be put to the plan, so nothing is claimed about how it holds up."
            : `Of the days tried, the dearest costs INR ${Math.abs(worst.result!.vsExpectedInr).toFixed(2)} ${worst.result!.vsExpectedInr >= 0 ? "more" : "less"} than the day the plan was made for (${worst.label.toLowerCase()}).`,
        whyNothingFails:
          "No day here can defeat the plan: its battery moves are carried out whatever the weather, and the grid makes up whatever the sun does not cover. What a worse day changes is the bill, not whether the plan can be followed.",
      },
      {
        ...base,
        notes: [
          `The reference day in this section is the plan replayed by the same method as the others, so the four can be compared with each other. It reconstructs the battery's efficiency and wear from the plan's own totals, so it lands near the plan's bill of INR ${(plan.result.value?.netCostInr ?? 0).toFixed(2)} rather than exactly on it; the differences below are measured against this replay, not against that bill.`,
          `The plan made ${row.createdAt.toISOString()}, replayed hour by hour against each day. A simulated outcome, not a measurement.`,
          "The ends of a band are where 1 hour in 10 falls beyond, measured from this place's own past forecast errors. A whole day at one end is rarer than an hour, and no probability is attached to any of these.",
          "The plan's own battery moves and appliance starts are kept; only the sun and the demand change. Where the battery cannot do what the plan asks, the grid makes up the difference.",
        ],
      },
    ),
    next: stale ? [{ label: "Make a new plan", href: `/property/${propertyId}/plan`, why: "The latest plan is more than a day old." }] : [],
  };
}
