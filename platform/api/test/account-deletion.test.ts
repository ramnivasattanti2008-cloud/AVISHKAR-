import { beforeEach, describe, expect, it } from "vitest";
import { seedReferenceData } from "../src/seed/reference.js";
import { LAT, LON, router } from "./fixtures.js";
import { type Session, type TestApp, PASSWORD, db, defaultTestDataDir, hasDb, makeApp, register, resetDb } from "./helpers.js";

const describeDb = hasDb ? describe : describe.skip;

const NOW = new Date("2026-10-08T06:30:00Z");

/** Every foreign key in the schema that points at users or properties: [table, column, referenced table, on delete rule]. */
async function foreignKeysToOwners(): Promise<{ table: string; column: string; refers: string; rule: string }[]> {
  return db().$queryRaw<{ table: string; column: string; refers: string; rule: string }[]>`
    SELECT t.relname AS "table", a.attname AS "column", r.relname AS "refers",
           CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' ELSE c.confdeltype::text END AS "rule"
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_class r ON r.oid = c.confrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND r.relname IN ('users', 'properties') AND t.relnamespace = r.relnamespace`;
}

/** The number of rows in every table of the schema (the spatial reference table and Prisma's own bookkeeping aside). */
async function rowCounts(): Promise<Record<string, number>> {
  const tables = await db().$queryRaw<{ name: string }[]>`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
  const out: Record<string, number> = {};
  for (const t of tables) out[t.name] = (await db().$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t.name}"`))[0]!.n;
  return out;
}

/** Tables that may be larger after the account is gone than before it had any data: the audit trail, and the shared caches of what outside providers said about a place. */
const MAY_GROW = new Set(["audit_logs", "provider_calls", "cache_entries", "data_provenance", "weather_observations"]);

