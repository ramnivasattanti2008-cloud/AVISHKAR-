import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { CloudFrontRequest, CloudFrontSchema } from "../cloudfront/schemas.js";
import { runCloudFront } from "../cloudfront/service.js";
import { ErrorResponse } from "../schemas.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 422: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse };

export const cloudFrontRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };

  app.post(
    "/api/properties/:id/cloud-front",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["scenarios"],
        summary: "What a cloud front crossing the sky would do to the next 24 hours, with and without AVISHKAR",
        description:
          "CLOUD FRONT SCENARIO. The front is one you set (when it arrives, how much sun it takes, how long it lasts): AVISHKAR has no cloud-nowcast source, so a front is never observed. The same day is planned twice by the planner, on the forecast sky and on the sky with the front. The answer says what the plan does differently, and the grid energy and cost with and without AVISHKAR. Nothing is stored.",
        params: z.object({ id: z.uuid() }),
        body: CloudFrontRequest,
        response: { 200: CloudFrontSchema, ...errs },
      },
    },
    async (req) => {
      const r = await runCloudFront(fdeps, req.user!.id, req.params.id, req.body, { requestId: req.id });
      await audit(deps.db, { userId: req.user!.id, action: "cloud-front.run", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { ...r.request } });
      return r;
    },
  );
};
