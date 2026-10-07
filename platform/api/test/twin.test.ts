import { beforeEach, describe, expect, it } from "vitest";
import { buildingWay, LAT, LON, overpassBody, POWER_ANNUAL_GHI, router, square } from "./fixtures.js";
import { type Session, type TestApp, db, hasDb, json, makeApp, register, resetDb } from "./helpers.js";

const describeDb = hasDb ? describe : describe.skip;

describeDb("Energy Twin", () => {
  let t: TestApp;
  let s: Session;
  let propertyId: string;

  const useNetwork = (over: Parameters<typeof router>[1] = {}) => t.setFetch(router(() => t.clock.now, over));
  const analyze = (session: Session = s, id = propertyId) =>
    t.app.inject({ method: "POST", url: `/api/properties/${id}/analyze`, cookies: session.cookies, headers: session.headers });

  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
    useNetwork();
    s = await register(t, "twin@example.com");
    const res = await t.app.inject({
      method: "POST",
      url: "/api/properties",
      cookies: s.cookies,
      headers: s.headers,
      payload: { name: "Home", latitude: LAT, longitude: LON, positionSource: "map-click" },
    });
    propertyId = res.json().id;
  });

  it("builds a twin from every real source, labels each number honestly, and says what it cannot know", async () => {
    const res = await analyze();
    expect(res.statusCode).toBe(201);
    const w = res.json();
    expect(w).toMatchObject({ version: 1, dataQuality: "PARTIAL", confidence: 0.7, reason: "analyze" });

    // Roof from OpenStreetMap, measured by PostGIS (a 20 m square is about 400 m2)
    expect(w.geometry.kind).toBe("BUILDING_FOOTPRINT");
    const roof = w.geometry.roofAreaM2;
    expect(roof.value).toBeGreaterThan(390);
    expect(roof.value).toBeLessThan(410);
    expect(roof.provenance).toMatchObject({ status: "REFERENCE", provider: "overpass" });

    // Estimates are ESTIMATED and consistent with the stated assumptions
    const sol = w.solar;
    expect(sol.annualGhiKwhM2Day).toMatchObject({ value: POWER_ANNUAL_GHI, unit: "kWh/m2/day", provenance: { status: "REFERENCE", provider: "nasa-power" } });
    expect(sol.usableRoofAreaM2.value).toBeCloseTo(roof.value * 0.5, 6);
    expect(sol.capacityKwEstimate.value).toBeCloseTo(roof.value * 0.5 * 0.1, 6);
    expect(sol.yieldKwhPerKwpDay.value).toBeCloseTo(POWER_ANNUAL_GHI * 0.75, 6);
    expect(sol.estimatedDailyGenerationKwh.value).toBeCloseTo(sol.capacityKwEstimate.value * sol.yieldKwhPerKwpDay.value, 6);
    for (const k of ["usableRoofAreaM2", "capacityKwEstimate", "yieldKwhPerKwpDay", "estimatedDailyGenerationKwh"]) {
      expect(sol[k].provenance.status).toBe("ESTIMATED");
      expect(sol[k].provenance.notes.join(" ")).toContain("Estimated:");
    }

    // 24-hour forecast from real hourly irradiance is a FORECAST
    expect(sol.forecastNext24hGhiKwhM2.provenance.status).toBe("FORECAST");
    expect(sol.forecastNext24hGhiKwhM2.value).toBeGreaterThan(3);
    expect(sol.forecastNext24hKwhPerKwp.value).toBeCloseTo(sol.forecastNext24hGhiKwhM2.value * 0.75, 6);

    // Satellite metadata, never LIVE
    expect(w.satellite.value).toMatchObject({ satellite: "sentinel-2c", sensor: "msi", cloudPercent: 26.2 });
    expect(w.satellite.provenance.status).toBe("REFERENCE");

    // Not guessed
    for (const m of [w.consumption.estimatedDailyLoadKwh, w.tariff, w.energyAutonomyScore]) {
      expect(m.value).toBeNull();
      expect(m.provenance.status).toBe("UNAVAILABLE");
      expect(m.provenance.notes[0].length).toBeGreaterThan(20);
    }
    expect(w.tariff.provenance.notes[0]).toContain("Tariff data unavailable");
    expect(w.unavailable.map((g: { what: string }) => g.what)).toEqual(["Electricity consumption", "Electricity tariff"]);

    // Sources, assumptions and the meaning of "confidence"
    expect(w.sources.map((x: { provider: string; ok: boolean }) => [x.provider, x.ok])).toEqual([
      ["nasa-power", true], ["open-meteo", true], ["overpass", true], ["earth-search", true],
    ]);
    expect(w.assumptions.map((a: { key: string }) => a.key)).toEqual(["usable_roof_fraction", "kwp_per_m2_usable_roof", "performance_ratio"]);
    expect(w.confidenceMeaning).toContain("not the probability");
    expect(w.confidenceBasis.filter((b: { available: boolean }) => !b.available).map((b: { item: string }) => b.item)).toEqual(["Household or business electricity use", "Electricity tariff"]);

    // The outline is stored with a PostGIS-measured area
    const [g] = await db().$queryRaw<{ kind: string; area_m2: number; source_ref: string }[]>`SELECT kind::text, area_m2, source_ref FROM property_geometry`;
    expect(g).toMatchObject({ kind: "BUILDING_FOOTPRINT", source_ref: "way/111" });
    expect(g!.area_m2).toBeCloseTo(roof.value, 3);
  });

  it("adds a new version on every analysis and keeps the old ones, without re-fetching the outline", async () => {
    await analyze();
    const second = await analyze();
    expect(second.json().version).toBe(2);
    expect(second.json().sources.find((x: { provider: string }) => x.provider === "user-or-stored")).toBeDefined();
    expect(await db().propertyGeometry.count()).toBe(1);
    const v = (await t.app.inject({ method: "GET", url: `/api/properties/${propertyId}/twin/versions`, cookies: s.cookies })).json().versions;
    expect(v.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    const latest = (await t.app.inject({ method: "GET", url: `/api/properties/${propertyId}/twin`, cookies: s.cookies })).json();
    expect(latest.version).toBe(2);
    expect(latest.solar.capacityKwEstimate.provenance.status).toBe("ESTIMATED");
  });

  it("still builds a twin when the weather service is down, and leaves the forecast empty instead of inventing it", async () => {
    useNetwork({ openMeteo: () => json({}, 503) });
    const w = (await analyze()).json();
    expect(w.dataQuality).toBe("PARTIAL");
    expect(w.confidence).toBe(0.55);
    expect(w.solar.forecastNext24hGhiKwhM2).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
    expect(w.solar.annualGhiKwhM2Day.value).toBe(POWER_ANNUAL_GHI);
    const src = w.sources.find((x: { provider: string }) => x.provider === "open-meteo");
    expect(src).toMatchObject({ ok: false, status: "UNAVAILABLE" });
    expect(w.unavailable.some((g: { what: string }) => g.what.includes("Weather"))).toBe(true);
  });

  it("survives every provider failing: a MINIMAL twin with nothing invented", async () => {
    const down = () => json({}, 503);
    useNetwork({ openMeteo: down, power: down, overpass: down, stac: down });
    const res = await analyze();
    expect(res.statusCode).toBe(201);
    const w = res.json();
    expect(w).toMatchObject({ dataQuality: "MINIMAL", confidence: 0.1 });
    expect(w.sources.every((x: { ok: boolean }) => !x.ok)).toBe(true);
    for (const m of Object.values(w.solar) as { value: unknown; provenance: { status: string } }[]) {
      expect(m.value).toBeNull();
      expect(m.provenance.status).toBe("UNAVAILABLE");
    }
    expect(w.geometry.roofAreaM2.value).toBeNull();
    expect(w.satellite.value).toBeNull();
  });

  it("without any mapped building: yield per kWp is real, capacity is not guessed", async () => {
    useNetwork({ overpass: () => json(overpassBody([])) });
    const w = (await analyze()).json();
    expect(w.geometry.kind).toBeNull();
    expect(w.geometry.roofAreaM2.provenance.status).toBe("UNAVAILABLE");
    expect(w.solar.capacityKwEstimate.value).toBeNull();
    expect(w.solar.estimatedDailyGenerationKwh.value).toBeNull();
    expect(w.solar.yieldKwhPerKwpDay.value).toBeCloseTo(POWER_ANNUAL_GHI * 0.75, 6);
    expect(w.unavailable[0].what).toBe("Building outline");
    expect(w.unavailable[0].reason).toContain("BUILDING GEOMETRY UNAVAILABLE");
    expect(w.assumptions.map((a: { key: string }) => a.key)).toEqual(["performance_ratio"]); // only the assumption actually used
  });

  it("prefers an outline the owner drew, and does not ask OpenStreetMap when one exists", async () => {
    const ring = square(LAT, LON, 5); // a 10 m square, about 100 m2
    const drawn = await t.app.inject({ method: "POST", url: `/api/properties/${propertyId}/geometry`, cookies: s.cookies, headers: s.headers, payload: { ring } });
    expect(drawn.statusCode).toBe(201);
    t.fetched.length = 0;
    const w = (await analyze()).json();
    expect(w.geometry.kind).toBe("USER_POLYGON");
    expect(w.geometry.roofAreaM2.value).toBeGreaterThan(95);
    expect(w.geometry.roofAreaM2.value).toBeLessThan(105);
    expect(w.geometry.roofAreaM2.provenance.provider).toBe("user");
    expect(t.fetched.some((u) => u.hostname.includes("overpass"))).toBe(false);
  });

  it("warns that a multi-storey building's roof is shared", async () => {
    useNetwork({ overpass: () => json(overpassBody([buildingWay(222, square(LAT, LON, 10), { building: "apartments", "building:levels": "8" })])) });
    const w = (await analyze()).json();
    expect(w.warnings.join(" ")).toContain("8 levels");
  });

  it("records the satellite scene once, however often it is seen", async () => {
    await analyze();
    await analyze();
    expect(await db().satelliteObservation.count()).toBe(1);
    const [o] = await db().satelliteObservation.findMany();
    expect(o).toMatchObject({ provider: "earth-search", satellite: "sentinel-2c", cloudPercent: 26.2 });
  });

  it("protects twins: sign-in, CSRF and ownership", async () => {
    const other = await register(t, "other-twin@example.com");
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${propertyId}/analyze` })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: `/api/properties/${propertyId}/analyze`, cookies: s.cookies })).json().error.code).toBe("CSRF_REJECTED");
    expect((await analyze(other)).statusCode).toBe(404);
    await analyze();
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${propertyId}/twin`, cookies: other.cookies })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${propertyId}/twin/versions`, cookies: other.cookies })).statusCode).toBe(404);
  });

  it("says there is no twin yet instead of making one up", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/properties/${propertyId}/twin`, cookies: s.cookies });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain("Run an analysis first");
  });

  it("writes the analysis to the audit log", async () => {
    await analyze();
    const a = (await db().auditLog.findMany({ where: { action: "twin.analyze" } }))[0]!;
    expect(a.entityId).toBe(propertyId);
    expect(a.detail).toMatchObject({ version: 1, dataQuality: "PARTIAL" });
  });
});

