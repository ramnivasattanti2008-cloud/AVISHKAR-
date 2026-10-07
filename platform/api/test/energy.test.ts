import { beforeEach, describe, expect, it } from "vitest";
import { seedReferenceData } from "../src/seed/reference.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, defaultTestDataDir, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeDb = hasDb ? describe : describe.skip;

describeDb("meter data and Energy DNA", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;

  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, session: Session | null = s, payload?: unknown) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const importCsv = (csv: string, extra: Record<string, unknown> = {}, session: Session | null = s, id = pid) =>
    call("POST", `/api/properties/${id}/energy/imports`, session, { csv, filename: "meter.csv", ...extra });
  const summary = async () => (await call("GET", `/api/properties/${pid}/energy`)).json();
  const count = (table: "energyObservation" | "energyImport" | "energyDna"): Promise<number> => (db()[table] as unknown as { count(a: unknown): Promise<number> }).count({ where: { propertyId: pid } });

  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "energy@example.com");
    pid = (await call("POST", "/api/properties", s, { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });

  it("imports two weeks of 15-minute readings and builds a fingerprint whose numbers are known by construction", async () => {
    const res = await importCsv(meterCsv()); // weekdays 1 kW (24 kWh a day), weekends 2 kW (48 kWh a day)
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r.import).toMatchObject({ rows: 1344, accepted: 1344, rejected: 0, duplicates: 0, intervalMinutes: 15, unit: "kWh", usageColumn: "Energy (kWh)", filename: "meter.csv" });
    expect(r.import.from).toBe("2026-03-01T18:30:00.000Z"); // 2 March 00:00 IST
    expect(r.import.notes.join(" ")).toContain("start of its reading interval");
    expect(r.dnaUnavailableReason).toBeNull();
    const d = r.dna;
    expect(d.period).toMatchObject({ completeDays: 14, intervalMinutes: 15 });
    expect(d.baseline.weekdayDailyKwh.value).toBe(24);
    expect(d.baseline.weekendDailyKwh.value).toBe(48);
    expect(d.baseline.meanDailyKwh.value).toBeCloseTo((10 * 24 + 4 * 48) / 14, 3);
    expect(d.baseline.meanDailyKwh.provenance).toMatchObject({ status: "ESTIMATED", provider: "avishkar-energy-dna" });
    expect(d.baseline.meanDailyKwh.provenance.notes.join(" ")).toContain("14 complete days of your meter readings");
    expect(d.patterns.hourlyKw).toHaveLength(24);
    expect(d.patterns.weekdayHourlyKw.every((v: number) => v === 1)).toBe(true);
    expect(d.patterns.weekendHourlyKw.every((v: number) => v === 2)).toBe(true);
    expect(await count("energyObservation")).toBe(1344);
  });

  it("accounts for every row of the file in exactly one of accepted, rejected or duplicate", async () => {
    const csv = meterCsv({ days: 8, extra: ["not a time,0.3", "2026-03-03T00:00:00+05:30,0.9", "2026-04-01T00:00:00+05:30,-2", "2026-04-01T00:15:00+05:30,abc", "2026-04-01T00:30:00+05:30,"] });
    const r = (await importCsv(csv)).json().import;
    expect(r.accepted + r.rejected + r.duplicates).toBe(r.rows);
    expect(r.rejectedByReason).toEqual({ bad_timestamp: 1, duplicate_in_file: 1, negative_value: 1, bad_value: 1, missing_value: 1 });
    expect(r.rejected).toBe(5);
    expect(r.notes.join(" ")).toContain("Rows refused:");
  });

  it("refuses the same file twice, naming the date, and lets it be loaded again after deleting the first", async () => {
    const csv = meterCsv({ days: 8 });
    const first = await importCsv(csv);
    expect(first.statusCode).toBe(201);
    const again = await importCsv(csv);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ code: "CONFLICT" });
    expect(again.json().error.message).toContain("already imported");
    expect(await count("energyObservation")).toBe(8 * 96);
    expect((await call("DELETE", `/api/properties/${pid}/energy/imports/${first.json().import.id}`)).statusCode).toBe(204);
    expect((await importCsv(csv)).statusCode).toBe(201);
  });

  it("keeps readings that already exist when files overlap, counts them, and adds only the new ones", async () => {
    const a = await importCsv(meterCsv({ days: 8 })); // 2 to 9 March
    expect(a.json().import.accepted).toBe(768);
    // 6 to 13 March at 5 kW: the 4 overlapping days must not overwrite the first file's readings
    const b = (await importCsv(meterCsv({ start: "2026-03-06", days: 8, kw: () => 5 }))).json();
    expect(b.import).toMatchObject({ rows: 768, accepted: 4 * 96, duplicates: 4 * 96, rejected: 0 });
    expect(b.import.notes.join(" ")).toContain("already existed");
    expect(await count("energyObservation")).toBe(12 * 96);
    const kept = await db().energyObservation.findFirstOrThrow({ where: { propertyId: pid, ts: new Date("2026-03-06T18:30:00Z") } }); // 7 March 00:00 IST, Saturday of the first file
    expect(kept.importKwh).toBe(0.5); // 2 kW x 0.25 h, not 5 kW x 0.25 h
    expect(b.dna.period.completeDays).toBe(12);
  });

  it("will not guess a unit the header does not state, but takes the one you state", async () => {
    const csv = meterCsv({ days: 8, header: "timestamp,Consumption" });
    const refused = await importCsv(csv);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/does not say its unit.*factor of four/);
    expect(await count("energyObservation")).toBe(0);
    const ok = await importCsv(csv, { unit: "kWh" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().import).toMatchObject({ unit: "kWh", accepted: 768 });
    expect(ok.json().import.notes.join(" ")).toContain("is the one you stated");
  });

  it("turns power readings into energy", async () => {
    const r = (await importCsv(meterCsv({ days: 8, header: "timestamp,Load (kW)", asPower: true }))).json();
    expect(r.import.unit).toBe("kW");
    expect(r.dna.baseline.weekdayDailyKwh.value).toBe(24); // 1 kW for 24 h, however the file wrote it
  });

  it("stores readings but builds no fingerprint from fewer than seven complete days, and says so", async () => {
    const r = (await importCsv(meterCsv({ days: 3 }))).json();
    expect(r.import.accepted).toBe(288);
    expect(r.dna).toBeNull();
    expect(r.dnaUnavailableReason).toContain("at least 7 complete days");
    expect(await count("energyDna")).toBe(0);
    const s2 = await summary();
    expect(s2.dna).toBeNull();
    expect(s2.dnaUnavailableReason).toContain("at least 7 complete days");
    expect((await call("GET", `/api/properties/${pid}/energy-dna`)).statusCode).toBe(404);
  });

  it("stores daily totals but refuses a daily pattern from them", async () => {
    const r = (await importCsv(meterCsv({ days: 30, intervalMinutes: 1440 }))).json();
    expect(r.import).toMatchObject({ intervalMinutes: 1440, accepted: 30 });
    expect(r.dna).toBeNull();
    expect(r.dnaUnavailableReason).toContain("at least hourly");
  });

  it("marks a partial day as partial, never presenting it as a day of consumption", async () => {
    await importCsv(meterCsv({ days: 8, skip: (d, slot) => d === 7 && slot >= 40 })); // the last day stops at 10:00
    const days = (await summary()).dailyKwh;
    expect(days).toHaveLength(8);
    expect(days.slice(0, 7).every((x: { complete: boolean }) => x.complete)).toBe(true);
    expect(days[7]).toMatchObject({ complete: false, readings: 40, expectedReadings: 96 });
    expect(days[7].kwh).toBeLessThan(days[6].kwh);
  });

  it("reports coverage, imports and the fingerprint in one summary", async () => {
    expect((await summary())).toMatchObject({ coverage: null, dailyKwh: [], dna: null, imports: [] });
    expect((await summary()).dnaUnavailableReason).toContain("Import a meter file");
    await importCsv(meterCsv());
    const x = await summary();
    expect(x.coverage).toMatchObject({ observations: 1344, days: 14, intervalMinutes: 15 });
    expect(x.imports).toHaveLength(1);
    expect(x.dailyKwh).toHaveLength(14);
    expect(x.dailyKwh[0]).toMatchObject({ date: "2026-03-02", kwh: 24, complete: true });
    expect(x.dna.version).toBe(1);
  });

  it("deletes an import with its readings and its fingerprint, since the fingerprint was built from them", async () => {
    const imp = (await importCsv(meterCsv())).json().import;
    expect((await call("DELETE", `/api/properties/${pid}/energy/imports/${imp.id}`)).statusCode).toBe(204);
    expect(await count("energyObservation")).toBe(0);
    expect(await count("energyDna")).toBe(0);
    expect((await summary()).coverage).toBeNull();
    expect((await call("DELETE", `/api/properties/${pid}/energy/imports/${imp.id}`)).statusCode).toBe(404);
  });

  it("rebuilds the fingerprint from what remains when one of two imports is deleted", async () => {
    await importCsv(meterCsv({ days: 8 }));
    const second = (await importCsv(meterCsv({ start: "2026-03-10", days: 8, kw: () => 3 }))).json().import;
    expect((await summary()).dna.period.completeDays).toBe(16);
    await call("DELETE", `/api/properties/${pid}/energy/imports/${second.id}`);
    const left = (await summary()).dna;
    expect(left.period.completeDays).toBe(8);
    expect(left.version).toBe(1); // old versions built from deleted data are gone, not kept
  });

  it("keeps a new version of the fingerprint for each import", async () => {
    await importCsv(meterCsv({ days: 8 }));
    await importCsv(meterCsv({ start: "2026-03-10", days: 8 }));
    expect((await summary()).dna.version).toBe(2);
  });

  it("is private: another account cannot import to, read or delete from this property", async () => {
    const imp = (await importCsv(meterCsv({ days: 8 }))).json().import;
    const other = await register(t, "other@example.com");
    expect((await importCsv(meterCsv({ days: 8 }), {}, other)).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${pid}/energy`, other)).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${pid}/energy-dna`, other)).statusCode).toBe(404);
    expect((await call("DELETE", `/api/properties/${pid}/energy/imports/${imp.id}`, other)).statusCode).toBe(404);
    expect((await call("GET", `/api/properties/${pid}/energy`, null)).statusCode).toBe(401);
  });

  it("needs the CSRF header like every state-changing call", async () => {
    const res = await t.app.inject({ method: "POST", url: `/api/properties/${pid}/energy/imports`, cookies: s.cookies, payload: { csv: meterCsv({ days: 3 }) } });
    expect(res.statusCode).toBe(403);
  });

  it("handles a whole year of 15-minute readings, with a monthly profile", async () => {
    const started = Date.now();
    const res = await importCsv(meterCsv({ start: "2025-03-01", days: 365, kw: (d) => 1 + (d % 30 < 15 ? 0.5 : 0) }));
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r.import).toMatchObject({ rows: 365 * 96, accepted: 365 * 96, rejected: 0 });
    expect(Object.keys(r.dna.patterns.monthlyDailyKwh)).toHaveLength(12);
    expect(r.dna.unavailable.map((g: { what: string }) => g.what)).not.toContain("Seasonal behaviour");
    expect(await count("energyObservation")).toBe(365 * 96);
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  describe("in the Energy Twin", () => {
    const analyze = () => call("POST", `/api/properties/${pid}/analyze`);

    it("gives the twin a real consumption figure, labelled ESTIMATED with the days it came from, and raises completeness", async () => {
      await importCsv(meterCsv());
      const w = (await analyze()).json();
      const load = w.consumption.estimatedDailyLoadKwh;
      expect(load.value).toBeCloseTo((10 * 24 + 4 * 48) / 14, 2);
      expect(load.provenance.status).toBe("ESTIMATED");
      expect(load.provenance.notes.join(" ")).toContain("14 complete days of your meter readings, 2026-03-01 to 2026-03-15");
      expect(w.confidence).toBe(0.9); // 0.7 + the 0.2 for consumption
      expect(w.dataQuality).toBe("PARTIAL"); // FULL also needs a tariff
      expect(w.unavailable.map((g: { what: string }) => g.what)).toEqual(["Electricity tariff"]);
      expect(w.sources.some((x: { provider: string; ok: boolean }) => x.provider === "avishkar-energy-dna" && x.ok)).toBe(true);
    });

    it("reaches FULL only with both consumption and a tariff", async () => {
      await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
      await importCsv(meterCsv());
      const plan = (await call("GET", "/api/tariffs?state=UP&scope=curated", null)).json().tariffs[0];
      await call("PUT", `/api/properties/${pid}/tariff`, s, { tariffPlanId: plan.id });
      const w = (await analyze()).json();
      expect(w).toMatchObject({ confidence: 1, dataQuality: "FULL" });
      expect(w.unavailable).toEqual([]);
    });

    it("keeps each twin version's own consumption figure when the data changes later", async () => {
      const imp = (await importCsv(meterCsv())).json().import;
      const v1 = (await analyze()).json();
      await call("DELETE", `/api/properties/${pid}/energy/imports/${imp.id}`);
      const reread = (await call("GET", `/api/properties/${pid}/twin`)).json();
      expect(reread.version).toBe(1);
      expect(reread.consumption.estimatedDailyLoadKwh.value).toBe(v1.consumption.estimatedDailyLoadKwh.value);
      const v2 = (await analyze()).json();
      expect(v2.version).toBe(2);
      expect(v2.consumption.estimatedDailyLoadKwh).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
      expect(v2.confidence).toBe(0.7);
    });
  });

  describe("the database refuses nonsense even if the API is bypassed", () => {
    it("a negative or absurd reading, an import whose counts do not add up, an impossible fingerprint", async () => {
      const base = { propertyId: pid, ts: new Date("2026-03-01T00:00:00Z"), intervalMinutes: 15 };
      await expect(db().energyObservation.create({ data: { ...base, importKwh: -1 } })).rejects.toThrow(/energy_observations_values/);
      await expect(db().energyObservation.create({ data: { ...base, importKwh: 1e9 } })).rejects.toThrow(/energy_observations_values/);
      await expect(db().energyObservation.create({ data: { ...base, intervalMinutes: 0, importKwh: 1 } })).rejects.toThrow(/energy_observations_values/);
      const imp = { propertyId: pid, sha256: "a".repeat(64), rows: 10, accepted: 5, rejected: 1, duplicates: 1, intervalMinutes: 15, usageColumn: "kWh", unit: "kWh", quality: {} };
      await expect(db().energyImport.create({ data: imp })).rejects.toThrow(/energy_imports_counts/);
      await expect(db().energyImport.create({ data: { ...imp, accepted: 8, sha256: "b".repeat(64), quality: [] } })).rejects.toThrow(/energy_imports_json/);
      const dna = { propertyId: pid, version: 1, fromTs: new Date("2026-03-01T00:00:00Z"), toTs: new Date("2026-03-15T00:00:00Z"), completeDays: 14, meanDailyKwh: 10, peakKw: 1, peakHour: 19, baseloadKw: 2, patterns: {}, unavailable: [] };
      await expect(db().energyDna.create({ data: dna })).rejects.toThrow(/energy_dna_values/); // baseload above peak
      await expect(db().energyDna.create({ data: { ...dna, baseloadKw: 0.5, peakHour: 24 } })).rejects.toThrow(/energy_dna_values/);
    });
  });
});
