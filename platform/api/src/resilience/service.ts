/**
 * Resilience and autonomy (spec sections 26 and 34). Resilience is "if the grid failed now, how long would the critical load
 * last?", answered by hour-by-hour arithmetic on the battery and the forecast sun. It predicts no outage: there is no outage data.
 * Autonomy is the share of the plan's energy that did not come from the grid, shown with how it is worked out.
 */
import { appliancePlan, aggregateBatteries } from "../plan/service.js";
import { HOUR_MS, planStart, resample } from "../plan/horizon.js";
import type { PlanDto } from "../plan/schemas.js";
import { AppError } from "../errors.js";
import { type ForecastDeps, solarForecast } from "../forecast/service.js";
import { getProperty } from "../properties/service.js";
import { simulated, unavailable } from "../provenance/index.js";
import type { ResilienceDto, ResilienceRequest } from "./schemas.js";
import { type BatterySpec, hoursWithoutSun, reserveFor, surviveOutage } from "./simulate.js";

const HORIZON = 48;
const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

/**
 * `opts.pv` lets a caller that already holds the sun (the Today view reads it from the stored forecast) skip the forecast call; the
 * 48 values are kW for each local hour from the next whole hour. `solarNote` is then said as a note.
 */
export async function resilienceReport(
  deps: ForecastDeps,
  userId: string,
  propertyId: string,
  req: ResilienceRequest,
  ctx: { requestId?: string } = {},
  opts: { pv?: number[]; solarNote?: string | null } = {},
): Promise<ResilienceDto> {
  const { db } = deps;
  const at = deps.now();
  const property = await getProperty(db, userId, propertyId, deps.policy);
  const startMs = planStart(at);
  const where = { latitude: property.latitude, longitude: property.longitude };
  const [batteryRows, applianceRows] = await Promise.all([db.battery.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } }), db.appliance.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } })]);

  const criticals = applianceRows.filter((a) => a.priority === "CRITICAL");
  if (criticals.length === 0) {
    throw new AppError("PLAN_INPUTS_MISSING", "Resilience needs to know what must stay on: no appliance of this property is marked CRITICAL.", {
      missing: [{ what: "critical", why: "Mark the appliances that must stay on in an outage (a refrigerator, a medical device, lights) as CRITICAL on the Assets tab." }],
    });
  }
  const criticalKw = appliancePlan(applianceRows, startMs, 24).criticalKw;
  const battery = aggregateBatteries(batteryRows, at, req.startSocPercent);
  const notes: string[] = [];
  const assumptions: string[] = [
    "No outage is predicted. There is no outage or grid-reliability data source, so the question answered is 'if the grid failed at the start of the next hour, how long?', not 'will it?'.",
    "The critical load is the rated power of each CRITICAL appliance, all running together all the time: a cautious figure, because most appliances draw less than their rating.",
    "The battery's inverter is assumed able to supply the home with the grid down. A grid-tied solar system without one shuts down in an outage, whatever its size.",
    "The sun is the solar forecast's central estimate, and none in hours it does not reach.",
    ...(battery?.notes ?? []),
  ];

  // the sun for the next 48 hours: given, or forecast if there is a system and an engine to do it
  let pv = new Array<number>(HORIZON).fill(0);
  if (opts.pv) {
    pv = opts.pv.slice(0, HORIZON);
    while (pv.length < HORIZON) pv.push(0);
    if (opts.solarNote) notes.push(opts.solarNote);
  } else {
    try {
      const solar = await solarForecast(deps, userId, propertyId, { days: 3, requestId: ctx.requestId });
      if (solar.hours.value) pv = resample(solar.hours.value.map((h) => ({ time: h.time, value: h.p50Kw })), "end", startMs, HORIZON).map((v) => round(v ?? 0, 4));
      else notes.push(`No sun is counted: ${solar.hours.provenance.notes[0] ?? "no solar forecast is available"}`);
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== "ENGINE_UNAVAILABLE") throw e;
      notes.push("No sun is counted: the solar forecast needs the planning engine, which is not available. The figures are the battery alone.");
    }
  }

  const src = { provider: "avishkar-resilience", source: "AVISHKAR hour-by-hour arithmetic on the battery, the critical load and the forecast sun", dataType: "resilience", location: where, now: at };

  let resilience: ResilienceDto["resilience"];
  let withSun: number | null = null;
  if (!battery) {
    notes.push("There is no battery, so there is no backup: with the grid down the critical load is not served.");
    resilience = simulated(
      {
        criticalKw: round(criticalKw, 3),
        criticalLoads: criticals.map((a) => ({ name: a.name, quantity: a.quantity, ratedPowerW: a.ratedPowerW, kw: round((a.ratedPowerW * a.quantity) / 1000, 3) })),
        battery: null,
        backupHours: { withForecastSun: 0, atLeast: false, withoutSun: 0 },
        score: 0,
        scoreMethod: SCORE_METHOD,
        recommendedReserve: null,
      },
      src,
    );
  } else {
    const spec: BatterySpec = {
      minSocKwh: battery.input.minSocKwh,
      maxSocKwh: battery.input.maxSocKwh,
      maxChargeKw: battery.input.maxChargeKw,
      maxDischargeKw: battery.input.maxDischargeKw,
      chargeEfficiency: battery.input.chargeEfficiency,
      dischargeEfficiency: battery.input.dischargeEfficiency,
    };
    const run = surviveOutage({ pvKw: pv, criticalKw, battery: spec, startSocKwh: battery.input.initialSocKwh });
    withSun = run.hoursCovered;
    const dark = hoursWithoutSun(criticalKw, spec, battery.input.initialSocKwh, HORIZON);
    const res = reserveFor(criticalKw, req.targetHours, spec);
    const current = battery.input.reserveSocKwh ?? spec.minSocKwh;
    if (!res.feasible) notes.push(`This battery cannot hold ${req.targetHours} hours of the critical load: the full battery lasts about ${round(res.longestPossibleHours, 1)} hours with no sun.`);
    resilience = simulated(
      {
        criticalKw: round(criticalKw, 3),
        criticalLoads: criticals.map((a) => ({ name: a.name, quantity: a.quantity, ratedPowerW: a.ratedPowerW, kw: round((a.ratedPowerW * a.quantity) / 1000, 3) })),
        battery: { usableKwh: battery.usableKwh, startSocKwh: round(battery.input.initialSocKwh, 2), startSocBasis: battery.startBasis, reserveKwh: battery.input.reserveSocKwh ?? null },
        backupHours: { withForecastSun: round(run.hoursCovered, 1), atLeast: run.survivesHorizon, withoutSun: round(Math.min(dark, HORIZON), 1) },
        score: Math.round((100 * Math.min(run.hoursCovered, 24)) / 24),
        scoreMethod: SCORE_METHOD,
        recommendedReserve: {
          targetHours: req.targetHours,
          reserveKwh: round(res.reserveKwh, 2),
          reservePercentOfCapacity: round((res.reserveKwh / battery.capacityKwh) * 100, 0),
          currentReserveKwh: round(current, 2),
          gapKwh: round(res.reserveKwh - current, 2),
          feasible: res.feasible,
          longestPossibleHours: round(res.longestPossibleHours, 1),
        },
      },
      { ...src, notes: ["A calculation on forecast sun and the battery's charge as entered or assumed, not a measurement of any outage."] },
    );
  }

  return {
    label: "RESILIENCE AND AUTONOMY",
    request: { targetHours: req.targetHours, startSocPercent: req.startSocPercent ?? null },
    madeAt: at.toISOString(),
    outageRisk: { status: "UNAVAILABLE", reason: "Grid outage risk is unavailable: no outage or grid-reliability data source exists, and none is invented. The figures use the weather and the battery only." },
    resilience,
    autonomy: await autonomy(deps, propertyId, withSun, src),
    assumptions: [...new Set(assumptions)],
    notes,
  };
}

