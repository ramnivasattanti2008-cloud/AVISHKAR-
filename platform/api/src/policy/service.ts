import type { Db } from "../db.js";
import type { PolicyRule as PolicyRow, Prisma } from "../generated/prisma/client.js";
import { type Measured, estimated, unavailable } from "../provenance/index.js";
import { type SubsidyStep, ResidentialCfaRule, residentialSubsidy } from "./pmsg.js";
import type { EligibilityInput } from "./schemas.js";

export interface PolicyRuleView {
  program: string;
  ruleKey: string;
  region: string;
  appliesTo: string;
  statedAs: string | null;
  source: string;
  sourceUrl: string | null;
  verifiedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  conditions: string[];
  notes: string[];
}

export interface ProgramResult {
  program: string;
  name: string;
  outcome: "RULE_APPLIES" | "NOT_COVERED" | "NO_SOURCED_RULE" | "RULE_ON_FILE_NOT_EVALUATED";
  subsidy: Measured<number>;
  breakdown: SubsidyStep[];
  rules: PolicyRuleView[];
  caveats: string[];
}

export interface EligibilityResult {
  asOf: string;
  consumerType: EligibilityInput["consumerType"];
  systemKwp: number;
  eligibilityConfirmed: false;
  programs: ProgramResult[];
  netMetering: ProgramResult;
  notice: string;
}

const PROVIDER = "avishkar-policy-engine";
const STALE_AFTER_DAYS = 180;
const NOTICE =
  "AVISHKAR applies published rules to the numbers you give. Whether you qualify is decided by your distribution company and the national portal, and rules change: check the source linked on each rule before you act on an amount.";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const strings = (v: Prisma.JsonValue): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function toRuleView(r: PolicyRow): PolicyRuleView {
  const rule = (r.rule ?? {}) as { conditions?: Prisma.JsonValue };
  return {
    program: r.program,
    ruleKey: r.ruleKey,
    region: r.region,
    appliesTo: r.appliesTo,
    statedAs: r.statedAs,
    source: r.source,
    sourceUrl: r.sourceUrl,
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
    effectiveFrom: day(r.effectiveFrom),
    effectiveTo: day(r.effectiveTo),
    conditions: strings(rule.conditions ?? []),
    notes: strings(r.notes),
  };
}

export async function listPolicyRules(db: Db, filter: { program?: string; region?: string }): Promise<PolicyRuleView[]> {
  const rows = await db.policyRule.findMany({
    where: { ...(filter.program ? { program: filter.program } : {}), ...(filter.region ? { region: filter.region } : {}) },
    orderBy: [{ program: "asc" }, { region: "asc" }, { ruleKey: "asc" }],
    take: 200,
  });
  return rows.map(toRuleView);
}

/** Rules of a programme for the given regions that are in force on `on`; a rule with no dates is treated as in force. */
export async function activeRules(db: Db, program: string, regions: string[], on: Date): Promise<PolicyRow[]> {
  const today = new Date(`${on.toISOString().slice(0, 10)}T00:00:00Z`);
  return db.policyRule.findMany({
    where: {
      program,
      region: { in: regions },
      AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] }, { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }],
    },
    orderBy: [{ region: "desc" }, { ruleKey: "asc" }], // a state rule sorts before the national one
  });
}

function staleNote(rule: PolicyRow, now: Date): string | null {
  if (!rule.verifiedAt) return "No one has recorded when this rule was last checked at its source.";
  const age = Math.floor((now.getTime() - rule.verifiedAt.getTime()) / 86_400_000);
  return age > STALE_AFTER_DAYS ? `This rule was last checked at its source ${age} days ago; rules change, so check it again.` : null;
}

function none(reason: string, program: string, name: string, outcome: ProgramResult["outcome"], rules: PolicyRuleView[], now: Date, caveats: string[] = []): ProgramResult {
  return {
    program,
    name,
    outcome,
    subsidy: unavailable<number>(reason, { provider: PROVIDER, source: "policy_rules table", dataType: `${program.toLowerCase()}_subsidy`, unit: "INR", now }),
    breakdown: [],
    rules,
    caveats,
  };
}

/**
 * Apply the rules on file to a system size (spec sections 23, 24). It states what a published rule says and never that
 * anyone is eligible: `eligibilityConfirmed` is always false. Where nothing sourced is loaded it says so and gives no number.
 */
