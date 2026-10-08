/**
 * The money arithmetic of an investment (spec sections 33 and 62): payback, discounted payback, net present value and internal
 * rate of return of a stream of yearly savings against what was paid up front. Pure. Every figure is an input or a stated
 * assumption: a saving that falls over the years because the equipment ages, one that rises with the tariff, a discount rate.
 */

export interface EconomicsInput {
  /** Paid up front, INR. */
  investmentInr: number;
  /** The saving in the first year, INR. */
  annualSavingsInr: number;
  /** Years the equipment is expected to keep earning that saving. */
  years: number;
  /** Per year, as a fraction (0.08 is 8%). */
  discountRate: number;
  /** Yearly rise in the tariff, as a fraction: the saving grows by this. */
  tariffEscalation: number;
  /** Yearly loss of output from ageing, as a fraction: the saving shrinks by this. */
  degradation: number;
}

export interface Cashflow {
  year: number;
  savingsInr: number;
  cumulativeInr: number;
  discountedCumulativeInr: number;
}

export interface Economics {
  /** Years until the cumulative saving covers the investment, counting part of a year; null if it never does within the life. */
  paybackYears: number | null;
  discountedPaybackYears: number | null;
  /** Present value of the savings minus the investment. */
  npvInr: number;
  /** Per cent; null when no rate makes the net present value zero in the range searched (-99% to 1000%). */
  irrPercent: number | null;
  /** Savings over the life, undiscounted, minus the investment. */
  netGainInr: number;
  cashflows: Cashflow[];
}

const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

export function yearlySavings(i: Pick<EconomicsInput, "annualSavingsInr" | "years" | "tariffEscalation" | "degradation">): number[] {
  const g = (1 + i.tariffEscalation) * (1 - i.degradation);
  return Array.from({ length: i.years }, (_, t) => i.annualSavingsInr * g ** t);
}

const npvAt = (rate: number, invest: number, flows: number[]): number => flows.reduce((a, s, t) => a + s / (1 + rate) ** (t + 1), -invest);

/** First fractional year at which a running total reaches the target, or null. */
function crossing(flows: number[], target: number): number | null {
  let acc = 0;
  for (let t = 0; t < flows.length; t++) {
    const next = acc + flows[t]!;
    if (next >= target) return flows[t]! > 0 ? t + (target - acc) / flows[t]! : t + 1;
    acc = next;
  }
  return null;
}

export function economics(i: EconomicsInput): Economics {
  const flows = yearlySavings(i);
  const disc = flows.map((s, t) => s / (1 + i.discountRate) ** (t + 1));
  let cum = 0;
  let dcum = 0;
  const cashflows = flows.map((s, t) => {
    cum += s;
    dcum += disc[t]!;
    return { year: t + 1, savingsInr: round(s, 2), cumulativeInr: round(cum - i.investmentInr, 2), discountedCumulativeInr: round(dcum - i.investmentInr, 2) };
  });
  // IRR by bisection: the net present value falls as the rate rises, so one sign change brackets the root
  let irr: number | null = null;
  let lo = -0.99;
  let hi = 10;
  if (i.investmentInr > 0 && npvAt(lo, i.investmentInr, flows) > 0 && npvAt(hi, i.investmentInr, flows) < 0) {
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2;
      if (npvAt(mid, i.investmentInr, flows) > 0) lo = mid;
      else hi = mid;
    }
    irr = (lo + hi) / 2;
  }
  const payback = crossing(flows, i.investmentInr);
  const dpayback = crossing(disc, i.investmentInr);
  return {
    paybackYears: payback === null ? null : round(payback, 2),
    discountedPaybackYears: dpayback === null ? null : round(dpayback, 2),
    npvInr: round(disc.reduce((a, b) => a + b, 0) - i.investmentInr, 2),
    irrPercent: irr === null ? null : round(irr * 100, 2),
    netGainInr: round(flows.reduce((a, b) => a + b, 0) - i.investmentInr, 2),
    cashflows,
  };
}
