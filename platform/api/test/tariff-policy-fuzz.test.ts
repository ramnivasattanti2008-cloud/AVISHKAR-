import { describe, expect, it } from "vitest";
import { residentialSubsidy } from "../src/policy/pmsg.js";
import { type Slab, type TariffShape, type TouBlock, computeBill, validateShape } from "../src/tariff/engine.js";

/**
 * Fuzzing the tariff engine and the subsidy arithmetic (spec section 66), seeded so a failure names its seed. A tariff an owner
 * types in is either refused with a reason, and then never billed, or billed so that every kWh is priced exactly once, the bill
 * never falls as use rises, and the average rate stays between the cheapest and the dearest block. A subsidy is never negative,
 * never above its cap, and never falls as the system grows.
 */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type R = () => number;
const int = (r: R, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const rate = (r: R) => Math.round(r() * 2000) / 100; // 0 to 20 INR per kWh

/** Blocks that tile the day (possibly wrapping midnight), then perhaps one mutation that breaks them. */
function blocks(r: R): TouBlock[] {
  const cuts = [...new Set(Array.from({ length: int(r, 0, 4) }, () => int(r, 1, 47) / 2))].sort((a, b) => a - b);
  const shift = r() < 0.3 ? int(r, 1, 23) : 0; // rotate so a block crosses midnight
  const edges = [0, ...cuts, 24].map((h) => (h + shift) % 24);
  const out: TouBlock[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const s = edges[i]!;
    const e = edges[i + 1]! === shift % 24 && i === edges.length - 2 ? shift % 24 : edges[i + 1]!;
    out.push({ startHour: s, endHour: s === e ? (s + 24) % 24 || 24 : e, rate: rate(r) });
  }
  if (out.length === 1) out[0] = { startHour: 0, endHour: 24, rate: out[0]!.rate };
  switch (r() < 0.35 ? int(r, 0, 5) : -1) {
    case 0:
      out.pop(); // a gap (or nothing at all)
      break;
    case 1:
      out.push({ startHour: 3, endHour: 4, rate: 1 }); // an overlap
      break;
    case 2:
      out[0]!.rate = -1;
      break;
    case 3:
      out[0]!.endHour = Number.NaN;
      break;
    case 4:
      out[0]!.endHour = out[0]!.startHour;
      break;
    case 5:
      out[0]!.rate = 1000;
      break;
  }
  return out;
}

function slabs(r: R): Slab[] | null {
  if (r() < 0.5) return null;
  let up = 0;
  const s: Slab[] = Array.from({ length: int(r, 0, 3) }, () => ({ upToKwhPerMonth: (up += int(r, 1, 300)), rate: rate(r) }));
  s.push({ upToKwhPerMonth: null, rate: rate(r) });
  switch (r() < 0.3 ? int(r, 0, 3) : -1) {
    case 0:
      s[s.length - 1]!.upToKwhPerMonth = up + 100; // the last one closed
      break;
    case 1:
      if (s.length > 1) s[0]!.upToKwhPerMonth = null; // an open slab before the last
      break;
    case 2:
      if (s.length > 2) s[1]!.upToKwhPerMonth = s[0]!.upToKwhPerMonth; // not increasing
      break;
    case 3:
      s.splice(0); // empty
      break;
  }
  return s;
}

function shape(seed: number): TariffShape {
  const r = rng(seed);
  const sl = slabs(r);
  return {
    touBlocks: sl ? [{ startHour: 0, endHour: 24, rate: rate(r) }, ...(r() < 0.1 ? [{ startHour: 0, endHour: 1, rate: 1 }] : [])] : blocks(r),
    slabs: sl,
    fixedCharge: r() < 0.5 ? null : { amountInr: r() < 0.05 ? -5 : int(r, 0, 300), basis: r() < 0.5 ? "PER_CONNECTION_MONTH" : "PER_KW_MONTH" },
  };
}

describe("tariff engine, fuzzed", () => {
  it("refuses a broken tariff with a reason and never bills it; bills a valid one consistently (800 seeds)", () => {
    let valid = 0;
    let refused = 0;
    for (let seed = 1; seed <= 800; seed++) {
      const s = shape(seed);
      const problems = validateShape(s);
      const r = rng(seed * 7919);
      if (problems.length > 0) {
        refused++;
        for (const p of problems) expect(p.length, `seed ${seed}`).toBeGreaterThan(10);
        expect(() => computeBill(s, { monthlyKwh: 100 }), `seed ${seed}`).toThrow(/Tariff is not usable/);
        continue;
      }
      valid++;
      const kwhs = [0, ...Array.from({ length: 6 }, () => Math.round(r() * 200_000) / 100)].sort((a, b) => a - b);
      const share = r() < 0.5 ? undefined : Array.from({ length: 24 }, () => r());
      const sanctionedLoadKw = r() < 0.5 ? undefined : int(r, 1, 20);
      let previous = -Infinity;
      for (const kwh of kwhs) {
        const bill = computeBill(s, { monthlyKwh: kwh, hourShare: share, sanctionedLoadKw });
        const msg = `seed ${seed}, ${kwh} kWh`;
        expect(Number.isFinite(bill.totalInr) && bill.totalInr >= 0, msg).toBe(true);
        expect(bill.totalInr, msg).toBeGreaterThanOrEqual(previous - 0.02); // never cheaper for using more
        previous = bill.totalInr;
        const energyLines = bill.lines.filter((l) => l.kwh !== null);
        expect(energyLines.reduce((a, l) => a + l.kwh!, 0), msg).toBeCloseTo(kwh, 2); // every kWh priced exactly once
        expect(bill.energyChargeInr, msg).toBeCloseTo(energyLines.reduce((a, l) => a + l.amountInr, 0), 1);
        const rates = s.slabs ? s.slabs.map((x) => x.rate) : s.touBlocks.map((b) => b.rate);
        if (kwh > 1) {
          const avg = bill.energyChargeInr / kwh;
          expect(avg, msg).toBeGreaterThanOrEqual(Math.min(...rates) - 0.01);
          expect(avg, msg).toBeLessThanOrEqual(Math.max(...rates) + 0.01);
        }
      }
    }
    // the generator is only useful if it produces both kinds in quantity
    expect(valid).toBeGreaterThan(200);
    expect(refused).toBeGreaterThan(100);
  });

  it("refuses a negative or non-finite monthly use", () => {
    const flat: TariffShape = { touBlocks: [{ startHour: 0, endHour: 24, rate: 6 }], slabs: null, fixedCharge: null };
    for (const kwh of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => computeBill(flat, { monthlyKwh: kwh })).toThrow(/zero or more/);
  });
});

describe("subsidy arithmetic, fuzzed", () => {
  it("is never negative, never above the cap, never falls as the system grows (500 seeded rules)", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(seed);
      let up = 0;
      const rule = { tiers: Array.from({ length: int(r, 1, 4) }, () => ({ upToKw: (up += int(r, 1, 6)), inrPerKw: int(r, 0, 40_000) })), capInr: int(r, 1, 150_000) };
      if (r() < 0.3) rule.tiers.reverse(); // the order in the file must not matter
      const sizes = [0, ...Array.from({ length: 8 }, () => Math.round(r() * 2000) / 100)].sort((a, b) => a - b);
      let previous = 0;
      for (const kwp of sizes) {
        const s = residentialSubsidy(rule, kwp);
        const msg = `seed ${seed}, ${kwp} kWp`;
        expect(s.subsidyInr, msg).toBeGreaterThanOrEqual(0);
        expect(s.subsidyInr, msg).toBeLessThanOrEqual(rule.capInr);
        expect(s.subsidyInr, msg).toBeGreaterThanOrEqual(previous - 1e-9);
        expect(s.capApplied, msg).toBe(s.uncappedInr > rule.capInr);
        // the kW paid for are the system up to the largest tier, counted once
        expect(s.steps.reduce((a, x) => a + x.kw, 0), msg).toBeCloseTo(Math.min(kwp, up), 9);
        previous = s.subsidyInr;
      }
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(residentialSubsidy(rule, bad).subsidyInr).toBe(0);
    }
  });
});
