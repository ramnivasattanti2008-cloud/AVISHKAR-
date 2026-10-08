import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { ErrorResponse } from "../schemas.js";
import { TodaySchema } from "../today/schemas.js";
import { today } from "../today/service.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 429: ErrorResponse };

export const todayRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.get(
    "/api/properties/:id/today",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["plan"],
        summary: "Today: generation, use, surplus, weather risk, backup, autonomy, expected value, and what to do next",
        description:
          "Read from the latest stored forecasts and plan, each figure labelled as what it is, with how old it is; what has none is UNAVAILABLE with the reason and a link to what would fill it in. It recomputes nothing: the one live call is the weather, cached for ten minutes.",
        params: z.object({ id: z.uuid() }),
        response: { 200: TodaySchema, ...errs },
      },
    },
    async (req) => today(fdeps, req.user!.id, req.params.id, { requestId: req.id }),
  );
};
