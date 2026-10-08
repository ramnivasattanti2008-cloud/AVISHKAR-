import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../src/engine/client.js";
import { breakEvenInr } from "../src/opportunities/service.js";
import { economics } from "../src/scenarios/economics.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, hasDb, makeApp, register, resetDb } from "./helpers.js";
import { meterCsv } from "./meter-csv.js";

const describeBoth = engineAvailable && hasDb ? describe : describe.skip;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

const PATTERN = (h: number) => 0.5 + (h >= 18 && h < 22 ? 2 : 0);
const TARIFF = { name: "Test ToD", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 6, rate: 4 }, { startHour: 6, endHour: 18, rate: 6 }, { startHour: 18, endHour: 24, rate: 10 }], exportRate: 3, source: "test tariff" };

describe("breakEvenInr", () => {
  it("is the present value of a saving that lasts 20 years, falls 0.5% a year and is discounted at 8%", () => {
    let pv = 0;
    for (let t = 1; t <= 20; t++) pv += (1000 * 0.995 ** (t - 1)) / 1.08 ** t;
    expect(breakEvenInr(1000)).toBeCloseTo(pv, 1);
    expect(breakEvenInr(1000)).toBeCloseTo(9_481.4, 0); // about 9.5 times the yearly saving: 20 years at 8%, less ageing
    expect(breakEvenInr(2000)).toBeCloseTo(2 * breakEvenInr(1000), 1);
    // at exactly that price the investment breaks even: net present value zero
    expect(economics({ investmentInr: breakEvenInr(1000), annualSavingsInr: 1000, years: 20, discountRate: 0.08, tariffEscalation: 0, degradation: 0.005 }).npvInr).toBeCloseTo(0, 1);
  });
});

