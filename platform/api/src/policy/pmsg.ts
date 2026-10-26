/**
 * PM Surya Ghar subsidy arithmetic (spec section 24). The rates are not here: they are a `policy_rules` row read from
 * configuration (data/policy/pm_surya_ghar.json), so a change of the scheme is a data change with a source and a date.
 */
import { z } from "zod";

export const ResidentialCfaRule = z.object({
  tiers: z.array(z.object({ upToKw: z.number().positive(), inrPerKw: z.number().nonnegative() })).min(1),
  capInr: z.number().positive(),
});
export type ResidentialCfaRule = z.infer<typeof ResidentialCfaRule>;

export interface SubsidyStep {
  fromKw: number;
  toKw: number;
  kw: number;
  inrPerKw: number;
  amountInr: number;
}

export interface Subsidy {
  subsidyInr: number;
  steps: SubsidyStep[];
  /** True when the uncapped total exceeded the cap and the cap was applied. */
  capApplied: boolean;
  uncappedInr: number;
}

/** Subsidy for a residential system of `systemKwp`: each tier pays its rate for the kW inside it, up to the cap. */
export function residentialSubsidy(rule: ResidentialCfaRule, systemKwp: number): Subsidy {
  if (!Number.isFinite(systemKwp) || systemKwp <= 0) return { subsidyInr: 0, steps: [], capApplied: false, uncappedInr: 0 };
  const tiers = [...rule.tiers].sort((a, b) => a.upToKw - b.upToKw);
  const steps: SubsidyStep[] = [];
  let lower = 0;
  for (const t of tiers) {
    const kw = Math.max(Math.min(systemKwp, t.upToKw) - lower, 0);
    if (kw > 0) steps.push({ fromKw: lower, toKw: Math.min(systemKwp, t.upToKw), kw, inrPerKw: t.inrPerKw, amountInr: kw * t.inrPerKw });
    lower = t.upToKw;
  }
  const uncapped = steps.reduce((s, x) => s + x.amountInr, 0);
  return { subsidyInr: Math.min(uncapped, rule.capInr), steps, capApplied: uncapped > rule.capInr, uncappedInr: uncapped };
}
