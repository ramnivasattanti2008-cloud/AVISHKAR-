/**
 * The allocation route over HTTP, against a real database: who may call it, what it refuses, and that allocating between
 * the owner's own properties uses those properties' own entered systems and imported readings rather than anything made up.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeDb = hasDb ? describe : describe.skip;
const describeBoth = engineAvailable && hasDb ? describe : describe.skip;
const DAY = 86_400_000;
const IST = 330 * 60_000;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

/** The three buildings the project owner specified, as the route takes them. */
const THREE = [
  { id: "a", name: "Building A", generationKw: 8, demandKw: 3 },
  { id: "b", name: "Building B", generationKw: 2, demandKw: 4 },
  { id: "c", name: "Building C", generationKw: 0, demandKw: 3 },
];

function harness(withEngine = false) {
  const ctx = {} as { t: TestApp; s: Session; pid: string };
  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown, session: Session | null = ctx.s) =>
    ctx.t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  beforeEach(async () => {
    await resetDb();
    ctx.t = await makeApp({}, withEngine ? { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 180_000 }) } : {});
    ctx.t.clock.now = new Date("2026-10-07T04:40:00Z"); // 10:10 IST
    ctx.t.setFetch(router(() => ctx.t.clock.now));
    ctx.s = await register(ctx.t, "community@example.com");
    ctx.pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });
  const allocate = async (body: unknown, session: Session | null = ctx.s) => call("POST", "/api/community/allocate", body, session);
  return { ctx, call, allocate };
}

