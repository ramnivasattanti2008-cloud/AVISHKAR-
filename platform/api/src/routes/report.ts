import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { buildReport } from "../report/service.js";
import { ErrorResponse } from "../schemas.js";

export const reportRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.get(
    "/api/properties/:id/report",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["properties"],
        summary: "Download a report of everything held for the property (Markdown)",
        description:
          "The tariff, the readings and their fingerprint, the equipment, the latest plan, the latest what-if and how the forecasts have done, each figure with its data label, and where something is missing, why. Assembled from what is stored: nothing is recomputed and no engine call is made.",
        params: z.object({ id: z.uuid() }),
        response: { 200: z.string(), 401: ErrorResponse, 404: ErrorResponse, 429: ErrorResponse },
      },
    },
    async (req, reply) => {
      const r = await buildReport(fdeps, req.user!.id, req.params.id);
      await audit(deps.db, { userId: req.user!.id, action: "report.export", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip });
      reply.header("content-type", "text/markdown; charset=utf-8").header("content-disposition", `attachment; filename="${r.filename}"`);
      return r.markdown;
    },
  );
};
