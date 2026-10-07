import { beforeEach, describe, expect, it } from "vitest";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeDb = hasDb ? describe : describe.skip;

const BATTERY = { name: "Home battery", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 };
const SOLAR = { name: "Roof array", capacityKwp: 3.3, tiltDeg: 15, azimuthDeg: 180 };
const EV = { name: "Car", batteryKwh: 40, chargerKw: 7.4, targetSoc: 0.8, departureTime: "07:30", departureDays: [4, 0, 2, 1, 3] };
const FRIDGE = { name: "Fridge", kind: "refrigerator", priority: "CRITICAL", ratedPowerW: 150 };
const WASHER = { name: "Washing machine", kind: "washing machine", priority: "FLEXIBLE", ratedPowerW: 500, earliestStart: "10:00", latestFinish: "16:00", durationMin: 90 };

describeDb("assets", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, session: Session | null = s, payload?: unknown) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const path = (kind: string, id?: string, sub = "") => `/api/properties/${pid}/${kind}${id ? `/${id}` : ""}${sub}`;
  const add = async (kind: string, body: unknown, session: Session | null = s) => call("POST", path(kind), session, body);

  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "assets@example.com");
    pid = (await call("POST", "/api/properties", s, { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });

  describe("batteries", () => {
    it("stores only what was entered and shows the default a plan would use, labelled as an assumption", async () => {
      const res = await add("batteries", BATTERY);
      expect(res.statusCode).toBe(201);
      const b = res.json();
      expect(b).toMatchObject({ name: "Home battery", status: "EXISTING", capacityKwh: 10, source: "USER_ENTERED" });
      expect(b.entered).toMatchObject({ chargeEfficiency: null, dischargeEfficiency: null, minSoc: null, maxSoc: null, reserveSoc: null });
      expect(b.effective.chargeEfficiency).toMatchObject({ basis: "ASSUMPTION" });
      expect(b.effective.chargeEfficiency.value).toBeCloseTo(Math.sqrt(0.9), 6); // the Python EMS's round-trip 0.90, split evenly
      expect(b.effective.chargeEfficiency.note).toContain("Python EMS");
      expect(b.effective.minSoc).toMatchObject({ value: 0.1, basis: "ASSUMPTION" });
      expect(b.effective.reserveSoc).toMatchObject({ value: null, basis: "PLANNER" });
      expect(b.usableKwh).toBe(9); // 10 kWh between 10% and 100%
      const row = await db().battery.findUniqueOrThrow({ where: { id: b.id } });
      expect(row.chargeEfficiency).toBeNull(); // the default was never written as if the owner had said it
    });

    it("uses and labels the owner's own figures", async () => {
      const b = (await add("batteries", { ...BATTERY, chargeEfficiency: 0.96, dischargeEfficiency: 0.95, minSoc: 0.2, maxSoc: 0.95, reserveSoc: 0.3, ratedCycles: 6000, wearInrPerKwh: 3.5 })).json();
      expect(b.effective.chargeEfficiency).toMatchObject({ value: 0.96, basis: "USER_ENTERED" });
      expect(b.effective.reserveSoc).toMatchObject({ value: 0.3, basis: "USER_ENTERED" });
      expect(b.effective.wearInrPerKwh).toMatchObject({ value: 3.5, basis: "USER_ENTERED" });
      expect(b.usableKwh).toBeCloseTo(7.5, 6); // 10 x (0.95 - 0.2)
    });

    it.each([
      ["an efficiency below 0.5", { chargeEfficiency: 0.3 }, "0.5"],
      ["an efficiency above 1", { dischargeEfficiency: 1.2 }, ""],
      ["a minimum charge at or above the maximum", { minSoc: 0.9, maxSoc: 0.8 }, "must be below the maximum"],
      ["a reserve outside the usable band", { minSoc: 0.2, reserveSoc: 0.1 }, "backup reserve"],
      ["a zero capacity", { capacityKwh: 0 }, ""],
      ["a negative charge rate", { maxChargeKw: -3 }, ""],
      ["a state of charge above 1", { currentSoc: 1.5 }, ""],
      ["an unknown status", { status: "BROKEN" }, ""],
      ["a missing name", { name: "" }, ""],
    ])("rejects %s", async (_label, patch, fragment) => {
      const res = await add("batteries", { ...BATTERY, ...patch });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_FAILED");
      if (fragment) expect(res.json().error.message).toContain(fragment);
    });

    it("changes only what a PATCH sends, never resetting the rest (a Zod default must not leak in)", async () => {
      const made = (await add("batteries", { ...BATTERY, status: "PLANNED", currentSoc: 0.6, reserveSoc: 0.25, notes: "garage" })).json();
      const patched = (await call("PATCH", path("batteries", made.id), s, { name: "Renamed" })).json();
      expect(patched).toMatchObject({ name: "Renamed", status: "PLANNED", capacityKwh: 10, notes: "garage" });
      expect(patched.entered).toMatchObject({ currentSoc: 0.6, reserveSoc: 0.25 });
      expect(patched.currentSocAt).toBe(made.currentSocAt); // an unchanged charge keeps its own timestamp
    });

    it("clears an optional field when sent null, and stamps the charge time when a charge is sent", async () => {
      const made = (await add("batteries", { ...BATTERY, chargeEfficiency: 0.96 })).json();
      t.clock.now = new Date("2026-10-08T10:00:00Z");
      const p = (await call("PATCH", path("batteries", made.id), s, { chargeEfficiency: null, currentSoc: 0.4 })).json();
      expect(p.entered.chargeEfficiency).toBeNull();
      expect(p.effective.chargeEfficiency.basis).toBe("ASSUMPTION");
      expect(p.currentSocAt).toBe("2026-10-08T10:00:00.000Z");
    });

    it("checks the whole battery after a PATCH, not just the field sent", async () => {
      const made = (await add("batteries", { ...BATTERY, minSoc: 0.2 })).json();
      const bad = await call("PATCH", path("batteries", made.id), s, { maxSoc: 0.1 });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.message).toContain("must be below the maximum");
      expect((await call("GET", path("batteries"))).json().batteries[0].entered.maxSoc).toBeNull(); // nothing was changed
    });

    it("keeps at most 10 per property", async () => {
      for (let i = 0; i < 10; i++) expect((await add("batteries", { ...BATTERY, name: `B${i}` })).statusCode).toBe(201);
      const res = await add("batteries", BATTERY);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain("up to 10 batteries");
    });

    it("lists, deletes, and says 404 for a battery that is gone", async () => {
      const made = (await add("batteries", BATTERY)).json();
      expect((await call("GET", path("batteries"))).json().batteries).toHaveLength(1);
      expect((await call("DELETE", path("batteries", made.id))).statusCode).toBe(204);
      expect((await call("GET", path("batteries"))).json().batteries).toEqual([]);
      expect((await call("DELETE", path("batteries", made.id))).statusCode).toBe(404);
      expect((await call("PATCH", path("batteries", made.id), s, { name: "x" })).statusCode).toBe(404);
    });
  });

  describe("solar systems", () => {
    it("stores an array with its orientation and shows the loss default as an assumption", async () => {
      const x = (await add("solar-systems", SOLAR)).json();
      expect(x).toMatchObject({ capacityKwp: 3.3, tiltDeg: 15, azimuthDeg: 180, status: "EXISTING", inverterKw: null });
      expect(x.effective.lossFraction).toMatchObject({ value: 0.14, basis: "ASSUMPTION" });
      expect((await add("solar-systems", { ...SOLAR, lossFraction: 0.08, status: "PLANNED", inverterKw: 3 })).json().effective.lossFraction).toMatchObject({ value: 0.08, basis: "USER_ENTERED" });
    });

    it.each([
      ["a tilt over 90", { tiltDeg: 95 }],
      ["a negative tilt", { tiltDeg: -1 }],
      ["an azimuth of 360", { azimuthDeg: 360 }],
      ["a zero capacity", { capacityKwp: 0 }],
      ["losses above 50%", { lossFraction: 0.7 }],
    ])("rejects %s", async (_l, patch) => {
      expect((await add("solar-systems", { ...SOLAR, ...patch })).statusCode).toBe(400);
    });

    it("patches without resetting the status", async () => {
      const x = (await add("solar-systems", { ...SOLAR, status: "PLANNED" })).json();
      const p = (await call("PATCH", path("solar-systems", x.id), s, { tiltDeg: 20 })).json();
      expect(p).toMatchObject({ tiltDeg: 20, status: "PLANNED", azimuthDeg: 180 });
    });
  });

  describe("electric vehicles", () => {
    it("stores the departure rule, sorting the weekdays", async () => {
      const e = (await add("evs", EV)).json();
      expect(e).toMatchObject({ batteryKwh: 40, chargerKw: 7.4, targetSoc: 0.8, departureTime: "07:30", departureDays: [0, 1, 2, 3, 4] });
      expect(e.effective.chargerEfficiency).toMatchObject({ value: 0.9, basis: "ASSUMPTION" });
      expect(e.effective.chargerEfficiency.note).toContain("no source");
    });

    it.each([
      ["a time that is not 24-hour HH:MM", { departureTime: "7:30" }],
      ["a time of 25:00", { departureTime: "25:00" }],
      ["no days", { departureDays: [] }],
      ["a repeated day", { departureDays: [1, 1] }],
      ["a day of 7", { departureDays: [7] }],
      ["a target above 100%", { targetSoc: 1.2 }],
      ["a charger of 0 kW", { chargerKw: 0 }],
    ])("rejects %s", async (_l, patch) => {
      expect((await add("evs", { ...EV, ...patch })).statusCode).toBe(400);
    });

    it("stamps the charge time when a current charge is sent", async () => {
      t.clock.now = new Date("2026-10-08T06:00:00Z");
      const e = (await add("evs", { ...EV, currentSoc: 0.3 })).json();
      expect(e.currentSocAt).toBe("2026-10-08T06:00:00.000Z");
    });
  });

  describe("appliances", () => {
    it("stores a critical appliance and computes its total rated load", async () => {
      const a = (await add("appliances", { ...FRIDGE, quantity: 2 })).json();
      expect(a).toMatchObject({ priority: "CRITICAL", ratedPowerW: 150, quantity: 2, totalRatedKw: 0.3, schedule: null });
      expect(a.flexibility).toMatchObject({ earliestStart: null, durationMin: null, windowMinutes: null, interruptible: false });
    });

    it("requires a flexible appliance to say when it may run and for how long", async () => {
      const res = await add("appliances", { ...WASHER, earliestStart: undefined, latestFinish: undefined, durationMin: undefined });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain("window it may run in");
    });

    it("works out the window, including one that runs past midnight", async () => {
      expect((await add("appliances", WASHER)).json().flexibility.windowMinutes).toBe(360);
      const night = (await add("appliances", { ...WASHER, name: "Geyser", earliestStart: "22:00", latestFinish: "06:00", durationMin: 120 })).json();
      expect(night.flexibility.windowMinutes).toBe(480);
    });

    it("refuses a run longer than its window", async () => {
      const res = await add("appliances", { ...WASHER, durationMin: 400 });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain("360 minutes long");
    });

    it("refuses half a window", async () => {
      const res = await add("appliances", { ...FRIDGE, earliestStart: "10:00" });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain("both the earliest start and the latest finish");
    });

    it("stores a usual schedule and rejects a malformed one", async () => {
      const ok = await add("appliances", { ...FRIDGE, name: "AC", kind: "air conditioner", priority: "DISCRETIONARY", schedule: [{ days: [0, 1, 2, 3, 4], from: "19:00", to: "23:00" }] });
      expect(ok.json().schedule).toEqual([{ days: [0, 1, 2, 3, 4], from: "19:00", to: "23:00" }]);
      expect((await add("appliances", { ...FRIDGE, schedule: [{ days: [], from: "19:00", to: "23:00" }] })).statusCode).toBe(400);
      expect((await add("appliances", { ...FRIDGE, schedule: [{ days: [1], from: "7pm", to: "23:00" }] })).statusCode).toBe(400);
    });

    it("rejects impossible ratings and quantities", async () => {
      for (const bad of [{ ratedPowerW: 0 }, { ratedPowerW: -5 }, { quantity: 0 }, { quantity: 1.5 }, { priority: "URGENT" }, { runtimeMinPerDay: 2000 }]) {
        expect((await add("appliances", { ...FRIDGE, ...bad })).statusCode, JSON.stringify(bad)).toBe(400);
      }
    });

    it("patches without resetting quantity or interruptibility, and re-checks the window rule", async () => {
      const a = (await add("appliances", { ...WASHER, quantity: 3, interruptible: true })).json();
      const p = (await call("PATCH", path("appliances", a.id), s, { name: "Washer 2" })).json();
      expect(p).toMatchObject({ name: "Washer 2", quantity: 3, priority: "FLEXIBLE" });
      expect(p.flexibility.interruptible).toBe(true);
      const bad = await call("PATCH", path("appliances", a.id), s, { durationMin: 1000 });
      expect(bad.statusCode).toBe(400);
      const fridge = (await add("appliances", FRIDGE)).json();
      const toFlexible = await call("PATCH", path("appliances", fridge.id), s, { priority: "FLEXIBLE" });
      expect(toFlexible.statusCode).toBe(400); // becoming flexible needs a window
      expect((await call("PATCH", path("appliances", fridge.id), s, { priority: "FLEXIBLE", earliestStart: "09:00", latestFinish: "17:00", durationMin: 60 })).statusCode).toBe(200);
    });

    it("lists critical loads first", async () => {
      await add("appliances", { ...FRIDGE, name: "Pool pump", priority: "DISCRETIONARY" });
      await add("appliances", FRIDGE);
      expect((await call("GET", path("appliances"))).json().appliances.map((a: { priority: string }) => a.priority)).toEqual(["CRITICAL", "DISCRETIONARY"]);
    });
  });

  describe("logged runs of an appliance", () => {
    let applianceId: string;
    beforeEach(async () => {
      applianceId = (await add("appliances", WASHER)).json().id;
    });
    const events = (id = applianceId, sub = "") => path("appliances", id, `/events${sub}`);

    it("records a run as USER_LOGGED, never as an estimate", async () => {
      const res = await call("POST", events(), s, { startedAt: "2026-10-06T10:00:00+05:30", endedAt: "2026-10-06T11:30:00+05:30", energyKwh: 0.8 });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ source: "USER_LOGGED", energyKwh: 0.8, confidence: null, uncertaintyKwh: null, applianceId });
      expect((await call("POST", events(), s, { startedAt: "2026-10-06T10:00:00+05:30", source: "NILM_ESTIMATE" })).json().source).toBe("USER_LOGGED"); // a caller cannot claim another source
    });

    it("rejects a run that ends before it starts and a negative energy", async () => {
      expect((await call("POST", events(), s, { startedAt: "2026-10-06T11:00:00Z", endedAt: "2026-10-06T10:00:00Z" })).statusCode).toBe(400);
      expect((await call("POST", events(), s, { startedAt: "2026-10-06T11:00:00Z", energyKwh: -1 })).statusCode).toBe(400);
      expect((await call("POST", events(), s, { startedAt: "yesterday" })).statusCode).toBe(400);
    });

    it("lists newest first with a limit and a since filter, and deletes", async () => {
      for (const d of ["01", "02", "03"]) await call("POST", events(), s, { startedAt: `2026-10-${d}T10:00:00Z` });
      const all = (await call("GET", events())).json().events;
      expect(all.map((e: { startedAt: string }) => e.startedAt.slice(0, 10))).toEqual(["2026-10-03", "2026-10-02", "2026-10-01"]);
      expect((await call("GET", `${events()}?limit=1`)).json().events).toHaveLength(1);
      expect((await call("GET", `${events()}?since=2026-10-02T00:00:00Z`)).json().events).toHaveLength(2);
      expect((await call("DELETE", events(applianceId, `/${all[0].id}`))).statusCode).toBe(204);
      expect((await call("GET", events())).json().events).toHaveLength(2);
      expect((await call("DELETE", events(applianceId, `/${all[0].id}`))).statusCode).toBe(404);
    });

    it("deletes the runs together with their appliance", async () => {
      await call("POST", events(), s, { startedAt: "2026-10-01T10:00:00Z" });
      await call("DELETE", path("appliances", applianceId));
      expect(await db().applianceEvent.count()).toBe(0);
    });
  });

  describe("estimated appliance energy (NILM)", () => {
    const estimates = async () => (await call("GET", path("appliance-estimates"))).json();

    it("says there is nothing to estimate before any appliance is entered", async () => {
      const e = await estimates();
      expect(e).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
      expect(e.provenance.notes[0]).toContain("No appliances have been entered");
    });

    it("says it needs meter data when appliances exist but no readings do", async () => {
      await add("appliances", FRIDGE);
      expect((await estimates()).provenance.notes[0]).toContain("No meter data has been imported");
    });

    it("explains that 15-minute readings cannot tell appliances apart, and gives no figure", async () => {
      await add("appliances", FRIDGE);
      await call("POST", path("energy", undefined, "/imports"), s, { csv: meterCsv({ days: 8 }) });
      const e = await estimates();
      expect(e.value).toBeNull();
      expect(e.provenance.notes[0]).toContain("15-minute steps");
      expect(e.provenance.notes[0]).toContain("any figure would be a guess");
    });
  });

  describe("the summary and the Energy Twin", () => {
    it("shows each kind as UNAVAILABLE, with what to do, until something is entered", async () => {
      const a = (await call("GET", path("assets"))).json();
      for (const k of ["battery", "solar", "ev", "appliances"]) {
        expect(a[k]).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
        expect(a[k].provenance.notes[0]).toMatch(/^No .* has been entered/);
      }
    });

    it("summarises what was entered, labelled as the owner's own statement", async () => {
      await add("batteries", BATTERY);
      await add("batteries", { ...BATTERY, name: "Planned", status: "PLANNED", capacityKwh: 5 });
      await add("solar-systems", SOLAR);
      await add("solar-systems", { ...SOLAR, status: "PLANNED", capacityKwp: 2 });
      await add("evs", EV);
      await add("appliances", { ...FRIDGE, quantity: 2 });
      await add("appliances", WASHER);
      const a = (await call("GET", path("assets"))).json();
      expect(a.battery.value).toMatchObject({ count: 2, existingCount: 1, plannedCount: 1, totalCapacityKwh: 15, totalUsableKwh: 13.5, maxChargeKw: 10 });
      expect(a.solar.value).toMatchObject({ count: 2, existingKwp: 3.3, plannedKwp: 2 });
      expect(a.ev.value).toMatchObject({ count: 1, totalBatteryKwh: 40, maxChargerKw: 7.4 });
      expect(a.appliances.value).toMatchObject({ count: 3, totalRatedKw: 0.8, criticalKw: 0.3, flexibleKw: 0.5, byPriority: { CRITICAL: 2, FLEXIBLE: 1 } });
      expect(a.battery.provenance).toMatchObject({ status: "REFERENCE", provider: "user" });
      expect(a.battery.provenance.notes.join(" ")).toContain("has not checked it against the equipment");
    });

    it("records the assets in the Energy Twin as they were when it was built", async () => {
      await add("batteries", BATTERY);
      const v1 = (await call("POST", `/api/properties/${pid}/analyze`)).json();
      expect(v1.profiles.battery.value).toMatchObject({ count: 1, totalCapacityKwh: 10 });
      expect(v1.profiles.solar.value).toBeNull();
      expect(v1.sources.some((x: { provider: string; note: string }) => x.provider === "user" && x.note.includes("battery"))).toBe(true);
      await add("batteries", { ...BATTERY, name: "Second" });
      const reread = (await call("GET", `/api/properties/${pid}/twin`)).json();
      expect(reread.profiles.battery.value.count).toBe(1); // version 1 keeps what it was built with
      expect((await call("POST", `/api/properties/${pid}/analyze`)).json().profiles.battery.value.count).toBe(2);
    });
  });

  describe("privacy and the database", () => {
    it("never shows or changes another account's assets", async () => {
      const b = (await add("batteries", BATTERY)).json();
      const a = (await add("appliances", FRIDGE)).json();
      const other = await register(t, "other@example.com");
      for (const [m, u, body] of [
        ["GET", path("batteries"), undefined],
        ["POST", path("batteries"), BATTERY],
        ["PATCH", path("batteries", b.id), { name: "x" }],
        ["DELETE", path("batteries", b.id), undefined],
        ["GET", path("appliances"), undefined],
        ["POST", path("appliances", a.id, "/events"), { startedAt: "2026-10-01T10:00:00Z" }],
        ["GET", path("assets"), undefined],
        ["GET", path("appliance-estimates"), undefined],
      ] as const) {
        expect((await call(m, u, other, body)).statusCode, `${m} ${u}`).toBe(404);
      }
      expect((await call("GET", path("batteries"), null)).statusCode).toBe(401);
      expect(await db().battery.count()).toBe(1);
    });

    it("needs the CSRF header like every state-changing call", async () => {
      const res = await t.app.inject({ method: "POST", url: path("batteries"), cookies: s.cookies, payload: BATTERY });
      expect(res.statusCode).toBe(403);
    });

    it("deletes every asset with its property", async () => {
      await add("batteries", BATTERY);
      await add("solar-systems", SOLAR);
      await add("evs", EV);
      await add("appliances", FRIDGE);
      expect((await call("DELETE", `/api/properties/${pid}`)).statusCode).toBe(204);
      expect(await db().battery.count()).toBe(0);
      expect(await db().solarSystem.count()).toBe(0);
      expect(await db().ev.count()).toBe(0);
      expect(await db().appliance.count()).toBe(0);
    });

    it("refuses nonsense at the database even if the API is bypassed", async () => {
      const ok = { propertyId: pid, ...BATTERY };
      await expect(db().battery.create({ data: { ...ok, capacityKwh: -1 } })).rejects.toThrow(/batteries_sizes/);
      await expect(db().battery.create({ data: { ...ok, chargeEfficiency: 0.2 } })).rejects.toThrow(/batteries_efficiency/);
      await expect(db().battery.create({ data: { ...ok, minSoc: 0.9, maxSoc: 0.5 } })).rejects.toThrow(/batteries_soc_order/);
      await expect(db().solarSystem.create({ data: { propertyId: pid, name: "x", capacityKwp: 1, tiltDeg: 120, azimuthDeg: 180 } })).rejects.toThrow(/solar_systems_orientation/);
      await expect(db().ev.create({ data: { propertyId: pid, name: "x", batteryKwh: 40, chargerKw: 7, targetSoc: 0.8, departureTime: "7:30", departureDays: [1] } })).rejects.toThrow(/evs_departure/);
      await expect(db().ev.create({ data: { propertyId: pid, name: "x", batteryKwh: 40, chargerKw: 7, targetSoc: 0.8, departureTime: "07:30", departureDays: [9] } })).rejects.toThrow(/evs_departure/);
      await expect(db().appliance.create({ data: { propertyId: pid, name: "x", kind: "washer", priority: "FLEXIBLE", ratedPowerW: 500 } })).rejects.toThrow(/appliances_flexible_has_window/);
      const a = await db().appliance.create({ data: { propertyId: pid, name: "x", kind: "fridge", priority: "CRITICAL", ratedPowerW: 100 } });
      const ev = { applianceId: a.id, startedAt: new Date("2026-10-01T10:00:00Z") };
      await expect(db().applianceEvent.create({ data: { ...ev, source: "NILM_ESTIMATE", energyKwh: 1 } })).rejects.toThrow(/appliance_events_nilm_has_uncertainty/);
      await expect(db().applianceEvent.create({ data: { ...ev, source: "NILM_ESTIMATE", energyKwh: 1, confidence: 0.6 } })).rejects.toThrow(/appliance_events_nilm_has_uncertainty/);
      await expect(db().applianceEvent.create({ data: { ...ev, source: "NILM_ESTIMATE", energyKwh: 1, confidence: 0.6, uncertaintyKwh: 0.3 } })).resolves.toBeTruthy(); // with its uncertainty it is accepted
      await expect(db().applianceEvent.create({ data: { ...ev, source: "USER_LOGGED", endedAt: new Date("2026-10-01T09:00:00Z") } })).rejects.toThrow(/appliance_events_values/);
    });
  });
});
