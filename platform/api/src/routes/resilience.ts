import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { ResilienceSchema } from "../resilience/schemas.js";
import { resilienceReport } from "../resilience/service.js";
import { ErrorResponse } from "../schemas.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 422: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse };

export const resilienceRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.get(
    "/api/properties/:id/resilience",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["plan"],
        summary: "How long the critical load would last if the grid failed, and how autonomous the plan is",
        description:
          "Resilience: if the grid failed at the start of the next hour, how long the appliances you marked CRITICAL would be served from the battery and the forecast sun, a score, and the reserve to keep for the time you want. No outage is predicted: grid outage risk is UNAVAILABLE because no outage data exists. Autonomy: the share of the latest plan's energy that did not come from the grid, with its method.",
        params: z.object({ id: z.uuid() }),
        querystring: z.object({
          targetHours: z.coerce.number().min(1).max(24).default(4).describe("How long you want the critical load to last, for the reserve to recommend."),
          startSocPercent: z.coerce.number().min(0).max(100).optional().describe("The battery's charge now, if you know it."),
        }),
        response: { 200: ResilienceSchema, ...errs },
      },
    },
    async (req) => resilienceReport(fdeps, req.user!.id, req.params.id, { targetHours: req.query.targetHours, startSocPercent: req.query.startSocPercent ?? null }, { requestId: req.id }),
  );
};
