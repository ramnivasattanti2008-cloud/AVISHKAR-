import { z } from "zod";
import { measured } from "../schemas.js";

export const ROBUSTNESS_KEYS = ["lowSun", "highDemand", "both", "moreSun"] as const;

const Outcome = z.object({
  netCostInr: z.number(),
  importKwh: z.number(),
  exportKwh: z.number(),
  vsExpectedInr: z.number().describe("This day's cost less the cost of the day the plan was made for. Positive is dearer."),
});

const Scenario = z.object({
  key: z.enum(ROBUSTNESS_KEYS),
  label: z.string(),
  built: z.string().describe("What the day is built from, in words."),
  state: z.enum(["RUN", "UNAVAILABLE"]),
  reason: z.string().nullable(),
  result: Outcome.nullable(),
});

export const RobustnessSchema = z
  .object({
    label: z.literal("IF THE DAY TURNS OUT DIFFERENTLY"),
    propertyId: z.uuid(),
    madeAt: z.string(),
    basedOn: z.object({ planId: z.uuid(), madeAt: z.string(), stale: z.boolean(), note: z.string() }).nullable(),
    scenarios: z.array(Scenario),
    result: measured(
      z.object({
        expected: Outcome.describe("The plan replayed against the day it was made for, by the same method as the others, so that the four can be compared. It reconstructs the battery's efficiency and wear from the plan's own totals, so it lands near the plan's own bill rather than exactly on it."),
        scenarios: z.array(Scenario),
        worst: z.object({ key: z.enum(ROBUSTNESS_KEYS), label: z.string(), netCostInr: z.number(), vsExpectedInr: z.number() }).nullable(),
        statement: z.string().describe("What the replay found, in a sentence. Never a probability."),
        whyNothingFails: z.string().describe("Why no scenario here can be infeasible: the plan's battery moves are followed whatever the day, and the grid makes up the difference. What changes is the bill."),
      }),
    ),
    next: z.array(z.object({ label: z.string(), href: z.string(), why: z.string() })),
  })
  .meta({ id: "PlanRobustness" });
export type RobustnessDto = z.infer<typeof RobustnessSchema>;
