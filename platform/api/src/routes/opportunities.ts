import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { OpportunitiesSchema, findOpportunities } from "../opportunities/service.js";
import { ErrorResponse } from "../schemas.js";

export const opportunityRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.post(
    "/api/properties/:id/opportunities",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        tags: ["scenarios"],
        summary: "What is worth doing at this property",
        description:
          "Tries a few example changes on the property's typical year (solar, a battery, another tariff it could really be on) and looks at what its records lack. A money suggestion carries the yearly saving and the most it could cost and still repay itself; there is no price list, so none is guessed. Changes that would not save enough are listed under `checked` with what they would save. Takes several seconds. Nothing is stored.",
        params: z.object({ id: z.uuid() }),
        response: { 200: OpportunitiesSchema, 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 422: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (req) => findOpportunities(fdeps, req.user!.id, req.params.id, { requestId: req.id }),
  );
};
