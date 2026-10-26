import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { ErrorResponse, GeocodeResultSchema, measured } from "../schemas.js";

const GEOCODE_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } };

export const geocodeRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    "/api/geocode/search",
    {
      config: GEOCODE_LIMIT,
      schema: {
        tags: ["geocoding"],
        summary: "Search an address, locality or place name",
        querystring: z.object({
          q: z.string().trim().min(3).max(200),
          limit: z.coerce.number().int().min(1).max(10).default(5),
          countries: z.string().regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/).optional().describe("Comma-separated ISO country codes to restrict to, for example in"),
        }),
        response: { 200: measured(z.array(GeocodeResultSchema)), 400: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (req) =>
      deps.providers.geocoding.search(req.query.q, { limit: req.query.limit, countryCodes: req.query.countries?.split(",") }, { requestId: req.id, now: deps.now }),
  );

  app.get(
    "/api/geocode/reverse",
    {
      config: GEOCODE_LIMIT,
      schema: {
        tags: ["geocoding"],
        summary: "Find the address at a coordinate",
        querystring: z.object({ latitude: z.coerce.number(), longitude: z.coerce.number() }),
        response: { 200: measured(GeocodeResultSchema), 400: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (req) => deps.providers.geocoding.reverse(req.query.latitude, req.query.longitude, { requestId: req.id, now: deps.now }),
  );
};
