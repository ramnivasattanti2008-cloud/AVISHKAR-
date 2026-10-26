import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { getProperty } from "../properties/service.js";
import { ErrorResponse, measured } from "../schemas.js";
import { PreviewSchema, TwinSchema, TwinVersionSchema } from "../schemas-twin.js";
import { cloudNowcast } from "../twin/nowcast.js";
import { previewLocation } from "../twin/preview.js";
import { analyzeProperty, getLatestTwin, listTwinVersions } from "../twin/service.js";

const Id = z.object({ id: z.uuid() });
const Coord = z.object({ latitude: z.coerce.number(), longitude: z.coerce.number() });
const upstream = { 400: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse };

export const twinRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const policy = { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED };
  const tdeps = { db: deps.db, providers: deps.providers, now: deps.now, policy };
  const auth = { preHandler: requireUser };

  // Public and read-only: what the map shows the moment a point is clicked. Nothing is saved.
  app.get(
    "/api/preview",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags: ["twin"],
        summary: "Solar resource, weather and yield per kWp at a coordinate (not saved)",
        querystring: Coord,
        response: { 200: PreviewSchema, ...upstream },
      },
    },
    async (req) => previewLocation(tdeps, req.query.latitude, req.query.longitude, { requestId: req.id }),
  );

  app.get(
    "/api/cloud-nowcast",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        tags: ["twin"],
        summary: "Cloud movement nowcast (UNAVAILABLE unless sub-hourly satellite data exists)",
        querystring: Coord,
        response: { 200: measured(z.null()), ...upstream },
      },
    },
    async (req) => cloudNowcast(tdeps, req.query.latitude, req.query.longitude, { requestId: req.id }),
  );

  app.post(
    "/api/properties/:id/analyze",
    {
      ...auth,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["twin"],
        summary: "Build a new Energy Twin version from every reachable real source",
        params: Id,
        response: { 201: TwinSchema, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, ...upstream },
      },
    },
    async (req, reply) => {
      const twin = await analyzeProperty(tdeps, req.user!.id, req.params.id, { requestId: req.id });
      await audit(deps.db, {
        userId: req.user!.id,
        action: "twin.analyze",
        entityType: "property",
        entityId: req.params.id,
        requestId: req.id,
        ip: req.ip,
        detail: { version: twin.version, dataQuality: twin.dataQuality },
      });
      reply.code(201);
      return twin;
    },
  );

  app.get(
    "/api/properties/:id/twin",
    { ...auth, schema: { tags: ["twin"], summary: "The latest Energy Twin", params: Id, response: { 200: TwinSchema, 401: ErrorResponse, 404: ErrorResponse } } },
    async (req) => getLatestTwin(tdeps, req.user!.id, req.params.id),
  );

  app.get(
    "/api/properties/:id/twin/versions",
    {
      ...auth,
      schema: {
        tags: ["twin"],
        summary: "Every Energy Twin version, newest first",
        params: Id,
        response: { 200: z.object({ versions: z.array(TwinVersionSchema) }), 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req) => ({ versions: await listTwinVersions(tdeps, req.user!.id, req.params.id) }),
  );

  app.get(
    "/api/properties/:id/cloud-nowcast",
    {
      ...auth,
      schema: { tags: ["twin"], summary: "Cloud nowcast for a property", params: Id, response: { 200: measured(z.null()), 401: ErrorResponse, 404: ErrorResponse, ...upstream } },
    },
    async (req) => {
      const p = await getProperty(deps.db, req.user!.id, req.params.id, policy);
      return cloudNowcast(tdeps, p.latitude, p.longitude, { requestId: req.id });
    },
  );
};
