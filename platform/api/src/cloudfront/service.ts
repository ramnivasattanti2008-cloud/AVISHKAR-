/**
 * The cloud-front scenario (spec section 75): the same day planned twice, once on the forecast sky and once on a sky with a front
 * crossing it, so the difference is the planner's own and not a number written into a page. The "without AVISHKAR" figures are the
 * planner's no-control baseline on the sky with the front; the "with" figures are its plan made knowing the front is coming.
 */
import type { ForecastDeps } from "../forecast/service.js";
import { requireEngine } from "../engine/index.js";
import type { OptimiseResponse } from "../engine/schemas.js";
import { AppError } from "../errors.js";
import { HOUR_MS, istIso, planStart, resample } from "../plan/horizon.js";
import { buildPlanInputs, costsShown } from "../plan/service.js";
import { simulated } from "../provenance/index.js";
import type { CloudFrontDto, CloudFrontRequest } from "./schemas.js";
import { EVENING, advise, eveningDemand, frontScale, stepsThroughFront } from "./front.js";

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
const iso = (ms: number): string => new Date(ms).toISOString();

function usable(out: OptimiseResponse, what: string): NonNullable<OptimiseResponse["schedule"]> & { totals: NonNullable<OptimiseResponse["totals"]>; baseline: NonNullable<OptimiseResponse["baseline"]> } {
  if (out.solver.status !== "optimal" || !out.schedule || !out.totals || !out.baseline) {
    throw new AppError("PLAN_INVALID", `The planner found no usable plan for ${what} (${out.solver.status}): ${out.solver.message}`, { solver: out.solver });
  }
  if (!out.validation.valid) {
    throw new AppError("PLAN_INVALID", `SIMULATION INVALID: the plan for ${what} failed the planner's independent check, so nothing is shown.`, { problems: out.validation.problems.slice(0, 10) });
  }
  return { ...out.schedule, totals: out.totals, baseline: out.baseline };
}

