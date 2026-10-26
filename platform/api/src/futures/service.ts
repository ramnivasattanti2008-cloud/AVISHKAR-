/**
 * The futures (spec section 16): the same 24 hours planned on each of several different days, so the owner can see what a cloudy day, a
 * high-demand day, a dead battery or an outage would cost and how much the plan can still do about it. See scenarios.ts for what each
 * day is built from. Nothing here is stored: it is a question, answered fresh from the same inputs a plan uses.
 */
import { requireEngine } from "../engine/index.js";
import type { OptimiseRequest } from "../engine/schemas.js";
import { AppError } from "../errors.js";
import type { ForecastDeps } from "../forecast/service.js";
import { istIso } from "../plan/horizon.js";
import { buildPlanInputs, costsShown } from "../plan/service.js";
import { usable } from "../plan/usable.js";
import { getProperty } from "../properties/service.js";
import { simulated, unavailable } from "../provenance/index.js";
import { type FutureDef, futureDefs } from "./scenarios.js";
import type { FuturesDto, FuturesRequest } from "./schemas.js";

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
type Entry = FuturesDto["futures"][number];
type Outcome = NonNullable<Entry["result"]["value"]>;

const hasOutage = (d: FutureDef): boolean => (d.patch.grid?.outages?.length ?? 0) > 0;
const same = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 1e-9);
/** A day whose sun and demand are the expected day's and that changes nothing else can only give the expected day's result. */
const sameAsExpected = (d: FutureDef, request: OptimiseRequest): boolean =>
  d.key !== "expected" && d.patch.battery === undefined && d.patch.grid === undefined && (d.patch.pvKw !== undefined || d.patch.loadKw !== undefined) && (d.patch.pvKw === undefined || same(d.patch.pvKw, request.pvKw)) && (d.patch.loadKw === undefined || same(d.patch.loadKw, request.loadKw));

export async function runFutures(deps: ForecastDeps, userId: string, propertyId: string, req: FuturesRequest, ctx: { requestId?: string } = {}): Promise<FuturesDto> {
  await getProperty(deps.db, userId, propertyId, deps.policy); // whose property it is is settled before anything about the engine
  const engine = requireEngine(deps.engine);
  const inp = await buildPlanInputs(deps, userId, propertyId, { mode: req.mode, hours: 24, startSocPercent: req.startSocPercent }, ctx);
  const { at, startMs, steps, request } = inp;
  const defs = futureDefs(
    { startMs, steps, pv: inp.pv, pvLow: inp.bands.pvLow, pvHigh: inp.bands.pvHigh, loadHigh: inp.bands.loadHigh, hasBattery: inp.battery !== null, criticalKw: inp.apps.criticalKw },
    { rainSolarPercent: req.rainSolarPercent, outage: req.outage },
  );
  const version = (await engine.health({ requestId: ctx.requestId })).version;
  const base = (dataType: string) => ({ provider: "avishkar-engine", source: "AVISHKAR planner (linear programme, HiGHS) run on this day", dataType, location: inp.where, now: at, modelVersion: `engine-${version}`, unit: "INR" });

  let expectedCost: number | null = null;
  const futures: Entry[] = [];
  for (const d of defs) {
    const entry = { key: d.key, label: d.label, basis: d.basis, built: d.built, sameAsExpected: sameAsExpected(d, request) };
    if (d.unavailable) {
      futures.push({ ...entry, state: "UNAVAILABLE", reason: d.unavailable, result: unavailable<Outcome>(d.unavailable, base(`future_${d.key}`)) });
      continue;
    }
    const body: OptimiseRequest = { ...request, ...d.patch, grid: { ...request.grid, ...d.patch.grid } };
    let outcome: Outcome;
    try {
      const run = usable(await engine.optimise(body, { requestId: ctx.requestId }), `the "${d.label}" day`);
      const shown = costsShown(run.totals.netCostInr, run.baseline.netCostInr);
      const loadKw = body.loadKw;
      const critical = body.criticalKw ?? 0;
      const shed = (body.grid?.outages ?? []).reduce((a, o) => a + loadKw.slice(o.startStep, o.endStep).reduce((x, l) => x + Math.max(l - critical, 0), 0), 0);
      if (d.key === "expected") expectedCost = shown.netCostInr;
      outcome = {
        netCostInr: shown.netCostInr,
        noControlCostInr: shown.baselineNetCostInr,
        savingsInr: shown.savingsInr,
        importKwh: round(run.totals.importKwh),
        exportKwh: round(run.totals.exportKwh),
        solarKwh: round(run.totals.pvKwh),
        loadKwh: round(run.totals.loadKwh),
        unservedKwh: round(run.totals.unservedKwh),
        unservedNoControlKwh: round(run.baseline.unservedKwh),
        batteryCycles: round(run.totals.batteryCycles),
        autonomyPercent: run.totals.selfSufficiencyRatio === null ? null : round(run.totals.selfSufficiencyRatio * 100, 1),
        shedKwh: round(shed),
        vsExpectedInr: null,
      };
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== "PLAN_INVALID") throw e;
      if (d.key === "expected") throw e; // without the day the plan is made for there is nothing to compare with
      futures.push({ ...entry, state: "UNAVAILABLE", reason: e.message, result: unavailable<Outcome>(e.message, base(`future_${d.key}`)) });
      continue;
    }
    futures.push({
      ...entry,
      state: "RUN",
      reason: null,
      result: simulated(outcome, { ...base(`future_${d.key}`), notes: [`A simulated day: ${d.built}`] }),
    });
  }

  // the difference from the expected day, in what is shown; not for a day with an outage (its bill is lower because load is switched off)
  for (const f of futures) {
    const v = f.result.value;
    const def = defs.find((d) => d.key === f.key)!;
    if (v && expectedCost !== null) v.vsExpectedInr = hasOutage(def) ? null : round(v.netCostInr - expectedCost, 2);
  }

  const comparable = futures.filter((f) => f.result.value && !hasOutage(defs.find((d) => d.key === f.key)!));
  let spread: FuturesDto["spread"] = null;
  if (comparable.length >= 2) {
    const sorted = [...comparable].sort((a, b) => a.result.value!.netCostInr - b.result.value!.netCostInr);
    const lo = sorted[0]!;
    const hi = sorted[sorted.length - 1]!;
    spread = {
      cheapest: { key: lo.key, label: lo.label, netCostInr: lo.result.value!.netCostInr },
      dearest: { key: hi.key, label: hi.label, netCostInr: hi.result.value!.netCostInr },
      note: "The days with an outage are left out: their bills are lower because load is switched off, not because the day is cheaper. These are not predictions and carry no probability.",
    };
  }

  return {
    label: "ENERGY FUTURES",
    madeAt: at.toISOString(),
    horizon: { start: istIso(startMs), steps },
    request: { mode: req.mode, rainSolarPercent: req.rainSolarPercent, outage: req.outage },
    futures,
    spread,
    assumptions: [
      ...new Set([
        ...inp.assumptions,
        "Each day is planned from scratch with the planner told what the day will be: it is how well the equipment could do on that day, not how well a plan made on the expected day would hold up if it turned out so.",
        "The ends of a band (sunny, heavy cloud, high demand) are where 1 hour in 10 falls beyond, measured from this place's past forecast errors. They are not scenarios with a probability, and a whole day at one end is rarer than an hour.",
        "No outage forecast exists: an outage is a question you ask. In one only the critical load is kept on and the rest is switched off; the planner knows when it comes.",
      ]),
    ],
    notes: [],
  };
}
