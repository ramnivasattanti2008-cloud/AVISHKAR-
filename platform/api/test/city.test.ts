import { beforeEach, describe, expect, it } from "vitest";
import { cellOf, buildGrid } from "../src/city/grid.js";
import { LAT, LON, powerBody, router } from "./fixtures.js";
import { type Session, type TestApp, hasDb, json, makeApp, register, resetDb } from "./helpers.js";

const describeDb = hasDb ? describe : describe.skip;

describeDb("the city energy map", () => {
  let t: TestApp;
  let s: Session;
  const call = (method: "GET" | "POST", url: string, payload?: unknown, session: Session | null = s) =>
    t.app.inject({ method, url, cookies: session?.cookies, headers: session?.headers, payload: payload as never });
  const run = async (body: Record<string, unknown> = {}) => {
    const res = await call("POST", "/api/city", { latitude: LAT, longitude: LON, ...body });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };

  beforeEach(async () => {
    await resetDb();
    t = await makeApp();
    t.clock.now = new Date("2026-10-07T04:40:00Z");
    t.setFetch(router(() => t.clock.now));
    s = await register(t, "city@example.com");
  });

  it("draws the square asked for, reads the solar resource in every cell, and labels it as a climatology", async () => {
    const c = await run({ spanKm: 8, cellsPerSide: 2 });
    expect(c.label).toBe("CITY ENERGY MAP");
    expect(c.grid).toMatchObject({ spanKm: 8, cellsPerSide: 2, cellKm: 4 });
    expect(c.cells).toHaveLength(4);
    for (const cell of c.cells) {
      expect(cell.solar.provenance.provider).toBe("nasa-power");
      expect(cell.solar.provenance.status).toBe("REFERENCE");
      expect(cell.solar.value.annualGhiKwhM2Day).toBeGreaterThan(0);
      expect(cell.solar.value.bestMonth.ghiKwhM2Day).toBeGreaterThanOrEqual(cell.solar.value.worstMonth.ghiKwhM2Day);
      expect(cell.geojson).toMatchObject({ type: "Polygon" });
      expect((cell.geojson as { coordinates: number[][][] }).coordinates[0]).toHaveLength(5);
    }
    expect(c.solarSpread.distinctValues).toBeGreaterThanOrEqual(1);
    expect(c.solarSpread.note.length).toBeGreaterThan(20);
  });

  it("states none of a city's demand, storage, vehicles, flexibility or outage risk, and says why for each", async () => {
    const c = await run({ spanKm: 8, cellsPerSide: 2 });
    for (const k of ["demand", "storage", "evs", "flexibility", "energyRisk"]) {
      expect(c.cityWide[k].status, k).toBe("UNAVAILABLE");
      expect(c.cityWide[k].reason.length, k).toBeGreaterThan(30);
    }
    expect(JSON.stringify(c.cityWide)).not.toMatch(/\d+(\.\d+)?\s*(kWh|kW|MW)/); // no number dressed as a city figure
    expect(c.notes.join(" ")).toContain("Only your own properties appear");
  });

  it("places the caller's own properties in the cells they fall in, with what each holds, and nobody else's", async () => {
    const mk = async (name: string, latitude: number, longitude: number, session = s) =>
      (await call("POST", "/api/properties", { name, latitude, longitude, positionSource: "manual" }, session)).json();
    const grid = buildGrid(LAT, LON, 8, 2);
    const here = await mk("Mine", LAT, LON);
    await call("POST", `/api/properties/${here.id}/solar-systems`, { name: "Roof", capacityKwp: 5, tiltDeg: 12, azimuthDeg: 180 });
    await call("POST", `/api/properties/${here.id}/batteries`, { name: "Wall", capacityKwh: 10, maxChargeKw: 5, maxDischargeKw: 5 });
    await call("POST", `/api/properties/${here.id}/appliances`, { name: "Washer", kind: "washing machine", priority: "FLEXIBLE", ratedPowerW: 500, earliestStart: "09:00", latestFinish: "17:00", durationMin: 90 });
    await mk("Far away", LAT + 2, LON + 2); // outside the square
    const other = await register(t, "neighbour@example.com");
    await mk("Not mine", LAT, LON, other);

    const c = await run({ spanKm: 8, cellsPerSide: 2 });
    const withMine = c.cells.filter((x: { yours: unknown }) => x.yours !== null);
    expect(withMine).toHaveLength(1);
    expect(withMine[0].id).toBe(cellOf(grid, LAT, LON)!.id);
    expect(withMine[0].yours).toMatchObject({ properties: 1, names: ["Mine"], solarKwp: 5, batteryKwh: 10, evs: 0, flexibleKw: 0.5 });
    expect(withMine[0].yours.meanDailyKwh).toBeNull(); // no meter readings were imported
    expect(c.yourTotals).toMatchObject({ properties: 1, solarKwp: 5, batteryKwh: 10 });
    expect(JSON.stringify(c)).not.toContain("Not mine");
    expect(JSON.stringify(c)).not.toContain("Far away");
  });

  it("has nothing of yours when none of your properties is in the square", async () => {
    const c = await run({ spanKm: 8, cellsPerSide: 2 });
    expect(c.cells.every((x: { yours: unknown }) => x.yours === null)).toBe(true);
    expect(c.yourTotals).toMatchObject({ properties: 0, names: [], solarKwp: null, batteryKwh: null, evs: 0, meanDailyKwh: null });
  });

  it("says plainly when every cell returned the same value, and states the real spread when they differ", async () => {
    const same = await run({ spanKm: 8, cellsPerSide: 2 }); // the fake provider gives one value everywhere
    expect(same.solarSpread.distinctValues).toBe(1);
    expect(same.solarSpread.note).toMatch(/cannot tell the cells apart/);
    expect(same.solarSpread.lowest).toBe(same.solarSpread.highest);

    // a provider whose value varies with latitude, as the real one does over tens of kilometres
    t.setFetch(
      router(() => t.clock.now, {
        power: (u) => {
          const lat = Number(new URL(u).searchParams.get("latitude"));
          const body = powerBody();
          const ghi = 5.4 + (lat - (LAT + 10)) * 0.5; // a realistic value: the provider refuses an irradiation no sun could deliver
          for (const key of Object.keys(body.properties.parameter.ALLSKY_SFC_SW_DWN)) {
            (body.properties.parameter.ALLSKY_SFC_SW_DWN as Record<string, number>)[key] = ghi;
          }
          return json(body);
        },
      }),
    );
    const varied = await run({ spanKm: 40, cellsPerSide: 2, latitude: LAT + 10, longitude: LON + 10 }); // another square: the first one's answers are cached
    expect(varied.solarSpread.distinctValues).toBe(2); // two rows of cells, two latitudes
    expect(varied.solarSpread.highest).toBeGreaterThan(varied.solarSpread.lowest);
    expect(varied.solarSpread.note).toMatch(/the model's grid showing through/);
  });

  it("refuses cells smaller than the provider can tell apart, and says why", async () => {
    const res = await call("POST", "/api/city", { latitude: LAT, longitude: LON, spanKm: 4, cellsPerSide: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("at least 1.1 km");
  });

  it("needs a session, a CSRF header and real coordinates", async () => {
    expect((await call("POST", "/api/city", { latitude: LAT, longitude: LON }, null)).statusCode).toBe(401);
    expect((await call("POST", "/api/city", { latitude: 120, longitude: LON })).statusCode).toBe(400);
    expect((await call("POST", "/api/city", { latitude: LAT, longitude: LON, spanKm: 500 })).statusCode).toBe(400);
  });
});
