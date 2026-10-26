/**
 * The background jobs (spec section 71). Each does work the person would otherwise have to ask for, or that goes stale if nobody
 * does: scoring stored forecasts against the readings that followed, refreshing the weather and the satellite scenes of saved
 * properties, and watching tariff validity. A job returns what it did in numbers; it throws when it could do none of its work.
 *
 * Not here, on purpose: re-planning (it would spend the planner on properties nobody is looking at) and opportunity
 * recalculation (the same). Those run when asked.
 */
import type { Db } from "../db.js";
import { evaluateDueForecasts } from "../forecast/evaluate.js";
import type { Providers } from "../providers/index.js";
import { validityOn } from "../tariff/engine.js";
import { storeScenes } from "../twin/service.js";
import type { JobSchedule } from "./schedule.js";

const MIN = 60_000;
/** A runaway job must not hold the runner for ever. */
export const JOB_TIMEOUT_MS = 10 * MIN;
/** A cap on the properties one run visits, so a large deployment spreads its refresh over runs rather than hitting a provider in a burst. */
export const MAX_PROPERTIES_PER_RUN = 200;

export interface JobContext {
  db: Db;
  providers: Providers;
  now: () => Date;
}

export interface JobDef {
  name: string;
  description: string;
  schedule: JobSchedule;
  run(ctx: JobContext): Promise<Record<string, number | string>>;
}

/** One property for each place (to about 1 km), because the providers answer for a place and the same place needs one call. */
async function distinctPlaces(db: Db): Promise<{ latitude: number; longitude: number; properties: number }[]> {
  const rows = await db.property.findMany({ where: { deletedAt: null }, select: { latitude: true, longitude: true }, take: 5000 });
  const places = new Map<string, { latitude: number; longitude: number; properties: number }>();
  for (const r of rows) {
    const key = `${r.latitude.toFixed(2)}:${r.longitude.toFixed(2)}`;
    const cur = places.get(key);
    if (cur) cur.properties++;
    else places.set(key, { latitude: r.latitude, longitude: r.longitude, properties: 1 });
  }
  return [...places.values()].slice(0, MAX_PROPERTIES_PER_RUN);
}

/** Every call is made; a failure is counted and the next place is tried. If every call failed the job fails and says what the first error was. */
async function eachPlace(ctx: JobContext, what: string, call: (p: { latitude: number; longitude: number }) => Promise<void>): Promise<Record<string, number | string>> {
  const places = await distinctPlaces(ctx.db);
  let ok = 0;
  let failed = 0;
  let firstError = "";
  for (const p of places) {
    try {
      await call(p);
      ok++;
    } catch (e) {
      failed++;
      firstError ||= e instanceof Error ? e.message : String(e);
    }
  }
  if (places.length > 0 && ok === 0) throw new Error(`Every ${what} call failed (${failed}): ${firstError}`);
  return { places: places.length, ok, failed, ...(firstError ? { firstError } : {}) };
}

export const JOBS: JobDef[] = [
  {
    name: "forecast-evaluation",
    description: "Scores stored load forecasts against the meter readings that followed them (the learning loop), for every property.",
    schedule: { everyMs: 6 * 60 * MIN, retryMs: 30 * MIN },
    async run(ctx) {
      const props = await ctx.db.property.findMany({ where: { deletedAt: null, forecastRuns: { some: {} } }, select: { id: true }, take: 5000 });
      let scored = 0;
      let notScorable = 0;
      let waiting = 0;
      for (const p of props) {
        const r = await evaluateDueForecasts(ctx.db, p.id, ctx.now());
        scored += r.scored;
        notScorable += r.notScorable;
        waiting += r.waiting;
      }
      return { properties: props.length, scored, notScorable, waiting };
    },
  },
  {
    name: "weather-refresh",
    description: "Fetches the weather forecast for each place with a saved property, so the issued values are kept for scoring later and the next page load is warm.",
    schedule: { everyMs: 60 * MIN, retryMs: 15 * MIN },
    async run(ctx) {
      return eachPlace(ctx, "weather", async (p) => void (await ctx.providers.weather.forecast(p.latitude, p.longitude, { days: 3 }, { now: ctx.now })));
    },
  },
  {
    name: "satellite-ingest",
    description: "Stores the latest Sentinel-2 scene metadata for each place with a saved property (a revisit is about five days, so this is cheap).",
    schedule: { everyMs: 6 * 60 * MIN, retryMs: 60 * MIN },
    async run(ctx) {
      return eachPlace(ctx, "satellite", async (p) => {
        const m = await ctx.providers.satellite.latest(p.latitude, p.longitude, { limit: 5 }, { now: ctx.now });
        if (m.value && m.value.length > 0) await storeScenes(ctx.db, m.provenance.provider, m.value, ctx.now());
      });
    },
  },
  {
    name: "tariff-validity",
    description: "Counts the catalogue's tariff plans whose published period has ended, and the properties still on one, so an expired order is noticed. Plans people entered for themselves are theirs and are not judged.",
    schedule: { everyMs: 24 * 60 * MIN, retryMs: 60 * MIN },
    async run(ctx) {
      const now = ctx.now();
      const plans = await ctx.db.tariffPlan.findMany({ where: { ownerId: null, deletedAt: null }, select: { id: true, effectiveFrom: true, effectiveTo: true, _count: { select: { properties: true } } } });
      let expired = 0;
      let unknown = 0;
      let propertiesOnExpired = 0;
      for (const p of plans) {
        const v = validityOn(p.effectiveFrom, p.effectiveTo, now).status;
        if (v === "EXPIRED") {
          expired++;
          propertiesOnExpired += p._count.properties;
        } else if (v === "UNKNOWN") unknown++;
      }
      return { plans: plans.length, expired, unknownValidity: unknown, propertiesOnExpired };
    },
  },
];
