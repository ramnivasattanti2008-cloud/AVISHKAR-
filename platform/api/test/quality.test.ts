import { describe, expect, it } from "vitest";
import { assessSeries, checkCoordinates, checkValue, isNearIndia, realityReport } from "../src/quality.js";

const t0 = new Date("2026-10-07T06:00:00Z");
const hour = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const opts = { now: hour(7), maxAgeMinutes: 90, expectedStepMinutes: 60 };

describe("impossible values are rejected, not shown", () => {
  it("rejects the 999 C temperature from the spec", () => {
    expect(checkValue("air_temperature_c", 999)).toMatchObject({ ok: false });
    expect(checkValue("air_temperature_c", 38.2)).toEqual({ ok: true });
  });
  it.each([
    ["relative_humidity_pct", 101],
    ["relative_humidity_pct", -1],
    ["cloud_cover_pct", 140],
    ["shortwave_radiation_wm2", 4000],
    ["wind_speed_ms", -3],
    ["air_temperature_c", Number.NaN],
    ["air_temperature_c", "hot"],
  ] as const)("%s = %s is refused", (kind, v) => expect(checkValue(kind, v).ok).toBe(false));
});

describe("coordinates", () => {
  it("accepts real places and refuses impossible ones", () => {
    expect(checkCoordinates(12.9716, 77.5946)).toEqual({ ok: true });
    expect(checkCoordinates(91, 0)).toMatchObject({ ok: false });
    expect(checkCoordinates(0, 181)).toMatchObject({ ok: false });
    expect(checkCoordinates(Number.NaN, 0)).toMatchObject({ ok: false });
    expect(checkCoordinates("12", 77)).toMatchObject({ ok: false });
  });
  it("knows what is near India without refusing anywhere else", () => {
    expect(isNearIndia(12.97, 77.59)).toBe(true);
    expect(isNearIndia(51.5, -0.12)).toBe(false);
  });
});

describe("assessSeries", () => {
  it("flags duplicates, missing timestamps, impossible values and spikes, and keeps the rest", () => {
    const series = [
      { time: hour(0), value: 24 },
      { time: hour(1), value: 25 },
      { time: hour(1), value: 25.5 }, // duplicate timestamp
      { time: hour(2), value: 60 }, // spike: 35 C in an hour and back
      { time: hour(3), value: 26 },
      { time: new Date("invalid"), value: 20 },
      { time: hour(4), value: 999 }, // impossible
      { time: hour(5), value: null }, // no value
      { time: hour(6), value: 27 },
    ];
    const a = assessSeries("air_temperature_c", series, opts);
    expect(a.accepted.map((p) => p.value)).toEqual([24, 25, 26, 27]);
    expect(a.duplicates).toBe(1);
    const reasons = a.rejected.map((r) => r.reason).join(" | ");
    expect(reasons).toContain("duplicate");
    expect(reasons).toContain("spike");
    expect(reasons).toContain("missing or invalid timestamp");
    expect(reasons).toContain("physically possible");
    expect(reasons).toContain("no value");
  });

  it("detects gaps and stale data without inventing the missing points", () => {
    const a = assessSeries(
      "air_temperature_c",
      [
        { time: hour(0), value: 24 },
        { time: hour(1), value: 25 },
        { time: hour(4), value: 27 }, // 3 h gap
      ],
      { now: hour(9), maxAgeMinutes: 90, expectedStepMinutes: 60 },
    );
    expect(a.gaps).toBe(1);
    expect(a.accepted).toHaveLength(3);
    expect(a.stale).toBe(true);
    expect(a.ageMinutes).toBe(5 * 60);
  });

  it("is stale and empty when nothing usable arrives", () => {
    const a = assessSeries("air_temperature_c", [{ time: hour(0), value: 999 }], opts);
    expect(a.accepted).toEqual([]);
    expect(a.stale).toBe(true);
    expect(a.newest).toBeNull();
  });

  it("does not call a real sharp change a spike when its neighbours confirm it", () => {
    const a = assessSeries(
      "air_temperature_c",
      [
        { time: hour(0), value: 20 },
        { time: hour(1), value: 20 },
        { time: hour(2), value: 40 }, // a real front: neighbours do not agree with each other
        { time: hour(3), value: 40 },
      ],
      opts,
    );
    expect(a.accepted).toHaveLength(4);
  });
});

describe("the seven reality checks (spec section 83)", () => {
  const good = {
    sourceAvailable: true,
    timestampValid: true,
    valuePossible: true,
    locationValid: true,
    modelApplicable: true,
    uncertaintyAvailable: true,
    statusLabelCorrect: true,
  };
  it("passes when every check passes", () => {
    const r = realityReport(good);
    expect(r.passed).toBe(true);
    expect(r.checks).toHaveLength(7);
  });
  it("names every failed check", () => {
    const r = realityReport({ ...good, modelApplicable: false, uncertaintyAvailable: false });
    expect(r.passed).toBe(false);
    expect(r.failures).toEqual(["Check 5 failed: model is applicable", "Check 6 failed: uncertainty is available"]);
  });
});
