import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { ownProperty } from "../assets/service.js";
import { requireUser } from "../auth/hooks.js";
import { evaluateDueForecasts } from "../forecast/evaluate.js";
import { ForecastAccuracySchema, LoadForecastSchema, SolarForecastSchema, SolarPerformanceSchema } from "../forecast/schemas.js";
import { forecastAccuracy, loadForecast, solarForecast, solarPerformance } from "../forecast/service.js";
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

  app.get(
    "/api/properties/:id/forecast-accuracy",
    {
      preHandler: requireUser,
      schema: {
        tags: ["forecast"],
        summary: "How the stored forecasts have done against the readings that followed",
        description:
          "Each load forecast made from current readings is kept as issued; once newer readings cover its hours it is scored (mean error, bias, how often the 10 to 90 percent band held) next to repeating the same hour a week earlier. WAITING means the readings do not reach its hours yet. Nothing is estimated: an hour with a reading missing is not scored.",
        params: P,
        response: { 200: ForecastAccuracySchema, ...upstream },
      },
    },
    async (req) => forecastAccuracy(fdeps, req.user!.id, req.params.id),
  );

  app.post(
    "/api/properties/:id/forecast-accuracy/evaluate",
    {
      preHandler: requireUser,
      config: limit,
      schema: {
        tags: ["forecast"],
        summary: "Score every stored forecast that the meter data now covers",
        description: "Also done automatically after each meter import. Safe to repeat: a forecast is scored once.",
        params: P,
        response: { 200: z.object({ scored: z.number(), notScorable: z.number(), waiting: z.number() }), ...upstream },
      },
    },
    async (req) => {
      await ownProperty(deps.db, req.user!.id, req.params.id);
      return evaluateDueForecasts(deps.db, req.params.id, deps.now());
    },
  );
};
