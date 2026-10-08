/**
 * Human control (spec section 46): Observe, Recommend, Approve, Automate. AVISHKAR is connected to no device, so no mode changes
 * anything outside the platform. What a mode decides is what a person is asked and what is recorded: Observe proposes nothing,
 * Recommend shows moves as advice, Approve asks for a decision on each move and records it, and Automate (refused while no device
 * exists) would act within a time-limited authorization and the owner's limits. Every decision is audited and, where something was
 * applied, can be rolled back through the executor.
 */
import { audit } from "../audit.js";
import type { Db } from "../db.js";
import { AppError } from "../errors.js";
import type { Prisma } from "../generated/prisma/client.js";
import { getPlan } from "../plan/service.js";
import { type Draft, type SafetyLimits, deriveProposals } from "./proposals.js";
import type { DeviceExecutor, ExecutionResult } from "./executor.js";
import { type ControlDto, type ControlSettingsInput, type ProposalDto, CONTROL_MODES } from "./schemas.js";

export interface ControlDeps {
  db: Db;
  executor: DeviceExecutor;
  now: () => Date;
}

type Mode = (typeof CONTROL_MODES)[number];
type Action = "approve" | "reject" | "withdraw" | "rollback";

export const MODE_TEXT: Record<Mode, { label: string; meaning: string }> = {
  OBSERVE: { label: "Observe", meaning: "AVISHKAR watches and explains. It proposes no moves." },
  RECOMMEND: { label: "Recommend", meaning: "AVISHKAR shows the moves the plan would make as advice. Nothing is asked of you and nothing is done." },
  APPROVE: { label: "Approve", meaning: "Each move waits for your decision. Approving records it and asks the connected device to make it; with no device, it is recorded and nothing changes." },
  AUTOMATE: { label: "Automate", meaning: "Moves inside your safety limits are made without asking, for a time you authorise, and can be rolled back. Needs a connected device." },
};

const NO_DEVICE = "No device is connected to AVISHKAR, so there is nothing for it to act on.";
const HOUR_MS = 3_600_000;

interface SettingRow {
  mode: Mode;
  maxChargeKw: number | null;
  maxDischargeKw: number | null;
  minSocPercent: number | null;
  automateUntil: Date | null;
  updatedAt: Date | null;
}

async function ownProperty(db: Db, userId: string, propertyId: string): Promise<void> {
  const p = await db.property.findFirst({ where: { id: propertyId, ownerId: userId, deletedAt: null }, select: { id: true } });
  if (!p) throw new AppError("NOT_FOUND", "No such property.");
}

async function settingsOf(db: Db, propertyId: string): Promise<SettingRow> {
  const r = await db.controlSetting.findUnique({ where: { propertyId } });
  return r ? { mode: r.mode, maxChargeKw: r.maxChargeKw, maxDischargeKw: r.maxDischargeKw, minSocPercent: r.minSocPercent, automateUntil: r.automateUntil, updatedAt: r.updatedAt } : { mode: "RECOMMEND", maxChargeKw: null, maxDischargeKw: null, minSocPercent: null, automateUntil: null, updatedAt: null };
}

const limitsOf = (s: SettingRow): SafetyLimits => ({ maxChargeKw: s.maxChargeKw, maxDischargeKw: s.maxDischargeKw, minSocPercent: s.minSocPercent });

/** Whether AUTOMATE is in force: chosen, authorised, not yet expired, and a device to act on. */
function automating(s: SettingRow, ex: DeviceExecutor, now: Date): boolean {
  return s.mode === "AUTOMATE" && ex.available && s.automateUntil !== null && s.automateUntil.getTime() > now.getTime();
}

