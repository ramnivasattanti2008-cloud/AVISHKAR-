import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { RobustnessSchema } from "../robustness/schemas.js";
import { robustness } from "../robustness/service.js";
import { ErrorResponse } from "../schemas.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 429: ErrorResponse };

export const robustnessRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.get(
    "/api/properties/:id/robustness",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["plan"],
        summary: "How the plan that was chosen holds up if the day turns out differently",
        description:
          "The latest plan replayed, with its own battery moves and appliance starts kept, against the ends of its forecasts' own bands: less sun, more demand, both together, more sun. It answers what happens to the plan you are following, where the futures page instead re-plans each day with the planner told what the day will be. No probability is attached to any of it, and a band that does not exist or does not cover the plan's hours is UNAVAILABLE with the reason.",
        params: z.object({ id: z.uuid() }),
        response: { 200: RobustnessSchema, ...errs },
      },
    },
    async (req) => robustness(fdeps, req.user!.id, req.params.id),
  );
};
