import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { getProperty } from "../properties/service.js";
import { ErrorResponse, WeatherReportSchema } from "../schemas.js";

const Days = z.coerce.number().int().min(1).max(7).default(3);
const errs = { 400: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse };

export const weatherRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const policy = { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED };

  // Public: the map shows weather as soon as a point is clicked, before anyone signs in.
  app.get(
    "/api/weather",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["weather"],
        summary: "Current model analysis and hourly forecast at a coordinate",
        querystring: z.object({ latitude: z.coerce.number(), longitude: z.coerce.number(), days: Days }),
        response: { 200: WeatherReportSchema, ...errs },
      },
    },
    async (req) => deps.providers.weather.forecast(req.query.latitude, req.query.longitude, { days: req.query.days }, { requestId: req.id, now: deps.now }),
  );

  app.get(
    "/api/properties/:id/weather",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["weather", "properties"],
        summary: "Weather at one of your properties",
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ days: Days }),
        response: { 200: WeatherReportSchema, 401: ErrorResponse, 404: ErrorResponse, ...errs },
      },
    },
    async (req) => {
      const p = await getProperty(deps.db, req.user!.id, req.params.id, policy);
      return deps.providers.weather.forecast(p.latitude, p.longitude, { days: req.query.days }, { requestId: req.id, now: deps.now });
    },
  );
};