function can(state: string, mode: Mode, startsAt: Date, safetyOk: boolean, now: Date): ProposalDto["can"] {
  const yes = { allowed: true, reason: null };
  const no = (reason: string) => ({ allowed: false, reason });
  const open = state === "PROPOSED";
  const approve = !open
    ? no(state === "BLOCKED" ? "It breaks a safety limit, so it cannot be approved." : state === "EXPIRED" ? "It has expired: its time has passed." : `It is already ${state.toLowerCase().replace("_", " ")}.`)
    : !safetyOk
      ? no("It breaks a safety limit, so it cannot be approved.")
      : mode === "OBSERVE" || mode === "RECOMMEND"
        ? no("The mode is " + MODE_TEXT[mode].label + ": moves are advice only. Switch to Approve to decide on them.")
        : yes;
  const reject = state === "PROPOSED" || state === "BLOCKED" ? yes : no(`It is already ${state.toLowerCase().replace("_", " ")}.`);
  const withdraw = state === "APPROVED" ? (startsAt.getTime() > now.getTime() ? yes : no("It has already started: roll it back instead.")) : no(state === "APPLIED" ? "It was applied: roll it back instead." : "Only an approved move that has not started can be withdrawn.");
  const rollback = state === "APPLIED" || (state === "APPROVED" && startsAt.getTime() <= now.getTime()) ? yes : no(state === "APPROVED" ? "It has not started: withdraw it instead." : "Only an applied move, or an approved one that has started, can be rolled back.");
  return { approve, reject, withdraw, rollback };
}

interface Row {
  id: string;
  planId: string | null;
  createdAt: Date;
  kind: ProposalDto["kind"];
  startsAt: Date;
  endsAt: Date;
  command: unknown;
  reason: string;
  state: ProposalDto["state"];
  decidedAt: Date | null;
  decisionNote: string | null;
  result: unknown;
  safety: unknown;
  decider: { email: string } | null;
}

function toDto(r: Row, mode: Mode, now: Date): ProposalDto {
  const safety = r.safety as ProposalDto["safety"];
  return {
    id: r.id,
    planId: r.planId,
    createdAt: r.createdAt.toISOString(),
    kind: r.kind,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    command: r.command as ProposalDto["command"],
    reason: r.reason,
    state: r.state,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedBy: r.decider?.email ?? null,
    decisionNote: r.decisionNote,
    result: (r.result as ProposalDto["result"]) ?? null,
    safety,
    can: can(r.state, mode, r.startsAt, safety.ok, now),
  };
}

/** Moves nobody decided on before they were due are EXPIRED, never silently carried out later. */
async function expireOld(db: Db, propertyId: string, now: Date): Promise<void> {
  await db.controlProposal.updateMany({ where: { propertyId, state: { in: ["PROPOSED", "BLOCKED"] }, endsAt: { lte: now } }, data: { state: "EXPIRED", decidedAt: now, decisionNote: "Its time passed with no decision." } });
}

export async function getControl(deps: ControlDeps, userId: string, propertyId: string): Promise<ControlDto> {
  const { db, executor } = deps;
  const now = deps.now();
  await ownProperty(db, userId, propertyId);
  await expireOld(db, propertyId, now);
  const s = await settingsOf(db, propertyId);
  const rows = await db.controlProposal.findMany({ where: { propertyId }, orderBy: [{ createdAt: "desc" }, { startsAt: "asc" }], take: 60, include: { decider: { select: { email: true } } } });
  const live = s.mode === "AUTOMATE" && !automating(s, executor, now) ? "RECOMMEND" : s.mode; // an authorization that ran out no longer authorises
  return {
    mode: live,
    modeMeaning: MODE_TEXT[live].meaning,
    limits: { maxChargeKw: s.maxChargeKw, maxDischargeKw: s.maxDischargeKw, minSocPercent: s.minSocPercent },
    automateUntil: live === "AUTOMATE" ? (s.automateUntil?.toISOString() ?? null) : null,
    updatedAt: s.updatedAt?.toISOString() ?? null,
    executor: { name: executor.name, available: executor.available, message: executor.available ? `Connected: ${executor.name}.` : NO_DEVICE },
    modes: CONTROL_MODES.map((m) => ({ mode: m, label: MODE_TEXT[m].label, meaning: MODE_TEXT[m].meaning, available: m !== "AUTOMATE" || executor.available, unavailableReason: m === "AUTOMATE" && !executor.available ? NO_DEVICE : null })),
    proposals: rows.map((r) => toDto(r, live, now)),
  };
}

