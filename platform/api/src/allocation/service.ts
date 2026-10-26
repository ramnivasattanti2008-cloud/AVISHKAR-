/**
 * Where every kWh of the latest plan went (spec section 19). Read from what is stored: nothing is recomputed and nothing is
 * assumed. The arithmetic, and the order it is applied in, are in ledger.ts, and that order is returned with the answer so that
 * whoever reads a number can see the convention it rests on.
 */
import type { ForecastDeps } from "../forecast/service.js";
import { HOUR_MS } from "../plan/horizon.js";
import type { PlanDto } from "../plan/schemas.js";
import { getProperty } from "../properties/service.js";
import { simulated, unavailable } from "../provenance/index.js";
import { buildLedger } from "./ledger.js";
import type { AllocationDto } from "./schemas.js";

const STALE_PLAN_MS = 24 * HOUR_MS;
type Totals = NonNullable<AllocationDto["totals"]["value"]>;

export const RULE = [
  "The sun serves what the property is using now.",
  "What is left of the sun charges the battery.",
  "What is still left is sold.",
  "Demand the sun did not cover is taken from the battery, and only then bought from the grid.",
  "Charging the sun did not cover was bought from the grid.",
  "The battery is a queue: energy goes in labelled with where it came from, and comes out first in, first out.",
];

export async function allocation(deps: ForecastDeps, userId: string, propertyId: string): Promise<AllocationDto> {
  const at = deps.now();
  const property = await getProperty(deps.db, userId, propertyId, deps.policy);
  const row = await deps.db.optimizationRun.findFirst({ where: { propertyId }, orderBy: { createdAt: "desc" } });
  const base = {
    provider: "avishkar-allocation",
    source: "AVISHKAR's latest stored plan for this property",
    dataType: "energy_allocation",
    location: { latitude: property.latitude, longitude: property.longitude },
    now: at,
    unit: "kWh",
  };

  if (!row) {
    return {
      label: "WHERE EVERY kWh WENT",
      propertyId,
      madeAt: at.toISOString(),
      basedOn: null,
      rule: RULE,
      hours: [],
      totals: unavailable<Totals>("No plan has been made yet, and the ledger is read from the latest plan.", base),
      check: { balanced: true, maxHourErrorKwh: 0, note: "There is nothing to check yet." },
      next: [{ label: "Make a plan", href: `/property/${propertyId}/plan`, why: "The ledger follows the energy of a plan, hour by hour, and there is none yet." }],
    };
  }

  const plan = row.plan as unknown as PlanDto;
  const stale = at.getTime() - row.createdAt.getTime() > STALE_PLAN_MS;
  const ledger = buildLedger(plan);
  return {
    label: "WHERE EVERY kWh WENT",
    propertyId,
    madeAt: at.toISOString(),
    basedOn: {
      planId: row.id,
      madeAt: row.createdAt.toISOString(),
      stale,
      note: stale ? "This plan is more than a day old: make a new one to follow today." : "Read from this plan; nothing was recomputed.",
    },
    rule: RULE,
    hours: ledger.rows,
    totals: simulated(ledger.totals, {
      ...base,
      notes: [
        `A simulated day: the plan made ${row.createdAt.toISOString()}. It is not a measurement of what the property did.`,
        "The split between sources and destinations follows the stated order; the optimiser does not record which kWh went where.",
      ],
    }),
    check: ledger.check,
    next: stale ? [{ label: "Make a new plan", href: `/property/${propertyId}/plan`, why: "The latest plan is more than a day old." }] : [],
  };
}