export async function evaluateEligibility(db: Db, input: EligibilityInput, now: Date): Promise<EligibilityResult> {
  const on = input.asOf ? new Date(`${input.asOf}T12:00:00Z`) : now;
  const regions = ["IN", ...(input.state ? [input.state] : [])];
  const NAME = "PM Surya Ghar: Muft Bijli Yojana (central financial assistance)";

  const pmsgRows = await activeRules(db, "PM_SURYA_GHAR", regions, on);
  const views = pmsgRows.map(toRuleView);
  let pmsg: ProgramResult;

  if (input.consumerType === "RESIDENTIAL") {
    const row = pmsgRows.find((r) => r.appliesTo === "RESIDENTIAL");
    const rule = row ? ResidentialCfaRule.safeParse(row.rule) : null;
    if (!row) {
      pmsg = none("No sourced PM Surya Ghar rule for residential households is loaded, so no amount is stated.", "PM_SURYA_GHAR", NAME, "NO_SOURCED_RULE", views, now);
    } else if (!rule?.success) {
      pmsg = none("The stored rule is not in the shape this calculator reads, so no amount is stated.", "PM_SURYA_GHAR", NAME, "RULE_ON_FILE_NOT_EVALUATED", views, now);
    } else {
      const s = residentialSubsidy(rule.data, input.systemKwp);
      const caveats = [...strings(row.notes), ...toRuleView(row).conditions];
      const stale = staleNote(row, now);
      if (stale) caveats.push(stale);
      const coveredKw = Math.max(...rule.data.tiers.map((t) => t.upToKw));
      if (s.capApplied) caveats.push(`The uncapped total would be INR ${s.uncappedInr.toLocaleString("en-IN")}; the scheme caps the subsidy at INR ${rule.data.capInr.toLocaleString("en-IN")}.`);
      else if (input.systemKwp > coveredKw) caveats.push(`Only the first ${coveredKw} kW earn a subsidy under this rule; the remaining ${+(input.systemKwp - coveredKw).toFixed(3)} kW of a ${input.systemKwp} kWp system get nothing extra, so the total stays at INR ${s.subsidyInr.toLocaleString("en-IN")}.`);
      pmsg = {
        program: "PM_SURYA_GHAR",
        name: NAME,
        outcome: "RULE_APPLIES",
        subsidy: estimated(s.subsidyInr, {
          provider: PROVIDER,
          source: row.source,
          dataType: "pm_surya_ghar_subsidy",
          unit: "INR",
          basis: `the published residential schedule applied to ${input.systemKwp} kWp; it is not a confirmed entitlement`,
          now,
        }),
        breakdown: s.steps,
        rules: [toRuleView(row)],
        caveats,
      };
    }
  } else if (input.consumerType === "GROUP_HOUSING_OR_RWA") {
    const row = pmsgRows.find((r) => r.appliesTo === "GHS_RWA");
    pmsg = row
      ? none(
          "The rule states a rate per kW and a 500 kW limit but not how the limit combines with the plants individual residents install, so no amount is calculated here. The rule is shown as the source states it.",
          "PM_SURYA_GHAR",
          NAME,
          "RULE_ON_FILE_NOT_EVALUATED",
          [toRuleView(row)],
          now,
          [...strings(row.notes)],
        )
      : none("No sourced rule for housing societies is loaded, so no amount is stated.", "PM_SURYA_GHAR", NAME, "NO_SOURCED_RULE", views, now);
  } else {
    pmsg = none("The rule loaded covers residential households and housing societies. No rule for this kind of consumer is loaded, so no amount is stated.", "PM_SURYA_GHAR", NAME, "NOT_COVERED", views, now);
  }

  const nmRows = await activeRules(db, "NET_METERING", regions, on);
  const netMetering: ProgramResult = nmRows.length
    ? none(
        "A net-metering rule is on file and is shown as its source states it. This calculator does not turn it into an eligibility answer.",
        "NET_METERING",
        "Net metering and export",
        "RULE_ON_FILE_NOT_EVALUATED",
        nmRows.map(toRuleView),
        now,
      )
    : none(
        `No sourced net-metering rule is loaded${input.state ? ` for ${input.state}` : ""}. Net-metering limits and export terms differ by state and distribution company, so AVISHKAR does not guess: ask your distribution company, or enter the export rate from your agreement on your tariff.`,
        "NET_METERING",
        "Net metering and export",
        "NO_SOURCED_RULE",
        [],
        now,
      );

  return { asOf: day(on)!, consumerType: input.consumerType, systemKwp: input.systemKwp, eligibilityConfirmed: false, programs: [pmsg], netMetering, notice: NOTICE };
}