describeBoth("opportunities, through the API and the real engine", () => {
  let t: TestApp;
  let s: Session;
  let pid: string;
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, session: Session | null = s) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const find = async () => {
    const res = await call("POST", `/api/properties/${pid}/opportunities`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const tariff = async (over: Record<string, unknown> = {}) => (await call("POST", "/api/tariffs", { ...TARIFF, ...over })).json();
  const useTariff = async (tf: { id: string }) => expect((await call("PUT", `/api/properties/${pid}/tariff`, { tariffPlanId: tf.id })).statusCode).toBe(200);
  const meter = (start = "2026-07-29", days = 70) => call("POST", `/api/properties/${pid}/energy/imports`, { csv: meterCsv({ start, days, intervalMinutes: 60, kw: (_d, h) => PATTERN(h) }), filename: "m.csv" });

  beforeEach(async () => {
    await resetDb();
    t = await makeApp({}, { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 180_000 }) });
    t.clock.now = new Date("2026-10-07T10:10:00Z");
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "opp@example.com");
    pid = (await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
  });

  it("tries solar and a battery on the property's own year, ranks them by saving, and gives each the most it could cost and still repay itself", async () => {
    await useTariff(await tariff());
    await meter();
    const r = await find();
    const money = r.items.filter((i: { kind: string }) => i.kind === "ADD_SOLAR" || i.kind === "ADD_BATTERY");
    expect(money.map((i: { id: string }) => i.id).sort()).toEqual(["battery-10", "battery-5", "solar-3", "solar-5"]);
    const savings = money.map((i: { annualSavingsInr: number }) => i.annualSavingsInr);
    expect(savings).toEqual([...savings].sort((a, b) => b - a)); // ranked
    for (const i of money) {
      expect(i.annualSavingsInr).toBeGreaterThan(100);
      expect(i.provenance.status).toBe("ESTIMATED");
      const size = Number(i.id.split("-")[1]);
      expect(i.breakEven.totalInr).toBeCloseTo(breakEvenInr(i.annualSavingsInr), -1);
      expect(i.breakEven.perUnitInr).toBeCloseTo(i.breakEven.totalInr / size, -1);
      expect(i.breakEven.unit).toBe(i.kind === "ADD_SOLAR" ? "kWp" : "kWh");
      expect(i.href).toBe("/what-if");
    }
    expect(r.notes.join(" ")).toContain("AVISHKAR has no price list");
  });

  it("gives the same saving the What-if tab gives for the same change", async () => {
    await useTariff(await tariff());
    await meter();
    const r = await find();
    const solar3 = r.items.find((i: { id: string }) => i.id === "solar-3");
    const sc = (await call("POST", `/api/properties/${pid}/scenarios`, solar3.scenario)).json();
    expect(sc.comparison.value.annualSavingsInr).toBeCloseTo(solar3.annualSavingsInr, 0);
    expect(solar3.scenario).toEqual({ addSolarKwp: 3 });
  });

  it("suggests only the sizes that make sense for what is already there", async () => {
    await useTariff(await tariff());
    await meter();
    await call("POST", `/api/properties/${pid}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 13, azimuthDeg: 180 });
    await call("POST", `/api/properties/${pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
    const r = await find();
    const tried = [...r.items.filter((i: { kind: string }) => i.kind !== "PROVIDE_DATA" && i.kind !== "CHANGE_TARIFF").map((i: { title: string }) => i.title), ...r.checked.map((c: { title: string }) => c.title)];
    // it has solar and a battery: the sizes to add are 2 and 4 kWp and 5 kWh, and nothing is "installed" from scratch
    expect(tried.sort()).toEqual(["Add 2 kWp of solar", "Add 4 kWp of solar", "Add a 5 kWh battery"]);
  });

  it("compares only tariffs it could really be on: the owner's own plans, with the dearer one listed as checked and what it would cost", async () => {
    await useTariff(await tariff());
    await meter();
    const cheaper = await tariff({ name: "Flat 7", touBlocks: [{ startHour: 0, endHour: 24, rate: 7 }], exportRate: 3 }); // 140 a day for this pattern against 158
    await tariff({ name: "Flat 14", touBlocks: [{ startHour: 0, endHour: 24, rate: 14 }], exportRate: 3 });
    const r = await find();
    const item = r.items.find((i: { kind: string }) => i.kind === "CHANGE_TARIFF");
    expect(item.title).toBe("Switch to Flat 7");
    expect(item.scenario).toEqual({ tariffPlanId: cheaper.id });
    expect(item.annualSavingsInr).toBeCloseTo(365 * 18, -1); // 158 - 140 a day
    expect(item.breakEven).toBeNull(); // a tariff costs nothing to switch to, so there is nothing to break even on
    expect(item.detail).toContain("up to your distribution company");
    const worse = r.checked.find((c: { title: string }) => c.title === "Switch to Flat 14");
    expect(worse.annualSavingsInr).toBeCloseTo(-365 * (14 * 20 - 158), -1);
    expect(r.items.filter((i: { kind: string }) => i.kind === "CHANGE_TARIFF")).toHaveLength(1);
  });

  it("looks at what the records lack, and says where to fix it", async () => {
    await useTariff(await tariff());
    await meter("2026-03-02", 30); // ends in March: old
    await call("POST", `/api/properties/${pid}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
    const r = await find();
    const data = Object.fromEntries(r.items.filter((i: { kind: string }) => i.kind === "PROVIDE_DATA").map((i: { id: string; href: string; annualSavingsInr: unknown }) => [i.id, i]));
    expect(Object.keys(data).sort()).toEqual(["data-battery-charge", "data-flexible", "data-meter-old"]);
    expect(data["data-meter-old"].href).toBe("/meter-data");
    expect(data["data-battery-charge"].href).toBe("/assets");
    expect(data["data-battery-charge"].annualSavingsInr).toBeNull();
    expect(data["data-meter-old"].provenance.status).toBe("REFERENCE");
  });

  it("asks for the tariff and the readings first, and does not need the engine to say so", async () => {
    const bare = await makeApp();
    const u = await register(bare, "bare@example.com");
    const id = (await bare.app.inject({ method: "POST", url: "/api/properties", cookies: u.cookies, headers: u.headers, payload: { name: "H", latitude: LAT, longitude: LON, positionSource: "map-click" } })).json().id;
    const res = await bare.app.inject({ method: "POST", url: `/api/properties/${id}/opportunities`, cookies: u.cookies, headers: u.headers });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.items.map((i: { id: string }) => i.id)).toEqual(["data-tariff", "data-meter", "data-flexible"]);
    expect(r.notes.join(" ")).toContain("need your tariff and meter readings first");
  });

  it("is private to its owner and needs a session and the CSRF header", async () => {
    await useTariff(await tariff());
    await meter();
    const other = await register(t, "other@example.com");
    expect((await call("POST", `/api/properties/${pid}/opportunities`, undefined, other)).statusCode).toBe(404);
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${pid}/opportunities` })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${pid}/opportunities`, cookies: s.cookies })).statusCode).toBe(403);
  });
});
