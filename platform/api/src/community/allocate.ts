/**
 * Community surplus allocation: who can meet whose deficit in one interval, and what stops them.
 *
 * This is pure arithmetic over numbers the caller supplies. It touches no database, no provider and no clock, so the same
 * inputs always give the same answer and every figure on a page can be traced back to an input the person can change.
 *
 * What it is NOT: this does not move electricity. Whether one property may send its surplus to another depends on the law,
 * the licence of the distribution company, the metering arrangement and the wiring in the ground where those properties
 * are. AVISHKAR models the energy; it does not claim the arrangement exists. Every response carries that caveat and the
 * API labels the result a simulation.
 *
 * The order of events in one interval, which is a stated convention and not something an optimiser discovered:
 *
 *   1. each property's own generation meets its own demand (never allocated twice);
 *   2. a property in deficit draws its own battery down to its reserve floor;
 *   3. a property in surplus charges its own battery first, or shares first, depending on `batteryPolicy`;
 *   4. what is still surplus is offered to the shared node, and what is still deficit asks of it;
 *   5. the node's pool is divided among the askers by `rule`;
 *   6. a surplus that found no taker is sold to the grid, or curtailed when the export limit stops it;
 *   7. a deficit the pool did not cover is bought from the grid, and what the import limit stops is reported unserved.
 *
 * Losses are explicit and are never paid twice. Energy leaving a meter loses that property's `lineLossFraction` on the way
 * to the shared node; the pool at the node loses `networkLossFraction`; what is drawn towards a receiving property loses
 * that property's `lineLossFraction` before it arrives. So a kW sent is worth less than a kW received, and the difference
 * is reported on its own line rather than hidden in a rounding.
 *
 * Caps are reported, not silently applied: each member says which limit bound it and the community says whether the feeder
 * was the binding constraint, so a page can explain "B received 1.2 kW, not the 2 kW it needed, because the feeder limit of
 * 3 kW was already carrying everything it could".
 */

/** How the node's pool is divided when the askers want more than it holds. */
export const ALLOCATION_RULES = ["PROPORTIONAL", "EQUAL_SHARE", "CRITICAL_FIRST", "NEAREST_FIRST"] as const;
export type AllocationRule = (typeof ALLOCATION_RULES)[number];

/** Whether a property in surplus fills its own battery before offering anything to its neighbours. */
export const BATTERY_POLICIES = ["SHARE_FIRST", "BATTERY_FIRST"] as const;
export type BatteryPolicy = (typeof BATTERY_POLICIES)[number];

export interface MemberBattery {
  /** Capacity that may be cycled, kWh: the usable band above the depth-of-discharge floor. */
  usableKwh: number;
  /** Energy stored now, kWh, counted within that usable band. */
  socKwh: number;
  /** The part of the usable band kept back for backup, kWh. Discharging stops here. */
  reserveKwh: number;
  maxChargeKw: number;
  maxDischargeKw: number;
  /**
   * Round-trip efficiency, 0 to 1. Charged here on the way in: putting X kWh in stores X * efficiency kWh, and
   * discharging takes one kWh out of the store for each kWh delivered. The whole loss sits on the charge leg, which is a
   * convention; it keeps the loss in one place instead of splitting it across two legs with a square root nobody can check.
   */
  roundTripEfficiency: number;
}

export interface MemberInput {
  id: string;
  name: string;
  /** Generation at this instant, kW. Solar, or anything else the caller counts as on-site generation. */
  generationKw: number;
  /** What the property is using at this instant, kW. */
  demandKw: number;
  /** The part of that demand which must not be dropped, kW. Used by CRITICAL_FIRST. Clamped to `demandKw`. */
  criticalKw: number;
  battery: MemberBattery | null;
  /** Most the property may push past its meter, kW: the smaller of its inverter and what its connection permits. */
  exportLimitKw: number;
  /** Most it may draw past its meter, kW: its sanctioned load. Shared energy and bought energy both pass it. */
  importLimitKw: number;
  /** Fraction of energy lost on this property's own leg to the shared node, 0 to 0.5. */
  lineLossFraction: number;
}

