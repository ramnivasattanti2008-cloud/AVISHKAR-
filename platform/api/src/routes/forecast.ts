import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { LoadForecastSchema, SolarForecastSchema, SolarPerformanceSchema } from "../forecast/schemas.js";
import { loadForecast, solarForecast, solarPerformance } from "../forecast/service.js";
import { ErrorResponse } from "../schemas.js";

const P = z.object({ id: z.uuid() });
const upstream = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse };

export const forecastRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };
  const limit = { rateLimit: { max: 30, timeWindow: "1 minute" } };

  app.get(
    "/api/properties/:id/solar-forecast",
    {
      preHandler: requireUser,
      config: limit,
      schema: {
        tags: ["forecast"],
        summary: "Forecast the output of the property's solar system",
        description:
          "A physical PV model (pvlib) driven by the Open-Meteo irradiance forecast. The 10th to 90th percentile band comes only from how wrong that forecast was at this place in the last weeks, and is absent (with the reason) when that record is missing. Uses the installed systems, or the planned ones when none is installed.",
        params: P,
        querystring: z.object({ days: z.coerce.number().int().min(1).max(7).default(3) }),
        response: { 200: SolarForecastSchema, ...upstream },
      },
    },
    async (req) => solarForecast(fdeps, req.user!.id, req.params.id, { days: req.query.days, requestId: req.id }),
  );

  app.get(
    "/api/properties/:id/solar-forecast/performance",
    {
      preHandler: requireUser,
      config: limit,
      schema: {
        tags: ["forecast"],
        summary: "How well the solar forecast has done lately",
        description:
          "MAE, RMSE, MAPE, WAPE and bias over the last weeks, next to the baselines it has to beat (yesterday's output; a cloudless sky). Scored against the weather model's analysis, not metered output: the response says so.",
        params: P,
        response: { 200: SolarPerformanceSchema, ...upstream },
      },
    },
    async (req) => solarPerformance(fdeps, req.user!.id, req.params.id, { requestId: req.id }),
  );

  app.get(
    "/api/properties/:id/load-forecast",
    {
      preHandler: requireUser,
      config: limit,
      schema: {
        tags: ["forecast"],
        summary: "Forecast the property's electricity use from its own meter readings",
        description:
          "Weekly-lagged baselines and a calibrated quantile model compete on a chronological holdout; the winner is used and every method's error is returned. Needs two weeks of readings. When the readings end more than two days ago the forecast covers the hours after them and is labelled an estimate, not a forecast of tomorrow.",
        params: P,
        querystring: z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }),
        response: { 200: LoadForecastSchema, ...upstream },
      },
    },
    async (req) => loadForecast(fdeps, req.user!.id, req.params.id, { hours: req.query.hours, requestId: req.id }),
  );
};
