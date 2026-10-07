import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { addUserPolygon, createProperty, deleteProperty, getProperty, listProperties, updateProperty } from "../properties/service.js";
import { ErrorResponse, PropertySchema } from "../schemas.js";

const Id = z.object({ id: z.uuid() });
const Create = z.object({
  name: z.string().trim().min(1).max(120),
  // Range checks live in the service so impossible coordinates return the documented INVALID_COORDINATES code.
  latitude: z.number(),
  longitude: z.number(),
  address: z.string().trim().max(300).optional(),
  positionSource: z.string().min(1).max(40),
  positionAccuracyM: z.number().min(0).max(100_000).optional(),
});
const Patch = z.object({ name: z.string().trim().min(1).max(120).optional(), address: z.string().trim().max(300).nullable().optional() }).refine((v) => v.name !== undefined || v.address !== undefined, "Provide name or address.");
const Polygon = z.object({ ring: z.array(z.tuple([z.number(), z.number()])).min(4).max(500).describe("GeoJSON ring of [longitude, latitude] pairs; first point repeated as last.") });

export const propertyRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const policy = { navicEnabled: config.NAVIC_RECEIVER_ENABLED };
  const auth = { preHandler: requireUser };
  const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse };

  app.post(
    "/api/properties",
    { ...auth, schema: { tags: ["properties"], summary: "Save a property at a location", body: Create, response: { 201: PropertySchema, ...errs } } },
    async (req, reply) => {
      const p = await createProperty(db, req.user!.id, req.body, policy);
      await audit(db, { userId: req.user!.id, action: "property.create", entityType: "property", entityId: p.id, requestId: req.id, ip: req.ip, detail: { source: p.position.source } });
      reply.code(201);
      return p;
    },
  );

  app.get(
    "/api/properties",
    { ...auth, schema: { tags: ["properties"], summary: "Your saved properties", response: { 200: z.object({ properties: z.array(PropertySchema) }), ...errs } } },
    async (req) => ({ properties: await listProperties(db, req.user!.id, policy) }),
  );

  app.get(
    "/api/properties/:id",
    { ...auth, schema: { tags: ["properties"], summary: "One property", params: Id, response: { 200: PropertySchema, ...errs } } },
    async (req) => getProperty(db, req.user!.id, req.params.id, policy),
  );

  app.patch(
    "/api/properties/:id",
    { ...auth, schema: { tags: ["properties"], summary: "Rename or re-address a property", params: Id, body: Patch, response: { 200: PropertySchema, ...errs } } },
    async (req) => {
      const p = await updateProperty(db, req.user!.id, req.params.id, req.body, policy);
      await audit(db, { userId: req.user!.id, action: "property.update", entityType: "property", entityId: p.id, requestId: req.id, ip: req.ip });
      return p;
    },
  );

  app.delete(
    "/api/properties/:id",
    { ...auth, schema: { tags: ["properties"], summary: "Delete a property and its geometry", params: Id, response: { 204: z.null(), ...errs } } },
    async (req, reply) => {
      await deleteProperty(db, req.user!.id, req.params.id);
      await audit(db, { userId: req.user!.id, action: "property.delete", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip });
      reply.code(204);
      return null;
    },
  );

  app.post(
    "/api/properties/:id/geometry",
    { ...auth, schema: { tags: ["properties"], summary: "Attach a roof or plot outline you drew", params: Id, body: Polygon, response: { 201: PropertySchema, ...errs } } },
    async (req, reply) => {
      const p = await addUserPolygon(db, req.user!.id, req.params.id, req.body.ring, policy);
      await audit(db, { userId: req.user!.id, action: "property.geometry.add", entityType: "property", entityId: p.id, requestId: req.id, ip: req.ip });
      reply.code(201);
      return p;
    },
  );
};
