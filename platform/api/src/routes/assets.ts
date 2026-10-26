import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { type NilmEngine, UnavailableNilm, finestInterval } from "../assets/nilm.js";
import {
  AppliancePatch,
  ApplianceEventSchema,
  ApplianceInput,
  ApplianceSchema,
  AssetProfilesSchema,
  BatteryInput,
  BatteryPatch,
  BatterySchema,
  EvInput,
  EvPatch,
  EvSchema,
  EventInput,
  SolarInput,
  SolarPatch,
  SolarSystemSchema,
} from "../assets/schemas.js";
import {
  createAppliance,
  createBattery,
  createEv,
  createSolarSystem,
  deleteAppliance,
  deleteApplianceEvent,
  deleteBattery,
  deleteEv,
  deleteSolarSystem,
  listApplianceEvents,
  listAppliances,
  listBatteries,
  listEvs,
  listSolarSystems,
  logApplianceEvent,
  ownProperty,
  profilesFromSnapshot,
  summariseAssets,
  updateAppliance,
  updateBattery,
  updateEv,
  updateSolarSystem,
} from "../assets/service.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { ErrorResponse, measured } from "../schemas.js";

const P = z.object({ id: z.uuid() });
const PA = z.object({ id: z.uuid(), assetId: z.uuid() });
const PAE = z.object({ id: z.uuid(), assetId: z.uuid(), eventId: z.uuid() });

const NilmEstimateSchema = measured(z.array(z.object({ applianceId: z.uuid(), energyKwh: z.number(), plusMinusKwh: z.number(), confidence: z.number() })));

