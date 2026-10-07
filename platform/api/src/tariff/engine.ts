/**
 * Tariff engine (spec section 22): pure arithmetic over a tariff's shape. No database, no network, no hidden defaults.
 *
 * A plan has time-of-day blocks (a flat tariff is one block covering 24 hours) or, instead, telescopic slabs. Hours are local
 * time and a block's end is exclusive; a block may wrap midnight (start after end), as in the Python EMS.
 */

export interface TouBlock {
  /** 0 to 24, may be fractional (6.5 is 06:30). */
  startHour: number;
  endHour: number;
  /** INR per kWh. */
  rate: number;
}

export interface Slab {
  /** Upper bound of this slab in kWh per month; null for the last, open-ended slab. */
  upToKwhPerMonth: number | null;
  rate: number;
}

export type FixedChargeBasis = "PER_CONNECTION_MONTH" | "PER_KW_MONTH";

export interface TariffShape {
  touBlocks: TouBlock[];
  slabs: Slab[] | null;
  fixedCharge: { amountInr: number; basis: FixedChargeBasis } | null;
}

export const MAX_RATE_INR_PER_KWH = 100;
const MINUTES = 1440;

/** True when the block covers the given minute of the day (0..1439). */
function covers(b: TouBlock, minute: number): boolean {
  const s = Math.round(b.startHour * 60);
  const e = Math.round(b.endHour * 60);
  return s < e ? minute >= s && minute < e : minute >= s || minute < e;
}

/** How many blocks cover each minute of the day. Valid tariffs have exactly one everywhere. */
function coverage(blocks: TouBlock[]): number[] {
  const count = new Array<number>(MINUTES).fill(0);
  for (const b of blocks) for (let m = 0; m < MINUTES; m++) if (covers(b, m)) count[m]!++;
  return count;
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Contiguous minute ranges where the predicate holds, as readable "hh:mm to hh:mm" text. */
function ranges(count: number[], bad: (c: number) => boolean): string[] {
  const out: string[] = [];
  let from: number | null = null;
  for (let m = 0; m <= MINUTES; m++) {
    const isBad = m < MINUTES && bad(count[m]!);
    if (isBad && from === null) from = m;
    if (!isBad && from !== null) {
      out.push(`${clock(from)} to ${clock(m % MINUTES)}`);
      from = null;
    }
  }
  return out;
}

/** Everything wrong with a tariff's shape, in plain words; an empty list means it is usable. */
export function validateShape(shape: TariffShape): string[] {
  const problems: string[] = [];
  const { touBlocks: blocks, slabs, fixedCharge } = shape;
  if (blocks.length === 0) problems.push("Add at least one time-of-day block (a flat tariff is one block from 0 to 24).");
  for (const [i, b] of blocks.entries()) {
    const n = i + 1;
    if (![b.startHour, b.endHour, b.rate].every(Number.isFinite)) problems.push(`Block ${n} has a value that is not a number.`);
    else {
      if (b.startHour < 0 || b.startHour > 24 || b.endHour < 0 || b.endHour > 24) problems.push(`Block ${n}: hours must be between 0 and 24.`);
      if (b.startHour === b.endHour) problems.push(`Block ${n}: start and end hour are the same, so it covers nothing (use 0 to 24 for a whole day).`);
      if (b.rate < 0 || b.rate > MAX_RATE_INR_PER_KWH) problems.push(`Block ${n}: a rate of ${b.rate} INR/kWh is outside 0 to ${MAX_RATE_INR_PER_KWH}.`);
    }
  }
  if (problems.length === 0) {
    const count = coverage(blocks);
    const gaps = ranges(count, (c) => c === 0);
    const overlaps = ranges(count, (c) => c > 1);
    if (gaps.length) problems.push(`The blocks leave these times without a rate: ${gaps.join(", ")}.`);
    if (overlaps.length) problems.push(`The blocks overlap at: ${overlaps.join(", ")}.`);
  }
  if (slabs) {
    if (slabs.length === 0) problems.push("Slabs, if given, need at least one entry.");
    let prev = 0;
    for (const [i, s] of slabs.entries()) {
      const n = i + 1;
      const last = i === slabs.length - 1;
      if (!Number.isFinite(s.rate) || s.rate < 0 || s.rate > MAX_RATE_INR_PER_KWH) problems.push(`Slab ${n}: a rate of ${s.rate} INR/kWh is outside 0 to ${MAX_RATE_INR_PER_KWH}.`);
      if (s.upToKwhPerMonth === null) {
        if (!last) problems.push(`Slab ${n}: only the last slab can be open-ended.`);
      } else {
        if (!Number.isFinite(s.upToKwhPerMonth) || s.upToKwhPerMonth <= prev) problems.push(`Slab ${n}: the upper limit must be above the previous slab's (${prev} kWh).`);
        else prev = s.upToKwhPerMonth;
        if (last) problems.push("The last slab must be open-ended (no upper limit) so every kWh has a price.");
      }
    }
    if (blocks.length > 1) problems.push("A plan has either slabs or several time-of-day blocks, not both: enter one flat block with the slabs.");
  }
  if (fixedCharge && (!Number.isFinite(fixedCharge.amountInr) || fixedCharge.amountInr < 0)) problems.push("The fixed charge must be zero or more.");
  return problems;
}

/** Rate in force at a minute of the day, or null if no block covers it (an invalid tariff). */
export function rateAtMinute(blocks: TouBlock[], minute: number): number | null {
  const hit = blocks.find((b) => covers(b, minute));
  return hit ? hit.rate : null;
}

/**
 * The rate for each hour of the day, 24 values: the time-weighted average of the blocks inside that hour, so a block that
 * starts at 06:30 shows up as half of the 06:00 hour. Slabs are not time based and are not part of this.
 */
export function hourlyRates(blocks: TouBlock[]): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    let sum = 0;
    for (let m = h * 60; m < h * 60 + 60; m++) sum += rateAtMinute(blocks, m) ?? Number.NaN;
    return round(sum / 60, 4);
  });
}

