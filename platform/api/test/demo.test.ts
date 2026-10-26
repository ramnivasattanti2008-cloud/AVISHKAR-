import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_TARIFF_SOURCE } from "../src/demo/world.js";
import { EngineClient } from "../src/engine/client.js";
import { seedReferenceData } from "../src/seed/reference.js";
import { type RunningEngine, engineAvailable, startEngine } from "./engine-process.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, defaultTestDataDir, hasDb, makeApp, register, resetDb } from "./helpers.js";

const describeDb = hasDb ? describe : describe.skip;
const describeBoth = engineAvailable && hasDb ? describe : describe.skip;

let engine: RunningEngine;
beforeAll(async () => {
  if (engineAvailable && hasDb) engine = await startEngine();
}, 60_000);
afterAll(async () => {
  await engine?.stop();
});

const NOW = new Date("2026-10-08T06:30:00Z"); // 12:00 IST

function setup(withEngine: boolean) {
  const ctx = {} as { t: TestApp; s: Session };
  beforeEach(async () => {
    await resetDb();
    await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
    ctx.t = await makeApp({}, withEngine ? { engine: new EngineClient({ baseUrl: engine.url, apiKey: engine.key, timeoutMs: 180_000 }) } : {});
    ctx.t.clock.now = NOW;
    ctx.t.setFetch(router(() => ctx.t.clock.now));
    ctx.s = await register(ctx.t, "demo@example.com");
  });
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, session: Session | null = ctx.s) =>
    ctx.t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const load = async () => {
    const res = await call("POST", "/api/demo/world");
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const idOf = (world: { sites: { key: string; propertyId: string }[] }, key: string) => world.sites.find((x) => x.key === key)!.propertyId;
  return { ctx, call, load, idOf };
}

