import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { ownProperty } from "../assets/service.js";
import { audit } from "../audit.js";
import { requireUser } from "../auth/hooks.js";
import { SUGGESTIONS } from "../copilot/intents.js";
import { ask } from "../copilot/service.js";
import { TOOL_CATALOG, TOOL_NAMES, callTool } from "../copilot/tools.js";
import { ErrorResponse } from "../schemas.js";

const P = z.object({ id: z.uuid() });
const errs = { 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse };

const ToolResultSchema = z.object({
  id: z.uuid(),
  tool: z.enum(TOOL_NAMES),
  input: z.unknown(),
  output: z.unknown(),
  status: z.enum(["OK", "UNAVAILABLE"]),
  unavailableReason: z.string().nullable(),
  dataStatus: z.string().nullable(),
  calledAt: z.string(),
});

const AnswerSchema = z
  .object({
    question: z.string(),
    intent: z.string().nullable(),
    status: z.enum(["ANSWERED", "UNAVAILABLE", "NOT_UNDERSTOOD"]),
    paragraphs: z.array(z.string()),
    citations: z.array(z.object({ marker: z.number(), toolResultId: z.uuid(), tool: z.string() })),
    toolResults: z.array(ToolResultSchema),
    generatedBy: z.enum(["TEMPLATES", "LANGUAGE_MODEL"]),
    notes: z.array(z.string()),
    suggestions: z.array(z.string()),
  })
  .meta({ id: "CopilotAnswer" });

export const copilotRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const fdeps = { db: deps.db, providers: deps.providers, engine: deps.engine, now: deps.now, policy: { navicEnabled: deps.config.NAVIC_RECEIVER_ENABLED } };
  const auth = { preHandler: requireUser };

  app.get(
    "/api/copilot/tools",
    {
      schema: {
        tags: ["copilot"],
        summary: "What the Copilot can look at, and the questions it can answer",
        description: "The backend tools the Copilot answers from (it can use nothing else), which of them store something, and example questions. Whether a language model words the answers depends on the server's configuration.",
        response: { 200: z.object({ tools: z.array(z.object({ name: z.enum(TOOL_NAMES), description: z.string(), writes: z.boolean() })), questions: z.array(z.string()), languageModel: z.boolean() }), 429: ErrorResponse },
      },
    },
    async () => ({ tools: TOOL_CATALOG, questions: SUGGESTIONS, languageModel: deps.llm != null }),
  );

  app.post(
    "/api/properties/:id/copilot/ask",
    {
      ...auth,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["copilot"],
        summary: "Ask about this property",
        description:
          "The question is routed to backend tools by fixed patterns, the tools run, and the answer is worded from what they returned, with each figure marked with the result it came from; the full results are returned so the supporting data can be inspected. A question it cannot answer is not guessed at. Making a plan or running a what-if is done only when the question asks for it. Nothing here comes from a language model unless the server has one configured, and its wording is checked against the tool results before it is used.",
        params: P,
        body: z.object({ question: z.string().trim().min(1).max(300) }),
        response: { 200: AnswerSchema, 422: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse, ...errs },
      },
    },
    async (req) => {
      await ownProperty(deps.db, req.user!.id, req.params.id);
      const a = await ask({ deps: fdeps, userId: req.user!.id, propertyId: req.params.id, requestId: req.id }, req.body.question, deps.llm ?? null);
      // the question itself is not kept: only which kind it was and which tools answered it
      await audit(deps.db, { userId: req.user!.id, action: "copilot.ask", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { intent: a.intent, status: a.status, tools: a.toolResults.map((t) => t.tool), generatedBy: a.generatedBy } });
      return a;
    },
  );

  app.post(
    "/api/properties/:id/copilot/tools/:tool",
    {
      ...auth,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        tags: ["copilot"],
        summary: "Call one tool directly and inspect what it returns",
        description: "The same tools the Copilot uses, with their raw results. Tools that store something (a plan, a what-if) store it, as they do from their own pages.",
        params: z.object({ id: z.uuid(), tool: z.enum(TOOL_NAMES) }),
        body: z.record(z.string(), z.unknown()).default({}),
        response: { 200: ToolResultSchema, 422: ErrorResponse, 429: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse, ...errs },
      },
    },
    async (req) => {
      await ownProperty(deps.db, req.user!.id, req.params.id);
      const r = await callTool({ deps: fdeps, userId: req.user!.id, propertyId: req.params.id, requestId: req.id }, req.params.tool, req.body);
      await audit(deps.db, { userId: req.user!.id, action: "copilot.tool", entityType: "property", entityId: req.params.id, requestId: req.id, ip: req.ip, detail: { tool: r.tool, status: r.status } });
      return r;
    },
  );
};
