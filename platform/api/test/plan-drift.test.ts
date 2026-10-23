import { describe, expect, it } from "vitest";
import { calculateDrift } from "../src/plan/drift.js";

describe("calculateDrift", () => {
  it("handles empty observations gracefully", () => {
    const res = calculateDrift([], [1.0, 1.0, 1.0]);
    expect(res.driftPercent).toBe(0);
    expect(res.replanRecommended).toBe(false);
  });

  it("calculates accurate drift percentage under tolerance", () => {
    // 5% higher consumption
    const observed = [1.05, 1.05, 1.05];
    const planned = [1.0, 1.0, 1.0];
    const res = calculateDrift(observed, planned, 15);
    expect(res.driftPercent).toBe(5);
    expect(res.replanRecommended).toBe(false);
  });

  it("flags replanRecommended when drift exceeds threshold", () => {
    // 25% higher consumption: observed 1.25 kW vs planned 1.0 kW
    const observed = [1.25, 1.25, 1.25];
    const planned = [1.0, 1.0, 1.0];
    const res = calculateDrift(observed, planned, 15);
    expect(res.driftPercent).toBe(25);
    expect(res.replanRecommended).toBe(true);
  });

  it("handles negative drift (solar surge or demand drop)", () => {
    // 30% lower consumption
    const observed = [0.7, 0.7, 0.7];
    const planned = [1.0, 1.0, 1.0];
    const res = calculateDrift(observed, planned, 15);
    expect(res.driftPercent).toBe(30);
    expect(res.replanRecommended).toBe(true);
  });
});