export interface CommunityLimits {
  /** Most that may pass through the shared node at once, kW: the feeder or the transformer, whichever is smaller. */
  feederLimitKw: number;
  /** Fraction lost in the shared network itself, 0 to 0.5. Charged once, on the pool. */
  networkLossFraction: number;
  rule: AllocationRule;
  batteryPolicy: BatteryPolicy;
  /** Length of the interval, hours. Converts every kW to the kWh a battery's charge level moves by. */
  stepHours: number;
}

/** Which cap stopped a member from sending or receiving more. */
export type BindingCap = "NONE" | "EXPORT_LIMIT" | "IMPORT_LIMIT" | "FEEDER_LIMIT" | "NO_TAKER" | "NO_SUPPLY" | "BATTERY_FULL" | "BATTERY_EMPTY";

export interface MemberResult {
  id: string;
  name: string;
  generationKw: number;
  demandKw: number;
  /** Generation that met this property's own demand. */
  selfUseKw: number;
  /** Delivered out of its own battery. */
  batteryDischargeKw: number;
  /** Taken into its own battery, measured at the battery's input. */
  batteryChargeKw: number;
  /** Charge level at the end of the interval, kWh. Null when the property has no battery. */
  batterySocKwh: number | null;
  /** Surplus after its own demand and its own battery: what it offered the shared node. */
  offeredKw: number;
  /** What actually left its meter towards the shared node. */
  sentKw: number;
  /** Deficit after its own generation and its own battery: what it asked the shared node for. */
  requestedKw: number;
  /** What was drawn from the shared node on its behalf, measured at the node. */
  allocatedKw: number;
  /** What arrived past its meter, after its own line loss. This is the kW that met demand. */
  receivedKw: number;
  /** Bought from the grid. */
  gridImportKw: number;
  /** Sold to the grid. */
  gridExportKw: number;
  /** Generation that nothing could use and the export limit would not let out. */
  curtailedKw: number;
  /** Demand that neither the community, the battery nor the grid could meet. An honest failure, not a rounding. */
  unservedKw: number;
  status: "SURPLUS" | "DEFICIT" | "BALANCED";
  /** Which cap stopped it sending more, or receiving more. */
  binding: BindingCap;
  /** Plain-language account of what happened to this property in this interval. */
  explanation: string;
}

/**
 * One property's share of another's sending, as an accounting convention. The node pools everything, so nothing in the
 * arithmetic says which kW of A's surplus reached B rather than C. Each sender is divided among the receivers in the same
 * proportion as the receivers were served, which is stated on every page that shows a pair.
 */
export interface Transfer {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  /** Left the sender's meter, kW. */
  sentKw: number;
  /** Arrived past the receiver's meter, kW. */
  deliveredKw: number;
  /** The difference: the sender's leg, the shared network and the receiver's leg. */
  lossKw: number;
}

export interface CommunityTotals {
  members: number;
  generationKw: number;
  demandKw: number;
  /** Generation that met demand on the property that made it. */
  selfUseKw: number;
  /** Surplus offered to the node, before any cap. */
  offeredKw: number;
  /** Deficit asked of the node, before any cap. */
  requestedKw: number;
  /** Left senders' meters. */
  sharedSentKw: number;
  /** Arrived past receivers' meters and met demand. */
  sharedDeliveredKw: number;
  /** The difference between the two: lost carrying it. */
  transferLossKw: number;
  batteryChargeKw: number;
  batteryDischargeKw: number;
  /** What the community as a whole bought. Zero when its own surplus covered every deficit. */
  gridImportKw: number;
  gridExportKw: number;
  curtailedKw: number;
  unservedKw: number;
  /** Share of the community's demand met without buying anything, 0 to 1. Null when nothing was being used. */
  selfSufficiency: number | null;
  /** Share of the community's generation that was used by the community rather than sold or thrown away. Null when nothing was generated. */
  selfConsumption: number | null;
}

export interface AllocationCheck {
  /** Every member balances, and the community's losses account for the gap between sent and delivered. */
  balanced: boolean;
  /** The worst member imbalance found, kW. */
  maxMemberErrorKw: number;
  /** The community imbalance, kW. */
  communityErrorKw: number;
  note: string;
}

