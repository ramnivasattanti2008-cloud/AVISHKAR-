import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { EligibilityInput, EligibilityResponseSchema, PolicyRuleListSchema } from "../policy/schemas.js";
import { evaluateEligibility, listPolicyRules } from "../policy/service.js";
import { ErrorResponse } from "../schemas.js";

export const policyRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;

  app.get(
    "/api/policy-rules",
    {
      schema: {
        tags: ["policy"],
        summary: "The policy rules on file, with their sources",
        description: "Every rule the eligibility calculator can apply, as configuration: where it was read, when it was last checked and from when to when it applies.",
        querystring: z.object({ program: z.string().trim().min(1).max(60).optional(), region: z.string().trim().min(2).max(4).optional() }),
        response: { 200: PolicyRuleListSchema, 400: ErrorResponse },
      },
    },
    async (req) => ({ rules: await listPolicyRules(db, req.query) }),
  );

  app.post(
    "/api/eligibility",
    {
      schema: {
        tags: ["policy"],
        summary: "Apply the published subsidy and net-metering rules to a system size",
        description:
          "Never confirms eligibility (eligibilityConfirmed is always false): it applies a sourced rule to the numbers given and returns the rule, its source and its caveats. Where no sourced rule is on file it says so and returns no amount.",
        body: EligibilityInput,
        response: { 200: EligibilityResponseSchema, 400: ErrorResponse },
      },
    },
    async (req) => evaluateEligibility(db, req.body, deps.now()),
  );
};
