import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { demoWorld, loadDemoWorld, removeDemoWorld } from "../demo/service.js";
import { ErrorResponse } from "../schemas.js";

const DemoWorldSchema = z
  .object({
    label: z.literal("DEMO DATA"),
    loaded: z.boolean().describe("True when all four demo properties are in your account."),
    sites: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        city: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        story: z.string(),
        propertyId: z.uuid().nullable().describe("The demo property in your account, or null when it is not loaded."),
        tariff: z.string().nullable(),
      }),
    ),
    notes: z.array(z.string()),
  })
  .meta({ id: "DemoWorld" });

const errs = { 400: ErrorResponse, 401: ErrorResponse, 429: ErrorResponse };

export const demoRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const auth = { preHandler: requireUser };
  const tags = ["demo"];

  app.get(
    "/api/demo/world",
    { ...auth, schema: { tags, summary: "The demo world: four invented properties, and whether they are in your account", response: { 200: DemoWorldSchema, ...errs } } },
    async (req) => demoWorld(deps.db, req.user!.id),
  );

  app.post(
    "/api/demo/world",
    {
      ...auth,
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Add the demo properties to your account (labelled DEMO DATA; loading twice changes nothing)",
        description:
          "Bengaluru, Pune, Jaipur and Mathura: invented readings (hourly, 120 days, generated deterministically), invented equipment, and the sourced catalogue tariff where one exists. Every value computed from them is labelled DEMO and they are never added up with your own properties.",
        response: { 200: z.object({ created: z.number().int(), world: DemoWorldSchema }), ...errs },
      },
    },
    async (req) => {
      const r = await loadDemoWorld(deps.db, req.user!.id, deps.now());
      await audit(deps.db, { userId: req.user!.id, action: "demo.load", requestId: req.id, ip: req.ip, detail: { created: r.created } });
      return r;
    },
  );

  app.delete(
    "/api/demo/world",
    {
      ...auth,
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      schema: { tags, summary: "Remove the demo properties and everything computed from them", response: { 200: z.object({ removed: z.number().int() }), ...errs } },
    },
    async (req) => {
      const removed = await removeDemoWorld(deps.db, req.user!.id);
      await audit(deps.db, { userId: req.user!.id, action: "demo.remove", requestId: req.id, ip: req.ip, detail: { removed } });
      return { removed };
    },
  );
};
