import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { ScenarioRequest, ScenarioSchema, ScenarioSummarySchema } from "../scenarios/schemas.js";
import { scenarioCsv } from "../scenarios/export.js";
import { deleteScenario, getScenario, listScenarios, runScenario } from "../scenarios/service.js";
import { ErrorResponse } from "../schemas.js";

const P = z.object({ id: z.uuid() });
const PS = z.object({ id: z.uuid(), scenarioId: z.uuid() });
const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse };

export const scenarioRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };
  const auth = { preHandler: requireUser };

  app.post(
    "/api/properties/:id/scenarios",
    {
      ...auth,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["scenarios"],
        summary: "What would adding solar, a battery or a different tariff do over a year",
        description:
          "Compares today's setup with the changed one over a typical year (one typical weekday and weekend day per month, planned for the lowest bill) and gives the yearly saving. With the prices you were quoted it adds payback, net present value and rate of return; without them it says so and does not guess. An estimate, not a forecast of any particular year: the response lists every assumption. Needs a chosen tariff and meter readings (422 PLAN_INPUTS_MISSING says which).",
        params: P,
        body: ScenarioRequest,
        response: { 201: ScenarioSchema, 422: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse, ...errs },
      },
    },
    async (req, reply) => {
      const s = await runScenario(fdeps, req.user!.id, req.params.id, req.body, { requestId: req.id });
      await audit(deps.db, { userId: req.user!.id, action: "scenario.run", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { scenarioId: s.id, annualSavingsInr: s.comparison.value?.annualSavingsInr ?? null } });
      reply.code(201);
      return s;
    },
  );

  app.get("/api/properties/:id/scenarios", { ...auth, schema: { tags: ["scenarios"], summary: "Scenarios run for a property, newest first", params: P, response: { 200: z.object({ scenarios: z.array(ScenarioSummarySchema) }), ...errs } } }, async (req) => ({
    scenarios: await listScenarios(deps.db, req.user!.id, req.params.id),
  }));

  app.get("/api/properties/:id/scenarios/:scenarioId", { ...auth, schema: { tags: ["scenarios"], summary: "One scenario as it was shown", params: PS, response: { 200: ScenarioSchema, ...errs } } }, async (req) =>
    getScenario(deps.db, req.user!.id, req.params.id, req.params.scenarioId),
  );

  app.get(
    "/api/properties/:id/scenarios/:scenarioId/export.csv",
    {
      ...auth,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags: ["scenarios"],
        summary: "Download one stored what-if as CSV",
        description: "One row per month, today's setup beside the changed one, then the year. The first lines (starting with #) say it is an ESTIMATE from typical days and give the economics with their assumptions. Nothing is recomputed.",
        params: PS,
        response: { 200: z.string(), ...errs },
      },
    },
    async (req, reply) => {
      const s = await getScenario(deps.db, req.user!.id, req.params.id, req.params.scenarioId);
      await audit(deps.db, { userId: req.user!.id, action: "scenario.export", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { scenarioId: s.id } });
      reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="avishkar-what-if-${s.id}.csv"`);
      return scenarioCsv(s);
    },
  );

  app.delete("/api/properties/:id/scenarios/:scenarioId", { ...auth, schema: { tags: ["scenarios"], summary: "Delete a scenario", params: PS, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await deleteScenario(deps.db, req.user!.id, req.params.id, req.params.scenarioId);
    reply.code(204);
    return null;
  });
};
