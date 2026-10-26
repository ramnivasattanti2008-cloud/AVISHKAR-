import { describe, expect, it } from "vitest";
import { type FutureInputs, type FutureParams, futureDefs, outageSteps } from "../src/futures/scenarios.js";

// 10:00 on the local clock (IST) on 7 October 2026: step 0 of the horizon
const START = Date.parse("2026-10-07T04:30:00Z");
const PARAMS: FutureParams = { rainSolarPercent: 20, outage: { startHour: 18, hours: 4 } };
const flat = (v: number, n = 24) => new Array<number>(n).fill(v);

function inputs(over: Partial<FutureInputs> = {}): FutureInputs {
  const sun = [...flat(0, 6), 1, 2, 3, 4, 4, 3, 2, 1, ...flat(0, 10)];
  return { startMs: START, steps: 24, pv: sun, pvLow: sun.map((v) => v / 2), pvHigh: sun.map((v) => v * 1.5), loadHigh: flat(2), hasBattery: true, criticalKw: 0.5, ...over };
}
const by = (defs: ReturnType<typeof futureDefs>, key: string) => defs.find((d) => d.key === key)!;

describe("where an outage falls on the horizon", () => {
  it("starts at the first step that begins at the hour asked for, and lasts the hours asked for", () => {
    expect(outageSteps(START, 24, 18, 4)).toEqual({ startStep: 8, endStep: 12, cut: false }); // 10:00 + 8 h = 18:00
    expect(outageSteps(START, 24, 22, 2)).toEqual({ startStep: 12, endStep: 14, cut: false });
  });
  it("starts now when the hour asked for is the current one", () => {
    expect(outageSteps(START, 24, 10, 3)).toEqual({ startStep: 0, endStep: 3, cut: false });
  });
  it("is cut at the end of the 24 hours, and says so", () => {
    expect(outageSteps(START, 24, 8, 4)).toEqual({ startStep: 22, endStep: 24, cut: true }); // 8 am the next day is step 22
  });
});

describe("the futures: each says what it is built from", () => {
  const defs = futureDefs(inputs(), PARAMS);

  it("has the expected day first and every other future after it, in a fixed order", () => {
    expect(defs.map((d) => d.key)).toEqual(["expected", "sunny", "heavyCloud", "rain", "highDemand", "batteryOffline", "outage", "stress"]);
    expect(by(defs, "expected")).toMatchObject({ basis: "REFERENCE", unavailable: null, patch: {} });
  });

  it("takes the sunny and cloudy days from the ends of the forecast's own band, and says they are data", () => {
    const i = inputs();
    expect(by(defs, "sunny")).toMatchObject({ basis: "DATA", unavailable: null, patch: { pvKw: i.pvHigh } });
    expect(by(defs, "heavyCloud")).toMatchObject({ basis: "DATA", unavailable: null, patch: { pvKw: i.pvLow } });
    expect(by(defs, "sunny").built).toMatch(/1 hour in 10/);
  });

  it("makes the rainy day a share of the expected sun that the person sets, and calls it an assumption", () => {
    const r = by(defs, "rain");
    expect(r.basis).toBe("ASSUMPTION");
    expect(r.built).toContain("20%");
    expect(r.built).toContain("your assumption");
    const sun = inputs().pv;
    expect(r.patch.pvKw).toEqual(sun.map((v) => Math.round(v * 0.2 * 10_000) / 10_000));
    expect(by(futureDefs(inputs(), { ...PARAMS, rainSolarPercent: 100 }), "rain").patch.pvKw).toEqual(sun);
  });

  it("takes the high-demand day from the load forecast's own band", () => {
    expect(by(defs, "highDemand")).toMatchObject({ basis: "DATA", unavailable: null, patch: { loadKw: flat(2) } });
  });

  it("asks the outage as a question, in steps on the local clock, and says the planner knows it is coming", () => {
    const o = by(defs, "outage");
    expect(o.basis).toBe("ASSUMPTION");
    expect(o.patch.grid).toEqual({ outages: [{ startStep: 8, endStep: 12 }] });
    expect(o.built).toContain("6 pm for 4 hour(s)");
    expect(o.built).toMatch(/A question, not a forecast/);
    expect(o.built).toMatch(/no warning would be worse/);
  });

  it("puts heavy cloud, high demand and the outage together in the stress day", () => {
    const s = by(defs, "stress");
    const i = inputs();
    expect(s.unavailable).toBeNull();
    expect(s.patch).toMatchObject({ pvKw: i.pvLow, loadKw: i.loadHigh, grid: { outages: [{ startStep: 8, endStep: 12 }] } });
  });
});

describe("a future that cannot be run says why, and is not made up", () => {
  it("has no sunny or cloudy day when the forecast has no calibrated band", () => {
    const defs = futureDefs(inputs({ pvLow: null, pvHigh: null }), PARAMS);
    for (const k of ["sunny", "heavyCloud", "stress"]) expect(by(defs, k).unavailable, k).toMatch(/no calibrated band/);
    expect(by(defs, "rain").unavailable).toBeNull(); // a share of the expected sun needs no band
  });
  it("has no weather day without solar", () => {
    const defs = futureDefs(inputs({ pv: flat(0), pvLow: null, pvHigh: null }), PARAMS);
    for (const k of ["sunny", "heavyCloud", "rain"]) expect(by(defs, k).unavailable, k).toMatch(/no solar system/);
    expect(by(defs, "highDemand").unavailable).toBeNull();
  });
  it("has no battery outage without a battery", () => {
    expect(by(futureDefs(inputs({ hasBattery: false }), PARAMS), "batteryOffline").unavailable).toMatch(/no battery entered/);
  });
  it("has no outage without a critical load", () => {
    const defs = futureDefs(inputs({ criticalKw: 0 }), PARAMS);
    for (const k of ["outage", "stress"]) expect(by(defs, k).unavailable, k).toMatch(/No appliance is marked CRITICAL/);
  });
  it("has no high-demand day without a load band", () => {
    const defs = futureDefs(inputs({ loadHigh: null }), PARAMS);
    expect(by(defs, "highDemand").unavailable).toMatch(/no band/);
    expect(by(defs, "stress").unavailable).toMatch(/no band/);
  });
});
