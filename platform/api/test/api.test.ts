import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, type TestApp, cookiesFrom, db, hasDb, json, makeApp, register, resetDb } from "./helpers.js";

const describeDb = hasDb ? describe : describe.skip;

describeDb("authentication", () => {
  let t: TestApp;
  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
  });
  afterAll(async () => db().$disconnect());

  it("registers, signs in with an HttpOnly session cookie, and returns the user", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "Ada@Example.com", password: PASSWORD, displayName: "Ada" } });
    expect(res.statusCode).toBe(201);
    const session = res.cookies.find((c) => c.name === "avk_session");
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(res.cookies.find((c) => c.name === "avk_csrf")?.httpOnly).toBeFalsy();
    expect(res.json().user).toMatchObject({ email: "ada@example.com", role: "USER", displayName: "Ada" });
    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", cookies: cookiesFrom(res) });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("ada@example.com");
  });

  it("never stores the password or the session token in clear", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "a@example.com", password: PASSWORD } });
    const token = cookiesFrom(res).avk_session!;
    const [user] = await db().user.findMany();
    expect(user!.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(user!.passwordHash).not.toContain(PASSWORD);
    const [s] = await db().session.findMany();
    expect(s!.tokenHash).not.toBe(token);
    expect(s!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    [{ email: "a@example.com", password: "short" }, "at least 10"],
    [{ email: "a@example.com", password: "password123" }, "commonly used"],
    [{ email: "not-an-email", password: PASSWORD }, "email"],
  ])("rejects bad registrations %j with VALIDATION_FAILED", async (payload, text) => {
    const res = await t.app.inject({ method: "POST", url: "/api/auth/register", payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
    expect(res.json().error.message.toLowerCase()).toContain(text);
  });

  it("refuses a duplicate email with EMAIL_TAKEN", async () => {
    await register(t, "dup@example.com");
    const res = await t.app.inject({ method: "POST", url: "/api/auth/register", payload: { email: "DUP@example.com", password: PASSWORD } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("EMAIL_TAKEN");
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await register(t, "real@example.com");
    const wrong = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "real@example.com", password: "wrong-password-1" } });
    const unknown = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "nobody@example.com", password: "wrong-password-1" } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error).toMatchObject({ code: "INVALID_CREDENTIALS", message: unknown.json().error.message });
  });

  it("rate-limits repeated sign-in attempts", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "x@example.com", password: "wrong-password-1" } })).statusCode;
    }
    expect(last).toBe(429);
  });

  it("signs out: the session stops working and the cookie is cleared", async () => {
    const s = await register(t, "out@example.com");
    const out = await t.app.inject({ method: "POST", url: "/api/auth/logout", cookies: s.cookies, headers: s.headers });
    expect(out.statusCode).toBe(204);
    const me = await t.app.inject({ method: "GET", url: "/api/auth/me", cookies: s.cookies });
    expect(me.statusCode).toBe(401);
  });

  it("expires sessions by time", async () => {
    const s = await register(t, "exp@example.com");
    t.clock.now = new Date(t.clock.now.getTime() + 15 * 24 * 3600 * 1000);
    expect((await t.app.inject({ method: "GET", url: "/api/auth/me", cookies: s.cookies })).statusCode).toBe(401);
  });

  it("rejects state-changing requests that lack the CSRF header, and wrong ones", async () => {
    const s = await register(t, "csrf@example.com");
    const body = { name: "Home", latitude: 12.97, longitude: 77.59, positionSource: "manual" };
    const missing = await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, payload: body });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe("CSRF_REJECTED");
    const wrong = await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: { "x-csrf-token": "nope" }, payload: body });
    expect(wrong.json().error.code).toBe("CSRF_REJECTED");
    const ok = await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: body });
    expect(ok.statusCode).toBe(201);
  });

  it("records sign-ups, sign-ins and failures in the audit log", async () => {
    await register(t, "audit@example.com");
    await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "audit@example.com", password: "wrong-password-1" } });
    const actions = (await db().auditLog.findMany({ orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["auth.register", "auth.login_failed"]);
  });
});

