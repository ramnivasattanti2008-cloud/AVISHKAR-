import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { AllocationSchema } from "../allocation/schemas.js";
import { allocation } from "../allocation/service.js";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { ErrorResponse } from "../schemas.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 429: ErrorResponse };

export const allocationRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.get(
    "/api/properties/:id/allocation",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["plan"],
        summary: "Where every kWh of the latest plan came from and went to, hour by hour",
        description:
          "Read from the latest stored plan; recomputes nothing. The optimiser does not record which kWh went where, so the split follows a stated order, which is returned with the answer, and every figure is SIMULATED. The response also carries a check that each hour's energy was put in exactly one place.",
        params: z.object({ id: z.uuid() }),
        response: { 200: AllocationSchema, ...errs },
      },
    },
    async (req) => allocation(fdeps, req.user!.id, req.params.id),
  );
};