export async function setControl(deps: ControlDeps, userId: string, propertyId: string, input: ControlSettingsInput, ctx: { requestId?: string; ip?: string } = {}): Promise<ControlDto> {
  const { db, executor } = deps;
  const now = deps.now();
  await ownProperty(db, userId, propertyId);
  let automateUntil: Date | null = null;
  if (input.mode === "AUTOMATE") {
    if (!executor.available) throw new AppError("CONTROL_UNAVAILABLE", `Automate cannot be chosen. ${NO_DEVICE}`, { mode: "AUTOMATE" });
    if (input.confirmAutomate !== true || !input.automateHours) {
      throw new AppError("VALIDATION_FAILED", "Automate needs your explicit authorization: confirm it and say how many hours it lasts (at most 720). It is never open-ended.", { field: "confirmAutomate" });
    }
    automateUntil = new Date(now.getTime() + input.automateHours * HOUR_MS);
  }
  const prev = await settingsOf(db, propertyId);
  const data = {
    mode: input.mode,
    maxChargeKw: input.maxChargeKw === undefined ? prev.maxChargeKw : input.maxChargeKw,
    maxDischargeKw: input.maxDischargeKw === undefined ? prev.maxDischargeKw : input.maxDischargeKw,
    minSocPercent: input.minSocPercent === undefined ? prev.minSocPercent : input.minSocPercent,
    automateUntil,
    updatedAt: now,
    updatedBy: userId,
  };
  await db.controlSetting.upsert({ where: { propertyId }, create: { propertyId, ...data }, update: data });
  await audit(db, { userId, action: "control.settings", entityType: "property", entityId: propertyId, requestId: ctx.requestId, ip: ctx.ip, detail: { from: prev.mode, to: input.mode, limits: { maxChargeKw: data.maxChargeKw, maxDischargeKw: data.maxDischargeKw, minSocPercent: data.minSocPercent }, automateUntil: automateUntil?.toISOString() ?? null } as Prisma.InputJsonValue });
  return getControl(deps, userId, propertyId);
}

async function applyTo(deps: ControlDeps, id: string, p: { propertyId: string; kind: ProposalDto["kind"]; startsAt: Date; endsAt: Date; command: unknown }): Promise<{ state: "APPROVED" | "APPLIED" | "FAILED"; result: ExecutionResult }> {
  try {
    const result = await deps.executor.apply({ id, propertyId: p.propertyId, kind: p.kind, startsAt: p.startsAt, endsAt: p.endsAt, command: p.command as Record<string, unknown> });
    return { state: result.applied ? "APPLIED" : "APPROVED", result };
  } catch (e) {
    return { state: "FAILED", result: { applied: false, message: `The device could not be asked: ${e instanceof Error ? e.message : "error"}.` } };
  }
}

/** Turn the latest plan's moves into proposals, put each through the safety limits, and (under a valid AUTOMATE authorization) make the safe ones. */
export async function proposeFromLatestPlan(deps: ControlDeps, userId: string, propertyId: string, ctx: { requestId?: string; ip?: string } = {}): Promise<{ created: number; skipped: number; control: ControlDto }> {
  const { db, executor } = deps;
  const now = deps.now();
  await ownProperty(db, userId, propertyId);
  const s = await settingsOf(db, propertyId);
  if (s.mode === "OBSERVE") throw new AppError("CONTROL_MODE", "The mode is Observe: AVISHKAR watches and explains, and proposes no moves. Choose Recommend or Approve to see them.");
  const plan = await getPlan(db, userId, propertyId);
  const drafts: Draft[] = deriveProposals(plan, limitsOf(s), now);
  const open = await db.controlProposal.findMany({ where: { propertyId, state: { in: ["PROPOSED", "APPROVED", "APPLIED", "BLOCKED"] } }, select: { kind: true, startsAt: true, endsAt: true } });
  const have = new Set(open.map((o) => `${o.kind}|${o.startsAt.getTime()}|${o.endsAt.getTime()}`));
  let created = 0;
  let skipped = 0;
  const auto = automating(s, executor, now);
  for (const d of drafts) {
    if (have.has(`${d.kind}|${d.startsAt.getTime()}|${d.endsAt.getTime()}`)) {
      skipped++;
      continue;
    }
    const row = await db.controlProposal.create({
      data: { propertyId, planId: plan.id, createdAt: now, kind: d.kind, startsAt: d.startsAt, endsAt: d.endsAt, command: d.command as Prisma.InputJsonValue, reason: d.reason, state: d.safety.ok ? "PROPOSED" : "BLOCKED", safety: d.safety as unknown as Prisma.InputJsonValue },
    });
    created++;
    if (auto && d.safety.ok) {
      const out = await applyTo(deps, row.id, { propertyId, kind: d.kind, startsAt: d.startsAt, endsAt: d.endsAt, command: d.command });
      await db.controlProposal.update({ where: { id: row.id }, data: { state: out.state, decidedAt: now, decidedBy: null, decisionNote: `Made automatically under your authorization until ${s.automateUntil!.toISOString()}.`, result: out.result as unknown as Prisma.InputJsonValue } });
      await audit(db, { userId, action: "control.automatic", entityType: "control_proposal", entityId: row.id, requestId: ctx.requestId, ip: ctx.ip, detail: { kind: d.kind, state: out.state } });
    }
  }
  await audit(db, { userId, action: "control.propose", entityType: "property", entityId: propertyId, requestId: ctx.requestId, ip: ctx.ip, detail: { planId: plan.id, created, skipped } });
  return { created, skipped, control: await getControl(deps, userId, propertyId) };
}

