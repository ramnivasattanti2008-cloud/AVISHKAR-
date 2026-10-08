/**
 * What an administrator can see of the platform (spec section 92): the health of the data, the catalogue and the models; what ran
 * in the background; and the audit log. It is read-only apart from asking a job to run, and every read and run is itself audited.
 * It shows counts and aggregates, never another person's readings, equipment or plans.
 */
import { audit } from "../audit.js";
import type { Db } from "../db.js";
import type { EngineClient } from "../engine/client.js";
import { PROVIDER_NAMES } from "../providers/index.js";
import { providerHealth } from "../providers/recorder.js";
import { validityOn } from "../tariff/engine.js";

const DAY_MS = 86_400_000;

export async function overview(deps: { db: Db; engine: EngineClient | null; now: () => Date }) {
  const { db } = deps;
  const now = deps.now();
  const week = new Date(now.getTime() - 7 * DAY_MS);
  const twoDays = new Date(now.getTime() - 2 * DAY_MS);

  const [total, admins, joined, props, demo, withTariff, withSolar, withBattery, plans, rules, forecasts, planRuns, usage, awaiting, scored, notScorable] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({ where: { deletedAt: null, role: "ADMIN" } }),
    db.user.count({ where: { deletedAt: null, createdAt: { gte: week } } }),
    db.property.findMany({ where: { deletedAt: null }, select: { id: true, tariffPlanId: true } }),
    db.property.count({ where: { deletedAt: null, isDemo: true } }),
    db.property.count({ where: { deletedAt: null, tariffPlanId: { not: null } } }),
    db.property.count({ where: { deletedAt: null, solarSystems: { some: {} } } }),
    db.property.count({ where: { deletedAt: null, batteries: { some: {} } } }),
    db.tariffPlan.findMany({ where: { ownerId: null, deletedAt: null }, orderBy: { name: "asc" }, include: { _count: { select: { properties: true } } } }),
    db.policyRule.findMany({ orderBy: [{ program: "asc" }, { ruleKey: "asc" }] }),
    db.forecastRun.groupBy({ by: ["kind", "model", "engineVersion"], _count: { _all: true }, orderBy: [{ kind: "asc" }, { engineVersion: "desc" }] }),
    db.optimizationRun.groupBy({ by: ["engineVersion"], _count: { _all: true } }),
    db.auditLog.groupBy({ by: ["action"], where: { createdAt: { gte: week } }, _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 40 }),
    db.forecastRun.count({ where: { evaluatedAt: null, firstHour: { lt: new Date(now.getTime() - DAY_MS) } } }),
    db.forecastRun.count({ where: { evaluatedAt: { not: null }, evaluation: { path: ["status"], equals: "SCORED" } } }),
    db.forecastRun.count({ where: { evaluatedAt: { not: null }, evaluation: { path: ["status"], equals: "NOT_SCORABLE" } } }),
  ]);

  // the newest reading of each property, to find the ones gone quiet
  const latest = await db.energyObservation.groupBy({ by: ["propertyId"], _max: { ts: true } });
  const stale = latest.filter((l) => (l._max.ts ?? new Date(0)) < twoDays).length;

  const tariffs = plans.map((p) => {
    const v = validityOn(p.effectiveFrom, p.effectiveTo, now);
    return {
      id: p.id,
      name: p.name,
      state: p.state,
      discom: p.discom,
      category: p.category,
      validity: v.status,
      validityMessage: v.message,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      source: p.source,
      sourceUrl: p.sourceUrl,
      propertiesUsing: p._count.properties,
    };
  });
  const expiredIds = new Set(tariffs.filter((t) => t.validity === "EXPIRED").map((t) => t.id));

  const engine = deps.engine
    ? await deps.engine.health().then(
        (h) => ({ state: "healthy" as const, version: h.version, solver: `HiGHS ${h.highs}`, error: null }),
        (e: unknown) => ({ state: "down" as const, version: null, solver: null, error: e instanceof Error ? e.message : String(e) }),
      )
    : { state: "not_configured" as const, version: null, solver: null, error: null };

  const health = await providerHealth(db, [...PROVIDER_NAMES], 60, now);
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  return {
    generatedAt: now.toISOString(),
    users: { total, admins, joinedLast7Days: joined },
    properties: { total: props.length, demo, withMeterData: latest.length, withTariff, withSolar, withBattery },
    dataHealth: {
      meterDataStale: stale,
      forecastsAwaitingScore: awaiting,
      forecastsScored: scored,
      forecastsNotScorable: notScorable,
      propertiesOnExpiredTariff: props.filter((p) => p.tariffPlanId && expiredIds.has(p.tariffPlanId)).length,
    },
    catalogue: {
      tariffs,
      policyRules: rules.map((r) => ({
        id: r.id,
        program: r.program,
        ruleKey: r.ruleKey,
        region: r.region,
        appliesTo: r.appliesTo,
        source: r.source,
        sourceUrl: r.sourceUrl,
        verifiedAt: r.verifiedAt?.toISOString() ?? null,
        effectiveFrom: day(r.effectiveFrom),
        effectiveTo: day(r.effectiveTo),
      })),
    },
    models: {
      engine,
      forecastRuns: forecasts.map((f) => ({ kind: f.kind, model: f.model, engineVersion: f.engineVersion, runs: f._count._all })),
      planRunsByEngineVersion: Object.fromEntries(planRuns.map((p) => [p.engineVersion, p._count._all])),
    },
    usageLast7Days: Object.fromEntries(usage.map((u) => [u.action, u._count._all])),
    providers: health.map((h) => ({ provider: h.provider, state: h.state, calls: h.calls, failures: h.failures, p95Ms: h.p95Ms, lastError: h.lastError })),
  };
}

export async function auditPage(db: Db, opts: { limit: number; action?: string; before?: string }) {
  const rows = await db.auditLog.findMany({
    where: { ...(opts.action ? { action: { startsWith: opts.action } } : {}), ...(opts.before ? { id: { lt: BigInt(opts.before) } } : {}) },
    orderBy: { id: "desc" },
    take: opts.limit + 1,
    include: { user: { select: { email: true } } },
  });
  const page = rows.slice(0, opts.limit);
  return {
    entries: page.map((r) => ({
      id: r.id.toString(),
      createdAt: r.createdAt.toISOString(),
      action: r.action,
      user: r.user?.email ?? null,
      entityType: r.entityType,
      entityId: r.entityId,
      requestId: r.requestId,
      ip: r.ip,
      detail: r.detail ?? null,
    })),
    next: rows.length > opts.limit ? page[page.length - 1]!.id.toString() : null,
  };
}

/** Grants or removes the administrator role. Used only by the command-line script: no route does it, so no web request can make an administrator. */
export async function setRole(db: Db, email: string, role: "ADMIN" | "USER"): Promise<{ id: string; email: string; role: string }> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || user.deletedAt) throw new Error(`No account has the email ${email}.`);
  const updated = await db.user.update({ where: { id: user.id }, data: { role } });
  await audit(db, { userId: null, action: role === "ADMIN" ? "admin.grant" : "admin.revoke", entityType: "user", entityId: user.id, detail: { from: user.role, to: role, by: "command line" } });
  return { id: updated.id, email: updated.email, role: updated.role };
}