describeDb("the demo world", () => {
  const { ctx, call, load, idOf } = setup(false);

  it("adds four demo properties with invented readings, equipment and the sourced tariff where one exists, all marked DEMO DATA", async () => {
    expect((await call("GET", "/api/demo/world")).json()).toMatchObject({ label: "DEMO DATA", loaded: false });
    const r = await load();
    expect(r.created).toBe(4);
    expect(r.world.loaded).toBe(true);
    expect(Object.fromEntries(r.world.sites.map((s: { city: string; tariff: string }) => [s.city, s.tariff]))).toMatchObject({ Bengaluru: "DEMO time-of-day tariff (invented)" });
    for (const s of r.world.sites) expect(s.tariff).not.toBeNull();

    const props = (await call("GET", "/api/properties")).json().properties;
    expect(props).toHaveLength(4);
    for (const p of props) {
      expect(p.isDemo).toBe(true);
      expect(p.warnings[0]).toMatch(/^DEMO DATA: an invented property in a real place/);
    }
    const clinic = idOf(r.world, "jaipur-clinic");
    const summary = (await call("GET", `/api/properties/${clinic}/energy`)).json();
    expect(JSON.stringify(summary)).toContain("avishkar-demo-jaipur-clinic.csv");
    expect(await db().energyObservation.count({ where: { propertyId: clinic } })).toBe(120 * 24);
    expect(await db().battery.count({ where: { propertyId: clinic } })).toBe(1);
    expect(await db().appliance.count({ where: { propertyId: clinic, priority: "CRITICAL" } })).toBe(1);
    const planName = (await db().property.findUniqueOrThrow({ where: { id: clinic }, include: { tariffPlan: true } })).tariffPlan!.seedKey;
    expect(planName).toBe("curated:clinic-jaipur");
    expect(await db().auditLog.count({ where: { action: "demo.load" } })).toBe(1);
  }, 120_000);

  it("is the same world when loaded twice: nothing is added the second time", async () => {
    await load();
    const again = await load();
    expect(again.created).toBe(0);
    expect(await db().property.count({ where: { isDemo: true } })).toBe(4);
    expect(await db().tariffPlan.count({ where: { source: DEMO_TARIFF_SOURCE } })).toBe(1);
  }, 120_000);

  it("labels what is computed from the invented readings DEMO, and never adds demo properties to the owner's own", async () => {
    const r = await load();
    const home = idOf(r.world, "bengaluru-home");
    const dna = (await call("GET", `/api/properties/${home}/energy-dna`)).json();
    const statuses = [...JSON.stringify(dna).matchAll(/"status":"([A-Z]+)"/g)].map((m) => m[1]);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.filter((x) => !["DEMO", "UNAVAILABLE", "REFERENCE"].includes(x!))).toEqual([]);

    const real = (await call("POST", "/api/properties", { name: "My real home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
    const own = (await call("GET", `/api/properties/${real}`)).json();
    expect(own.isDemo).toBe(false);
    const community = (await call("GET", "/api/community")).json();
    expect(community.members.map((m: { name: string }) => m.name)).toEqual(["My real home"]);
    expect(community.notes.join(" ")).toContain("Your 4 demo properties are left out");

    const report = (await call("GET", `/api/properties/${home}/report`)).body;
    expect(report).toContain("**DEMO DATA.** This is a demo property");
  }, 120_000);

  it("belongs to its owner only, and is removed with everything under it, leaving the owner's real property and data alone", async () => {
    const r = await load();
    const home = idOf(r.world, "bengaluru-home");
    const other = await register(ctx.t, "other@example.com");
    expect((await call("GET", `/api/properties/${home}`, undefined, other)).statusCode).toBe(404);
    expect((await call("GET", "/api/demo/world", undefined, other)).json().loaded).toBe(false);
    expect((await call("GET", "/api/demo/world", undefined, null)).statusCode).toBe(401);
    expect((await ctx.t.app.inject({ method: "POST", url: "/api/demo/world", cookies: ctx.s.cookies })).statusCode).toBe(403); // no CSRF header

    const real = (await call("POST", "/api/properties", { name: "Mine", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
    const del = await call("DELETE", "/api/demo/world");
    expect(del.json()).toEqual({ removed: 4 });
    expect(await db().property.count({ where: { isDemo: true } })).toBe(0);
    expect(await db().energyObservation.count()).toBe(0);
    expect(await db().tariffPlan.count({ where: { source: DEMO_TARIFF_SOURCE } })).toBe(0);
    expect((await call("GET", `/api/properties/${real}`)).statusCode).toBe(200);
    expect(await db().tariffPlan.count({ where: { seedKey: "curated:clinic-jaipur" } })).toBe(1); // the catalogue is not the demo's to delete
  }, 120_000);

  it("keeps the invented tariff when the owner has chosen it for a real property", async () => {
    await load();
    const plan = (await db().tariffPlan.findFirstOrThrow({ where: { source: DEMO_TARIFF_SOURCE } })).id;
    const real = (await call("POST", "/api/properties", { name: "Mine", latitude: LAT, longitude: LON, positionSource: "map-click" })).json().id;
    expect((await call("PUT", `/api/properties/${real}/tariff`, { tariffPlanId: plan })).statusCode).toBe(200);
    await call("DELETE", "/api/demo/world");
    expect(await db().tariffPlan.count({ where: { id: plan } })).toBe(1);
  }, 120_000);
});

describeBoth("the demo world through the real engine", () => {
  const { call, load, idOf } = setup(true);

  it("plans a demo home, and the plan, its forecasts and the Copilot all say DEMO, while the weather at the real place keeps its own label", async () => {
    const r = await load();
    const home = idOf(r.world, "bengaluru-home");

    const solar = (await call("GET", `/api/properties/${home}/solar-forecast`)).json();
    expect(solar.hours.provenance.status).toBe("DEMO");
    expect(solar.hours.provenance.notes[0]).toContain("computed as FORECAST");

    const res = await call("POST", `/api/properties/${home}/plan`, {});
    expect(res.statusCode, res.body).toBe(201);
    const plan = res.json();
    expect(plan.result.provenance.status).toBe("DEMO");
    const kept = [...JSON.stringify(plan).matchAll(/"provider":"([^"]+)","[^}]*?"status":"([A-Z]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    for (const k of kept) if (!k.startsWith("open-meteo") && !k.startsWith("nasa-power")) expect(k).toMatch(/:(DEMO|REFERENCE|UNAVAILABLE)$/);

    // the Today view: what is computed from the invented readings says DEMO; the weather at the real place keeps its own label
    const td = (await call("GET", `/api/properties/${home}/today`)).json();
    expect(td.plan.provenance.status).toBe("DEMO");
    expect(td.generation.provenance.status).toBe("DEMO");
    expect(td.weatherRisk.provenance.status).toBe("FORECAST");
    expect(td.weatherRisk.provenance.provider).toBe("open-meteo");

    const answer = (await call("POST", `/api/properties/${home}/copilot/ask`, { question: "which tariff am I on" })).json();
    expect(answer.paragraphs[0]).toMatch(/^DEMO DATA: this is a demo property/);

    const vpp = await call("POST", "/api/vpp/simulate", { archetypePropertyId: home, homes: 10 });
    expect(vpp.statusCode, vpp.body).toBe(200);
    expect(vpp.json().isDemo).toBe(true);
    expect(vpp.json().result.provenance.status).toBe("DEMO");
    expect(vpp.json().notes[0]).toContain("DEMO DATA");
  }, 240_000);
});