export const assetRoutes: FastifyPluginAsyncZod<{ deps: AppDeps; nilm?: NilmEngine }> = async (app, { deps, nilm = new UnavailableNilm() }) => {
  const { db } = deps;
  const auth = { preHandler: requireUser };
  const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse };
  const log = (req: { id: string; ip: string; user: { id: string } | null }, action: string, entityId: string, propertyId: string) =>
    audit(db, { userId: req.user!.id, action, entityType: action.split(".")[0], entityId, requestId: req.id, ip: req.ip, detail: { propertyId } });

  // The same five routes for each kind of asset, spelled out so each is documented and typed on its own.
  app.get("/api/properties/:id/batteries", { ...auth, schema: { tags: ["assets"], summary: "Batteries of a property", params: P, response: { 200: z.object({ batteries: z.array(BatterySchema) }), ...errs } } }, async (req) => ({
    batteries: await listBatteries(db, req.user!.id, req.params.id),
  }));
  app.post(
    "/api/properties/:id/batteries",
    { ...auth, schema: { tags: ["assets"], summary: "Add a battery", description: "Blank efficiency and charge limits are not stored: the response shows the labelled default a plan would use next to what you entered.", params: P, body: BatteryInput, response: { 201: BatterySchema, ...errs } } },
    async (req, reply) => {
      const b = await createBattery(db, req.user!.id, req.params.id, req.body, deps.now());
      await log(req, "battery.create", b.id, req.params.id);
      reply.code(201);
      return b;
    },
  );
  app.patch(
    "/api/properties/:id/batteries/:assetId",
    { ...auth, schema: { tags: ["assets"], summary: "Change a battery", description: "Only the fields you send change. Send null to clear an optional field.", params: PA, body: BatteryPatch, response: { 200: BatterySchema, ...errs } } },
    async (req) => {
      const b = await updateBattery(db, req.user!.id, req.params.id, req.params.assetId, req.body, deps.now());
      await log(req, "battery.update", b.id, req.params.id);
      return b;
    },
  );
  app.delete("/api/properties/:id/batteries/:assetId", { ...auth, schema: { tags: ["assets"], summary: "Delete a battery", params: PA, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await deleteBattery(db, req.user!.id, req.params.id, req.params.assetId);
    await log(req, "battery.delete", req.params.assetId, req.params.id);
    reply.code(204);
    return null;
  });

  app.get("/api/properties/:id/solar-systems", { ...auth, schema: { tags: ["assets"], summary: "Solar systems of a property", params: P, response: { 200: z.object({ solarSystems: z.array(SolarSystemSchema) }), ...errs } } }, async (req) => ({
    solarSystems: await listSolarSystems(db, req.user!.id, req.params.id),
  }));
  app.post("/api/properties/:id/solar-systems", { ...auth, schema: { tags: ["assets"], summary: "Add a solar system (installed or planned)", params: P, body: SolarInput, response: { 201: SolarSystemSchema, ...errs } } }, async (req, reply) => {
    const s = await createSolarSystem(db, req.user!.id, req.params.id, req.body);
    await log(req, "solar_system.create", s.id, req.params.id);
    reply.code(201);
    return s;
  });
  app.patch("/api/properties/:id/solar-systems/:assetId", { ...auth, schema: { tags: ["assets"], summary: "Change a solar system", params: PA, body: SolarPatch, response: { 200: SolarSystemSchema, ...errs } } }, async (req) => {
    const s = await updateSolarSystem(db, req.user!.id, req.params.id, req.params.assetId, req.body);
    await log(req, "solar_system.update", s.id, req.params.id);
    return s;
  });
  app.delete("/api/properties/:id/solar-systems/:assetId", { ...auth, schema: { tags: ["assets"], summary: "Delete a solar system", params: PA, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await deleteSolarSystem(db, req.user!.id, req.params.id, req.params.assetId);
    await log(req, "solar_system.delete", req.params.assetId, req.params.id);
    reply.code(204);
    return null;
  });

  app.get("/api/properties/:id/evs", { ...auth, schema: { tags: ["assets"], summary: "Electric vehicles of a property", params: P, response: { 200: z.object({ evs: z.array(EvSchema) }), ...errs } } }, async (req) => ({
    evs: await listEvs(db, req.user!.id, req.params.id),
  }));
  app.post("/api/properties/:id/evs", { ...auth, schema: { tags: ["assets"], summary: "Add an electric vehicle", params: P, body: EvInput, response: { 201: EvSchema, ...errs } } }, async (req, reply) => {
    const e = await createEv(db, req.user!.id, req.params.id, req.body, deps.now());
    await log(req, "ev.create", e.id, req.params.id);
    reply.code(201);
    return e;
  });
  app.patch("/api/properties/:id/evs/:assetId", { ...auth, schema: { tags: ["assets"], summary: "Change an electric vehicle", params: PA, body: EvPatch, response: { 200: EvSchema, ...errs } } }, async (req) => {
    const e = await updateEv(db, req.user!.id, req.params.id, req.params.assetId, req.body, deps.now());
    await log(req, "ev.update", e.id, req.params.id);
    return e;
  });
  app.delete("/api/properties/:id/evs/:assetId", { ...auth, schema: { tags: ["assets"], summary: "Delete an electric vehicle", params: PA, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await deleteEv(db, req.user!.id, req.params.id, req.params.assetId);
    await log(req, "ev.delete", req.params.assetId, req.params.id);
    reply.code(204);
    return null;
  });

  app.get("/api/properties/:id/appliances", { ...auth, schema: { tags: ["assets"], summary: "Appliances of a property", params: P, response: { 200: z.object({ appliances: z.array(ApplianceSchema) }), ...errs } } }, async (req) => ({
    appliances: await listAppliances(db, req.user!.id, req.params.id),
  }));
  app.post(
    "/api/properties/:id/appliances",
    { ...auth, schema: { tags: ["assets"], summary: "Add an appliance", description: "Mark critical loads CRITICAL: the optimiser preserves them. A FLEXIBLE appliance must give the window it may run in and for how long.", params: P, body: ApplianceInput, response: { 201: ApplianceSchema, ...errs } } },
    async (req, reply) => {
      const a = await createAppliance(db, req.user!.id, req.params.id, req.body);
      await log(req, "appliance.create", a.id, req.params.id);
      reply.code(201);
      return a;
    },
  );
  app.patch("/api/properties/:id/appliances/:assetId", { ...auth, schema: { tags: ["assets"], summary: "Change an appliance", params: PA, body: AppliancePatch, response: { 200: ApplianceSchema, ...errs } } }, async (req) => {
    const a = await updateAppliance(db, req.user!.id, req.params.id, req.params.assetId, req.body);
    await log(req, "appliance.update", a.id, req.params.id);
    return a;
  });
  app.delete("/api/properties/:id/appliances/:assetId", { ...auth, schema: { tags: ["assets"], summary: "Delete an appliance and its logged runs", params: PA, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await deleteAppliance(db, req.user!.id, req.params.id, req.params.assetId);
    await log(req, "appliance.delete", req.params.assetId, req.params.id);
    reply.code(204);
    return null;
  });

  app.get(
    "/api/properties/:id/appliances/:assetId/events",
    { ...auth, schema: { tags: ["assets"], summary: "Logged runs of an appliance", params: PA, querystring: z.object({ since: z.iso.datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }), response: { 200: z.object({ events: z.array(ApplianceEventSchema) }), ...errs } } },
    async (req) => ({ events: await listApplianceEvents(db, req.user!.id, req.params.id, req.params.assetId, req.query) }),
  );
  app.post(
    "/api/properties/:id/appliances/:assetId/events",
    { ...auth, schema: { tags: ["assets"], summary: "Log a run of an appliance", description: "Recorded as USER_LOGGED. Estimated and meter-derived runs are written only by engines.", params: PA, body: EventInput, response: { 201: ApplianceEventSchema, ...errs } } },
    async (req, reply) => {
      const e = await logApplianceEvent(db, req.user!.id, req.params.id, req.params.assetId, req.body);
      await log(req, "appliance_event.create", e.id, req.params.id);
      reply.code(201);
      return e;
    },
  );
  app.delete("/api/properties/:id/appliances/:assetId/events/:eventId", { ...auth, schema: { tags: ["assets"], summary: "Delete a logged run", params: PAE, response: { 204: z.null(), ...errs } } }, async (req, reply) => {
    await deleteApplianceEvent(db, req.user!.id, req.params.id, req.params.assetId, req.params.eventId);
    reply.code(204);
    return null;
  });

  app.get(
    "/api/properties/:id/assets",
    { ...auth, schema: { tags: ["assets"], summary: "A summary of everything entered for a property", description: "The profiles the Energy Twin records: battery, solar, EV and appliances. A kind with nothing entered is UNAVAILABLE with what to do about it.", params: P, response: { 200: AssetProfilesSchema, ...errs } } },
    async (req) => {
      await ownProperty(db, req.user!.id, req.params.id);
      const now = deps.now();
      return profilesFromSnapshot(await summariseAssets(db, req.params.id, now), now);
    },
  );

  app.get(
    "/api/properties/:id/appliance-estimates",
    { ...auth, schema: { tags: ["assets"], summary: "Estimated energy per appliance (NILM)", description: "Estimates carry their uncertainty and confidence, never an exact figure. Today no estimation engine is installed, so the answer is UNAVAILABLE with the reason.", params: P, response: { 200: NilmEstimateSchema, ...errs } } },
    async (req) => {
      await ownProperty(db, req.user!.id, req.params.id);
      const [applianceCount, finest] = await Promise.all([db.appliance.count({ where: { propertyId: req.params.id } }), finestInterval(db, req.params.id)]);
      return nilm.estimate({ propertyId: req.params.id, finestIntervalMinutes: finest, applianceCount });
    },
  );
};