export async function runCloudFront(deps: ForecastDeps, userId: string, propertyId: string, req: CloudFrontRequest, ctx: { requestId?: string } = {}): Promise<CloudFrontDto> {
  const engine = requireEngine(deps.engine);
  const inp = await buildPlanInputs(deps, userId, propertyId, { mode: req.mode, hours: 24, startSocPercent: req.startSocPercent }, ctx);
  const { at, startMs, steps, pv, battery, request } = inp;
  const nowMs = at.getTime();
  if (!pv.some((v) => v > 0)) {
    throw new AppError("PLAN_INPUTS_MISSING", "A cloud front needs sun to take away: this property has no solar system, or its forecast shows no sun in the next 24 hours.", {
      missing: [{ what: "solar", why: "Add a solar system on the Assets tab: a front only matters when there is sun for it to cover." }],
    });
  }

  const shape = { arrivalMinutes: req.arrivalMinutes, reductionPercent: req.reductionPercent, durationHours: req.durationHours };
  const scale = frontScale(nowMs, startMs, steps, shape);
  const pvFront = pv.map((v, i) => round(v * scale[i]!, 4));
  const [clear, front] = await Promise.all([
    engine.optimise(request, { requestId: ctx.requestId }),
    engine.optimise({ ...request, pvKw: pvFront }, { requestId: ctx.requestId }),
  ]);
  const unaware = usable(clear, "the forecast sky");
  const informed = usable(front, "the sky with the front");

  const window = stepsThroughFront(nowMs, startMs, steps, shape);
  const advice = advise(battery !== null, window, { chargeKw: informed.batteryChargeKw, dischargeKw: informed.batteryDischargeKw }, { chargeKw: unaware.batteryChargeKw, dischargeKw: unaware.batteryDischargeKw });

  const withFront = costsShown(informed.totals.netCostInr, informed.baseline.netCostInr);
  // shown to the 0.01 kWh, and the difference is the difference of what is shown
  const importWithout = round(informed.baseline.importKwh, 2);
  const importWith = round(informed.totals.importKwh, 2);
  const onClear = costsShown(unaware.totals.netCostInr, unaware.baseline.netCostInr);
  const pvTotal = pv.reduce((a, b) => a + b, 0);
  const lost = pvTotal - pvFront.reduce((a, b) => a + b, 0);

  // the sun now: the forecast's output for the hour that contains this moment
  const nowHour = planStart(at) > nowMs ? planStart(at) - HOUR_MS : planStart(at);
  const solarNow = inp.solar.hours.value ? resample(inp.solar.hours.value.map((h) => ({ time: h.time, value: h.p50Kw })), "end", nowHour, 1)[0] ?? null : null;
  const evening = eveningDemand(inp.load.kw, startMs);
  const version = (await engine.health({ requestId: ctx.requestId })).version;

  const arrives = nowMs + req.arrivalMinutes * 60_000;
  const ends = arrives + req.durationHours * HOUR_MS;
  const assumptions = [
    ...inp.assumptions,
    "The front is a scenario you set, not an observation: AVISHKAR has no cloud-nowcast source (a satellite that returns every few days cannot see a front minutes away). Its arrival, size and length are yours; the defaults are an example.",
    "A front covers a step for the part of the hour it is overhead, and takes the stated share of the forecast sun for that part; the planner works in whole local hours.",
    `"Evening" is ${EVENING.fromHour}:00 to ${EVENING.toHour}:00 local. Demand is HIGH when the evening's mean power is at least ${EVENING.highRatio} times the mean of the whole 24 hours, LOW below ${EVENING.lowRatio}, NORMAL between: a rule of this page, not a standard.`,
    "The 'before and during the front' window is the plan's hours up to the end of the front; the advice is the difference between the plan that knows about the front and the plan that does not.",
  ];

  return {
    label: "CLOUD FRONT SCENARIO",
    request: { ...shape, mode: req.mode },
    madeAt: at.toISOString(),
    horizon: { start: iso(startMs), stepHours: 1, steps },
    hourly: {
      times: Array.from({ length: steps }, (_, i) => iso(startMs + i * HOUR_MS)),
      solarKw: pv,
      solarWithFrontKw: pvFront,
      loadKw: inp.load.kw,
      batteryChargeKw: informed.batteryChargeKw,
      batteryChargeUnawareKw: unaware.batteryChargeKw,
      batterySocKwh: informed.batterySocKwh,
      gridImportKw: informed.gridImportKw,
      gridImportUnawareKw: unaware.gridImportKw,
    },
    result: simulated(
      {
        solarNowKw: solarNow === null ? null : round(solarNow, 2),
        frontArrivesAt: istIso(arrives),
        frontEndsAt: istIso(ends),
        reductionPercent: req.reductionPercent,
        solarLostKwh: round(lost, 2),
        solarLostPercentOfDay: pvTotal > 0 ? round((lost / pvTotal) * 100, 1) : null,
        batteryNowPercent: battery ? round((battery.input.initialSocKwh / battery.capacityKwh) * 100, 0) : null,
        batteryNowBasis: battery ? battery.startBasis : null,
        eveningDemand: evening
          ? { level: evening.level, eveningMeanKw: round(evening.eveningMeanKw, 2), meanKw: round(evening.meanKw, 2), ratio: round(evening.ratio, 2), rule: `HIGH at ${EVENING.highRatio} times the daily mean or more, LOW below ${EVENING.lowRatio}.` }
          : null,
        advice,
        without: { importKwh: importWithout, netCostInr: withFront.baselineNetCostInr },
        with: { importKwh: importWith, netCostInr: withFront.netCostInr },
        difference: { importKwh: round(importWithout - importWith, 2), savingsInr: withFront.savingsInr },
        onForecastSky: { withoutNetCostInr: onClear.baselineNetCostInr, withNetCostInr: onClear.netCostInr },
        frontCost: {
          withoutAvishkarInr: round(withFront.baselineNetCostInr - onClear.baselineNetCostInr, 2),
          withAvishkarInr: round(withFront.netCostInr - onClear.netCostInr, 2),
        },
      },
      {
        provider: "avishkar-engine",
        source: "AVISHKAR planner (linear programme, HiGHS) run twice: on the forecast sky and on the sky with the front",
        dataType: "cloud_front_scenario",
        location: inp.where,
        now: at,
        modelVersion: `engine-${version}`,
        unit: "INR",
        notes: ["A scenario: the front is assumed, and the sun now is the forecast's value for this hour, not a measurement. The real day will differ."],
      },
    ),
    assumptions: [...new Set(assumptions)],
    notes: [...new Set([...informed.totals.unservedKwh > 0 ? ["Some load could not be served in the front scenario: see the plan's reasons."] : [], ...front.notes])],
  };
}
