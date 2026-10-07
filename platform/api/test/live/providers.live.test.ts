import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { MemoryCache } from "../../src/providers/cache.js";
import { buildProviders } from "../../src/providers/index.js";
import { MemoryRecorder } from "../../src/providers/recorder.js";

/**
 * These call the REAL public providers and prove our schemas and quality checks match what they actually return.
 * Run on demand: `pnpm test:live`. Not part of CI (the network and the providers are outside our control, and each
 * provider has a usage policy: these tests make a handful of requests, spaced as the policy asks).
 */
const config = loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: "postgresql://unused@localhost/unused", SESSION_SECRET: "x".repeat(40) });
const recorder = new MemoryRecorder();
const providers = buildProviders(config, { cache: new MemoryCache(), recorder });

describe("live: Nominatim", () => {
  it("finds a real Indian locality with coordinates near it", async () => {
    const r = await providers.geocoding.search("Indiranagar, Bengaluru", { limit: 3, countryCodes: ["in"] });
    expect(r.provenance.status).toBe("REFERENCE");
    expect(r.value!.length).toBeGreaterThan(0);
    const top = r.value![0]!;
    expect(top.latitude).toBeGreaterThan(12.9);
    expect(top.latitude).toBeLessThan(13.1);
    expect(top.longitude).toBeGreaterThan(77.5);
    expect(top.longitude).toBeLessThan(77.7);
  });

  it("reverse geocodes a point in Bengaluru", async () => {
    const r = await providers.geocoding.reverse(12.9784, 77.6408);
    expect(r.value?.label).toContain("Bengaluru");
  });
});

describe("live: Open-Meteo", () => {
  it("returns a current analysis and a 3-day hourly forecast that pass every quality check", async () => {
    const r = await providers.weather.forecast(12.9716, 77.5946, { days: 3 });
    expect(r.stale).toBe(false);
    expect(r.current.air_temperature?.value).toBeGreaterThan(5);
    expect(r.current.air_temperature?.value).toBeLessThan(50);
    expect(r.current.air_temperature?.provenance.status).toMatch(/^(LIVE|UPDATED)$/);
    expect(r.current.air_temperature?.provenance.ageSeconds).toBeLessThan(3 * 3600);
    const ghi = r.hourly.global_horizontal_irradiance!;
    expect(ghi.value!.length).toBeGreaterThanOrEqual(70);
    expect(ghi.value!.every((p) => p.value >= 0 && p.value <= 1500)).toBe(true);
    expect(Math.max(...ghi.value!.map((p) => p.value))).toBeGreaterThan(300); // a real daytime peak in India
    expect(r.quality).toEqual([]);
    expect(r.elevationM).toBeGreaterThan(500);
  });

  it("recorded real latency for every call", () => {
    expect(recorder.calls.length).toBeGreaterThanOrEqual(3);
    expect(recorder.calls.every((c) => c.ok && c.latencyMs > 0)).toBe(true);
  });
});

describe("live: NASA POWER", () => {
  it("returns a plausible solar climatology for Bengaluru", async () => {
    const r = await providers.solarResource.climatology(12.9716, 77.5946);
    expect(r.provenance.status).toBe("REFERENCE");
    const a = r.value!.annual;
    expect(a.ghiKwhM2Day).toBeGreaterThan(4.5); // Bengaluru averages about 5.5 kWh/m2/day
    expect(a.ghiKwhM2Day).toBeLessThan(6.5);
    expect(a.clearnessIndex).toBeGreaterThan(0.4);
    expect(r.value!.months).toHaveLength(12);
    expect(r.value!.rejected).toEqual([]);
    expect(r.provenance.notes.join(" ")).toMatch(/2001|20-year/);
  });
});

describe("live: Overpass (public server, intermittent: mirrors and retries are part of the test)", () => {
  it("finds a real building outline near a point in Bengaluru", async () => {
    const r = await providers.footprints.find(12.9716, 77.5946, { radiusM: 40 });
    expect(r.value, r.provenance.notes.join(" ")).not.toBeNull();
    expect(r.value!.areaM2).toBeGreaterThan(10);
    expect(r.value!.sourceRef).toMatch(/^way\/\d+$/);
    expect(r.provenance.notes.join(" ")).toContain("ODbL");
  });
});

describe("live: Earth Search (Sentinel-2)", () => {
  it("returns recent Sentinel-2 scenes with acquisition time and cloud percentage", async () => {
    const r = await providers.satellite.latest(12.9716, 77.5946, { limit: 3 });
    expect(r.value!.length).toBeGreaterThan(0);
    const s = r.value![0]!;
    expect(s.satellite).toMatch(/^sentinel-2/);
    expect(s.cloudPercent).toBeGreaterThanOrEqual(0);
    expect(s.cloudPercent).toBeLessThanOrEqual(100);
    expect(Date.now() - new Date(s.acquiredAt).getTime()).toBeLessThan(30 * 86_400_000); // a scene within the last month
    expect(r.provenance.status).toBe("UPDATED"); // never LIVE for imagery
  });
});
