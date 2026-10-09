import type { OptimiseResponse } from "../engine/schemas.js";
import { AppError } from "../errors.js";

/**
 * A planner answer that can be shown: the solver found an optimal plan and the planner's own independent check passed it. Anything
 * else is an error and nothing from it is shown (spec sections 64 and 67).
 */
export function usable(out: OptimiseResponse, what: string): NonNullable<OptimiseResponse["schedule"]> & { totals: NonNullable<OptimiseResponse["totals"]>; baseline: NonNullable<OptimiseResponse["baseline"]> } {
  if (out.solver.status !== "optimal" || !out.schedule || !out.totals || !out.baseline) {
    throw new AppError("PLAN_INVALID", `The planner found no usable plan for ${what} (${out.solver.status}): ${out.solver.message}`, { solver: out.solver });
  }
  if (!out.validation.valid) {
    throw new AppError("PLAN_INVALID", `SIMULATION INVALID: the plan for ${what} failed the planner's independent check, so nothing is shown.`, { problems: out.validation.problems.slice(0, 10) });
  }
  return { ...out.schedule, totals: out.totals, baseline: out.baseline };
}