describeDb("map-click preview and cloud nowcast", () => {
  let t: TestApp;
  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
    t.setFetch(router(() => t.clock.now));
  });

  it("shows real solar resource and weather for any point without saving anything", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/preview?latitude=${LAT}&longitude=${LON}` });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.solar.annualGhiKwhM2Day).toMatchObject({ value: POWER_ANNUAL_GHI, provenance: { status: "REFERENCE" } });
    expect(p.solar.yieldKwhPerKwpDay).toMatchObject({ provenance: { status: "ESTIMATED" } });
    expect(p.solar.yieldKwhPerKwpDay.value).toBeCloseTo(POWER_ANNUAL_GHI * 0.75, 6);
    expect(p.solar.forecastNext24hKwhPerKwp.provenance.status).toBe("FORECAST");
    expect(p.weather.airTemperature.value).toBe(28.2);
    expect(p.weather.airTemperature.provenance.status).toMatch(/^(LIVE|UPDATED)$/);
    expect(p).toMatchObject({ dataQuality: "PARTIAL", confidence: 0.45 });
    expect(await db().energyTwin.count()).toBe(0);
    expect(await db().property.count()).toBe(0);
  });

  it("degrades gracefully when a source is down, and warns about places outside India", async () => {
    t.setFetch(router(() => t.clock.now, { power: () => json({}, 503) }));
    const p = (await t.app.inject({ method: "GET", url: "/api/preview?latitude=51.5&longitude=-0.12" })).json();
    expect(p.solar.annualGhiKwhM2Day).toMatchObject({ value: null, provenance: { status: "UNAVAILABLE" } });
    expect(p.solar.yieldKwhPerKwpDay.value).toBeNull();
    expect(p.weather.airTemperature.value).toBe(28.2);
    expect(p.unavailable[0].what).toBe("Solar resource");
    expect(p.warnings.join(" ")).toContain("outside India");
  });

  it("rejects impossible coordinates", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/preview?latitude=95&longitude=10" })).json().error.code).toBe("INVALID_COORDINATES");
    expect((await t.app.inject({ method: "GET", url: "/api/preview?latitude=x&longitude=10" })).statusCode).toBe(400);
  });

  it("refuses to fake a cloud nowcast and explains why, including how old the latest image is", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/cloud-nowcast?latitude=${LAT}&longitude=${LON}` });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.value).toBeNull();
    expect(m.provenance.status).toBe("UNAVAILABLE");
    const note: string = m.provenance.notes[0];
    expect(note).toContain("Satellite nowcast unavailable: insufficient recent observations");
    expect(note).toContain("Sentinel-2");
    expect(note).toMatch(/taken \d+ d ago/);
  });

  it("gives the same honest answer when the satellite catalogue is also down", async () => {
    t.setFetch(router(() => t.clock.now, { stac: () => json({}, 503) }));
    const m = (await t.app.inject({ method: "GET", url: `/api/cloud-nowcast?latitude=${LAT}&longitude=${LON}` })).json();
    expect(m.provenance.status).toBe("UNAVAILABLE");
    expect(m.provenance.notes[0]).toContain("No recent satellite scene could be retrieved");
  });

  it("the nowcast for a property needs sign-in and ownership", async () => {
    const owner = await register(t, "nc@example.com");
    const other = await register(t, "nc2@example.com");
    const p = (await t.app.inject({ method: "POST", url: "/api/properties", cookies: owner.cookies, headers: owner.headers, payload: { name: "H", latitude: LAT, longitude: LON, positionSource: "manual" } })).json();
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${p.id}/cloud-nowcast` })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${p.id}/cloud-nowcast`, cookies: other.cookies })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/api/properties/${p.id}/cloud-nowcast`, cookies: owner.cookies })).statusCode).toBe(200);
  });
});

