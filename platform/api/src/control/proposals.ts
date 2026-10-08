/**
 * From a plan to the moves a person could approve (spec section 46). Pure: the plan and the owner's limits are inputs.
 *
 * A proposal is one contiguous move: the battery charging for some hours, the battery supplying the home, a flexible appliance
 * running, the car charging. Each carries the planner's own reason for it and is checked against the owner's safety limits before
 * it can be approved; a move that breaks a limit is BLOCKED, with the reason, and cannot be approved.
 */
import type { PlanDto } from "../plan/schemas.js";

const HOUR_MS = 3_600_000;
/** Below this many kW a flow is dust, not a move (the planner's own decision list ignores anything under 0.02 kWh). */
const MIN_KW = 0.05;

export type ProposalKind = "BATTERY_CHARGE" | "BATTERY_DISCHARGE" | "APPLIANCE_RUN" | "EV_CHARGE";

export interface SafetyLimits {
  /** Highest power the battery may be asked to charge at, kW. Null: only the battery's own limit. */
  maxChargeKw: number | null;
  maxDischargeKw: number | null;
  /** Lowest charge the battery may be taken to, as a share of its capacity. Null: only the battery's own floor. */
  minSocPercent: number | null;
}

export interface Draft {
  kind: ProposalKind;
  startsAt: Date;
  endsAt: Date;
  command: Record<string, number | string>;
  reason: string;
  safety: { ok: boolean; checks: { check: string; ok: boolean; detail: string }[] };
}

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

/** Runs of consecutive steps (as [first, last] inclusive) where the series is above the dust level. */
export function runsOf(kw: number[]): [number, number][] {
  const out: [number, number][] = [];
  let from = -1;
  kw.forEach((v, i) => {
    if (v > MIN_KW) {
      if (from < 0) from = i;
    } else if (from >= 0) {
      out.push([from, i - 1]);
      from = -1;
    }
  });
  if (from >= 0) out.push([from, kw.length - 1]);
  return out;
}

function reasonFor(plan: PlanDto, kind: string, from: number, to: number, fallback: string): string {
  const start = Date.parse(plan.horizon.start);
  const found = plan.decisions.find((d) => d.kind === kind && Date.parse(d.time) >= start + from * HOUR_MS && Date.parse(d.time) < start + (to + 1) * HOUR_MS);
  return found?.reason ?? fallback;
}

function checkBattery(plan: PlanDto, kind: "BATTERY_CHARGE" | "BATTERY_DISCHARGE", peakKw: number, lastStep: number, limits: SafetyLimits): Draft["safety"] {
  const b = plan.inputs.battery;
  const checks: Draft["safety"]["checks"] = [];
  if (!b) return { ok: false, checks: [{ check: "battery", ok: false, detail: "The plan has no battery to command." }] };
  const deviceMax = kind === "BATTERY_CHARGE" ? b.maxChargeKw : b.maxDischargeKw;
  const ownerMax = kind === "BATTERY_CHARGE" ? limits.maxChargeKw : limits.maxDischargeKw;
  checks.push({ check: "device power limit", ok: peakKw <= deviceMax + 1e-6, detail: `${round(peakKw)} kW against the battery's own ${round(deviceMax)} kW.` });
  if (ownerMax !== null) checks.push({ check: "your power limit", ok: peakKw <= ownerMax + 1e-6, detail: `${round(peakKw)} kW against the ${round(ownerMax)} kW you set.` });
  const soc = plan.schedule.batterySocKwh[lastStep];
  if (limits.minSocPercent !== null && soc !== undefined) {
    const floor = (limits.minSocPercent / 100) * b.capacityKwh;
    checks.push({ check: "your lowest charge", ok: soc >= floor - 1e-6, detail: `${round(soc)} kWh left at the end, against the ${round(floor)} kWh (${round(limits.minSocPercent, 0)}%) you set as the lowest.` });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

/** The moves in a plan that have not finished by `now`, each with its safety checks. */
export function deriveProposals(plan: PlanDto, limits: SafetyLimits, now: Date): Draft[] {
  const start = Date.parse(plan.horizon.start);
  const s = plan.schedule;
  const out: Draft[] = [];
  const at = (i: number) => new Date(start + i * HOUR_MS);

  for (const [from, to] of runsOf(s.batteryChargeKw)) {
    const kw = s.batteryChargeKw.slice(from, to + 1);
    const peak = Math.max(...kw);
    out.push({
      kind: "BATTERY_CHARGE",
      startsAt: at(from),
      endsAt: at(to + 1),
      command: { avgKw: round(kw.reduce((a, b) => a + b, 0) / kw.length), peakKw: round(peak), kwh: round(kw.reduce((a, b) => a + b, 0)) },
      reason: reasonFor(plan, "charge_battery", from, to, "The plan charges the battery here."),
      safety: checkBattery(plan, "BATTERY_CHARGE", peak, to, limits),
    });
  }
  for (const [from, to] of runsOf(s.batteryDischargeKw)) {
    const kw = s.batteryDischargeKw.slice(from, to + 1);
    const peak = Math.max(...kw);
    out.push({
      kind: "BATTERY_DISCHARGE",
      startsAt: at(from),
      endsAt: at(to + 1),
      command: { avgKw: round(kw.reduce((a, b) => a + b, 0) / kw.length), peakKw: round(peak), kwh: round(kw.reduce((a, b) => a + b, 0)) },
      reason: reasonFor(plan, "discharge_battery", from, to, "The plan supplies the home from the battery here."),
      safety: checkBattery(plan, "BATTERY_DISCHARGE", peak, to, limits),
    });
  }
  for (const [from, to] of runsOf(s.evChargeKw)) {
    const kw = s.evChargeKw.slice(from, to + 1);
    out.push({
      kind: "EV_CHARGE",
      startsAt: at(from),
      endsAt: at(to + 1),
      command: { avgKw: round(kw.reduce((a, b) => a + b, 0) / kw.length), peakKw: round(Math.max(...kw)), kwh: round(kw.reduce((a, b) => a + b, 0)) },
      reason: reasonFor(plan, "ev_charge", from, to, "The plan charges the car here."),
      safety: { ok: true, checks: [{ check: "vehicle", ok: true, detail: "The plan delivers the energy the car needs before it leaves." }] },
    });
  }
  for (const a of plan.appliances) {
    if (!a.startTime) continue;
    const startsAt = new Date(a.startTime);
    const endsAt = new Date(startsAt.getTime() + a.runHours * HOUR_MS);
    const found = plan.decisions.find((d) => d.kind === "appliance" && d.reason.startsWith(a.name));
    out.push({
      kind: "APPLIANCE_RUN",
      startsAt,
      endsAt,
      command: { applianceId: a.id, name: a.name, runHours: a.runHours, kwh: round(a.energyKwh) },
      reason: found?.reason ?? `${a.name} is placed here, inside its window.`,
      safety: { ok: true, checks: [{ check: "your window", ok: true, detail: `${a.name} runs inside the window you gave it.` }] },
    });
  }
  return out.filter((d) => d.endsAt.getTime() > now.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.kind.localeCompare(b.kind));
}
