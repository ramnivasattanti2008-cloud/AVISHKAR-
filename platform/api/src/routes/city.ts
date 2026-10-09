import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { CityRequest, CitySchema } from "../city/schemas.js";
import { cityMap } from "../city/service.js";
import { ErrorResponse } from "../schemas.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse };

export const cityRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.post(
    "/api/city",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["map"],
        summary: "A square of cells over a place: the solar resource in each, and your own properties",
        description:
          "CITY ENERGY MAP. The solar resource is a 20-year climatology at each cell's centre (REFERENCE), and the response says how much the cells really differ, because the provider's grid is coarser than a city. Only your own properties appear. A city's demand, storage, vehicles, flexibility and outage risk are UNAVAILABLE with the reason: no source for them is connected, and inventing them would be fabrication.",
        body: CityRequest,
        response: { 200: CitySchema, ...errs },
      },
    },
    async (req) => cityMap(fdeps, req.user!.id, req.body, { requestId: req.id }),
  );
};