describeDb("POST /api/community/allocate", () => {
  const { ctx, call, allocate } = harness();

  it("requires a signed-in account", async () => {
    const res = await allocate({ members: THREE }, null);
    expect(res.statusCode).toBe(401);
  });

  it("allocates the specified three-building scenario and imports nothing", async () => {
    const res = await allocate({ members: THREE });
    expect(res.statusCode, res.body).toBe(200);
    const b = res.json();
    expect(b.label).toBe("COMMUNITY ALLOCATION SIMULATION");
    expect(b.source).toBe("MEMBERS_GIVEN");
    expect(b.result.provenance.status).toBe("SIMULATED");

    const members = b.result.value.members as { name: string; receivedKw: number; sentKw: number }[];
    expect(members.find((m) => m.name === "Building B")!.receivedKw).toBe(2);
    expect(members.find((m) => m.name === "Building C")!.receivedKw).toBe(3);
    expect(members.find((m) => m.name === "Building A")!.sentKw).toBe(5);
    expect(b.result.value.totals.gridImportKw).toBe(0);
    expect(b.result.value.check.balanced).toBe(true);
  });

  it("says in the response that AVISHKAR does not move electricity and claims nothing about what is permitted", async () => {
    const b = (await allocate({ members: THREE })).json();
    const notes = (b.notes as string[]).join(" ");
    expect(notes).toMatch(/does not move electricity/i);
    expect(notes).toMatch(/depends on the law/i);
    expect(notes).toMatch(/never allocated twice/i);
  });

  it("says where every input came from", async () => {
    const b = (await allocate({ members: THREE })).json();
    expect(b.inputs).toHaveLength(3);
    for (const i of b.inputs as { basis: string[] }[]) expect(i.basis.join(" ")).toMatch(/supplied in the request/);
  });

  it("applies a feeder limit and names it as the binding constraint", async () => {
    const b = (await allocate({ members: THREE, limits: { feederLimitKw: 3 } })).json();
    expect(b.result.value.feederBinding).toBe(true);
    expect(b.result.value.totals.gridImportKw).toBe(2);
    const members = b.result.value.members as { name: string; binding: string }[];
    expect(members.find((m) => m.name === "Building C")!.binding).toBe("FEEDER_LIMIT");
  });

  it("takes every allocation rule and every battery policy", async () => {
    for (const rule of ["PROPORTIONAL", "EQUAL_SHARE", "CRITICAL_FIRST", "NEAREST_FIRST"]) {
      for (const batteryPolicy of ["SHARE_FIRST", "BATTERY_FIRST"]) {
        const res = await allocate({ members: THREE, limits: { rule, batteryPolicy, feederLimitKw: 4 } });
        expect(res.statusCode, `${rule}/${batteryPolicy}: ${res.body}`).toBe(200);
        expect(res.json().result.value.check.balanced).toBe(true);
      }
    }
  });

  it("refuses a body that gives both members and properties, or neither", async () => {
    expect((await allocate({ members: THREE, propertyIds: [ctx.pid] })).statusCode).toBe(400);
    expect((await allocate({})).statusCode).toBe(400);
    expect((await allocate({ members: [] })).statusCode).toBe(400);
  });

  it("refuses figures that cannot describe a real property", async () => {
    const negative = await allocate({ members: [{ id: "a", name: "A", generationKw: -1, demandKw: 2 }] });
    expect(negative.statusCode).toBe(400);
    const badLoss = await allocate({ members: [{ id: "a", name: "A", generationKw: 1, demandKw: 2, lineLossFraction: 0.9 }] });
    expect(badLoss.statusCode).toBe(400);
    const badBattery = await allocate({ members: [{ id: "a", name: "A", generationKw: 1, demandKw: 2, battery: { usableKwh: 5, socKwh: 9, maxChargeKw: 2, maxDischargeKw: 2 } }] });
    expect(badBattery.statusCode).toBe(400);
  });

  it("will not allocate between another account's properties", async () => {
    const other = await register(ctx.t, "someone-else@example.com");
    const theirs = (await call("POST", "/api/properties", { name: "Theirs", latitude: LAT, longitude: LON, positionSource: "map-click" }, other)).json().id;
    const res = await allocate({ propertyIds: [theirs] });
    expect(res.statusCode).toBe(404);
  });

  it("says what is missing when a property has no imported readings, instead of inventing a demand", async () => {
    const res = await allocate({ propertyIds: [ctx.pid] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/no imported meter readings/i);
  });
});

describeBoth("allocating between the owner's own properties", () => {
  const { ctx, call, allocate } = harness(true);

  /** Gives a property a tariff, seventy days of real imported readings and a solar system, as a real owner would. */
  const equip = async (pid: string, kwp: number | null) => {
    const tariff = (await call("POST", "/api/tariffs", { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" })).json();
    await call("PUT", `/api/properties/${pid}/tariff`, { tariffPlanId: tariff.id });
    const istToday = new Date(ctx.t.clock.now.getTime() + IST).toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${istToday}T00:00:00Z`) - 70 * DAY).toISOString().slice(0, 10);
    const res = await call("POST", `/api/properties/${pid}/energy/imports`, { csv: meterCsv({ start, days: 70, intervalMinutes: 60, kw: (_d, h) => 0.5 + (h >= 18 && h < 22 ? 2 : 0) }), filename: "m.csv" });
    expect(res.statusCode, res.body).toBe(201);
    if (kwp !== null) await call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: kwp, tiltDeg: 12, azimuthDeg: 180, inverterKw: kwp });
  };

  it("builds each property's generation and demand from its own data and balances", async () => {
    const second = (await call("POST", "/api/properties", { name: "Shop", latitude: LAT + 0.01, longitude: LON + 0.01, positionSource: "map-click" })).json().id;
    await equip(ctx.pid, 6);
    await equip(second, null);

    const res = await allocate({ propertyIds: [ctx.pid, second], hour: 11, month: 10 });
    expect(res.statusCode, res.body).toBe(200);
    const b = res.json();
    expect(b.source).toBe("YOUR_PROPERTIES");
    const members = b.result.value.members as { id: string; name: string; generationKw: number; demandKw: number }[];
    expect(members).toHaveLength(2);
    // The property with a 6 kWp roof generates at 11:00; the one with none does not.
    expect(members.find((m) => m.id === ctx.pid)!.generationKw).toBeGreaterThan(0);
    expect(members.find((m) => m.id === second)!.generationKw).toBe(0);
    // Both have the same imported pattern, so both have the same demand at 11:00.
    expect(members.find((m) => m.id === second)!.demandKw).toBeCloseTo(0.5, 1);
    expect(b.result.value.check.balanced).toBe(true);
  }, 120_000);

  it("names the source of each figure, and does not pretend to know a limit nobody gave", async () => {
    await equip(ctx.pid, 6);
    const b = (await allocate({ propertyIds: [ctx.pid], hour: 11, month: 10 })).json();
    const basis = (b.inputs[0].basis as string[]).join(" ");
    expect(basis).toMatch(/imported meter readings/);
    expect(basis).toMatch(/pvlib/);
    expect(basis).toMatch(/inverter rating entered/);
    // The schema holds no sanctioned load, so the response must say so rather than apply a figure as if it were real.
    expect(basis).toMatch(/import limit: not known/);
    expect(basis).toMatch(/line loss 0/);
  }, 120_000);

  it("applies a what-if override and says it was the caller's figure", async () => {
    await equip(ctx.pid, 6);
    const b = (await allocate({ propertyIds: [ctx.pid], hour: 11, month: 10, overrides: { [ctx.pid]: { demandKw: 9 } } })).json();
    expect((b.result.value.members as { demandKw: number }[])[0]!.demandKw).toBe(9);
    expect((b.inputs[0].basis as string[]).join(" ")).toMatch(/you changed this to 9/);
  }, 120_000);

  it("prices the interval from the properties' own tariffs", async () => {
    const second = (await call("POST", "/api/properties", { name: "Shop", latitude: LAT + 0.01, longitude: LON + 0.01, positionSource: "map-click" })).json().id;
    await equip(ctx.pid, 8);
    await equip(second, null);
    const b = (await allocate({ propertyIds: [ctx.pid, second], hour: 11, month: 10 })).json();
    const c = b.result.value.comparison;
    expect(c).not.toBeNull();
    expect(typeof c.withoutSharingInr).toBe("number");
    expect(c.basis).toMatch(/own tariff/);
  }, 120_000);
});
