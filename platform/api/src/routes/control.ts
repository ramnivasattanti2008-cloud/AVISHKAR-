import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { requireUser } from "../auth/hooks.js";
import { NoDeviceExecutor } from "../control/executor.js";
import { ControlSchema, ControlSettingsInput } from "../control/schemas.js";
import { decide, getControl, proposeFromLatestPlan, setControl } from "../control/service.js";
import { ErrorResponse } from "../schemas.js";

const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse };

export const controlRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const cdeps = { db: deps.db, executor: deps.executor ?? new NoDeviceExecutor(), now: deps.now };
  const tags = ["control"];
  const params = z.object({ id: z.uuid() });

  app.get(
    "/api/properties/:id/control",
    {
      preHandler: requireUser,
      schema: {
        tags,
        summary: "How much AVISHKAR may do for this property, its safety limits and the moves waiting for a decision",
        description: "Observe, Recommend, Approve or Automate. No device is connected, so no mode changes anything outside the platform; Automate cannot be chosen until one is.",
        params,
        response: { 200: ControlSchema, ...errs },
      },
    },
    async (req) => getControl(cdeps, req.user!.id, req.params.id),
  );

  app.put(
    "/api/properties/:id/control",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: { tags, summary: "Choose the mode and the safety limits", params, body: ControlSettingsInput, response: { 200: ControlSchema, ...errs } },
    },
    async (req) => setControl(cdeps, req.user!.id, req.params.id, req.body, { requestId: req.id, ip: req.ip }),
  );

  app.post(
    "/api/properties/:id/control/proposals",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Turn the latest plan's moves into proposals, each put through your safety limits",
        description: "Moves already proposed are not proposed twice. A move that breaks a limit you set is recorded as BLOCKED, with the reason, and cannot be approved.",
        params,
        response: { 200: z.object({ created: z.number().int(), skipped: z.number().int(), control: ControlSchema }), ...errs },
      },
    },
    async (req) => proposeFromLatestPlan(cdeps, req.user!.id, req.params.id, { requestId: req.id, ip: req.ip }),
  );

  app.post(
    "/api/properties/:id/control/proposals/:proposalId/:action",
    {
      preHandler: requireUser,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags,
        summary: "Approve, reject, withdraw or roll back one proposed move",
        description: "Approving needs the Approve mode and a move that passed its safety checks. Withdraw is for an approved move that has not started; rollback undoes an applied move through the device, or records that nothing had been applied.",
        params: z.object({ id: z.uuid(), proposalId: z.uuid(), action: z.enum(["approve", "reject", "withdraw", "rollback"]) }),
        body: z.object({ note: z.string().trim().max(300).optional() }).default({}),
        response: { 200: ControlSchema, ...errs },
      },
    },
    async (req) => decide(cdeps, req.user!.id, req.params.id, req.params.proposalId, req.params.action, req.body.note, { requestId: req.id, ip: req.ip }),
  );
};
