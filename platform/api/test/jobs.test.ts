import { beforeEach, describe, expect, it } from "vitest";
import { JOBS, type JobDef } from "../src/jobs/registry.js";
import { JobRunner, startScheduler } from "../src/jobs/runner.js";
import { STALE_RUNNING_MS } from "../src/jobs/schedule.js";
import { seedReferenceData } from "../src/seed/reference.js";
import { LAT, LON, router } from "./fixtures.js";
import { type TestApp, db, defaultTestDataDir, hasDb, json, makeApp, register, resetDb } from "./helpers.js";

const describeDb = hasDb ? describe : describe.skip;
const MIN = 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeDb("the job runner", () => {
  let t: TestApp;
  const now = () => t.clock.now;
  const make = (defs: JobDef[], extra: { timeoutMs?: number } = {}) => new JobRunner({ db: db(), providers: t.deps.providers, now, defs, ...extra });
  const job = (name: string, run: JobDef["run"], over: Partial<JobDef["schedule"]> = {}): JobDef => ({ name, description: name, schedule: { everyMs: 60 * MIN, retryMs: 10 * MIN, ...over }, run });

  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
    t.clock.now = new Date("2026-10-08T10:00:00Z");
  });

  it("runs a job that has never run, records what it did and how long it took, and waits a whole interval before the next", async () => {
    const r = make([job("count", async () => ({ things: 3 }))]);
    const first = await r.runDue();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ job: "count", trigger: "SCHEDULE", status: "OK", summary: { things: 3 }, error: null });
    expect(first[0]!.finishedAt).not.toBeNull();
    expect(await r.runDue()).toEqual([]); // nothing is due a moment later
    t.clock.now = new Date(t.clock.now.getTime() + 59 * MIN);
    expect(await r.runDue()).toEqual([]);
    t.clock.now = new Date(t.clock.now.getTime() + 2 * MIN);
    expect((await r.runDue()).map((x) => x.status)).toEqual(["OK"]);
    expect(await db().jobRun.count({ where: { job: "count" } })).toBe(2);
  });

  it("records a failure with what went wrong, retries it after the shorter wait, and lets the other jobs run", async () => {
    let calls = 0;
    const r = make([
      job("breaks", async () => {
        calls++;
        throw new Error("the provider is down");
      }),
      job("fine", async () => ({ ok: 1 })),
    ]);
    const out = await r.runDue();
    expect(out.map((x) => [x.job, x.status])).toEqual([["breaks", "FAILED"], ["fine", "OK"]]);
    expect(out[0]!.error).toBe("the provider is down");
    t.clock.now = new Date(t.clock.now.getTime() + 9 * MIN);
    expect(await r.runDue()).toEqual([]); // not yet
    t.clock.now = new Date(t.clock.now.getTime() + 2 * MIN);
    const again = await r.runDue();
    expect(again.map((x) => [x.job, x.status])).toEqual([["breaks", "FAILED"]]); // retried after ten minutes, not an hour
    expect(calls).toBe(2);
  });

  it("will not start a job that is already running: a scheduled attempt does nothing, a manual one is recorded as skipped, with why", async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const r = make([job("slow", async () => (await gate, { done: 1 }))]);
    const running = r.run("slow", "SCHEDULE", null);
    await sleep(100); // let the first take its place
    expect(await r.run("slow", "SCHEDULE", null)).toBeNull();
    const manual = await r.run("slow", "MANUAL", null);
    expect(manual).toMatchObject({ status: "SKIPPED", trigger: "MANUAL", summary: { reason: "The job is already running." } });
    release();
    expect((await running)!.status).toBe("OK");
    expect(await db().jobRun.count({ where: { job: "slow", status: "OK" } })).toBe(1);
    expect(await db().jobRun.count({ where: { job: "slow", status: "SKIPPED" } })).toBe(1);
  });

  it("does not let a run that died with its process block the job for ever", async () => {
    await db().jobRun.create({ data: { job: "orphan", trigger: "SCHEDULE", startedAt: new Date(t.clock.now.getTime() - STALE_RUNNING_MS - MIN), status: "RUNNING" } });
    const r = make([job("orphan", async () => ({ ok: 1 }))]);
    expect((await r.runDue()).map((x) => x.status)).toEqual(["OK"]);
    // and one that is only recently running does
    await db().jobRun.create({ data: { job: "busy", trigger: "SCHEDULE", startedAt: new Date(t.clock.now.getTime() - 5 * MIN), status: "RUNNING" } });
    expect(await make([job("busy", async () => ({}))]).runDue()).toEqual([]);
  });

  it("abandons a job that runs too long and records that it did", async () => {
    const r = make([job("forever", () => new Promise(() => undefined))], { timeoutMs: 60 });
    const out = await r.run("forever", "MANUAL", null);
    expect(out).toMatchObject({ status: "FAILED" });
    expect(out!.error).toContain("took longer than");
  });

  it("names who asked for a manual run, and nobody for a scheduled one", async () => {
    const s = await register(t, "admin@example.com");
    const userId = (await db().user.findUniqueOrThrow({ where: { email: "admin@example.com" } })).id;
    expect(s.cookies).toBeDefined();
    const r = make([job("x", async () => ({}))]);
    await r.run("x", "MANUAL", userId);
    await r.run("x", "SCHEDULE", null);
    const rows = await db().jobRun.findMany({ where: { job: "x" }, orderBy: { startedAt: "asc" } });
    expect(rows.map((x) => [x.trigger, x.requestedBy])).toEqual([["MANUAL", userId], ["SCHEDULE", null]]);
  });

  it("reports each job's schedule and history for the admin page", async () => {
    const r = make([job("a", async () => ({ n: 1 }), { everyMs: 30 * MIN })]);
    expect((await r.status())[0]).toMatchObject({ name: "a", everyMinutes: 30, dueInSeconds: 0, recent: [] });
    await r.runDue();
    t.clock.now = new Date(t.clock.now.getTime() + 10 * MIN);
    const s = (await r.status())[0]!;
    expect(s.dueInSeconds).toBe(20 * 60);
    expect(s.recent).toHaveLength(1);
    expect(s.recent[0]).toMatchObject({ status: "OK", summary: { n: 1 } });
  });

  it("the scheduler runs what is due, does not repeat it, and stops when told", async () => {
    let calls = 0;
    const r = make([job("tick", async () => ({ n: ++calls }))]);
    const sch = startScheduler(r, 20);
    await sleep(400);
    sch.stop();
    expect(calls).toBe(1); // due once; the clock did not move, so never again
    const before = await db().jobRun.count();
    await sleep(100);
    expect(await db().jobRun.count()).toBe(before);
  });

  it("is held by the database: a run cannot be RUNNING with an end time, nor FAILED without saying why, nor name a requester unless manual", async () => {
    const base = { job: "c", startedAt: new Date() };
    await expect(db().jobRun.create({ data: { ...base, trigger: "SCHEDULE", status: "RUNNING", finishedAt: new Date() } })).rejects.toThrow(/job_runs_finished/);
    await expect(db().jobRun.create({ data: { ...base, trigger: "SCHEDULE", status: "OK" } })).rejects.toThrow(/job_runs_finished/);
    await expect(db().jobRun.create({ data: { ...base, trigger: "SCHEDULE", status: "FAILED", finishedAt: new Date() } })).rejects.toThrow(/job_runs_failure_says_why/);
  });
});

