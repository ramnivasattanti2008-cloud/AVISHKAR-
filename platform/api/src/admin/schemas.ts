import { z } from "zod";

const Counts = z.record(z.string(), z.number());

export const JobRunSchema = z.object({
  id: z.uuid(),
  job: z.string(),
  trigger: z.enum(["SCHEDULE", "MANUAL"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(["RUNNING", "OK", "FAILED", "SKIPPED"]),
  seconds: z.number().nullable(),
  summary: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
});

export const JobsSchema = z
  .object({
    schedulerEnabled: z.boolean().describe("Whether this API process checks for due jobs once a minute (JOBS_ENABLED)."),
    jobs: z.array(z.object({ name: z.string(), description: z.string(), everyMinutes: z.number(), retryMinutes: z.number(), dueInSeconds: z.number(), recent: z.array(JobRunSchema) })),
  })
  .meta({ id: "AdminJobs" });

export const OverviewSchema = z
  .object({
    generatedAt: z.string(),
    users: z.object({ total: z.number(), admins: z.number(), joinedLast7Days: z.number() }),
    properties: z.object({ total: z.number(), demo: z.number(), withMeterData: z.number(), withTariff: z.number(), withSolar: z.number(), withBattery: z.number() }),
    dataHealth: z.object({
      meterDataStale: z.number().describe("Properties whose newest meter reading is more than two days old."),
      forecastsAwaitingScore: z.number().describe("Stored forecasts whose hours have passed but that have not been scored."),
      forecastsScored: z.number(),
      forecastsNotScorable: z.number(),
      propertiesOnExpiredTariff: z.number(),
    }),
    catalogue: z.object({
      tariffs: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          state: z.string().nullable(),
          discom: z.string().nullable(),
          category: z.string().nullable(),
          validity: z.string(),
          validityMessage: z.string(),
          verifiedAt: z.string().nullable(),
          source: z.string(),
          sourceUrl: z.string().nullable(),
          propertiesUsing: z.number(),
        }),
      ),
      policyRules: z.array(
        z.object({
          id: z.uuid(),
          program: z.string(),
          ruleKey: z.string(),
          region: z.string(),
          appliesTo: z.string(),
          source: z.string(),
          sourceUrl: z.string().nullable(),
          verifiedAt: z.string().nullable(),
          effectiveFrom: z.string().nullable(),
          effectiveTo: z.string().nullable(),
        }),
      ),
    }),
    models: z.object({
      engine: z.object({ state: z.enum(["healthy", "down", "not_configured"]), version: z.string().nullable(), solver: z.string().nullable(), error: z.string().nullable() }),
      forecastRuns: z.array(z.object({ kind: z.string(), model: z.string(), engineVersion: z.string(), runs: z.number() })),
      planRunsByEngineVersion: Counts,
    }),
    usageLast7Days: Counts.describe("How many times each audited action happened."),
    providers: z.array(z.object({ provider: z.string(), state: z.enum(["healthy", "degraded", "down", "unknown"]), calls: z.number(), failures: z.number(), p95Ms: z.number().nullable(), lastError: z.string().nullable() })),
  })
  .meta({ id: "AdminOverview" });

export const AuditSchema = z
  .object({
    entries: z.array(
      z.object({
        id: z.string(),
        createdAt: z.string(),
        action: z.string(),
        user: z.string().nullable(),
        entityType: z.string().nullable(),
        entityId: z.string().nullable(),
        requestId: z.string().nullable(),
        ip: z.string().nullable(),
        detail: z.unknown().nullable(),
      }),
    ),
    next: z.string().nullable().describe("Pass as `before` to read the next, older page."),
  })
  .meta({ id: "AdminAudit" });
