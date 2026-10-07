import { z } from "zod";
import { STATE_CODES } from "../tariff/schemas.js";
import { measured } from "../schemas.js";

export const ELIGIBILITY_CONSUMERS = ["RESIDENTIAL", "GROUP_HOUSING_OR_RWA", "COMMERCIAL", "INDUSTRIAL", "AGRICULTURAL", "OTHER"] as const;

export const EligibilityInput = z.object({
  consumerType: z.enum(ELIGIBILITY_CONSUMERS),
  systemKwp: z.number().positive().max(10_000).describe("Size of the solar system in kWp (DC)."),
  state: z.enum(STATE_CODES).optional().describe("Used to pick state rules; national rules apply without it."),
  asOf: z.iso.date().optional().describe("Evaluate the rules in force on this day (default today)."),
});
export type EligibilityInput = z.infer<typeof EligibilityInput>;

export const PolicyRuleViewSchema = z
  .object({
    program: z.string(),
    ruleKey: z.string(),
    region: z.string(),
    appliesTo: z.string(),
    statedAs: z.string().nullable().describe("The rule in the words of its source."),
    source: z.string(),
    sourceUrl: z.string().nullable(),
    verifiedAt: z.string().nullable().describe("When someone last read the rule at its source."),
    effectiveFrom: z.string().nullable(),
    effectiveTo: z.string().nullable(),
    conditions: z.array(z.string()),
    notes: z.array(z.string()),
  })
  .meta({ id: "PolicyRule" });

export const PolicyRuleListSchema = z.object({ rules: z.array(PolicyRuleViewSchema) });

export const ProgramResultSchema = z
  .object({
    program: z.string(),
    name: z.string(),
    outcome: z
      .enum(["RULE_APPLIES", "NOT_COVERED", "NO_SOURCED_RULE", "RULE_ON_FILE_NOT_EVALUATED"])
      .describe(
        "RULE_APPLIES: a sourced rule was applied to the size you gave. NOT_COVERED: the rule on file is for other consumers. NO_SOURCED_RULE: nothing sourced is loaded, so nothing is claimed. RULE_ON_FILE_NOT_EVALUATED: a rule is on file but cannot be turned into a number from what it states.",
      ),
    subsidy: measured(z.number()),
    breakdown: z.array(z.object({ fromKw: z.number(), toKw: z.number(), kw: z.number(), inrPerKw: z.number(), amountInr: z.number() })),
    rules: z.array(PolicyRuleViewSchema),
    caveats: z.array(z.string()),
  })
  .meta({ id: "ProgramResult" });

export const EligibilityResponseSchema = z.object({
  asOf: z.string(),
  consumerType: z.enum(ELIGIBILITY_CONSUMERS),
  systemKwp: z.number(),
  eligibilityConfirmed: z.literal(false).describe("Always false: this applies a published rule to the numbers given; it never confirms that anyone qualifies."),
  programs: z.array(ProgramResultSchema),
  netMetering: ProgramResultSchema,
  notice: z.string(),
});
