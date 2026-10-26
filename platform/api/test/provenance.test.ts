import { describe, expect, it } from "vitest";
import {
  classifyObservation,
  demo,
  estimated,
  forecast,
  humanAge,
  observed,
  reage,
  simulated,
  unavailable,
} from "../src/provenance/index.js";

const now = new Date("2026-10-07T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);
const meta = { provider: "open-meteo", source: "Open-Meteo forecast API", dataType: "air_temperature", now };

describe("freshness decides LIVE, never the caller", () => {
  it("is LIVE within 1.5 provider update intervals and UPDATED beyond", () => {
    expect(classifyObservation({ observedAt: ago(600), cadenceSeconds: 900, now })).toEqual({ ok: true, status: "LIVE", ageSeconds: 600 });
    expect(classifyObservation({ observedAt: ago(1350), cadenceSeconds: 900, now })).toMatchObject({ status: "LIVE" }); // exactly 1.5x
    expect(classifyObservation({ observedAt: ago(1351), cadenceSeconds: 900, now })).toMatchObject({ status: "UPDATED" });
  });

  it("rejects an invalid or future timestamp instead of calling it live", () => {
    expect(classifyObservation({ observedAt: new Date("nope"), cadenceSeconds: 900, now })).toMatchObject({ ok: false });
    expect(classifyObservation({ observedAt: ago(-3600), cadenceSeconds: 900, now })).toMatchObject({ ok: false });
    expect(classifyObservation({ observedAt: ago(-60), cadenceSeconds: 900, now })).toMatchObject({ ok: true }); // small clock skew
  });
});

describe("observed()", () => {
  it("labels a fresh reading LIVE with its timestamp and age", () => {
    const m = observed(28.4, { ...meta, unit: "C", observedAt: ago(300), cadenceSeconds: 900, location: { latitude: 12.97, longitude: 77.59 } });
    expect(m.value).toBe(28.4);
    expect(m.provenance).toMatchObject({ status: "LIVE", observedAt: ago(300).toISOString(), ageSeconds: 300, provider: "open-meteo" });
    expect(m.provenance.notes).toEqual([]);
  });

  it("labels an old reading UPDATED and says how old it is", () => {
    const m = observed(28.4, { ...meta, observedAt: ago(42 * 60), cadenceSeconds: 900 });
    expect(m.provenance.status).toBe("UPDATED");
    expect(m.provenance.notes[0]).toContain("42 min");
  });

  it("returns UNAVAILABLE with no value when the timestamp is unusable", () => {
    const m = observed(28.4, { ...meta, observedAt: new Date("garbage"), cadenceSeconds: 900 });
    expect(m.value).toBeNull();
    expect(m.provenance.status).toBe("UNAVAILABLE");
  });

  it("re-ages a cached value so staleness is never hidden", () => {
    const m = observed(20, { ...meta, observedAt: ago(100), cadenceSeconds: 900 });
    expect(m.provenance.status).toBe("LIVE");
    const later = new Date(now.getTime() + 3 * 3600 * 1000);
    const aged = reage(m, later, 900);
    expect(aged.provenance.status).toBe("UPDATED");
    expect(aged.provenance.ageSeconds).toBe(100 + 3 * 3600);
  });
});

describe("other statuses are explicit", () => {
  it("forecast, estimate, simulation and demo carry their own status and caveats", () => {
    const valid = new Date("2026-10-07T15:00:00Z");
    expect(forecast(5.4, { ...meta, validFor: valid }).provenance).toMatchObject({ status: "FORECAST", validFor: valid.toISOString() });
    const e = estimated(21.3, { ...meta, basis: "roof area x irradiance x efficiency" });
    expect(e.provenance.status).toBe("ESTIMATED");
    expect(e.provenance.notes.join(" ")).toContain("roof area");
    expect(simulated(1, meta).provenance.notes.join(" ")).toContain("not a measurement");
    expect(demo(1, meta).provenance.notes.join(" ")).toContain("DEMO DATA");
  });

  it("unavailable has no value and states the reason", () => {
    const u = unavailable("weather service did not answer", meta);
    expect(u.value).toBeNull();
    expect(u.provenance).toMatchObject({ status: "UNAVAILABLE" });
    expect(u.provenance.notes).toEqual(["weather service did not answer"]);
  });
});

describe("humanAge", () => {
  it.each([
    [30, "30 s"],
    [600, "10 min"],
    [3 * 3600, "3 h"],
    [3 * 86400, "3 d"],
  ])("%is -> %s", (s, text) => expect(humanAge(s)).toBe(text));
});
