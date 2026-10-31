import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { AppDeps } from "../app.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { ErrorResponse } from "../schemas.js";
import { AllocateRequest, AllocateSchema } from "../community/schemas.js";
import { allocateCommunity } from "../community/service.js";
import { communityView } from "../vpp/community.js";
import { CommunitySchema, VppSchema } from "../vpp/schemas.js";
import { VppRequest, simulateVpp } from "../vpp/service.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 422: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse };

export const communityRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };
  const auth = { preHandler: requireUser };

  app.get(
    "/api/community",
    {
      ...auth,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["community"],
        summary: "Your properties together: surplus, deficit, storage and shiftable load on a typical day",
        description:
          "COMMUNITY ENERGY SIMULATION over the properties your account owns, for a typical day of this month: each one's own pattern and solar, where it has a surplus or a deficit, and how much of one's surplus could meet another's deficit in the same hour. It makes no claim that electricity may be shared or sold between properties. Only your own properties appear.",
        response: { 200: CommunitySchema, ...errs },
      },
    },
    async (req) => communityView(fdeps, req.user!.id, { requestId: req.id }),
  );

  app.post(
    "/api/community/allocate",
    {
      ...auth,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["community"],
        summary: "Allocate one interval's surplus between properties, and say what stopped it",
        description:
          "Works out, for a single interval, which property's surplus can meet which other's deficit: own generation first, then own battery, then the shared node divided by the rule you choose, then the grid. Transfer limits, the feeder limit and line and network losses are all applied and reported, and each property says which cap bound it and why. Supply `members` to allocate between figures you give (pure arithmetic, nothing measured), or `propertyIds` to allocate between your own properties at one hour of a typical day, built from their entered systems and imported readings, with `overrides` for asking what if. Energy is conserved and the response carries the check that proves it. AVISHKAR does not move electricity and makes no claim that sharing between these properties is permitted.",
        body: AllocateRequest,
        response: { 200: AllocateSchema, ...errs },
      },
    },
    async (req) => allocateCommunity(fdeps, req.user!.id, req.body, { requestId: req.id }),
  );

  app.post(
    "/api/vpp/simulate",
    {
      ...auth,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["community"],
        summary: "Simulate a virtual power plant of 10, 100, 1,000 or 10,000 homes",
        description:
          "A separate, synthetic mode: the homes are drawn from shares and sizes you choose (the defaults are assumptions, not data), each a variation of one of your properties' own daily pattern, with solar from the sun at its place. The fleet is dispatched by the planner as one aggregate battery, shiftable demand and vehicle charging, and the response compares the evening peak, the use of solar and the bill with and without that coordination. Always SIMULATED; the same seed describes the same homes.",
        body: VppRequest,
        response: { 200: VppSchema, ...errs },
      },
    },
    async (req) => {
      const r = await simulateVpp(fdeps, req.user!.id, req.body, { requestId: req.id });
      await audit(deps.db, { userId: req.user!.id, action: "vpp.simulate", entityType: "property", entityId: req.body.archetypePropertyId, requestId: req.id, ip: req.ip, detail: { homes: req.body.homes, seed: req.body.seed } });
      return r;
    },
  );
};