export interface BillInput {
  monthlyKwh: number;
  /** Share of consumption in each hour of the day (24 values, any scale); uniform when absent. */
  hourShare?: number[];
  /** Sanctioned or contract load, needed for a fixed charge billed per kW. */
  sanctionedLoadKw?: number;
}

export interface BillLine {
  label: string;
  kwh: number | null;
  rate: number | null;
  amountInr: number;
}

export interface Bill {
  energyChargeInr: number;
  /** null when the plan has a fixed charge that could not be priced (per-kW charge without a sanctioned load). */
  fixedChargeInr: number | null;
  fixedChargeIncluded: boolean;
  totalInr: number;
  /** Average price per kWh actually paid, fixed charge included when it is. */
  effectiveRate: number | null;
  lines: BillLine[];
  /** What the figures assume and what they leave out, in plain words. */
  assumptions: string[];
}

const round = (v: number, digits = 2): number => {
  const f = 10 ** digits;
  return Math.round((v + Number.EPSILON) * f) / f;
};

/** Normalise a load shape to shares that sum to 1; null when it is unusable. */
export function normaliseShare(share: number[] | undefined): number[] | null {
  if (!share) return Array.from({ length: 24 }, () => 1 / 24);
  if (share.length !== 24 || share.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const total = share.reduce((a, b) => a + b, 0);
  return total > 0 ? share.map((v) => v / total) : null;
}

/** A monthly bill for a given usage under a plan. The caller labels the result ESTIMATED: usage is an input, not a reading. */
export function computeBill(shape: TariffShape, input: BillInput): Bill {
  const problems = validateShape(shape);
  if (problems.length) throw new Error(`Tariff is not usable: ${problems[0]}`);
  if (!Number.isFinite(input.monthlyKwh) || input.monthlyKwh < 0) throw new Error("Monthly consumption must be zero or more.");
  const kwh = input.monthlyKwh;
  const lines: BillLine[] = [];
  const assumptions: string[] = [];

  if (shape.slabs) {
    let prev = 0;
    let remaining = kwh;
    for (const s of shape.slabs) {
      const upTo = s.upToKwhPerMonth ?? Number.POSITIVE_INFINITY;
      const take = Math.min(remaining, upTo - prev);
      if (take > 0) lines.push({ label: s.upToKwhPerMonth === null ? `Above ${prev} kWh` : `${prev} to ${s.upToKwhPerMonth} kWh`, kwh: round(take, 3), rate: s.rate, amountInr: round(take * s.rate) });
      remaining -= Math.max(take, 0);
      prev = Number.isFinite(upTo) ? upTo : prev;
      if (remaining <= 0) break;
    }
  } else {
    const share = normaliseShare(input.hourShare);
    if (!share) throw new Error("The hourly usage shape must be 24 non-negative numbers that are not all zero.");
    const rates = hourlyRates(shape.touBlocks);
    const avg = rates.reduce((s, r, h) => s + r * share[h]!, 0);
    if (!input.hourShare && shape.touBlocks.length > 1) assumptions.push("Usage is assumed to be spread evenly over the 24 hours; a real profile changes the bill because the rate depends on the time of day.");
    lines.push({
      label: shape.touBlocks.length > 1 ? "Energy at the usage-weighted time-of-day rate" : "Energy at the flat rate",
      kwh: round(kwh, 3),
      rate: round(avg, 4),
      amountInr: round(kwh * avg),
    });
  }
  const energy = round(lines.reduce((s, l) => s + l.amountInr, 0));

  let fixed: number | null = null;
  if (shape.fixedCharge) {
    if (shape.fixedCharge.basis === "PER_CONNECTION_MONTH") fixed = round(shape.fixedCharge.amountInr);
    else if (input.sanctionedLoadKw !== undefined && Number.isFinite(input.sanctionedLoadKw) && input.sanctionedLoadKw > 0) fixed = round(shape.fixedCharge.amountInr * input.sanctionedLoadKw);
    else assumptions.push(`This plan has a fixed charge of ${shape.fixedCharge.amountInr} INR per kW per month; give the sanctioned load to include it. It is not in the total.`);
    if (fixed !== null) lines.push({ label: shape.fixedCharge.basis === "PER_KW_MONTH" ? `Fixed charge, ${input.sanctionedLoadKw} kW` : "Fixed charge", kwh: null, rate: null, amountInr: fixed });
  } else {
    assumptions.push("No fixed charge is recorded for this plan, so the total is energy charges only; a real bill may add fixed charges, duties and taxes.");
  }
  assumptions.push("Electricity duty, taxes and surcharges are not included.");

  const total = round(energy + (fixed ?? 0));
  return {
    energyChargeInr: energy,
    fixedChargeInr: fixed,
    fixedChargeIncluded: fixed !== null,
    totalInr: total,
    effectiveRate: kwh > 0 ? round(total / kwh, 4) : null,
    lines,
    assumptions,
  };
}

export type Validity = "WITHIN" | "EXPIRED" | "NOT_YET_EFFECTIVE" | "OPEN_ENDED" | "UNKNOWN";

/**
 * Whether the plan's published validity period covers `on`. Dates are calendar days. A plan with no end date is
 * OPEN_ENDED (the source stated none; a newer order may exist), one with no dates at all is UNKNOWN.
 */
export function validityOn(effectiveFrom: Date | null, effectiveTo: Date | null, on: Date): { status: Validity; message: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const today = day(on);
  if (effectiveFrom && day(effectiveFrom) > today) return { status: "NOT_YET_EFFECTIVE", message: `This tariff takes effect on ${day(effectiveFrom)}.` };
  if (effectiveTo) {
    if (day(effectiveTo) < today) return { status: "EXPIRED", message: `The source covers the period to ${day(effectiveTo)}. A newer order has probably replaced it: check your latest bill or enter your current rates.` };
    return { status: "WITHIN", message: `Valid to ${day(effectiveTo)}.` };
  }
  if (effectiveFrom) return { status: "OPEN_ENDED", message: `In force from ${day(effectiveFrom)}; the source states no end date, so a newer order may exist.` };
  return { status: "UNKNOWN", message: "The source does not say when this tariff applies. Check it against your latest bill." };
}
