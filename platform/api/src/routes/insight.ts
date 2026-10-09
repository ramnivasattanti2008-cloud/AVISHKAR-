import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { HealthSchema, WasteSchema } from "../insight/schemas.js";
import { energyHealth, energyWaste } from "../insight/service.js";
import { ErrorResponse } from "../schemas.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 429: ErrorResponse };
const params = z.object({ id: z.uuid() });

export const insightRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.get(
    "/api/properties/:id/health",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["plan"],
        summary: "Energy health: efficiency, solar utilisation, peak management, storage utilisation, resilience, grid dependence and flexibility",
        description:
          "Each metric is a ratio that means what its formula says, worked out from the latest stored plan's hour-by-hour flows (SIMULATED: a plan is a simulation of a day). A metric that does not exist for the property (no solar, no battery) is UNAVAILABLE with the reason. There is no overall score: it would need invented weights.",
        params,
        response: { 200: HealthSchema, ...errs },
      },
    },
    async (req) => energyHealth(fdeps, req.user!.id, req.params.id, { requestId: req.id }),
  );

  app.get(
    "/api/properties/:id/waste",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["plan"],
        summary: "Energy waste: solar thrown away, surplus sold, energy sold then bought back dearer, energy bought in the dearest hours, and the avoidable cost",
        description:
          "Read from the latest stored plan; recomputes nothing. A finding that the data cannot support (the appliance schedule, the battery's lost opportunity) is UNAVAILABLE with the reason. The avoidable cost per day is the plan's saving over no control; the average month's figure appears only when a what-if run has worked out a year.",
        params,
        response: { 200: WasteSchema, ...errs },
      },
    },
    async (req) => energyWaste(fdeps, req.user!.id, req.params.id),
  );
};
