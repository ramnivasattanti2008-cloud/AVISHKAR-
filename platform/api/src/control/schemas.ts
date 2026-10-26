import { z } from "zod";

export const CONTROL_MODES = ["OBSERVE", "RECOMMEND", "APPROVE", "AUTOMATE"] as const;
export const PROPOSAL_STATES = ["PROPOSED", "APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED", "APPLIED", "FAILED", "ROLLED_BACK", "BLOCKED"] as const;
export const PROPOSAL_KINDS = ["BATTERY_CHARGE", "BATTERY_DISCHARGE", "APPLIANCE_RUN", "EV_CHARGE"] as const;

export const ControlSettingsInput = z
  .object({
    mode: z.enum(CONTROL_MODES),
    maxChargeKw: z.number().positive().max(100_000).nullable().optional().describe("The most power AVISHKAR may ask the battery to charge at. Empty: the battery's own limit."),
    maxDischargeKw: z.number().positive().max(100_000).nullable().optional(),
    minSocPercent: z.number().min(0).max(100).nullable().optional().describe("The lowest charge, as a share of capacity, the battery may be taken to."),
    automateHours: z.number().int().min(1).max(720).optional().describe("AUTOMATE only: how many hours your authorization lasts. It never lasts longer than 30 days and is never open-ended."),
    confirmAutomate: z.boolean().optional().describe("AUTOMATE only: true says you authorise moves to be made without asking each time."),
  })
  .meta({ id: "ControlSettingsInput" });
export type ControlSettingsInput = z.infer<typeof ControlSettingsInput>;

const Can = z.object({ allowed: z.boolean(), reason: z.string().nullable().describe("Why not, when it is not allowed: no button is dead without saying why.") });

export const ProposalSchema = z
  .object({
    id: z.uuid(),
    planId: z.uuid().nullable(),
    createdAt: z.string(),
    kind: z.enum(PROPOSAL_KINDS),
    startsAt: z.string(),
    endsAt: z.string(),
    command: z.record(z.string(), z.union([z.number(), z.string()])),
    reason: z.string().describe("The planner's own reason for the move, in words."),
    state: z.enum(PROPOSAL_STATES),
    decidedAt: z.string().nullable(),
    decidedBy: z.string().nullable().describe("The email of who decided; null when the system did under an AUTOMATE authorization or time did."),
    decisionNote: z.string().nullable(),
    result: z.object({ applied: z.boolean(), message: z.string() }).nullable().describe("What the device executor answered, as it answered."),
    safety: z.object({ ok: z.boolean(), checks: z.array(z.object({ check: z.string(), ok: z.boolean(), detail: z.string() })) }),
    can: z.object({ approve: Can, reject: Can, withdraw: Can, rollback: Can }),
  })
  .meta({ id: "ControlProposal" });
export type ProposalDto = z.infer<typeof ProposalSchema>;

export const ControlSchema = z
  .object({
    mode: z.enum(CONTROL_MODES),
    modeMeaning: z.string(),
    limits: z.object({ maxChargeKw: z.number().nullable(), maxDischargeKw: z.number().nullable(), minSocPercent: z.number().nullable() }),
    automateUntil: z.string().nullable(),
    updatedAt: z.string().nullable(),
    executor: z.object({ name: z.string(), available: z.boolean(), message: z.string() }),
    modes: z.array(z.object({ mode: z.enum(CONTROL_MODES), label: z.string(), meaning: z.string(), available: z.boolean(), unavailableReason: z.string().nullable() })),
    proposals: z.array(ProposalSchema),
  })
  .meta({ id: "Control" });
export type ControlDto = z.infer<typeof ControlSchema>;