describeDb("what deleting an account removes (spec section 50)", () => {
  let t: TestApp;
  let s: Session;
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown, session: Session = s) =>
    t.app.inject({ method, url, cookies: session.cookies, headers: session.headers, payload: payload as never });

  beforeEach(async () => {
    await resetDb();
    await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
    t = await makeApp();
    t.clock.now = NOW;
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "leaving@example.com");
  });

  it("leaves no foreign key that keeps a row after its owner is gone, other than the few that are meant to and are listed here", async () => {
    const fks = await foreignKeysToOwners();
    expect(fks.length).toBeGreaterThan(15); // the query really found the schema's keys
    const keeps = fks.filter((f) => f.rule !== "CASCADE").map((f) => `${f.table}.${f.column} -> ${f.refers}: ${f.rule}`).sort();
    // Each of these is either an audit trail, a record of who asked for something that is not the owner's data, or a link to shared reference data.
    expect(keeps).toEqual(
      [
        "audit_logs.user_id -> users: SET NULL",
        "control_proposals.decided_by -> users: SET NULL",
        "control_settings.updated_by -> users: SET NULL",
        "job_runs.requested_by -> users: SET NULL",
      ].sort(),
    );
  });

  it("removes every row that belongs to the account, in every table, and the rows left in the audit log carry neither the account nor its address", async () => {
    const other = await register(t, "staying@example.com"); // someone else, whose rows must survive
    const keep = await t.app.inject({ method: "POST", url: "/api/properties", cookies: other.cookies, headers: other.headers, payload: { name: "Stays", latitude: LAT, longitude: LON, positionSource: "manual" } });
    expect(keep.statusCode).toBe(201);
    const before = await rowCounts(); // both people exist, the leaving one has nothing yet

    const world = await call("POST", "/api/demo/world");
    expect(world.statusCode, world.body).toBe(200);
    const clinic = world.json().world.sites[0].propertyId as string;
    const own = await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "manual" });
    expect(own.statusCode, own.body).toBe(201);
    const home = own.json().id as string;
    expect((await call("PUT", `/api/properties/${home}/control`, { mode: "RECOMMEND" })).statusCode).toBe(200);
    expect((await call("PUT", `/api/properties/${clinic}/control`, { mode: "RECOMMEND" })).statusCode).toBe(200);

    const filled = await rowCounts();
    const touched = Object.keys(filled).filter((k) => !MAY_GROW.has(k) && filled[k]! > before[k]!);
    expect(touched.length, `tables that now hold the account's rows: ${touched.join(", ")}`).toBeGreaterThan(8); // the check below would be vacuous otherwise

    const gone = await call("DELETE", "/api/account", { password: PASSWORD });
    expect(gone.statusCode, gone.body).toBe(204);

    const after = await rowCounts();
    for (const [table, n] of Object.entries(after)) {
      if (MAY_GROW.has(table)) continue;
      // the leaving account's session is gone as well, so nothing is above where it began, and its own tables are back to it
      expect(n, table).toBeLessThanOrEqual(before[table]!);
    }
    for (const table of touched) expect(after[table], table).toBe(before[table]! - (table === "sessions" ? 1 : 0)); // back to where it was; only the session the call itself used is also gone
    expect(await db().user.count()).toBe(1);
    expect(await db().property.count()).toBe(1); // the other person's

    // the audit log: nothing links to the account any more, none of its rows has an address, and one anonymous row says it happened
    const audits = await db().auditLog.findMany();
    expect(audits.some((a) => a.action === "demo.load")).toBe(true); // the trail of what was done stays
    const unlinked = audits.filter((x) => x.userId === null); // the account's rows, whose link was erased (there was no failed sign-in here, which would be unlinked from the start)
    expect(unlinked.length).toBeGreaterThan(3);
    for (const a of unlinked) expect(a.ip, a.action).toBeNull();
    const marker = audits.filter((a) => a.action === "account.delete");
    expect(marker).toHaveLength(1);
    expect(marker[0]).toMatchObject({ userId: null, ip: null });
  });

  it("still refuses to edit or delete an audit row in any other way", async () => {
    await call("POST", "/api/properties", { name: "Home", latitude: LAT, longitude: LON, positionSource: "manual" });
    const row = await db().auditLog.findFirstOrThrow();
    await expect(db().$executeRaw`UPDATE audit_logs SET action = 'x' WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
    await expect(db().$executeRaw`UPDATE audit_logs SET ip = NULL WHERE id = ${row.id}`).rejects.toThrow(/append-only/); // an address is erased only together with the link
    await expect(db().$executeRaw`DELETE FROM audit_logs WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
    await expect(db().$executeRaw`UPDATE audit_logs SET user_id = NULL, ip = NULL, action = 'x' WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
  });
});

describeDb("what the export holds (spec section 50)", () => {
  let t: TestApp;
  let s: Session;
  const call = (method: "GET" | "POST", url: string, payload?: unknown, session: Session = s) =>
    t.app.inject({ method, url, cookies: session.cookies, headers: session.headers, payload: payload as never });

  beforeEach(async () => {
    await resetDb();
    await seedReferenceData(db(), { dataDir: defaultTestDataDir() });
    t = await makeApp();
    t.clock.now = NOW;
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "taking@example.com");
  });

  it("carries the equipment, the meter files, the tariffs entered and the counts of what was stored, as they are in the database, and nobody else's", async () => {
    expect((await call("POST", "/api/demo/world")).statusCode).toBe(200);
    const other = await register(t, "neighbour@example.com");
    await t.app.inject({ method: "POST", url: "/api/properties", cookies: other.cookies, headers: other.headers, payload: { name: "Neighbour-house", latitude: LAT, longitude: LON, positionSource: "manual" } });

    const res = await call("GET", "/api/account/export");
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.holdings.properties).toHaveLength(4);
    expect(body.holdings.properties.map((p: { propertyId: string }) => p.propertyId).sort()).toEqual(body.properties.map((p: { id: string }) => p.id).sort());

    const mine = await db().user.findUniqueOrThrow({ where: { email: "taking@example.com" } });
    const count = (n: number, what: string) => expect(n, what).toBeGreaterThan(0);
    const sum = (f: (p: (typeof body.holdings.properties)[number]) => number) => body.holdings.properties.reduce((a: number, p: (typeof body.holdings.properties)[number]) => a + f(p), 0);
    expect(sum((p) => p.equipment.batteries.length)).toBe(await db().battery.count({ where: { property: { ownerId: mine.id } } }));
    expect(sum((p) => p.equipment.solarSystems.length)).toBe(await db().solarSystem.count({ where: { property: { ownerId: mine.id } } }));
    expect(sum((p) => p.equipment.appliances.length)).toBe(await db().appliance.count({ where: { property: { ownerId: mine.id } } }));
    expect(sum((p) => p.meterImports.length)).toBe(await db().energyImport.count({ where: { property: { ownerId: mine.id } } }));
    expect(sum((p) => p.meterReadings.count)).toBe(await db().energyObservation.count({ where: { property: { ownerId: mine.id } } }));
    count(sum((p) => p.equipment.batteries.length), "batteries exported");
    count(sum((p) => p.meterReadings.count), "readings counted");
    expect(body.holdings.ownTariffs.length).toBe(await db().tariffPlan.count({ where: { ownerId: mine.id } }));

    const text = JSON.stringify(body);
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("Neighbour-house");
    expect(text).not.toContain("neighbour@example.com");
  });
});
