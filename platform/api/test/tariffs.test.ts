import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { seedReferenceData } from "../src/seed/reference.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, defaultTestDataDir, hasDb, makeApp, register, resetDb } from "./helpers.js";

const describeDb = hasDb ? describe : describe.skip;

/** A fixed "today", so tariff validity (FY2025-26 has ended; the Rajasthan schedule is open-ended) does not depend on the run date. */
const TODAY = new Date("2026-10-07T09:00:00Z");

describeDb("tariffs, policy and eligibility", () => {
  let t: TestApp;
  let s: Session;
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, session?: Session, payload?: unknown) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const plans = async (session?: Session, query = "") => (await call("GET", `/api/tariffs${query}`, session)).json().tariffs as { id: string; name: string; state: string; origin: string; validity: { status: string } }[];
  const curated = async (state: string) => (await plans(undefined, `?state=${state}&scope=curated`))[0]!;

  beforeEach(async () => {
    await resetDb();
    await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
    t = await makeApp();
    t.clock.now = TODAY;
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "tariffs@example.com");
  });

  describe("seeding", () => {
    it("loads every sourced tariff order and policy rule, and loading again changes nothing", async () => {
      expect(await db().tariffPlan.count()).toBe(3);
      expect(await db().policyRule.count()).toBe(2);
      const again = await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
      expect(again.tariffs).toEqual(["curated:clinic-jaipur", "curated:home-mathura", "curated:shop-pune"]);
      expect(await db().tariffPlan.count()).toBe(3);
      expect(await db().policyRule.count()).toBe(2);
    });

    it("keeps each order's source text and fixed charge, and the policy rule's source and check date", async () => {
      const pune = await db().tariffPlan.findUniqueOrThrow({ where: { seedKey: "curated:shop-pune" } });
      expect(pune.source).toContain("MERC MYT order");
      expect(pune).toMatchObject({ state: "MH", discom: "MSEDCL", fixedChargeInr: 520, fixedChargeBasis: "PER_CONNECTION_MONTH", exportRateBasis: "ASSUMPTION" });
      const rule = await db().policyRule.findUniqueOrThrow({ where: { seedKey: "PM_SURYA_GHAR:residential_cfa:IN" } });
      expect(rule).toMatchObject({ program: "PM_SURYA_GHAR", region: "IN", sourceUrl: "https://pmsuryaghar.gov.in" });
      expect(rule.verifiedAt?.toISOString().slice(0, 10)).toBe("2026-10-07");
    });

    it("refuses a data file that does not validate instead of loading nonsense", async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "avk-seed-"));
      try {
        for (const sub of ["tariffs", "policy"]) cpSync(path.join(defaultTestDataDir(), sub), path.join(dir, sub), { recursive: true });
        const f = path.join(dir, "tariffs", "shop-pune.json");
        const d = JSON.parse(readFileSync(f, "utf8"));
        d.tou_blocks = [[0, 10, 7], [12, 24, 8]]; // leaves 10:00 to 12:00 without a rate
        writeFileSync(f, JSON.stringify(d));
        await expect(seedReferenceData(db(), { dataDir: dir })).rejects.toThrow(/shop-pune\.json.*10:00 to 12:00/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("the catalogue", () => {
    it("is public, filters by state and consumer type, and flags a tariff whose period has ended instead of hiding it", async () => {
      const all = await plans();
      expect(all.map((p) => p.state).sort()).toEqual(["MH", "RJ", "UP"]);
      expect(all.every((p) => p.origin === "CURATED")).toBe(true);
      expect((await plans(undefined, "?state=MH")).map((p) => p.name)).toEqual([expect.stringContaining("MSEDCL")]);
      expect((await plans(undefined, "?consumerType=RESIDENTIAL")).map((p) => p.state)).toEqual(["UP"]);
      expect((await plans(undefined, "?discom=uppcl")).map((p) => p.state)).toEqual(["UP"]);
      const byState = Object.fromEntries(all.map((p) => [p.state, p.validity.status]));
      expect(byState).toEqual({ MH: "EXPIRED", UP: "EXPIRED", RJ: "OPEN_ENDED" });
    });

    it("rejects an unknown state code", async () => {
      expect((await call("GET", "/api/tariffs?state=ZZ")).statusCode).toBe(400);
    });

    it("shows one plan with its source, hourly rates, export basis and an honest provenance", async () => {
      const id = (await curated("MH")).id;
      const res = await call("GET", `/api/tariffs/${id}`);
      expect(res.statusCode).toBe(200);
      const p = res.json();
      expect(p.hourlyRates).toHaveLength(24);
      expect(p.hourlyRates[3]).toBe(7.84);
      expect(p.hourlyRates[12]).toBe(6.52);
      expect(p.hourlyRates[19]).toBe(9.49);
      expect(p.fixedCharge).toEqual({ amountInr: 520, basis: "PER_CONNECTION_MONTH" });
      expect(p.export).toMatchObject({ rate: 3.5, basis: "ASSUMPTION", meteringMode: "UNKNOWN" });
      expect(p.provenance).toMatchObject({ status: "REFERENCE", provider: "avishkar-tariffs" });
      const notes = p.provenance.notes.join(" ");
      expect(notes).toContain("2026-03-31"); // the period has ended
      expect(notes).toContain("export rate is an assumption");
      expect(notes).toContain("metering arrangement");
    });

    it("answers 404 for an id that does not exist", async () => {
      expect((await call("GET", "/api/tariffs/00000000-0000-4000-8000-000000000000")).statusCode).toBe(404);
    });
  });

  describe("bill estimates", () => {
    it("prices a time-of-day plan with an even spread, adds the fixed charge, and says what it assumed", async () => {
      const id = (await curated("MH")).id;
      const res = await call("POST", `/api/tariffs/${id}/bill`, undefined, { monthlyKwh: 300 });
      expect(res.statusCode).toBe(200);
      const b = res.json();
      expect(b.energyCharge.value).toBeCloseTo(2364.38, 2); // 300 x 7.88125
      expect(b.fixedCharge.value).toBe(520);
      expect(b.total.value).toBeCloseTo(2884.38, 2);
      expect(b.total.provenance.status).toBe("ESTIMATED");
      expect(b.total.unit).toBe("INR");
      const text = b.assumptions.join(" ");
      expect(text).toContain("spread evenly");
      expect(text).toContain("2026-03-31"); // expired plan: the warning travels with the number
      expect(b.validity.status).toBe("EXPIRED");
    });

    it("uses the hourly shape when given: everything used at noon costs 300 x 6.52", async () => {
      const id = (await curated("MH")).id;
      const noon = Array.from({ length: 24 }, (_, h) => (h === 12 ? 1 : 0));
      const b = (await call("POST", `/api/tariffs/${id}/bill`, undefined, { monthlyKwh: 300, hourShare: noon })).json();
      expect(b.energyCharge.value).toBe(1956);
      expect(b.assumptions.join(" ")).not.toContain("spread evenly");
    });

    it("leaves a per-kW fixed charge out, as UNAVAILABLE, until the sanctioned load is given", async () => {
      const id = (await curated("UP")).id;
      const without = (await call("POST", `/api/tariffs/${id}/bill`, undefined, { monthlyKwh: 200 })).json();
      expect(without.fixedCharge).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
      expect(without.total.value).toBe(1300);
      const withLoad = (await call("POST", `/api/tariffs/${id}/bill`, undefined, { monthlyKwh: 200, sanctionedLoadKw: 3 })).json();
      expect(withLoad.fixedCharge.value).toBe(330);
      expect(withLoad.total.value).toBe(1630);
    });

    it("rejects impossible input", async () => {
      const id = (await curated("UP")).id;
      expect((await call("POST", `/api/tariffs/${id}/bill`, undefined, { monthlyKwh: -5 })).statusCode).toBe(400);
      expect((await call("POST", `/api/tariffs/${id}/bill`, undefined, { monthlyKwh: 100, hourShare: [1, 2] })).statusCode).toBe(400);
      expect((await call("POST", `/api/tariffs/${id}/bill`, undefined, { monthlyKwh: 100, hourShare: Array(24).fill(0) })).statusCode).toBe(400);
    });
  });

  describe("entering your own tariff", () => {
    const flat = { name: "My home", consumerType: "RESIDENTIAL", state: "KA", discom: "BESCOM", touBlocks: [{ startHour: 0, endHour: 24, rate: 8.1 }], exportRate: 3.1, source: "My bill of March 2026" };

    it("needs a session", async () => {
      expect((await call("POST", "/api/tariffs", undefined, flat)).statusCode).toBe(401);
    });

    it("needs the CSRF header like every state-changing call", async () => {
      const res = await t.app.inject({ method: "POST", url: "/api/tariffs", cookies: s.cookies, payload: flat });
      expect(res.statusCode).toBe(403);
    });

    it("stores a flat plan as yours, with your words as its source and your export rate as USER_ENTERED", async () => {
      const res = await call("POST", "/api/tariffs", s, flat);
      expect(res.statusCode).toBe(201);
      const p = res.json();
      expect(p).toMatchObject({ origin: "USER", name: "My home", state: "KA", source: "My bill of March 2026", export: { rate: 3.1, basis: "USER_ENTERED" } });
      expect(p.provenance).toMatchObject({ status: "REFERENCE", provider: "user" });
      expect(p.hourlyRates.every((r: number) => r === 8.1)).toBe(true);
    });

    it("keeps it private: another account cannot read, list, bill or select it, and it never enters the public catalogue", async () => {
      const mine = (await call("POST", "/api/tariffs", s, flat)).json();
      const other = await register(t, "other@example.com");
      expect((await call("GET", `/api/tariffs/${mine.id}`, other)).statusCode).toBe(404);
      expect((await call("POST", `/api/tariffs/${mine.id}/bill`, other, { monthlyKwh: 100 })).statusCode).toBe(404);
      expect((await plans(other)).some((p) => p.id === mine.id)).toBe(false);
      expect((await plans()).some((p) => p.id === mine.id)).toBe(false);
      expect((await plans(s, "?scope=mine")).map((p) => p.id)).toEqual([mine.id]);
      expect((await plans(s, "?scope=curated")).every((p) => p.origin === "CURATED")).toBe(true);
    });

    it("accepts slabs alone (one flat block at the marginal rate is stored) and bills them telescopically", async () => {
      const res = await call("POST", "/api/tariffs", s, {
        name: "Slabbed",
        consumerType: "RESIDENTIAL",
        slabs: [{ upToKwhPerMonth: 100, rate: 3 }, { upToKwhPerMonth: 300, rate: 5 }, { upToKwhPerMonth: null, rate: 7 }],
        fixedCharge: { amountInr: 50, basis: "PER_CONNECTION_MONTH" },
      });
      expect(res.statusCode).toBe(201);
      const p = res.json();
      expect(p.touBlocks).toEqual([{ startHour: 0, endHour: 24, rate: 7 }]);
      const b = (await call("POST", `/api/tariffs/${p.id}/bill`, s, { monthlyKwh: 450 })).json();
      expect(b.energyCharge.value).toBe(2350);
      expect(b.total.value).toBe(2400);
    });

    it("rejects a tariff that leaves times without a rate, naming them", async () => {
      const res = await call("POST", "/api/tariffs", s, { ...flat, touBlocks: [{ startHour: 0, endHour: 10, rate: 5 }, { startHour: 12, endHour: 24, rate: 7 }] });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain("10:00 to 12:00");
    });

    it.each([
      ["overlapping blocks", { touBlocks: [{ startHour: 0, endHour: 14, rate: 5 }, { startHour: 12, endHour: 24, rate: 7 }] }, "overlap"],
      ["a rate of 500", { touBlocks: [{ startHour: 0, endHour: 24, rate: 500 }] }, "100"],
      ["neither blocks nor slabs", { touBlocks: undefined }, "time-of-day blocks"],
      ["an end date before the start date", { effectiveFrom: "2026-05-01", effectiveTo: "2026-04-01" }, "before the start"],
      ["a made-up state", { state: "XX" }, "state"],
    ])("rejects %s", async (_label, patch, fragment) => {
      const res = await call("POST", "/api/tariffs", s, { ...flat, ...patch });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain(fragment);
    });

    it("lets you delete your own plan but not someone else's or a curated one", async () => {
      const mine = (await call("POST", "/api/tariffs", s, flat)).json();
      const other = await register(t, "thief@example.com");
      expect((await call("DELETE", `/api/tariffs/${mine.id}`, other)).statusCode).toBe(404);
      expect((await call("DELETE", `/api/tariffs/${(await curated("MH")).id}`, s)).statusCode).toBe(404);
      expect((await call("DELETE", `/api/tariffs/${mine.id}`, s)).statusCode).toBe(204);
      expect((await call("GET", `/api/tariffs/${mine.id}`, s)).statusCode).toBe(404);
      expect(await db().tariffPlan.count({ where: { ownerId: null } })).toBe(3);
    });

    it("records the creation in the audit log", async () => {
      const mine = (await call("POST", "/api/tariffs", s, flat)).json();
      const row = await db().auditLog.findFirst({ where: { action: "tariff.create", entityId: mine.id } });
      expect(row?.userId).toBe(s.userId);
    });
  });

  describe("choosing a tariff for a property", () => {
    let propertyId: string;
    beforeEach(async () => {
      const res = await call("POST", "/api/properties", s, { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" });
      propertyId = res.json().id;
    });

    it("selects and clears a curated plan", async () => {
      const id = (await curated("UP")).id;
      expect((await call("GET", `/api/properties/${propertyId}`, s)).json().tariffPlanId).toBeNull();
      const put = await call("PUT", `/api/properties/${propertyId}/tariff`, s, { tariffPlanId: id });
      expect(put.statusCode).toBe(200);
      expect(put.json().tariffPlanId).toBe(id);
      const del = await call("DELETE", `/api/properties/${propertyId}/tariff`, s);
      expect(del.json().tariffPlanId).toBeNull();
    });

    it("cannot select another account's plan or touch another account's property", async () => {
      const other = await register(t, "owner2@example.com");
      const theirs = (await call("POST", "/api/tariffs", other, { name: "Theirs", consumerType: "COMMERCIAL", touBlocks: [{ startHour: 0, endHour: 24, rate: 9 }] })).json();
      expect((await call("PUT", `/api/properties/${propertyId}/tariff`, s, { tariffPlanId: theirs.id })).statusCode).toBe(404);
      const id = (await curated("UP")).id;
      expect((await call("PUT", `/api/properties/${propertyId}/tariff`, other, { tariffPlanId: id })).statusCode).toBe(404);
    });

    it("clears the choice when the plan is deleted", async () => {
      const mine = (await call("POST", "/api/tariffs", s, { name: "Temp", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 24, rate: 6 }] })).json();
      await call("PUT", `/api/properties/${propertyId}/tariff`, s, { tariffPlanId: mine.id });
      await call("DELETE", `/api/tariffs/${mine.id}`, s);
      expect((await call("GET", `/api/properties/${propertyId}`, s)).json().tariffPlanId).toBeNull();
    });

    it("is recorded by the Energy Twin: completeness rises by the tariff's weight, and the version keeps its own copy", async () => {
      const before = (await call("POST", `/api/properties/${propertyId}/analyze`, s)).json();
      expect(before.tariff.provenance.status).toBe("UNAVAILABLE");
      expect(before.confidence).toBe(0.7);

      const id = (await curated("MH")).id;
      await call("PUT", `/api/properties/${propertyId}/tariff`, s, { tariffPlanId: id });
      const after = (await call("POST", `/api/properties/${propertyId}/analyze`, s)).json();
      expect(after.version).toBe(2);
      expect(after.confidence).toBe(0.8);
      expect(after.confidenceBasis.find((b: { item: string }) => b.item === "Electricity tariff").available).toBe(true);
      expect(after.unavailable.map((g: { what: string }) => g.what)).not.toContain("Electricity tariff");
      expect(after.tariff.provenance.status).toBe("REFERENCE");
      expect(after.tariff.value).toMatchObject({
        planId: id,
        state: "MH",
        discom: "MSEDCL",
        timeOfDay: true,
        rateRangeInrPerKwh: { min: 6.52, max: 9.49 },
        fixedCharge: { amountInr: 520, basis: "PER_CONNECTION_MONTH" },
        exportRateBasis: "ASSUMPTION",
        validity: { status: "EXPIRED" },
      });
      expect(after.tariff.provenance.notes.join(" ")).toContain("2026-03-31");
      expect(after.sources.some((x: { provider: string; ok: boolean }) => x.provider === "avishkar-tariffs" && x.ok)).toBe(true);

      // The plan can change or vanish later; version 2 keeps what it was built with, and version 1 is untouched.
      await db().tariffPlan.update({ where: { id }, data: { name: "Renamed later" } });
      const reread = (await call("GET", `/api/properties/${propertyId}/twin`, s)).json();
      expect(reread.tariff.value.name).toContain("MSEDCL");
      const v1 = await db().energyTwin.findFirstOrThrow({ where: { propertyId, version: 1 } });
      expect(v1.tariffSnapshot).toBeNull();
    });
  });

  describe("eligibility", () => {
    const check = async (payload: unknown) => (await call("POST", "/api/eligibility", undefined, payload)).json();

    it("applies the sourced residential schedule: 3 kWp is 2 kW at 30,000 plus 1 kW at 18,000", async () => {
      const r = await check({ consumerType: "RESIDENTIAL", systemKwp: 3 });
      const pmsg = r.programs[0];
      expect(r.eligibilityConfirmed).toBe(false);
      expect(pmsg).toMatchObject({ program: "PM_SURYA_GHAR", outcome: "RULE_APPLIES" });
      expect(pmsg.subsidy).toMatchObject({ value: 78000, unit: "INR", provenance: { status: "ESTIMATED" } });
      expect(pmsg.subsidy.provenance.notes.join(" ")).toContain("not a confirmed entitlement");
      expect(pmsg.breakdown).toEqual([
        { fromKw: 0, toKw: 2, kw: 2, inrPerKw: 30000, amountInr: 60000 },
        { fromKw: 2, toKw: 3, kw: 1, inrPerKw: 18000, amountInr: 18000 },
      ]);
      expect(pmsg.rules).toHaveLength(1);
      expect(pmsg.rules[0]).toMatchObject({ ruleKey: "residential_cfa", source: expect.stringContaining("National Portal for Rooftop Solar"), sourceUrl: "https://pmsuryaghar.gov.in", verifiedAt: expect.any(String) });
      expect(pmsg.caveats.join(" ")).toContain("2nd amendment"); // the unread amendment is disclosed, not hidden
      expect(r.notice).toContain("Whether you qualify is decided");
    });

    it.each([
      [0.5, 15000],
      [1, 30000],
      [2, 60000],
      [2.5, 69000],
      [5, 78000],
      [10, 78000],
    ])("%d kWp gets %d", async (kwp, expected) => {
      expect((await check({ consumerType: "RESIDENTIAL", systemKwp: kwp })).programs[0].subsidy.value).toBe(expected);
    });

    it("explains why a system above 3 kW gets no more than a 3 kW one", async () => {
      const c = (await check({ consumerType: "RESIDENTIAL", systemKwp: 5 })).programs[0].caveats.join(" ");
      expect(c).toContain("Only the first 3 kW earn a subsidy");
      expect(c).toContain("remaining 2 kW of a 5 kWp system");
      expect(c).toContain("INR 78,000");
      expect((await check({ consumerType: "RESIDENTIAL", systemKwp: 2 })).programs[0].caveats.join(" ")).not.toContain("Only the first");
    });

    it("states no amount for a consumer the rule does not cover, and why", async () => {
      const c = (await check({ consumerType: "COMMERCIAL", systemKwp: 10 })).programs[0];
      expect(c).toMatchObject({ outcome: "NOT_COVERED", subsidy: { value: null, provenance: { status: "UNAVAILABLE" } } });
      expect(c.subsidy.provenance.notes[0]).toContain("residential households and housing societies");
    });

    it("shows the housing-society rule as stated and calculates nothing from an ambiguous limit", async () => {
      const g = (await check({ consumerType: "GROUP_HOUSING_OR_RWA", systemKwp: 100 })).programs[0];
      expect(g).toMatchObject({ outcome: "RULE_ON_FILE_NOT_EVALUATED", subsidy: { value: null } });
      expect(g.rules[0].statedAs).toContain("18,000 per kW for common facilities");
    });

    it("never invents a net-metering answer: nothing sourced is loaded, so it says so", async () => {
      const r = await check({ consumerType: "RESIDENTIAL", systemKwp: 3, state: "MH" });
      expect(r.netMetering).toMatchObject({ outcome: "NO_SOURCED_RULE", subsidy: { value: null } });
      expect(r.netMetering.subsidy.provenance.notes[0]).toContain("for MH");
      expect(r.netMetering.subsidy.provenance.notes[0]).toContain("does not guess");
    });

    it("shows a net-metering rule that is on file without turning it into an eligibility answer", async () => {
      await db().policyRule.create({
        data: { seedKey: "NET_METERING:test:MH", program: "NET_METERING", ruleKey: "test", region: "MH", appliesTo: "RESIDENTIAL", rule: {}, statedAs: "Test rule text.", source: "A test order", notes: [] },
      });
      const r = await check({ consumerType: "RESIDENTIAL", systemKwp: 3, state: "MH" });
      expect(r.netMetering.outcome).toBe("RULE_ON_FILE_NOT_EVALUATED");
      expect(r.netMetering.rules[0]).toMatchObject({ region: "MH", statedAs: "Test rule text." });
      expect(r.eligibilityConfirmed).toBe(false);
    });

    it("claims nothing when no sourced rule is loaded", async () => {
      await db().policyRule.deleteMany({});
      const r = (await check({ consumerType: "RESIDENTIAL", systemKwp: 3 })).programs[0];
      expect(r).toMatchObject({ outcome: "NO_SOURCED_RULE", subsidy: { value: null, provenance: { status: "UNAVAILABLE" } } });
    });

    it("ignores a rule that has expired and uses one that has not started yet only from its start date", async () => {
      await db().policyRule.updateMany({ data: { effectiveTo: new Date("2020-01-01T00:00:00Z") } });
      expect((await check({ consumerType: "RESIDENTIAL", systemKwp: 3 })).programs[0].outcome).toBe("NO_SOURCED_RULE");
      await db().policyRule.updateMany({ data: { effectiveTo: null, effectiveFrom: new Date("2027-01-01T00:00:00Z") } });
      expect((await check({ consumerType: "RESIDENTIAL", systemKwp: 3 })).programs[0].outcome).toBe("NO_SOURCED_RULE");
      expect((await check({ consumerType: "RESIDENTIAL", systemKwp: 3, asOf: "2027-06-01" })).programs[0].outcome).toBe("RULE_APPLIES");
    });

    it("warns when the rule was last checked long ago", async () => {
      t.clock.now = new Date("2027-10-07T09:00:00Z");
      const r = (await check({ consumerType: "RESIDENTIAL", systemKwp: 3 })).programs[0];
      expect(r.caveats.join(" ")).toMatch(/last checked at its source \d+ days ago/);
    });

    it("rejects impossible input", async () => {
      expect((await call("POST", "/api/eligibility", undefined, { consumerType: "RESIDENTIAL", systemKwp: 0 })).statusCode).toBe(400);
      expect((await call("POST", "/api/eligibility", undefined, { consumerType: "MARTIAN", systemKwp: 3 })).statusCode).toBe(400);
      expect((await call("POST", "/api/eligibility", undefined, { consumerType: "RESIDENTIAL", systemKwp: 3, state: "XX" })).statusCode).toBe(400);
    });

    it("lists the rules on file with their sources, publicly", async () => {
      const res = await call("GET", "/api/policy-rules?program=PM_SURYA_GHAR");
      expect(res.statusCode).toBe(200);
      const rules = res.json().rules;
      expect(rules.map((r: { ruleKey: string }) => r.ruleKey).sort()).toEqual(["ghs_rwa_cfa", "residential_cfa"]);
      expect(rules.every((r: { source: string; verifiedAt: string | null }) => r.source.length > 10 && r.verifiedAt)).toBe(true);
      expect((await call("GET", "/api/policy-rules?program=NOPE")).json().rules).toEqual([]);
    });
  });
});