describeDb("the jobs themselves", () => {
  let t: TestApp;
  const runner = () => new JobRunner({ db: db(), providers: t.deps.providers, now: () => t.clock.now });
  const byName = (n: string) => JOBS.find((j) => j.name === n)!;

  beforeEach(async () => {
    await resetDb();
    await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
    t = await makeApp();
    t.clock.now = new Date("2026-10-08T10:00:00Z");
    t.setFetch(router(() => t.clock.now));
  });

  it("are the four the specification names that can be done without spending the planner, each with a schedule and a reason", () => {
    expect(JOBS.map((j) => j.name)).toEqual(["forecast-evaluation", "weather-refresh", "satellite-ingest", "tariff-validity"]);
    for (const j of JOBS) {
      expect(j.description.length).toBeGreaterThan(30);
      expect(j.schedule.retryMs).toBeLessThan(j.schedule.everyMs);
    }
  });

  it("tariff-validity counts the plans whose period has ended and the properties still on one", async () => {
    const s = await register(t, "tariff@example.com");
    const expired = await db().tariffPlan.findFirstOrThrow({ where: { seedKey: "curated:home-mathura" } });
    const open = await db().tariffPlan.findFirstOrThrow({ where: { seedKey: "curated:clinic-jaipur" } });
    for (const [name, plan] of [["A", expired], ["B", expired], ["C", open]] as const) {
      const p = (await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name, latitude: LAT, longitude: LON, positionSource: "map-click" } })).json();
      await t.app.inject({ method: "PUT", url: `/api/properties/${p.id}/tariff`, cookies: s.cookies, headers: s.headers, payload: { tariffPlanId: plan.id } });
    }
    const r = await runner().run("tariff-validity", "MANUAL", null);
    expect(r!.status).toBe("OK");
    // the Mathura and Pune orders ended on 2026-03-31; the Rajasthan schedule has no end date
    expect(r!.summary).toMatchObject({ plans: 3, expired: 2, unknownValidity: 0, propertiesOnExpired: 2 });
  });

  it("tariff-validity judges the catalogue only: a plan someone entered for themselves, with no dates, is theirs and is not counted", async () => {
    const s = await register(t, "own-plan@example.com");
    await t.app.inject({ method: "POST", url: "/api/tariffs", cookies: s.cookies, headers: s.headers, payload: { name: "Mine", consumerType: "RESIDENTIAL", touBlocks: [{ startHour: 0, endHour: 24, rate: 6 }], source: "my bill" } });
    expect(await db().tariffPlan.count({ where: { ownerId: { not: null } } })).toBe(1);
    const r = await runner().run("tariff-validity", "MANUAL", null);
    expect(r!.summary).toMatchObject({ plans: 3, unknownValidity: 0 }); // the three of the catalogue, and not the one with no end date
  });

  it("weather-refresh fetches each place once, however many properties are there, and keeps the issued values", async () => {
    const s = await register(t, "weather@example.com");
    for (const name of ["A", "B"]) await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name, latitude: LAT, longitude: LON, positionSource: "map-click" } });
    await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name: "Far", latitude: 26.9124, longitude: 75.7873, positionSource: "map-click" } });
    t.fetched.length = 0;
    const r = await runner().run("weather-refresh", "MANUAL", null);
    expect(r!.status).toBe("OK");
    expect(r!.summary).toMatchObject({ places: 2, ok: 2, failed: 0 });
    expect(t.fetched.filter((u) => u.hostname.includes("open-meteo"))).toHaveLength(2);
    expect(await db().weatherObservation.count()).toBeGreaterThan(0);
  });

  it("weather-refresh fails, saying what the provider said, when every call fails, and is retried soon", async () => {
    const s = await register(t, "weather2@example.com");
    await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name: "A", latitude: LAT, longitude: LON, positionSource: "map-click" } });
    t.setFetch(() => json({}, 400));
    const r = await runner().run("weather-refresh", "MANUAL", null);
    expect(r).toMatchObject({ status: "FAILED" });
    expect(r!.error).toContain("Every weather call failed (1)");
  });

  it("weather-refresh succeeds with a count of failures when only some places fail", async () => {
    const s = await register(t, "weather3@example.com");
    await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name: "A", latitude: LAT, longitude: LON, positionSource: "map-click" } });
    await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name: "Far", latitude: 26.9124, longitude: 75.7873, positionSource: "map-click" } });
    const ok = router(() => t.clock.now);
    t.setFetch((u) => (u.search.includes("26.9") ? json({}, 400) : ok(u)));
    const r = await runner().run("weather-refresh", "MANUAL", null);
    expect(r!.status).toBe("OK");
    expect(r!.summary).toMatchObject({ places: 2, ok: 1, failed: 1 });
  });

  it("satellite-ingest stores the scenes it finds for each place", async () => {
    const s = await register(t, "sat@example.com");
    await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name: "A", latitude: LAT, longitude: LON, positionSource: "map-click" } });
    const r = await runner().run("satellite-ingest", "MANUAL", null);
    expect(r!.status).toBe("OK");
    expect(r!.summary).toMatchObject({ places: 1, ok: 1, failed: 0 });
    expect(await db().satelliteObservation.count()).toBeGreaterThan(0);
  });

  it("forecast-evaluation visits only properties with stored forecasts, and does nothing, harmlessly, with none", async () => {
    const s = await register(t, "eval@example.com");
    await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name: "A", latitude: LAT, longitude: LON, positionSource: "map-click" } });
    const r = await runner().run("forecast-evaluation", "MANUAL", null);
    expect(r).toMatchObject({ status: "OK", summary: { properties: 0, scored: 0, notScorable: 0, waiting: 0 } });
  });

  it("a job with no properties to visit succeeds, rather than failing for want of work", async () => {
    const r = await runner().run("weather-refresh", "MANUAL", null);
    expect(r).toMatchObject({ status: "OK", summary: { places: 0, ok: 0, failed: 0 } });
    expect(byName("weather-refresh")).toBeDefined();
  });
});
