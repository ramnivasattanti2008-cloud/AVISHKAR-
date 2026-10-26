import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireAdmin } from "../auth/hooks.js";
import { AppError } from "../errors.js";
import { JOBS } from "../jobs/registry.js";
import { JobRunner } from "../jobs/runner.js";
import { ErrorResponse } from "../schemas.js";
import { AuditSchema, JobRunSchema, JobsSchema, OverviewSchema } from "../admin/schemas.js";
import { auditPage, overview } from "../admin/service.js";

const errs = { 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 429: ErrorResponse };

export const adminRoutes: FastifyPluginAsyncZod<{ deps: AppDeps; runner?: JobRunner }> = async (app, { deps, runner: given }) => {
  const runner = given ?? new JobRunner({ db: deps.db, providers: deps.providers, now: deps.now });
  const tags = ["admin"];
  const gate = { preHandler: requireAdmin, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  app.get(
    "/api/admin/overview",
    { ...gate, schema: { tags, summary: "Health of the data, the catalogue, the models and the providers: counts, and no one's readings", response: { 200: OverviewSchema, ...errs } } },
    async (req) => {
      await audit(deps.db, { userId: req.user!.id, action: "admin.overview", requestId: req.id, ip: req.ip });
      return overview(deps);
    },
  );

  app.get(
    "/api/admin/jobs",
    { ...gate, schema: { tags, summary: "The background jobs, when each is next due and what it did lately", response: { 200: JobsSchema, ...errs } } },
    async () => ({ schedulerEnabled: deps.config.JOBS_ENABLED, jobs: await runner.status() }),
  );

  app.post(
    "/api/admin/jobs/:name/run",
    {
      preHandler: requireAdmin,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Run one background job now",
        description: "Recorded as a manual run by you. If the job is already running, the answer is a SKIPPED run saying so.",
        params: z.object({ name: z.string().min(1).max(60) }),
        response: { 200: JobRunSchema, ...errs },
      },
    },
    async (req) => {
      if (!JOBS.some((j) => j.name === req.params.name)) throw new AppError("NOT_FOUND", `No job is called ${req.params.name}.`);
      await audit(deps.db, { userId: req.user!.id, action: "admin.job.run", entityType: "job", entityId: req.params.name, requestId: req.id, ip: req.ip });
      const r = await runner.run(req.params.name, "MANUAL", req.user!.id);
      return r!;
    },
  );

  app.get(
    "/api/admin/audit",
    {
      ...gate,
      schema: {
        tags,
        summary: "The audit log, newest first",
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          action: z.string().trim().min(1).max(60).optional().describe("Only actions that start with this, for example plan or admin."),
          before: z.string().regex(/^\d{1,18}$/).optional(),
        }),
        response: { 200: AuditSchema, ...errs },
      },
    },
    async (req) => {
      await audit(deps.db, { userId: req.user!.id, action: "admin.audit.read", requestId: req.id, ip: req.ip, detail: { action: req.query.action ?? null } });
      return auditPage(deps.db, req.query);
    },
  );
};
