import { describe, expect, it } from "vitest";
import { ASSUMPTIONS, completeness, estimatePv, nextDayIrradiation } from "../src/twin/estimate.js";

describe("estimatePv", () => {
  it("derives usable area, capacity, yield and daily generation from roof area and irradiation", () => {
    const e = estimatePv({ roofAreaM2: 120, ghiKwhM2Day: 5.5 });
    expect(e.usableAreaM2).toBeCloseTo(120 * ASSUMPTIONS.usableRoofFraction.value, 9);
    expect(e.capacityKw).toBeCloseTo(60 * ASSUMPTIONS.kwpPerM2Usable.value, 9); // 6 kWp
    expect(e.yieldKwhPerKwpDay).toBeCloseTo(5.5 * 0.75, 9);
    expect(e.dailyGenerationKwh).toBeCloseTo(6 * 5.5 * 0.75, 9);
  });

  it("never guesses a roof: without an outline there is yield per kWp but no capacity or generation", () => {
    const e = estimatePv({ roofAreaM2: null, ghiKwhM2Day: 5.5 });
    expect(e).toEqual({ usableAreaM2: null, capacityKw: null, yieldKwhPerKwpDay: 5.5 * 0.75, dailyGenerationKwh: null });
    expect(estimatePv({ roofAreaM2: 0, ghiKwhM2Day: 5.5 }).capacityKw).toBeNull();
  });

  it("has nothing to say about yield without irradiation", () => {
    expect(estimatePv({ roofAreaM2: 100, ghiKwhM2Day: null })).toMatchObject({ yieldKwhPerKwpDay: null, dailyGenerationKwh: null, capacityKw: 5 });
    expect(estimatePv({ roofAreaM2: -3, ghiKwhM2Day: Number.NaN })).toEqual({ usableAreaM2: null, capacityKw: null, yieldKwhPerKwpDay: null, dailyGenerationKwh: null });
  });

  it("is monotonic: more roof or more sun never means less energy", () => {
    const a = estimatePv({ roofAreaM2: 50, ghiKwhM2Day: 4 }).dailyGenerationKwh!;
    expect(estimatePv({ roofAreaM2: 80, ghiKwhM2Day: 4 }).dailyGenerationKwh!).toBeGreaterThan(a);
    expect(estimatePv({ roofAreaM2: 50, ghiKwhM2Day: 6 }).dailyGenerationKwh!).toBeGreaterThan(a);
  });

  it("states every assumption with a unit and a reason", () => {
    for (const a of Object.values(ASSUMPTIONS)) {
      expect(a.key).toMatch(/^[a-z0-9_]+$/);
      expect(a.unit.length).toBeGreaterThan(0);
      expect(a.rationale.length).toBeGreaterThan(30);
    }
  });
});

describe("nextDayIrradiation", () => {
  const now = new Date("2026-10-07T06:30:00Z");
  const day = (fn: (h: number) => number, start = 7, n = 24) =>
    Array.from({ length: n }, (_, i) => ({ time: new Date(Date.UTC(2026, 9, 7, start + i)).toISOString(), value: fn((start + i) % 24) }));

  it("sums hourly W/m2 over the next 24 hours into kWh/m2", () => {
    const r = nextDayIrradiation(day((h) => (h >= 6 && h <= 18 ? 500 : 0)), now)!;
    expect(r.hours).toBe(24);
    expect(r.kwhPerM2).toBeCloseTo((13 * 500) / 1000, 9); // 13 sunny hours at 500 W/m2
  });

  it("ignores hours outside the window", () => {
    const pts = [...day(() => 100, 0, 6), ...day(() => 100, 7, 24), ...day(() => 100, 31, 10)];
    const r = nextDayIrradiation(pts, now)!;
    expect(r.hours).toBe(24);
    expect(r.kwhPerM2).toBeCloseTo(2.4, 9);
  });

  it("refuses to extrapolate from a partial day", () => {
    expect(nextDayIrradiation(day(() => 100, 7, 10), now)).toBeNull();
    expect(nextDayIrradiation([], now)).toBeNull();
  });
});

describe("completeness", () => {
  const none = { location: false, solarResource: false, weather: false, geometry: false, satellite: false, loadProfile: false, tariff: false };

  it("is MINIMAL with only a location", () => {
    const c = completeness({ ...none, location: true });
    expect(c).toMatchObject({ confidence: 0.1, quality: "MINIMAL" });
  });

  it("is PARTIAL with real location, solar resource, weather and a roof outline, and shows why", () => {
    const c = completeness({ ...none, location: true, solarResource: true, weather: true, geometry: true });
    expect(c).toMatchObject({ confidence: 0.65, quality: "PARTIAL" });
    expect(c.basis.filter((b) => !b.available).map((b) => b.item)).toEqual(["Recent satellite scene", "Household or business electricity use", "Electricity tariff"]);
  });

  it("cannot reach FULL without consumption and tariff data", () => {
    const c = completeness({ ...none, location: true, solarResource: true, weather: true, geometry: true, satellite: true });
    expect(c.confidence).toBe(0.7);
    expect(c.quality).toBe("PARTIAL");
    expect(completeness({ location: true, solarResource: true, weather: true, geometry: true, satellite: true, loadProfile: true, tariff: true })).toMatchObject({ confidence: 1, quality: "FULL" });
  });

  it("needs both consumption and a tariff for FULL; only the satellite scene may be missing", () => {
    const all = { location: true, solarResource: true, weather: true, geometry: true, satellite: true, loadProfile: true, tariff: true };
    expect(completeness({ ...all, tariff: false })).toMatchObject({ confidence: 0.9, quality: "PARTIAL" });
    expect(completeness({ ...all, loadProfile: false })).toMatchObject({ confidence: 0.8, quality: "PARTIAL" });
    expect(completeness({ ...all, satellite: false })).toMatchObject({ confidence: 0.95, quality: "FULL" });
    expect(completeness({ ...all, geometry: false })).toMatchObject({ confidence: 0.8, quality: "PARTIAL" });
  });

  it("weights sum to one", () => {
    expect(completeness({ location: true, solarResource: true, weather: true, geometry: true, satellite: true, loadProfile: true, tariff: true }).basis.reduce((s, b) => s + b.weight, 0)).toBeCloseTo(1, 9);
  });
});
