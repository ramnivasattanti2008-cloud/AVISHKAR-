import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { PlanRequest, PlanSchema, PlanSummarySchema } from "../plan/schemas.js";
import { createPlan, getPlan, listPlans } from "../plan/service.js";
import { ErrorResponse } from "../schemas.js";

const P = z.object({ id: z.uuid() });
const PP = z.object({ id: z.uuid(), planId: z.uuid() });
const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse };

export const planRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };
  const auth = { preHandler: requireUser };

  app.post(
    "/api/properties/:id/plan",
    {
      ...auth,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["plan"],
        summary: "Plan the next day or two",
        description:
          "Chooses when to charge and discharge the battery, import and export, charge an EV and run flexible appliances, from the tariff's prices, the load and solar forecasts and the equipment entered. The plan is re-checked from scratch before it is returned; one that fails the check is refused (502 PLAN_INVALID), never shown. Savings are against the same day with no control (a simulated outcome of forecast inputs, not a measurement). Needs a chosen tariff and meter readings (422 PLAN_INPUTS_MISSING says which).",
        params: P,
        body: PlanRequest,
        response: { 201: PlanSchema, 422: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse, ...errs },
      },
    },
    async (req, reply) => {
      const plan = await createPlan(fdeps, req.user!.id, req.params.id, req.body, { requestId: req.id });
      await audit(deps.db, { userId: req.user!.id, action: "plan.create", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { planId: plan.id, mode: plan.mode, savingsInr: plan.result.value?.savingsInr ?? null } });
      reply.code(201);
      return plan;
    },
  );

  app.get("/api/properties/:id/plan", { ...auth, schema: { tags: ["plan"], summary: "The latest plan", params: P, response: { 200: PlanSchema, ...errs } } }, async (req) => getPlan(deps.db, req.user!.id, req.params.id));

  app.get("/api/properties/:id/plans", { ...auth, schema: { tags: ["plan"], summary: "Plans made for a property, newest first", params: P, response: { 200: z.object({ plans: z.array(PlanSummarySchema) }), ...errs } } }, async (req) => ({
    plans: await listPlans(deps.db, req.user!.id, req.params.id),
  }));

  app.get("/api/properties/:id/plans/:planId", { ...auth, schema: { tags: ["plan"], summary: "One plan as it was shown", params: PP, response: { 200: PlanSchema, ...errs } } }, async (req) => getPlan(deps.db, req.user!.id, req.params.id, req.params.planId));
};
