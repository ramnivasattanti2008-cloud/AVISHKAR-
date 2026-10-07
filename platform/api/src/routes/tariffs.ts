import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { getProperty } from "../properties/service.js";
import { ErrorResponse, PropertySchema } from "../schemas.js";
import { BillInputSchema, BillSchema, CONSUMER_TYPES, STATE_CODES, TariffInput, TariffListSchema, TariffPlanSchema } from "../tariff/schemas.js";
import { billFor, createTariff, deleteTariff, getTariff, listTariffs, selectPropertyTariff } from "../tariff/service.js";

const Id = z.object({ id: z.uuid() });
const Filter = z.object({
  state: z.enum(STATE_CODES).optional(),
  discom: z.string().trim().min(1).max(120).optional(),
  consumerType: z.enum(CONSUMER_TYPES).optional(),
  scope: z.enum(["all", "curated", "mine"]).optional().describe("curated: shared plans from regulator orders; mine: plans you entered; all: both (default)."),
});
const Select = z.object({ tariffPlanId: z.uuid() });

export const tariffRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db, config } = deps;
  const policy = { navicEnabled: config.NAVIC_RECEIVER_ENABLED };
  const auth = { preHandler: requireUser };
  const errs = { 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse };

  app.get(
    "/api/tariffs",
    {
      schema: {
        tags: ["tariffs"],
        summary: "Tariff plans you can choose from",
        description:
          "Curated plans come from regulator orders recorded with their source text and validity period; a plan whose period has ended is flagged EXPIRED rather than hidden. Plans you entered yourself are included when you are signed in.",
        querystring: Filter,
        response: { 200: TariffListSchema, 400: ErrorResponse },
      },
    },
    async (req) => ({ tariffs: await listTariffs(db, req.user?.id ?? null, req.query, deps.now()) }),
  );

  app.get(
    "/api/tariffs/:id",
    { schema: { tags: ["tariffs"], summary: "One tariff plan", params: Id, response: { 200: TariffPlanSchema, 400: ErrorResponse, 404: ErrorResponse } } },
    async (req) => getTariff(db, req.user?.id ?? null, req.params.id, deps.now()),
  );

  app.post(
    "/api/tariffs",
    {
      ...auth,
      schema: {
        tags: ["tariffs"],
        summary: "Enter your own tariff",
        description: "For a tariff that is not in the catalogue, or to correct one against your bill. Only you can see it. Give time-of-day blocks (a flat tariff is one block from 0 to 24) or slabs.",
        body: TariffInput,
        response: { 201: TariffPlanSchema, ...errs },
      },
    },
    async (req, reply) => {
      const plan = await createTariff(db, req.user!.id, req.body, deps.now());
      await audit(db, { userId: req.user!.id, action: "tariff.create", entityType: "tariff_plan", entityId: plan.id, requestId: req.id, ip: req.ip });
      reply.code(201);
      return plan;
    },
  );

  app.delete(
    "/api/tariffs/:id",
    { ...auth, schema: { tags: ["tariffs"], summary: "Delete a tariff you entered", params: Id, response: { 204: z.null(), ...errs } } },
    async (req, reply) => {
      await deleteTariff(db, req.user!.id, req.params.id);
      await audit(db, { userId: req.user!.id, action: "tariff.delete", entityType: "tariff_plan", entityId: req.params.id, requestId: req.id, ip: req.ip });
      reply.code(204);
      return null;
    },
  );

  app.post(
    "/api/tariffs/:id/bill",
    {
      schema: {
        tags: ["tariffs"],
        summary: "Estimate a monthly bill under a tariff",
        description:
          "ESTIMATED: the rates are the plan's, the consumption is what you give. Slabs are applied telescopically; time-of-day rates are weighted by the hourly shape you give (an even spread when you give none, and the response says so). Taxes and duties are not included.",
        params: Id,
        body: BillInputSchema,
        response: { 200: BillSchema, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      const plan = await getTariff(db, req.user?.id ?? null, req.params.id, deps.now());
      const r = billFor(plan, req.body, deps.now());
      return {
        tariffId: r.tariffId,
        total: r.total,
        energyCharge: r.energyCharge,
        fixedCharge: r.fixedCharge,
        effectiveRateInrPerKwh: r.bill.effectiveRate,
        lines: r.bill.lines,
        assumptions: r.assumptions,
        validity: r.validity,
      };
    },
  );

  app.put(
    "/api/properties/:id/tariff",
    { ...auth, schema: { tags: ["tariffs", "properties"], summary: "Choose the tariff for a property", description: "Run the property analysis again afterwards: the Energy Twin records the tariff that was chosen when it was built.", params: Id, body: Select, response: { 200: PropertySchema, ...errs } } },
    async (req) => {
      await selectPropertyTariff(db, req.user!.id, req.params.id, req.body.tariffPlanId);
      await audit(db, { userId: req.user!.id, action: "property.tariff.select", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { tariffPlanId: req.body.tariffPlanId } });
      return getProperty(db, req.user!.id, req.params.id, policy);
    },
  );

  app.delete(
    "/api/properties/:id/tariff",
    { ...auth, schema: { tags: ["tariffs", "properties"], summary: "Clear the tariff of a property", params: Id, response: { 200: PropertySchema, ...errs } } },
    async (req) => {
      await selectPropertyTariff(db, req.user!.id, req.params.id, null);
      await audit(db, { userId: req.user!.id, action: "property.tariff.clear", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip });
      return getProperty(db, req.user!.id, req.params.id, policy);
    },
  );
};
