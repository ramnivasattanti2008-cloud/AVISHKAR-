import { describe, expect, it } from "vitest";
import { type HomeParams, drawFleet, lognormal, normal, rng } from "../src/vpp/sample.js";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

describe("the seeded generator", () => {
  it("repeats for the same seed, differs for another, and stays inside [0, 1)", () => {
    const a = rng(7);
    const b = rng(7);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs).not.toEqual(Array.from({ length: 50 }, ((c) => () => c())(rng(8))));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });

  it("is uniform enough: the mean of 100,000 draws is 0.5 and a tenth fall in each tenth", () => {
    const r = rng(1);
    const xs = Array.from({ length: 100_000 }, () => r());
    expect(mean(xs)).toBeCloseTo(0.5, 2);
    for (let k = 0; k < 10; k++) expect(xs.filter((x) => x >= k / 10 && x < (k + 1) / 10).length / xs.length).toBeCloseTo(0.1, 2);
  });
});

describe("the distributions", () => {
  it("normal draws have mean 0 and standard deviation 1", () => {
    const r = rng(2);
    const xs = Array.from({ length: 100_000 }, () => normal(r));
    expect(mean(xs)).toBeCloseTo(0, 1);
    expect(sd(xs)).toBeCloseTo(1, 1);
  });

  it("lognormal draws have the mean and the spread asked for, and are never negative", () => {
    const r = rng(3);
    const xs = Array.from({ length: 200_000 }, () => lognormal(r, 3, 0.4));
    expect(mean(xs)).toBeCloseTo(3, 1);
    expect(sd(xs) / mean(xs)).toBeCloseTo(0.4, 1);
    expect(xs.reduce((m, x) => Math.min(m, x), Infinity)).toBeGreaterThan(0);
  });

  it("with no spread every draw is the mean", () => {
    const r = rng(4);
    expect(Array.from({ length: 5 }, () => lognormal(r, 3, 0))).toEqual([3, 3, 3, 3, 3]);
  });
});

const params = (over: Partial<HomeParams> = {}): HomeParams => ({ homes: 10_000, pvSharePercent: 30, pvKwpMean: 3, pvKwpCv: 0.3, batterySharePercent: 10, batteryKwhMean: 5, evSharePercent: 5, loadCv: 0.35, seed: 1, ...over });

describe("drawFleet", () => {
  it("describes the same homes for the same seed, and others for another", () => {
    expect(drawFleet(params())).toEqual(drawFleet(params()));
    expect(drawFleet(params({ seed: 2 }))).not.toEqual(drawFleet(params()));
  });

  it("follows the shares and sizes asked for, with batteries only among the homes that have solar", () => {
    const f = drawFleet(params());
    expect(f.homes).toBe(10_000);
    expect(f.withPv / f.homes).toBeCloseTo(0.3, 1); // 30% have solar
    expect(f.withBattery / f.withPv).toBeCloseTo(0.1, 1); // 10% of those have a battery
    expect(f.withEv / f.homes).toBeCloseTo(0.05, 1);
    expect(f.pvKwp / f.withPv).toBeCloseTo(3, 1);
    expect(f.batteryKwh / f.withBattery).toBeCloseTo(5, 0);
    expect(f.loadScale / f.homes).toBeCloseTo(1, 1);
    expect(f.withBattery).toBeLessThanOrEqual(f.withPv);
  });

  it("zero shares give none, a hundred give all, and no spread gives exact sizes", () => {
    const none = drawFleet(params({ homes: 1000, pvSharePercent: 0, evSharePercent: 0 }));
    expect(none).toMatchObject({ withPv: 0, withBattery: 0, withEv: 0, pvKwp: 0, batteryKwh: 0 });
    const all = drawFleet(params({ homes: 200, pvSharePercent: 100, batterySharePercent: 100, evSharePercent: 100, pvKwpCv: 0, loadCv: 0 }));
    expect(all).toMatchObject({ withPv: 200, withBattery: 200, withEv: 200, pvKwp: 600, loadScale: 200 });
  });

  it("ten homes is ten homes: small fleets are as small as they say", () => {
    const f = drawFleet(params({ homes: 10 }));
    expect(f.withPv).toBeLessThanOrEqual(10);
    expect(f.homes).toBe(10);
  });
});
