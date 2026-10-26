import { beforeEach, describe, expect, it } from "vitest";
import { setRole } from "../src/admin/service.js";
import { seedReferenceData } from "../src/seed/reference.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, db, defaultTestDataDir, hasDb, makeApp, register, resetDb } from "./helpers.js";

const describeDb = hasDb ? describe : describe.skip;

describeDb("the admin API", () => {
  let t: TestApp;
  let admin: Session;
  let user: Session;
  const call = (method: "GET" | "POST", url: string, session: Session | null = admin, payload?: unknown) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });

  beforeEach(async () => {
    await resetDb();
    await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
    t = await makeApp();
    t.clock.now = new Date("2026-10-08T10:00:00Z");
    t.setFetch(router(() => t.clock.now));
    admin = await register(t, "admin@example.com");
    user = await register(t, "someone@example.com");
    await setRole(db(), "admin@example.com", "ADMIN"); // the role is read from the database on every request
  });

  it("is for administrators only: a signed-in user is refused, and so is a request with no session", async () => {
    for (const [method, url] of [["GET", "/api/admin/overview"], ["GET", "/api/admin/jobs"], ["GET", "/api/admin/audit"], ["POST", "/api/admin/jobs/tariff-validity/run"]] as const) {
      const as = await call(method, url, user);
      expect(as.statusCode, `${method} ${url}`).toBe(403);
      expect(as.json().error.code).toBe("FORBIDDEN");
      expect((await call(method, url, null)).statusCode, `${method} ${url} without a session`).toBe(401);
    }
    expect((await call("GET", "/api/admin/overview")).statusCode).toBe(200);
  });

  it("cannot be reached by promoting yourself: no route changes a role, and a registration always makes an ordinary user", async () => {
    const reg = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "sneaky@example.com", password: "correct-horse-battery", role: "ADMIN" } });
    expect(reg.json().user.role).toBe("USER");
    expect((await db().user.findUniqueOrThrow({ where: { email: "sneaky@example.com" } })).role).toBe("USER");
    for (const method of ["PUT", "PATCH", "POST"] as const) {
      const res = await t.app.inject({ method, url: "/api/auth/me", cookies: user.cookies, headers: user.headers, payload: { role: "ADMIN" } });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect((await db().user.findUniqueOrThrow({ where: { email: "someone@example.com" } })).role).toBe("USER");
  });

  it("shows the health of the data, the catalogue and the providers as counts, with the expired orders named", async () => {
    const mathura = await db().tariffPlan.findFirstOrThrow({ where: { seedKey: "curated:home-mathura" } });
    const p = (await call("POST", "/api/properties", user, { name: "Secret Home", latitude: LAT, longitude: LON, positionSource: "map-click" })).json();
    await t.app.inject({ method: "PUT", url: `/api/properties/${p.id}/tariff`, cookies: user.cookies, headers: user.headers, payload: { tariffPlanId: mathura.id } });

    const o = (await call("GET", "/api/admin/overview")).json();
    expect(o.users).toMatchObject({ total: 2, admins: 1, joinedLast7Days: 2 });
    expect(o.properties).toMatchObject({ total: 1, demo: 0, withMeterData: 0, withTariff: 1, withSolar: 0, withBattery: 0 });
    expect(o.dataHealth).toMatchObject({ propertiesOnExpiredTariff: 1, meterDataStale: 0, forecastsAwaitingScore: 0 });

    const tariffs = Object.fromEntries(o.catalogue.tariffs.map((x: { name: string }) => [x.name, x]));
    const names = Object.keys(tariffs);
    expect(names).toHaveLength(3);
    const expired = o.catalogue.tariffs.filter((x: { validity: string }) => x.validity === "EXPIRED").map((x: { name: string }) => x.name);
    expect(expired).toHaveLength(2); // the Mathura and Pune orders ended on 2026-03-31
    const m = o.catalogue.tariffs.find((x: { id: string }) => x.id === mathura.id);
    expect(m).toMatchObject({ validity: "EXPIRED", propertiesUsing: 1 });
    expect(m.source.length).toBeGreaterThan(10);
    expect(o.catalogue.policyRules.length).toBeGreaterThan(0);
    expect(o.catalogue.policyRules[0]).toMatchObject({ program: expect.any(String), source: expect.any(String) });

    expect(o.models.engine).toEqual({ state: "not_configured", version: null, solver: null, error: null });
    expect(o.providers.map((x: { provider: string }) => x.provider)).toContain("open-meteo");
  });

  it("shows no one's readings, equipment, names or addresses: counts and aggregates only", async () => {
    await call("POST", "/api/properties", user, { name: "Secret Home", latitude: LAT, longitude: LON, positionSource: "map-click", address: "12 Hidden Lane" });
    const text = (await call("GET", "/api/admin/overview")).body;
    for (const secret of ["Secret Home", "12 Hidden Lane", "someone@example.com", "admin@example.com"]) expect(text).not.toContain(secret);
  });

  it("counts what was used in the last seven days from the audit log", async () => {
    await call("POST", "/api/properties", user, { name: "A", latitude: LAT, longitude: LON, positionSource: "map-click" });
    await call("POST", "/api/properties", user, { name: "B", latitude: LAT, longitude: LON, positionSource: "map-click" });
    const o = (await call("GET", "/api/admin/overview")).json();
    expect(o.usageLast7Days["property.create"]).toBe(2);
    expect(o.usageLast7Days["auth.register"]).toBe(2);
    expect(o.usageLast7Days["admin.overview"]).toBe(1); // reading this page is itself recorded, before it is counted
  });

  it("lists the jobs with when each is due, runs one on request as a manual run by that administrator, and audits it", async () => {
    const before = (await call("GET", "/api/admin/jobs")).json();
    expect(before.schedulerEnabled).toBe(false);
    expect(before.jobs.map((j: { name: string }) => j.name)).toEqual(["forecast-evaluation", "weather-refresh", "satellite-ingest", "tariff-validity"]);
    expect(before.jobs.every((j: { dueInSeconds: number; recent: unknown[] }) => j.dueInSeconds === 0 && j.recent.length === 0)).toBe(true);

    const run = await call("POST", "/api/admin/jobs/tariff-validity/run");
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json()).toMatchObject({ job: "tariff-validity", trigger: "MANUAL", status: "OK", summary: { plans: 3, expired: 2 } });
    const adminId = (await db().user.findUniqueOrThrow({ where: { email: "admin@example.com" } })).id;
    expect((await db().jobRun.findFirstOrThrow({ where: { job: "tariff-validity" } })).requestedBy).toBe(adminId);
    expect(await db().auditLog.count({ where: { action: "admin.job.run", userId: adminId, entityId: "tariff-validity" } })).toBe(1);

    const after = (await call("GET", "/api/admin/jobs")).json().jobs.find((j: { name: string }) => j.name === "tariff-validity");
    expect(after.recent).toHaveLength(1);
    expect(after.dueInSeconds).toBeGreaterThan(0);
    expect(after.recent[0].status).toBe("OK");
  });

  it("refuses to run a job that does not exist", async () => {
    const res = await call("POST", "/api/admin/jobs/nothing/run");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain("No job is called nothing");
  });

  it("pages through the audit log, newest first, with who did what and from where, and can filter by action", async () => {
    await call("POST", "/api/properties", user, { name: "A", latitude: LAT, longitude: LON, positionSource: "map-click" });
    await call("POST", "/api/properties", user, { name: "B", latitude: LAT, longitude: LON, positionSource: "map-click" });
    const first = (await call("GET", "/api/admin/audit?limit=2")).json();
    expect(first.entries).toHaveLength(2);
    expect(first.entries[0]).toMatchObject({ action: "admin.audit.read", user: "admin@example.com" }); // reading the log is written to it first, so it is the newest
    expect(first.entries[1]).toMatchObject({ action: "property.create", user: "someone@example.com", entityType: "property" });
    expect(first.next).not.toBeNull();
    const second = (await call("GET", `/api/admin/audit?limit=2&before=${first.next}`)).json();
    expect(second.entries.length).toBeGreaterThan(0);
    expect(BigInt(second.entries[0].id)).toBeLessThan(BigInt(first.next));
    const onlyProps = (await call("GET", "/api/admin/audit?action=property&limit=50")).json();
    expect(onlyProps.entries).toHaveLength(2);
    expect(onlyProps.entries.every((e: { action: string }) => e.action.startsWith("property"))).toBe(true);
    expect(onlyProps.next).toBeNull();
    // reading the log is itself written to it
    expect(await db().auditLog.count({ where: { action: "admin.audit.read" } })).toBe(3);
    expect((await call("GET", "/api/admin/audit?limit=0")).statusCode).toBe(400);
    expect((await call("GET", "/api/admin/audit?limit=500")).statusCode).toBe(400);
    expect((await call("GET", "/api/admin/audit?before=abc")).statusCode).toBe(400);
  });
});

describeDb("granting the administrator role", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is done by the command line only, writes the audit log, and works both ways", async () => {
    const t = await makeApp();
    await register(t, "future-admin@example.com");
    const granted = await setRole(db(), "Future-Admin@Example.com ", "ADMIN");
    expect(granted).toMatchObject({ email: "future-admin@example.com", role: "ADMIN" });
    const grant = await db().auditLog.findFirstOrThrow({ where: { action: "admin.grant" } });
    expect(grant).toMatchObject({ userId: null, entityType: "user", entityId: granted.id });
    expect(grant.detail).toMatchObject({ from: "USER", to: "ADMIN", by: "command line" });
    expect((await setRole(db(), "future-admin@example.com", "USER")).role).toBe("USER");
    expect(await db().auditLog.count({ where: { action: "admin.revoke" } })).toBe(1);
  });

  it("refuses an email that has no account", async () => {
    await expect(setRole(db(), "nobody@example.com", "ADMIN")).rejects.toThrow("No account has the email nobody@example.com.");
  });
});