export async function decide(deps: ControlDeps, userId: string, propertyId: string, proposalId: string, action: Action, note: string | undefined, ctx: { requestId?: string; ip?: string } = {}): Promise<ControlDto> {
  const { db, executor } = deps;
  const now = deps.now();
  await ownProperty(db, userId, propertyId);
  await expireOld(db, propertyId, now);
  const row = await db.controlProposal.findFirst({ where: { id: proposalId, propertyId } });
  if (!row) throw new AppError("NOT_FOUND", "No such proposal.");
  const s = await settingsOf(db, propertyId);
  const mode: Mode = s.mode === "AUTOMATE" && !automating(s, executor, now) ? "RECOMMEND" : s.mode;
  const verdict = can(row.state, mode, row.startsAt, (row.safety as ProposalDto["safety"]).ok, now)[action];
  if (!verdict.allowed) throw new AppError("CONTROL_MODE", verdict.reason ?? "That is not possible now.", { action, state: row.state });

  const base = { decidedAt: now, decidedBy: userId, decisionNote: note ?? null };
  const spec = { propertyId, kind: row.kind, startsAt: row.startsAt, endsAt: row.endsAt, command: row.command };
  let data: Prisma.ControlProposalUncheckedUpdateInput;
  if (action === "approve") {
    const out = await applyTo(deps, row.id, spec);
    data = { ...base, state: out.state, result: out.result as unknown as Prisma.InputJsonValue };
  } else if (action === "reject") {
    data = { ...base, state: "REJECTED" };
  } else if (action === "withdraw") {
    data = { ...base, state: "WITHDRAWN", result: { applied: false, message: "Withdrawn before it started: nothing had been applied, so there was nothing to undo." } };
  } else {
    // rollback: undo through the executor only what the executor applied
    const applied = row.state === "APPLIED";
    let result: ExecutionResult = { applied: false, message: "Nothing had been applied to any device, so there was nothing to undo." };
    if (applied) {
      try {
        result = await executor.revert({ id: row.id, ...spec, command: spec.command as Record<string, unknown> });
      } catch (e) {
        throw new AppError("ENGINE_UNAVAILABLE", `The device could not be asked to undo it (${e instanceof Error ? e.message : "error"}). The move stays recorded as applied; try again or undo it at the device.`);
      }
    }
    data = { ...base, state: "ROLLED_BACK", result: result as unknown as Prisma.InputJsonValue };
  }
  await db.controlProposal.update({ where: { id: row.id }, data });
  await audit(db, { userId, action: `control.${action}`, entityType: "control_proposal", entityId: row.id, requestId: ctx.requestId, ip: ctx.ip, detail: { kind: row.kind, from: row.state, noteGiven: Boolean(note) } });
  return getControl(deps, userId, propertyId);
}