describeDb("properties", () => {
  let t: TestApp;
  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
  });
  const create = (s: Awaited<ReturnType<typeof register>>, over: Record<string, unknown> = {}) =>
    t.app.inject({
      method: "POST",
      url: "/api/properties",
      cookies: s.cookies,
      headers: s.headers,
      payload: { name: "Home", latitude: 12.9716, longitude: 77.5946, address: "Bengaluru", positionSource: "map-click", ...over },
    });

  it("requires sign-in", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/properties" })).statusCode).toBe(401);
  });

  it("saves a property, keeps PostGIS in step with lat/lon, and says plainly that no building geometry exists", async () => {
    const s = await register(t, "p@example.com");
    const res = await create(s, { positionSource: "browser-geolocation", positionAccuracyM: 12.4 });
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p.position).toMatchObject({ source: "browser-geolocation", label: "Browser geolocation", accuracyM: 12.4 });
    expect(p.position.description).toBe("POSITION SOURCE: Browser geolocation, accuracy 12 m");
    expect(p.geometry).toEqual({ status: "UNAVAILABLE", message: "BUILDING GEOMETRY UNAVAILABLE: analysis uses the point location.", items: [] });
    const [row] = await db().$queryRaw<{ x: number; y: number; srid: number }[]>`SELECT ST_X(location) x, ST_Y(location) y, ST_SRID(location) srid FROM properties`;
    expect(row).toEqual({ x: 77.5946, y: 12.9716, srid: 4326 });
  });

  it("keeps the geometry column correct when the coordinates change", async () => {
    const s = await register(t, "moves@example.com");
    const p = (await create(s)).json();
    await db().$executeRaw`UPDATE properties SET latitude = 18.52, longitude = 73.86 WHERE id = ${p.id}::uuid`;
    const [row] = await db().$queryRaw<{ x: number; y: number }[]>`SELECT ST_X(location) x, ST_Y(location) y FROM properties`;
    expect(row).toEqual({ x: 73.86, y: 18.52 });
  });

  it.each([
    [{ latitude: 91 }, "INVALID_COORDINATES"],
    [{ longitude: -181 }, "INVALID_COORDINATES"],
    [{ latitude: 12.9, longitude: 1e9 }, "INVALID_COORDINATES"],
    [{ positionSource: "navic" }, "VALIDATION_FAILED"],
    [{ positionSource: "telepathy" }, "VALIDATION_FAILED"],
    [{ name: "" }, "VALIDATION_FAILED"],
    [{ latitude: "12.9" }, "VALIDATION_FAILED"],
  ])("refuses a bad property %j with %s", async (over, code) => {
    const s = await register(t, "bad@example.com");
    const res = await create(s, over);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(code);
    expect(await db().property.count()).toBe(0);
  });

  it("accepts a NavIC label only when a receiver integration is enabled", async () => {
    const enabled = await makeApp({ NAVIC_RECEIVER_ENABLED: "true" });
    const s = await register(enabled, "navic@example.com");
    const res = await enabled.app.inject({
      method: "POST",
      url: "/api/properties",
      cookies: s.cookies,
      headers: s.headers,
      payload: { name: "Rooftop", latitude: 12.97, longitude: 77.59, positionSource: "navic" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().position.label).toBe("NavIC receiver");
  });

  it("warns, without refusing, about a location outside India", async () => {
    const s = await register(t, "uk@example.com");
    const res = await create(s, { latitude: 51.5, longitude: -0.12 });
    expect(res.statusCode).toBe(201);
    expect(res.json().warnings[0]).toContain("outside India");
  });

  it("isolates users: nobody can read, change, delete or list another user's property", async () => {
    const a = await register(t, "a@example.com");
    const b = await register(t, "b@example.com");
    const p = (await create(a)).json();
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${p.id}`, cookies: b.cookies })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "PATCH", url: `/api/properties/${p.id}`, cookies: b.cookies, headers: b.headers, payload: { name: "mine now" } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "DELETE", url: `/api/properties/${p.id}`, cookies: b.cookies, headers: b.headers })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: "/api/properties", cookies: b.cookies })).json().properties).toEqual([]);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${p.id}`, cookies: a.cookies })).statusCode).toBe(200);
  });

  it("lists, renames and deletes a property, and rejects a malformed id", async () => {
    const s = await register(t, "crud@example.com");
    const p = (await create(s)).json();
    expect((await t.app.inject({ method: "GET", url: "/api/properties", cookies: s.cookies })).json().properties).toHaveLength(1);
    const patched = await t.app.inject({ method: "PATCH", url: `/api/properties/${p.id}`, cookies: s.cookies, headers: s.headers, payload: { name: "Shop" } });
    expect(patched.json().name).toBe("Shop");
    expect((await t.app.inject({ method: "PATCH", url: `/api/properties/${p.id}`, cookies: s.cookies, headers: s.headers, payload: {} })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "GET", url: "/api/properties/not-a-uuid", cookies: s.cookies })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "DELETE", url: `/api/properties/${p.id}`, cookies: s.cookies, headers: s.headers })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${p.id}`, cookies: s.cookies })).statusCode).toBe(404);
  });

  describe("drawn polygons", () => {
    // About 20 m x 20 m around the default test point (12.9716, 77.5946).
    const near = (d = 0): [number, number][] => [
      [77.5945 + d, 12.9715], [77.5947 + d, 12.9715], [77.5947 + d, 12.9717], [77.5945 + d, 12.9717], [77.5945 + d, 12.9715],
    ];
    const post = (s: Awaited<ReturnType<typeof register>>, id: string, ring: unknown) =>
      t.app.inject({ method: "POST", url: `/api/properties/${id}/geometry`, cookies: s.cookies, headers: s.headers, payload: { ring } });

    it("stores a valid outline, measures its area in square metres, and returns GeoJSON", async () => {
      const s = await register(t, "poly@example.com");
      const p = (await create(s)).json();
      const res = await post(s, p.id, near());
      expect(res.statusCode).toBe(201);
      const g = res.json().geometry;
      expect(g.status).toBe("AVAILABLE");
      expect(g.items[0]).toMatchObject({ kind: "USER_POLYGON", source: "user" });
      expect(g.items[0].areaM2).toBeGreaterThan(300);
      expect(g.items[0].areaM2).toBeLessThan(600);
      expect(g.items[0].geojson.type).toBe("Polygon");
    });

    it.each([
      ["too few points", [[77.5, 12.9], [77.6, 12.9], [77.5, 12.9]], ">=4"],
      ["not closed", [[77.5945, 12.9715], [77.5947, 12.9715], [77.5947, 12.9717], [77.5945, 12.9717]], "closed"],
      ["self-crossing bow-tie", [[77.5945, 12.9715], [77.5947, 12.9717], [77.5947, 12.9715], [77.5945, 12.9717], [77.5945, 12.9715]], "valid shape"],
      ["far from the property", [[77.7, 12.9715], [77.7002, 12.9715], [77.7002, 12.9717], [77.7, 12.9717], [77.7, 12.9715]], "within 500 m"],
      ["impossible coordinates", [[77.59, 12.97], [77.59, 95], [77.6, 95], [77.6, 12.97], [77.59, 12.97]], "latitude"],
    ])("refuses a polygon that is %s", async (_label, ring, text) => {
      const s = await register(t, `bad-${_label.replace(/\W/g, "")}@example.com`);
      const p = (await create(s)).json();
      const res = await post(s, p.id, ring);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain(text);
      expect(await db().propertyGeometry.count()).toBe(0);
    });

    it("cannot attach a polygon to someone else's property", async () => {
      const a = await register(t, "own@example.com");
      const b = await register(t, "other@example.com");
      const p = (await create(a)).json();
      expect((await post(b, p.id, near())).statusCode).toBe(404);
    });
  });
});

describeDb("account export and deletion", () => {
  let t: TestApp;
  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
  });

  it("exports only the caller's data", async () => {
    const a = await register(t, "ea@example.com");
    const b = await register(t, "eb@example.com");
    const mk = (s: typeof a, name: string) => t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name, latitude: 12.9, longitude: 77.5, positionSource: "manual" } });
    await mk(a, "A-home");
    await mk(b, "B-home");
    const res = await t.app.inject({ method: "GET", url: "/api/account/export", cookies: a.cookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe("ea@example.com");
    expect(body.properties.map((p: { name: string }) => p.name)).toEqual(["A-home"]);
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("B-home");
  });

  it("deletes the account and its data for real, keeping only anonymous audit rows", async () => {
    const s = await register(t, "gone@example.com");
    await t.app.inject({ method: "POST", url: "/api/properties", cookies: s.cookies, headers: s.headers, payload: { name: "Home", latitude: 12.9, longitude: 77.5, positionSource: "manual" } });
    const wrong = await t.app.inject({ method: "DELETE", url: "/api/account", cookies: s.cookies, headers: s.headers, payload: { password: "not-my-password" } });
    expect(wrong.statusCode).toBe(401);
    expect(await db().user.count()).toBe(1);
    const ok = await t.app.inject({ method: "DELETE", url: "/api/account", cookies: s.cookies, headers: s.headers, payload: { password: PASSWORD } });
    expect(ok.statusCode).toBe(204);
    expect(await db().user.count()).toBe(0);
    expect(await db().property.count()).toBe(0);
    expect(await db().session.count()).toBe(0);
    const audits = await db().auditLog.findMany();
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every((a) => a.userId === null || a.action !== "account.delete")).toBe(true);
    expect(audits.find((a) => a.action === "account.delete")?.userId).toBeNull();
    const login = await t.app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "gone@example.com", password: PASSWORD } });
    expect(login.statusCode).toBe(401);
  });
});

describeDb("geocoding", () => {
  let t: TestApp;
  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
  });
  const place = { place_id: 1, lat: "12.9767936", lon: "77.590082", display_name: "Bengaluru, Karnataka, India", category: "boundary", type: "administrative", importance: 0.7 };

  it("returns results with REFERENCE provenance and attribution", async () => {
    t.setFetch(() => json([place]));
    const res = await t.app.inject({ method: "GET", url: "/api/geocode/search?q=Bengaluru&countries=in" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.value[0]).toMatchObject({ label: "Bengaluru, Karnataka, India", latitude: 12.9767936 });
    expect(body.provenance).toMatchObject({ status: "REFERENCE", provider: "nominatim" });
    expect(body.provenance.notes.join(" ")).toContain("OpenStreetMap");
    expect(t.fetched[0]!.searchParams.get("countrycodes")).toBe("in");
  });

  it("says the geocoder is unavailable instead of inventing a location", async () => {
    t.setFetch(() => json({}, 503));
    const res = await t.app.inject({ method: "GET", url: "/api/geocode/search?q=Bengaluru" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: "PROVIDER_UNAVAILABLE", details: { provider: "nominatim" } });
  });

  it("rejects bad input before calling the provider", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/geocode/search?q=ab" })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "GET", url: "/api/geocode/reverse?latitude=120&longitude=10" })).json().error.code).toBe("INVALID_COORDINATES");
    expect((await t.app.inject({ method: "GET", url: "/api/geocode/reverse?latitude=x&longitude=10" })).statusCode).toBe(400);
    expect(t.fetched).toHaveLength(0);
  });

  it("reverse geocodes a coordinate and returns null in the open ocean", async () => {
    t.setFetch(() => json({ error: "Unable to geocode" }));
    const res = await t.app.inject({ method: "GET", url: "/api/geocode/reverse?latitude=0&longitude=-30" });
    expect(res.statusCode).toBe(200);
    expect(res.json().value).toBeNull();
  });
});

describeDb("system health and observability", () => {
  let t: TestApp;
  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
  });

  it("reports the database and PostGIS, and 'unknown' (not 'healthy') for providers with no traffic", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/system/health" });
    const h = res.json();
    expect(h.database.state).toBe("healthy");
    expect(h.database.postgis).toMatch(/^3\./);
    expect(h.providers.map((p: { provider: string }) => p.provider)).toEqual(["nominatim", "open-meteo", "open-meteo-previous-runs", "nasa-power", "overpass", "earth-search"]);
    expect(h.providers.every((p: { state: string; calls: number }) => p.state === "unknown" && p.calls === 0)).toBe(true);
    expect(h.status).toBe("ok");
  });

  it("derives provider health from real recorded calls, including failures", async () => {
    t.setFetch(() => json([{ place_id: 1, lat: "12.9", lon: "77.5", display_name: "x" }]));
    await t.app.inject({ method: "GET", url: "/api/geocode/search?q=first+place" });
    let h = (await t.app.inject({ method: "GET", url: "/api/system/health" })).json();
    expect(h.providers[0]).toMatchObject({ state: "healthy", calls: 1, failures: 0 });
    expect(h.providers[0].p50Ms).toBeGreaterThanOrEqual(0);

    t.setFetch(() => json({}, 503));
    await t.app.inject({ method: "GET", url: "/api/geocode/search?q=second+place" });
    h = (await t.app.inject({ method: "GET", url: "/api/system/health" })).json();
    expect(h.providers[0].failures).toBeGreaterThan(0);
    expect(["degraded", "down"]).toContain(h.providers[0].state);
    expect(h.status).toBe("degraded");
    expect(h.providers[0].lastError).toContain("503");
  });

  it("echoes a safe request id and generates one otherwise", async () => {
    const a = await t.app.inject({ method: "GET", url: "/api/health", headers: { "x-request-id": "abc-123" } });
    expect(a.headers["x-request-id"]).toBe("abc-123");
    const b = await t.app.inject({ method: "GET", url: "/api/health", headers: { "x-request-id": "bad id with spaces!" } });
    expect(b.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("answers unknown routes with the standard error body", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("serves an OpenAPI document that describes the routes", async () => {
    const doc = (await t.app.inject({ method: "GET", url: "/api/openapi.json" })).json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/api/auth/register", "/api/properties", "/api/geocode/search", "/api/system/health"]));
    expect(doc.paths["/api/properties"].post.requestBody).toBeDefined();
  });
});

describeDb("database constraints (the last line of defence)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses to record a value as LIVE without an observation time", async () => {
    const insert = (status: string, observed: string | null) =>
      db().$executeRawUnsafe(
        `INSERT INTO data_provenance (id, entity_type, data_type, status, provider, source, processing_version, observed_at)
         VALUES (gen_random_uuid(), 'weather_observation', 'air_temperature', '${status}'::"DataStatus", 'open-meteo', 'test', 'v1', ${observed ? `'${observed}'` : "NULL"})`,
      );
    await expect(insert("LIVE", null)).rejects.toThrow(/live_needs_observation_time/);
    await expect(insert("LIVE", "2026-10-07T12:00:00Z")).resolves.toBe(1);
    await expect(insert("FORECAST", null)).resolves.toBe(1);
  });

  it("refuses impossible coordinates, emails and areas at the database level", async () => {
    const u = await db().user.create({ data: { email: "c@example.com", passwordHash: "x" } });
    await expect(
      db().$executeRaw`INSERT INTO properties (id, owner_id, name, latitude, longitude, position_source, updated_at) VALUES (gen_random_uuid(), ${u.id}::uuid, 'x', 95, 10, 'manual', now())`,
    ).rejects.toThrow(/latitude_range/);
    await expect(db().user.create({ data: { email: "Upper@Example.com", passwordHash: "x" } })).rejects.toThrow();
  });

  it("makes the audit log append-only", async () => {
    await db().auditLog.create({ data: { action: "test.event" } });
    await expect(db().$executeRaw`UPDATE audit_logs SET action = 'tampered'`).rejects.toThrow(/append-only/);
    await expect(db().$executeRaw`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
    expect((await db().auditLog.findMany()).map((a) => a.action)).toEqual(["test.event"]);
  });
});