const SCORE_METHOD = "Score = 100 x the hours the critical load is served if the grid fails at the start of the next hour, with the forecast sun and the battery as they are, counted up to 24, divided by 24. 24 hours or more is 100; no battery is 0.";

const AUTONOMY_METHOD = "Autonomy = 100 x (1 - energy bought from the grid / energy used), over the hours of your latest plan. Energy bought to charge the battery counts as bought, so cycling cheap grid energy does not raise the score.";

type Src = { provider: string; source: string; dataType: string; location: { latitude: number; longitude: number }; now: Date };

async function autonomy(deps: ForecastDeps, propertyId: string, coverageHours: number | null, src: Src): Promise<ResilienceDto["autonomy"]> {
  const row = await deps.db.optimizationRun.findFirst({ where: { propertyId }, orderBy: { createdAt: "desc" } });
  if (!row) return unavailable("No plan has been made yet, and autonomy is read from a plan. Make one on the Plan tab.", { ...src, dataType: "autonomy" });
  return autonomyOf(row, coverageHours, src);
}

/**
 * The backup report read from a stored solar forecast, so it needs no engine call: what the Today view and the health metrics both
 * show. `points` are the stored forecast's hours (null when none is stored, and then only the battery is counted).
 */
export async function resilienceOnStoredSun(
  deps: ForecastDeps,
  userId: string,
  propertyId: string,
  points: { time: string; value: number }[] | null,
  ctx: { requestId?: string } = {},
): Promise<ResilienceDto> {
  const at = deps.now();
  const pv = points ? resample(points, "end", Math.ceil((at.getTime() + 330 * 60_000) / HOUR_MS) * HOUR_MS - 330 * 60_000, 48).map((v) => v ?? 0) : new Array<number>(48).fill(0);
  return resilienceReport(deps, userId, propertyId, { targetHours: 4, startSocPercent: null }, ctx, { pv, solarNote: points ? null : "No solar forecast is stored, so only the battery is counted." });
}

/** Autonomy from one stored plan: the share of its energy use that was not bought from the grid, with its parts. */
export function autonomyOf(row: { id: string; createdAt: Date; plan: unknown }, coverageHours: number | null, src: Src): ResilienceDto["autonomy"] {
  const p = row.plan as PlanDto;
  const s = p.schedule;
  const appliance = Object.values(s.applianceKw).reduce((a, k) => a + sum(k), 0);
  const consumed = sum(s.loadKw) + sum(s.evChargeKw) + appliance;
  if (consumed <= 0) return unavailable("The latest plan uses no energy, so there is nothing to measure autonomy against.", { ...src, dataType: "autonomy" });
  const bought = sum(s.gridImportKw);
  const share = Math.min(1, Math.max(0, bought / consumed));
  return simulated(
    {
      score: Math.round(100 * (1 - share)),
      methodology: AUTONOMY_METHOD,
      parts: { consumedKwh: round(consumed, 2), solarUsedKwh: round(sum(s.pvUsedKw), 2), batteryReleasedKwh: round(sum(s.batteryDischargeKw), 2), boughtKwh: round(bought, 2), gridDependencyPercent: round(share * 100, 0) },
      criticalCoverageHours: coverageHours === null ? null : round(coverageHours, 1),
      planId: row.id,
      planMadeAt: row.createdAt.toISOString(),
    },
    { ...src, dataType: "autonomy", notes: [`Read from the plan made at ${row.createdAt.toISOString()}: an outcome expected from forecasts, not a measurement.`] },
  );
}