export interface AllocationResult {
  members: MemberResult[];
  transfers: Transfer[];
  totals: CommunityTotals;
  limits: CommunityLimits;
  /** Whether the shared node was carrying everything it was allowed to. */
  feederBinding: boolean;
  /** kW through the shared node, measured at the node after senders' line losses. */
  feederFlowKw: number;
  check: AllocationCheck;
  /** Why the answer came out as it did, in the order the steps were applied. */
  decisions: string[];
}

/** Energy balance tolerance, kW. Above this an imbalance is a defect, not rounding. */
const TOLERANCE_KW = 1e-6;

const round = (v: number, d = 4): number => {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return Object.is(r, -0) ? 0 : r;
};
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
/** The largest loss fraction a leg of the network may be given. Above this the input is refused, not repaired. */
const MAX_LOSS_FRACTION = 0.5;
/** The fraction of what is sent that survives a leg. Never zero, because `MAX_LOSS_FRACTION` is below one. */
const safeFactor = (f: number): number => 1 - f;

function fmt(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2);
}

/**
 * Divides `available` among `needs` in proportion to each need, never giving anyone more than they need. Because a
 * proportional share can exceed a small need, it refills the remainder over whoever is still short, until nothing is left
 * to give or no one is short.
 */
function proportional(available: number, needs: number[]): number[] {
  const out = needs.map(() => 0);
  let left = available;
  let active = needs.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
  while (left > TOLERANCE_KW && active.length > 0) {
    const pool = sum(active.map((i) => needs[i]! - out[i]!));
    if (pool <= TOLERANCE_KW) break;
    const give = Math.min(left, pool);
    let handed = 0;
    for (const i of active) {
      const want = needs[i]! - out[i]!;
      const share = Math.min(want, (give * want) / pool);
      out[i]! += share;
      handed += share;
    }
    left -= handed;
    active = active.filter((i) => needs[i]! - out[i]! > TOLERANCE_KW);
    if (handed <= TOLERANCE_KW) break;
  }
  return out;
}

/**
 * Max-min fair division: everyone gets the same amount until their need is met, and what the already-satisfied cannot use
 * is shared again over the rest. The smallest need is met first, which is what "equal share" means once needs differ.
 */
function equalShare(available: number, needs: number[]): number[] {
  const out = needs.map(() => 0);
  let left = available;
  let active = needs.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0);
  while (left > TOLERANCE_KW && active.length > 0) {
    const each = left / active.length;
    let handed = 0;
    const next: number[] = [];
    for (const i of active) {
      const want = needs[i]! - out[i]!;
      const share = Math.min(want, each);
      out[i]! += share;
      handed += share;
      if (needs[i]! - out[i]! > TOLERANCE_KW) next.push(i);
    }
    left -= handed;
    if (handed <= TOLERANCE_KW) break;
    active = next;
  }
  return out;
}

/** Fills needs one at a time in the given order, which is how a priority rule turns into kW. */
function greedy(available: number, needs: number[], order: number[]): number[] {
  const out = needs.map(() => 0);
  let left = available;
  for (const i of order) {
    if (left <= TOLERANCE_KW) break;
    const share = Math.min(needs[i]!, left);
    out[i]! = share;
    left -= share;
  }
  return out;
}

interface Working {
  input: MemberInput;
  demand: number;
  critical: number;
  selfUse: number;
  surplus: number;
  deficit: number;
  discharge: number;
  charge: number;
  soc: number | null;
  offered: number;
  requested: number;
  sent: number;
  allocated: number;
  received: number;
  gridImport: number;
  gridExport: number;
  curtailed: number;
  unserved: number;
  binding: BindingCap;
}

/**
 * Allocates one interval. Throws on an input that cannot describe a real property (a negative generation, a battery whose
 * reserve is above its capacity) rather than quietly repairing it: the caller's numbers are the caller's numbers.
 */
