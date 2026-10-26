import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { FuturesRequest, FuturesSchema } from "../futures/schemas.js";
import { runFutures } from "../futures/service.js";
import { ErrorResponse } from "../schemas.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 422: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse };

export const futuresRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.post(
    "/api/properties/:id/futures",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
      schema: {
        tags: ["scenarios"],
        summary: "The next 24 hours planned on several different days: sunny, heavy cloud, rain, high demand, a dead battery, a grid outage",
        description:
          "ENERGY FUTURES. Each day is built from the forecasts' central estimates, an end of a band the forecast measured from this place's own past errors, or a figure you set (the rain's share of the sun, an outage you ask about), and the response says which. They are not predictions and carry no probability. A day that cannot be built (no solar band yet, no battery, no critical load) is UNAVAILABLE with the reason. Nothing is stored.",
        params: z.object({ id: z.uuid() }),
        body: FuturesRequest,
        response: { 200: FuturesSchema, ...errs },
      },
    },
    async (req) => {
      const r = await runFutures(fdeps, req.user!.id, req.params.id, req.body, { requestId: req.id });
      await audit(deps.db, { userId: req.user!.id, action: "futures.run", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { ...r.request, run: r.futures.filter((f) => f.state === "RUN").length } });
      return r;
    },
  );
};
