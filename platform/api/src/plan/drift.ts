import type { Db } from "../db.js";
import type { PlanDriftDto } from "./schemas.js";

/** Calculate percentage drift between observed and planned intervals. */
export function calculateDrift(
  observedKwh: number[],
  plannedLoadKwh: number[],
  thresholdPercent = 15,
): { driftPercent: number; replanRecommended: boolean } {
  if (observedKwh.length === 0 || plannedLoadKwh.length === 0) {
    return { driftPercent: 0, replanRecommended: false };
  }
  const n = Math.min(observedKwh.length, plannedLoadKwh.length);
  const obsMean = observedKwh.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const planMean = plannedLoadKwh.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const diff = Math.abs(obsMean - planMean) / Math.max(planMean, 0.1);
  const driftPercent = Math.round(diff * 1000) / 10;
  return {
    driftPercent,
    replanRecommended: driftPercent > thresholdPercent,
  };
}

/** Check real-time observations against the latest plan to detect intraday drift. */
export async function checkPlanDrift(
  db: Db,
  propertyId: string,
  now: Date,
  thresholdPercent = 15,
): Promise<PlanDriftDto> {
  const latestRun = await db.optimizationRun.findFirst({
    where: { propertyId },
    orderBy: { createdAt: "desc" },
    select: { startsAt: true, plan: true },
  });

  if (!latestRun) {
    return {
      status: "NO_PLAN",
      driftPercent: null,
      replanRecommended: false,
      reason: "No active plan exists for this property.",
      observationsEvaluated: 0,
      evaluatedAt: now.toISOString(),
    };
  }

  const obs = await db.energyObservation.findMany({
    where: {
      propertyId,
      ts: { gte: latestRun.startsAt, lte: now },
    },
    orderBy: { ts: "asc" },
    select: { importKwh: true },
    take: 48,
  });

  if (obs.length < 2) {
    return {
      status: "INSUFFICIENT_OBSERVATIONS",
      driftPercent: null,
      replanRecommended: false,
      reason: "Fewer than 2 real-time intervals recorded since plan started.",
      observationsEvaluated: obs.length,
      evaluatedAt: now.toISOString(),
    };
  }

  const planObj = latestRun.plan as Record<string, unknown> | null;
  const steps = Array.isArray(planObj?.steps) ? (planObj?.steps as Array<Record<string, unknown>>) : [];
  const plannedKwh = steps.map((s) => Number(s.loadKw ?? s.load_kw ?? s.gridKw ?? 1.0));
  const observed = obs.map((o) => o.importKwh);

  const { driftPercent, replanRecommended } = calculateDrift(observed, plannedKwh, thresholdPercent);

  return {
    status: replanRecommended ? "DRIFT_DETECTED" : "ON_TRACK",
    driftPercent,
    replanRecommended,
    reason: replanRecommended
      ? `Observed load drifted ${driftPercent}% from planned schedule (exceeds ${thresholdPercent}% tolerance).`
      : `Actual usage is tracking within ${thresholdPercent}% of planned schedule (${driftPercent}% deviation).`,
    observationsEvaluated: obs.length,
    evaluatedAt: now.toISOString(),
  };
}