export function allocateInterval(membersIn: MemberInput[], limitsIn: CommunityLimits): AllocationResult {
  if (!Number.isFinite(limitsIn.feederLimitKw) || limitsIn.feederLimitKw < 0) throw new Error("the feeder limit must be zero or more kW");
  if (!Number.isFinite(limitsIn.networkLossFraction) || limitsIn.networkLossFraction < 0 || limitsIn.networkLossFraction > MAX_LOSS_FRACTION) {
    throw new Error(`the shared network's loss must be between 0 and ${MAX_LOSS_FRACTION}; a network that loses more than half of what enters it is not a network worth modelling`);
  }
  if (!Number.isFinite(limitsIn.stepHours) || limitsIn.stepHours <= 0) throw new Error("the interval must be longer than zero hours");
  const limits: CommunityLimits = {
    feederLimitKw: limitsIn.feederLimitKw,
    networkLossFraction: limitsIn.networkLossFraction,
    rule: limitsIn.rule,
    batteryPolicy: limitsIn.batteryPolicy,
    stepHours: limitsIn.stepHours,
  };
  const decisions: string[] = [];

  const ws: Working[] = membersIn.map((m) => {
    if (!Number.isFinite(m.generationKw) || m.generationKw < 0) throw new Error(`${m.name}: generation must be zero or more`);
    if (!Number.isFinite(m.demandKw) || m.demandKw < 0) throw new Error(`${m.name}: demand must be zero or more`);
    if (!Number.isFinite(m.exportLimitKw) || m.exportLimitKw < 0) throw new Error(`${m.name}: export limit must be zero or more kW`);
    if (!Number.isFinite(m.importLimitKw) || m.importLimitKw < 0) throw new Error(`${m.name}: import limit must be zero or more kW`);
    if (!Number.isFinite(m.lineLossFraction) || m.lineLossFraction < 0 || m.lineLossFraction > MAX_LOSS_FRACTION) {
      throw new Error(`${m.name}: line loss must be between 0 and ${MAX_LOSS_FRACTION}`);
    }
    if (m.battery) {
      const b = m.battery;
      if (b.usableKwh < 0 || b.socKwh < 0) throw new Error(`${m.name}: battery capacity and charge level must be zero or more`);
      if (b.reserveKwh > b.usableKwh + TOLERANCE_KW) throw new Error(`${m.name}: battery reserve (${b.reserveKwh} kWh) is above its usable capacity (${b.usableKwh} kWh)`);
      if (b.socKwh > b.usableKwh + TOLERANCE_KW) throw new Error(`${m.name}: battery charge level (${b.socKwh} kWh) is above its usable capacity (${b.usableKwh} kWh)`);
      if (!(b.roundTripEfficiency > 0 && b.roundTripEfficiency <= 1)) throw new Error(`${m.name}: battery round-trip efficiency must be above 0 and at most 1`);
    }
    const demand = m.demandKw;
    const selfUse = Math.min(m.generationKw, demand);
    return {
      input: m,
      demand,
      critical: clamp(m.criticalKw, 0, demand),
      selfUse,
      surplus: m.generationKw - selfUse,
      deficit: demand - selfUse,
      discharge: 0,
      charge: 0,
      soc: m.battery ? m.battery.socKwh : null,
      offered: 0,
      requested: 0,
      sent: 0,
      allocated: 0,
      received: 0,
      gridImport: 0,
      gridExport: 0,
      curtailed: 0,
      unserved: 0,
      binding: "NONE",
    };
  });

  decisions.push(`Step 1 — each property's own generation met its own demand first: ${fmt(sum(ws.map((w) => w.selfUse)))} kW of the ${fmt(sum(ws.map((w) => w.input.generationKw)))} kW generated. The same kW is never allocated twice.`);

  // Step 2: a property short of energy draws its own battery down to its reserve floor.
  for (const w of ws) {
    const b = w.input.battery;
    if (!b || w.deficit <= TOLERANCE_KW) continue;
    const roomToDischargeKwh = Math.max(0, w.soc! - b.reserveKwh);
    const take = Math.min(w.deficit, b.maxDischargeKw, roomToDischargeKwh / limits.stepHours);
    if (take > TOLERANCE_KW) {
      w.discharge = take;
      w.deficit -= take;
      w.soc = w.soc! - take * limits.stepHours;
    }
    if (w.deficit > TOLERANCE_KW && roomToDischargeKwh / limits.stepHours <= take + TOLERANCE_KW) w.binding = "BATTERY_EMPTY";
  }
  const discharged = sum(ws.map((w) => w.discharge));
  if (discharged > TOLERANCE_KW) decisions.push(`Step 2 — properties short of energy drew ${fmt(discharged)} kW from their own batteries, stopping at each battery's reserve floor.`);

  // Step 3: a property with a surplus fills its own battery first, when that is the chosen policy.
  const chargeOwn = (w: Working): void => {
    const b = w.input.battery;
    if (!b || w.surplus <= TOLERANCE_KW) return;
    const headroomKwh = Math.max(0, b.usableKwh - w.soc!);
    // The loss sits on the charge leg: putting `x` in stores `x * efficiency`, so filling the headroom takes more than it holds.
    const inputForHeadroomKw = headroomKwh / b.roundTripEfficiency / limits.stepHours;
    const put = Math.min(w.surplus, b.maxChargeKw, inputForHeadroomKw);
    if (put > TOLERANCE_KW) {
      w.charge += put;
      w.surplus -= put;
      w.soc = w.soc! + put * limits.stepHours * b.roundTripEfficiency;
    }
    if (w.surplus > TOLERANCE_KW && inputForHeadroomKw <= put + TOLERANCE_KW) w.binding = "BATTERY_FULL";
  };
  if (limits.batteryPolicy === "BATTERY_FIRST") {
    for (const w of ws) chargeOwn(w);
    const charged = sum(ws.map((w) => w.charge));
    decisions.push(`Step 3 — policy BATTERY_FIRST: properties with a surplus filled their own batteries before offering anything, taking ${fmt(charged)} kW. Backup comes before sharing.`);
  } else {
    decisions.push("Step 3 — policy SHARE_FIRST: a surplus is offered to the neighbours before it charges the property's own battery, so the community buys as little as possible.");
  }

  // Step 4: what is offered, and what is asked. Both capped at the meter.
  for (const w of ws) {
    w.offered = w.surplus;
    w.requested = w.deficit;
  }
  const sendableAtMeter = ws.map((w) => Math.min(w.offered, w.input.exportLimitKw));
  // A receiver's ask, measured at the node: delivering `deficit` past its meter means drawing more, because its own leg loses some.
  const needAtNode = ws.map((w) => Math.min(w.requested / safeFactor(w.input.lineLossFraction), w.input.importLimitKw));

  const nodeInflowOffered = sum(sendableAtMeter.map((s, i) => s * safeFactor(ws[i]!.input.lineLossFraction)));
  const nodeInflowAllowed = Math.min(nodeInflowOffered, limits.feederLimitKw);
  const poolAfterNetwork = nodeInflowAllowed * safeFactor(limits.networkLossFraction);
  const totalNeed = sum(needAtNode);
  const toAllocate = Math.min(poolAfterNetwork, totalNeed);

  decisions.push(
    `Step 4 — ${fmt(sum(ws.map((w) => w.offered)))} kW was offered to the shared node and ${fmt(sum(ws.map((w) => w.requested)))} kW asked of it. ` +
      `Export limits held the offer to ${fmt(sum(sendableAtMeter))} kW at the meters, ${fmt(nodeInflowOffered)} kW of which would reach the node after each sender's line loss; ` +
      `the feeder allows ${fmt(limits.feederLimitKw)} kW, so ${fmt(nodeInflowAllowed)} kW passed through it and ${fmt(poolAfterNetwork)} kW was left after the shared network's own loss.`,
  );

  // Step 5: divide the pool among the askers.
  let allocatedAtNode: number[];
  switch (limits.rule) {
    case "PROPORTIONAL":
      allocatedAtNode = proportional(toAllocate, needAtNode);
      decisions.push(`Step 5 — rule PROPORTIONAL: ${fmt(toAllocate)} kW was divided in proportion to what each property asked for, and no one was given more than it asked.`);
      break;
    case "EQUAL_SHARE":
      allocatedAtNode = equalShare(toAllocate, needAtNode);
      decisions.push(`Step 5 — rule EQUAL_SHARE: every asking property was given the same amount until its need was met, and what the satisfied could not use was shared again over the rest.`);
      break;
    case "CRITICAL_FIRST": {
      // The part of a deficit that is critical demand its own generation and battery did not reach.
      const criticalNeed = ws.map((w, i) => {
        const covered = w.selfUse + w.discharge;
        const unmetCritical = clamp(w.critical - covered, 0, w.requested);
        return Math.min(unmetCritical / safeFactor(w.input.lineLossFraction), needAtNode[i]!);
      });
      const first = proportional(toAllocate, criticalNeed);
      const left = toAllocate - sum(first);
      const rest = needAtNode.map((n, i) => Math.max(0, n - first[i]!));
      const second = proportional(left, rest);
      allocatedAtNode = first.map((v, i) => v + second[i]!);
      decisions.push(
        `Step 5 — rule CRITICAL_FIRST: ${fmt(sum(first))} kW went to demand the properties had marked as critical and could not cover themselves, before the remaining ${fmt(Math.max(0, left))} kW was divided over the rest in proportion to what was still asked.`,
      );
      break;
    }
    case "NEAREST_FIRST": {
      const order = needAtNode
        .map((_, i) => i)
        .filter((i) => needAtNode[i]! > 0)
        .sort((a, b) => ws[a]!.input.lineLossFraction - ws[b]!.input.lineLossFraction || ws[a]!.input.name.localeCompare(ws[b]!.input.name));
      allocatedAtNode = greedy(toAllocate, needAtNode, order);
      decisions.push(`Step 5 — rule NEAREST_FIRST: the pool filled the properties with the smallest line loss first, so the least energy was lost carrying it. Order: ${order.map((i) => ws[i]!.input.name).join(", ") || "none"}.`);
      break;
    }
  }

  // What the allocation actually required at the node, and back through the senders.
  const allocatedTotal = sum(allocatedAtNode);
  const nodeInflowRequired = allocatedTotal / safeFactor(limits.networkLossFraction);
  const senderWeights = sendableAtMeter.map((s, i) => s * safeFactor(ws[i]!.input.lineLossFraction));
  const weightTotal = sum(senderWeights);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    const shareAtNode = weightTotal > TOLERANCE_KW ? (nodeInflowRequired * senderWeights[i]!) / weightTotal : 0;
    w.sent = Math.min(sendableAtMeter[i]!, shareAtNode / safeFactor(w.input.lineLossFraction));
    w.allocated = allocatedAtNode[i]!;
    w.received = w.allocated * safeFactor(w.input.lineLossFraction);
  }

  // Step 6: the grid picks up whatever the community could not, within what each meter permits.
  for (const w of ws) {
    const leftSurplus = Math.max(0, w.offered - w.sent);
    if (leftSurplus > TOLERANCE_KW) {
      if (limits.batteryPolicy === "SHARE_FIRST") {
        // Nobody wanted it, so now it may as well go into this property's own battery.
        const before = w.charge;
        w.surplus = leftSurplus;
        chargeOwn(w);
        const added = w.charge - before;
        if (added > TOLERANCE_KW) w.offered -= added;
      }
    }
    const stillSurplus = Math.max(0, w.offered - w.sent);
    const exportRoom = Math.max(0, w.input.exportLimitKw - w.sent);
    w.gridExport = Math.min(stillSurplus, exportRoom);
    w.curtailed = Math.max(0, stillSurplus - w.gridExport);
    if (w.curtailed > TOLERANCE_KW) w.binding = "EXPORT_LIMIT";
    else if (stillSurplus > TOLERANCE_KW && w.binding === "NONE") w.binding = "NO_TAKER";

    const stillShort = Math.max(0, w.requested - w.received);
    const importRoom = Math.max(0, w.input.importLimitKw - w.allocated);
    w.gridImport = Math.min(stillShort, importRoom);
    w.unserved = Math.max(0, stillShort - w.gridImport);
    if (w.unserved > TOLERANCE_KW) w.binding = "IMPORT_LIMIT";
    else if (stillShort > TOLERANCE_KW && w.binding === "NONE") w.binding = "NO_SUPPLY";
  }

  const feederFlowKw = sum(ws.map((w) => w.sent * safeFactor(w.input.lineLossFraction)));
  const feederBinding = limits.feederLimitKw > 0 && nodeInflowOffered > limits.feederLimitKw + TOLERANCE_KW && feederFlowKw >= limits.feederLimitKw - TOLERANCE_KW;
  if (feederBinding) {
    for (const w of ws) if (w.unserved > TOLERANCE_KW || (w.requested - w.received > TOLERANCE_KW && w.binding === "NO_SUPPLY")) w.binding = "FEEDER_LIMIT";
    decisions.push(`Step 6 — the feeder was the binding constraint: it carried its full ${fmt(limits.feederLimitKw)} kW while ${fmt(nodeInflowOffered)} kW was on offer, so some deficit went to the grid that the community could otherwise have covered.`);
  }
  const bought = sum(ws.map((w) => w.gridImport));
  const sold = sum(ws.map((w) => w.gridExport));
  const unservedTotal = sum(ws.map((w) => w.unserved));
  decisions.push(
    `Step 7 — the grid covered ${fmt(bought)} kW the community could not and took ${fmt(sold)} kW it could not use` +
      (sum(ws.map((w) => w.curtailed)) > TOLERANCE_KW ? `, and ${fmt(sum(ws.map((w) => w.curtailed)))} kW was curtailed because an export limit would not let it out` : "") +
      (unservedTotal > TOLERANCE_KW ? `. ${fmt(unservedTotal)} kW of demand was left unserved: no supply within the limits could reach it` : "") +
      ".",
  );

  // Pair-level transfers, as a stated convention: each sender divided over the receivers in the proportion they were served.
  const transfers: Transfer[] = [];
  const receivers = ws.filter((w) => w.allocated > TOLERANCE_KW);
  const receivedTotal = sum(receivers.map((w) => w.allocated));
  for (const s of ws) {
    if (s.sent <= TOLERANCE_KW) continue;
    for (const r of receivers) {
      const share = r.allocated / receivedTotal;
      const sentKw = s.sent * share;
      const deliveredKw = sentKw * safeFactor(s.input.lineLossFraction) * safeFactor(limits.networkLossFraction) * safeFactor(r.input.lineLossFraction);
      if (sentKw <= TOLERANCE_KW) continue;
      transfers.push({ fromId: s.input.id, fromName: s.input.name, toId: r.input.id, toName: r.input.name, sentKw: round(sentKw), deliveredKw: round(deliveredKw), lossKw: round(sentKw - deliveredKw) });
    }
  }

  // Energy balance, per member and for the community.
  let maxMemberErrorKw = 0;
  for (const w of ws) {
    const inKw = w.input.generationKw + w.discharge + w.received + w.gridImport;
    const outKw = w.demand - w.unserved + w.charge + w.sent + w.gridExport + w.curtailed;
    maxMemberErrorKw = Math.max(maxMemberErrorKw, Math.abs(inKw - outKw));
  }
  const sentTotal = sum(ws.map((w) => w.sent));
  const deliveredTotal = sum(ws.map((w) => w.received));
  const communityErrorKw = Math.abs(sum(ws.map((w) => w.input.generationKw + w.discharge + w.gridImport)) - sum(ws.map((w) => w.demand - w.unserved + w.charge + w.gridExport + w.curtailed)) - (sentTotal - deliveredTotal));

  const demandTotal = sum(ws.map((w) => w.demand));
  const generationTotal = sum(ws.map((w) => w.input.generationKw));
  const servedTotal = demandTotal - unservedTotal;

  const members: MemberResult[] = ws.map((w) => {
    const parts: string[] = [];
    parts.push(
      w.input.generationKw > TOLERANCE_KW
        ? `Generated ${fmt(w.input.generationKw)} kW and used ${fmt(w.selfUse)} kW of it on site.`
        : `Generated nothing, and needed ${fmt(w.demand)} kW.`,
    );
    if (w.discharge > TOLERANCE_KW) parts.push(`Took ${fmt(w.discharge)} kW from its own battery.`);
    if (w.charge > TOLERANCE_KW) parts.push(`Put ${fmt(w.charge)} kW into its own battery.`);
    if (w.sent > TOLERANCE_KW) parts.push(`Sent ${fmt(w.sent)} kW to the shared node, of which ${fmt(w.sent * safeFactor(w.input.lineLossFraction))} kW reached it.`);
    if (w.received > TOLERANCE_KW) parts.push(`Received ${fmt(w.received)} kW from the community (${fmt(w.allocated)} kW drawn at the node, the difference lost on its own line).`);
    if (w.gridImport > TOLERANCE_KW) parts.push(`Bought ${fmt(w.gridImport)} kW.`);
    if (w.gridExport > TOLERANCE_KW) parts.push(`Sold ${fmt(w.gridExport)} kW.`);
    if (w.curtailed > TOLERANCE_KW) parts.push(`Curtailed ${fmt(w.curtailed)} kW: its export limit of ${fmt(w.input.exportLimitKw)} kW would not let it out.`);
    if (w.unserved > TOLERANCE_KW) parts.push(`${fmt(w.unserved)} kW of its demand went unserved: its import limit of ${fmt(w.input.importLimitKw)} kW was already full.`);
    if (w.binding === "FEEDER_LIMIT") parts.push(`It would have taken more from the community, but the feeder limit of ${fmt(limits.feederLimitKw)} kW was already carrying all it could.`);
    return {
      id: w.input.id,
      name: w.input.name,
      generationKw: round(w.input.generationKw),
      demandKw: round(w.demand),
      selfUseKw: round(w.selfUse),
      batteryDischargeKw: round(w.discharge),
      batteryChargeKw: round(w.charge),
      batterySocKwh: w.soc === null ? null : round(w.soc),
      offeredKw: round(w.offered),
      sentKw: round(w.sent),
      requestedKw: round(w.requested),
      allocatedKw: round(w.allocated),
      receivedKw: round(w.received),
      gridImportKw: round(w.gridImport),
      gridExportKw: round(w.gridExport),
      curtailedKw: round(w.curtailed),
      unservedKw: round(w.unserved),
      status: w.offered > w.requested + TOLERANCE_KW ? "SURPLUS" : w.requested > w.offered + TOLERANCE_KW ? "DEFICIT" : "BALANCED",
      binding: w.binding,
      explanation: parts.join(" "),
    };
  });

  return {
    members,
    transfers,
    totals: {
      members: ws.length,
      generationKw: round(generationTotal),
      demandKw: round(demandTotal),
      selfUseKw: round(sum(ws.map((w) => w.selfUse))),
      offeredKw: round(sum(ws.map((w) => w.offered))),
      requestedKw: round(sum(ws.map((w) => w.requested))),
      sharedSentKw: round(sentTotal),
      sharedDeliveredKw: round(deliveredTotal),
      transferLossKw: round(sentTotal - deliveredTotal),
      batteryChargeKw: round(sum(ws.map((w) => w.charge))),
      batteryDischargeKw: round(sum(ws.map((w) => w.discharge))),
      gridImportKw: round(bought),
      gridExportKw: round(sold),
      curtailedKw: round(sum(ws.map((w) => w.curtailed))),
      unservedKw: round(unservedTotal),
      selfSufficiency: servedTotal > TOLERANCE_KW ? round(clamp((servedTotal - bought) / servedTotal, 0, 1), 4) : null,
      selfConsumption: generationTotal > TOLERANCE_KW ? round(clamp((generationTotal - sold - sum(ws.map((w) => w.curtailed))) / generationTotal, 0, 1), 4) : null,
    },
    limits,
    feederBinding,
    feederFlowKw: round(feederFlowKw),
    check: {
      balanced: maxMemberErrorKw <= TOLERANCE_KW && communityErrorKw <= TOLERANCE_KW,
      maxMemberErrorKw: round(maxMemberErrorKw, 9),
      communityErrorKw: round(communityErrorKw, 9),
      note:
        maxMemberErrorKw <= TOLERANCE_KW && communityErrorKw <= TOLERANCE_KW
          ? "Every property's generation, battery, shared energy and grid energy add up to its demand, and the community's sent and delivered energy differ by exactly the losses reported."
          : "An imbalance above rounding was found; the figures above should not be relied on. This is a defect, please report it.",
    },
    decisions,
  };
}
