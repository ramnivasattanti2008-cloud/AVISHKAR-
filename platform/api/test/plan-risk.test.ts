import { describe, expect, it } from "vitest";
import { CENTRAL_WEIGHT, RISK_ALPHA, riskDays, riskRequest, riskSummary } from "../src/plan/risk.js";

const pv = [0, 2, 0];
const load = [1, 1, 3];
const pvLow = [0, 1, 0];
const loadHigh = [1.2, 1.3, 4];

describe("riskDays", () => {
  it("uses only the bad ends of bands that exist, and never more sun", () => {
    expect(riskDays({ pvLow: null, pvHigh: null, loadLow: null, loadHigh: null }, pv, load)).toEqual([]);
    expect(riskDays({ pvLow, pvHigh: [0, 3, 0], loadLow: null, loadHigh: null }, pv, load).map((d) => d.label)).toEqual(["Less sun than expected"]);
    const all = riskDays({ pvLow, pvHigh: [0, 3, 0], loadLow: [0.8, 0.8, 2], loadHigh }, pv, load);
    expect(all.map((d) => [d.label, d.pvKw, d.loadKw])).toEqual([
      ["Less sun than expected", pvLow, load],
      ["More demand than expected", pv, loadHigh],
      ["Less sun and more demand", pvLow, loadHigh],
    ]);
  });
});

describe("riskRequest", () => {
  const days = riskDays({ pvLow, pvHigh: null, loadLow: null, loadHigh }, pv, load);

  it("is nothing without days or without aversion", () => {
    expect(riskRequest([], 1)).toBeNull();
    expect(riskRequest(days, 0)).toBeNull();
  });

  it("gives the central forecast its weight and shares the rest equally", () => {
    const r = riskRequest(days, 0.7)!;
    expect(r).toMatchObject({ centralWeight: CENTRAL_WEIGHT, alpha: RISK_ALPHA, aversion: 0.7 });
    expect(r.scenarios.map((s) => s.weight)).toEqual([0.5 / 3, 0.5 / 3, 0.5 / 3]);
    expect(r.scenarios[2]).toMatchObject({ label: "Less sun and more demand", loadKw: loadHigh, pvKw: pvLow });
  });
});

describe("riskSummary", () => {
  it("says how each day was built, which is dearest, and that weights are not probabilities", () => {
    const days = riskDays({ pvLow, pvHigh: null, loadLow: null, loadHigh: null }, pv, load);
    const s = riskSummary(
      {
        alpha: 0.8,
        aversion: 1,
        scenarios: [
          { label: "central forecast", weight: 0.5, netCostInr: 20, importKwh: 3, exportKwh: 0, unservedKwh: 0 },
          { label: "Less sun than expected", weight: 0.5, netCostInr: 26.5, importKwh: 4, exportKwh: 0, unservedKwh: 0 },
        ],
        expectedNetCostInr: 23.25,
        cvarNetCostInr: 26.5,
      },
      days,
    );
    expect(s.scenarios[0]!.built).toMatch(/central estimate/);
    expect(s.scenarios[1]!.built).toMatch(/lower end of the solar forecast/);
    expect(s.statement).toContain('"Less sun than expected", would cost ₹26.50');
    expect(s.statement).toContain("worst 20% of weight");
    expect(s.statement).toContain("not probabilities");
  });
});
