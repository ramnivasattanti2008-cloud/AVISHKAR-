import { describe, expect, it } from "vitest";
import { distanceToRingM, isClosed, pointInRing, polygonAreaM2, type Ring } from "../src/geo.js";
import { MemoryCache } from "../src/providers/cache.js";
import { OverpassFootprints, chooseFootprint } from "../src/providers/footprint.js";
import { ProviderHttp } from "../src/providers/http.js";
import { MemoryRecorder } from "../src/providers/recorder.js";
import { EarthSearchSatellite } from "../src/providers/satellite.js";
import { NasaPowerSolarResource } from "../src/providers/solar-resource.js";
import { json } from "./helpers.js";

const NOW = new Date("2026-10-07T10:00:00Z");
const at = { now: () => NOW };
type Handler = (u: URL, init: RequestInit | undefined, n: number) => Response | Promise<Response>;

function client(provider: string, handler: Handler, extra: { retries?: number } = {}) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const recorder = new MemoryRecorder();
  const http = new ProviderHttp({
    provider,
    baseUrl: `https://${provider}.test`,
    userAgent: "AVISHKAR-tests/1.0 (contact: tests)",
    timeoutMs: 1000,
    recorder,
    retries: extra.retries ?? 0,
    sleep: async () => undefined,
    fetchImpl: (async (i: URL | string, init?: RequestInit) => {
      const url = new URL(i.toString());
      calls.push({ url, init });
      return handler(url, init, calls.length);
    }) as typeof fetch,
  });
  return { http, calls, recorder, cache: new MemoryCache() };
}

/** A square of about 20 m x 20 m around (lat, lon), as a closed [lon, lat] ring. */
function square(lat: number, lon: number, halfM = 10): Ring {
  const dLat = halfM / 111_320;
  const dLon = halfM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
}

describe("geo helpers", () => {
  it("measures the area of a 20 m square to within 1%", () => {
    const a = polygonAreaM2(square(12.97, 77.59));
    expect(a).toBeGreaterThan(396);
    expect(a).toBeLessThan(404);
  });
  it("finds points inside and outside, and distance to the outline", () => {
    const r = square(12.97, 77.59);
    expect(pointInRing(77.59, 12.97, r)).toBe(true);
    expect(pointInRing(77.591, 12.97, r)).toBe(false);
    expect(distanceToRingM(77.59, 12.97, r)).toBeCloseTo(10, 0);
    const outside = distanceToRingM(77.59, 12.97 + 30 / 111_320, r); // 30 m north of the centre = 20 m beyond the edge
    expect(outside).toBeGreaterThan(19);
    expect(outside).toBeLessThan(21);
  });
  it("treats an unclosed ring as having no area", () => {
    const open = square(12.97, 77.59).slice(0, 4);
    expect(isClosed(open)).toBe(false);
    expect(polygonAreaM2(open)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("NASA POWER solar resource", () => {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const series = (base: number, over: Record<string, number> = {}) => ({ ...Object.fromEntries(months.map((m, i) => [m, base + i * 0.05])), ANN: base + 0.3, ...over });
  const body = (over: { ghi?: Record<string, number>; ann?: number } = {}) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [77.59, 12.97, 841.72] },
    properties: {
      parameter: {
        ALLSKY_SFC_SW_DWN: series(5.2, over.ghi),
        CLRSKY_SFC_SW_DWN: series(6.0),
        ALLSKY_KT: Object.fromEntries([...months, "ANN"].map((m) => [m, 0.56])),
        T2M: series(22),
      },
    },
    header: { range: "20-year Meteorological and Solar Monthly & Annual Climatologies (January 2001 - December 2020)", fill_value: -999.0 },
  });
  const make = (h: Handler) => {
    const c = client("nasa-power", h);
    return { ...c, p: new NasaPowerSolarResource({ http: c.http, cache: c.cache }) };
  };

  it("returns monthly and annual irradiation labelled REFERENCE, with the climatological period", async () => {
    const { p, calls } = make(() => json(body()));
    const m = await p.climatology(12.971634, 77.594612, at);
    expect(m.provenance).toMatchObject({ status: "REFERENCE", provider: "nasa-power", dataType: "solar_resource_climatology" });
    expect(m.provenance.notes.join(" ")).toContain("January 2001 - December 2020");
    expect(m.value!.months).toHaveLength(12);
    expect(m.value!.annual.ghiKwhM2Day).toBeCloseTo(5.5, 5);
    expect(m.value!.elevationM).toBe(841.72);
    const q = calls[0]!.url.searchParams;
    expect(q.get("parameters")).toBe("ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN,ALLSKY_KT,T2M");
    expect(q.get("latitude")).toBe("12.97");
    expect(q.get("longitude")).toBe("77.59");
  });

  it("leaves missing (-999) and implausible values empty instead of using them", async () => {
    const { p } = make(() => json(body({ ghi: { JAN: -999, JUN: 50 } })));
    const m = await p.climatology(12.97, 77.59, at);
    expect(m.value!.months[0]!.ghiKwhM2Day).toBeNull();
    expect(m.value!.months[5]!.ghiKwhM2Day).toBeNull();
    expect(m.value!.months[1]!.ghiKwhM2Day).not.toBeNull();
    expect(m.value!.rejected).toEqual(expect.arrayContaining(["ALLSKY_SFC_SW_DWN JAN", "ALLSKY_SFC_SW_DWN JUN"]));
    expect(m.provenance.notes.join(" ")).toContain("missing or implausible");
  });

  it("refuses a response with no usable annual figure", async () => {
    const { p } = make(() => json(body({ ghi: { ANN: -999 } })));
    await expect(p.climatology(12.97, 77.59, at)).rejects.toMatchObject({ code: "PROVIDER_BAD_RESPONSE" });
  });

  it("caches for a long time and rejects impossible coordinates", async () => {
    const { p, calls } = make(() => json(body()));
    await p.climatology(12.97, 77.59, at);
    await p.climatology(12.9712, 77.5903, at);
    expect(calls).toHaveLength(1);
    await expect(p.climatology(95, 0, at)).rejects.toMatchObject({ code: "INVALID_COORDINATES" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Overpass building footprints", () => {
  const way = (id: number, ring: Ring, tags: Record<string, string> = { building: "yes" }) => ({
    type: "way",
    id,
    tags,
    geometry: ring.map(([lon, lat]) => ({ lat, lon })),
  });
  const LAT = 12.9716;
  const LON = 77.5946;

  it("chooses the outline containing the point over a nearer neighbour", () => {
    const mine = way(1, square(LAT, LON, 12), { building: "house", "building:levels": "2" });
    const next = way(2, square(LAT, LON + 0.0002, 5));
    const fp = chooseFootprint([next, mine], LAT, LON, 30)!;
    expect(fp.sourceRef).toBe("way/1");
    expect(fp.containsPoint).toBe(true);
    expect(fp.areaM2).toBeGreaterThan(550);
    expect(fp.tags).toMatchObject({ building: "house", levels: "2" });
  });

  it("falls back to the nearest building within the radius, and says how far", () => {
    const near = way(7, square(LAT + 25 / 111_320, LON, 5)); // centre 25 m north, edge about 20 m away
    const fp = chooseFootprint([near], LAT, LON, 30)!;
    expect(fp.containsPoint).toBe(false);
    expect(fp.distanceM).toBeGreaterThan(15);
    expect(fp.distanceM).toBeLessThan(25);
    expect(chooseFootprint([near], LAT, LON, 10)).toBeNull();
  });

  it("ignores unclosed ways, specks and non-way elements", () => {
    const open = way(3, square(LAT, LON).slice(0, 4));
    const speck = way(4, square(LAT, LON, 0.5));
    const node = { type: "node", id: 5 } as const;
    expect(chooseFootprint([open, speck, node], LAT, LON, 30)).toBeNull();
  });

  const response = (elements: unknown[], remark?: string) => json({ version: 0.6, elements, ...(remark ? { remark } : {}) });
  const make = (h: Handler) => {
    const c = client("overpass", h);
    return { ...c, p: new OverpassFootprints({ http: c.http, cache: c.cache, baseUrls: ["https://a.test", "https://b.test"] }) };
  };

  it("returns the outline with attribution and queries the right place and radius", async () => {
    const { p, calls } = make(() => response([way(1, square(LAT, LON, 12))]));
    const m = await p.find(LAT, LON, { radiusM: 40 }, at);
    expect(m.provenance).toMatchObject({ status: "REFERENCE", provider: "overpass" });
    expect(m.provenance.notes.join(" ")).toContain("OpenStreetMap contributors (ODbL)");
    expect(m.value!.sourceRef).toBe("way/1");
    const data = calls[0]!.url.searchParams.get("data")!;
    expect(data).toContain("around:40,12.97160,77.59460");
    expect(data).toContain('["building"]');
  });

  it("moves on to the next server when the first fails (the real service answers 504 now and then)", async () => {
    const { p, calls } = make((u) => (u.hostname === "a.test" ? json({}, 504) : response([way(1, square(LAT, LON))])));
    const m = await p.find(LAT, LON, {}, at);
    expect(m.value!.sourceRef).toBe("way/1");
    expect(calls.map((c) => c.url.hostname)).toEqual(["a.test", "b.test"]);
  });

  it("treats an Overpass runtime-error remark as a failure and tries the next server", async () => {
    const { p, calls } = make((u) => (u.hostname === "a.test" ? response([], "runtime error: Query timed out") : response([way(9, square(LAT, LON))])));
    expect((await p.find(LAT, LON, {}, at)).value!.sourceRef).toBe("way/9");
    expect(calls).toHaveLength(2);
  });

  it("says BUILDING GEOMETRY UNAVAILABLE when OpenStreetMap has no outline there, rather than inventing one", async () => {
    const { p } = make(() => response([]));
    const m = await p.find(LAT, LON, {}, at);
    expect(m.value).toBeNull();
    expect(m.provenance.status).toBe("UNAVAILABLE");
    expect(m.provenance.notes[0]).toContain("BUILDING GEOMETRY UNAVAILABLE");
  });

  it("raises PROVIDER_UNAVAILABLE naming every server when all of them fail", async () => {
    const { p } = make(() => json({}, 504));
    const err = await p.find(LAT, LON, {}, at).catch((e) => e);
    expect(err.code).toBe("PROVIDER_UNAVAILABLE");
    expect(err.message).toContain("a.test");
    expect(err.message).toContain("b.test");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Earth Search satellite scenes", () => {
  const feature = (id: string, datetime: string, cloud: number | null) => ({
    id,
    geometry: { type: "Polygon", coordinates: [[[77.4, 12.8], [77.9, 12.8], [77.9, 13.3], [77.4, 13.3], [77.4, 12.8]]] },
    properties: {
      datetime,
      platform: "sentinel-2c",
      instruments: ["msi"],
      "eo:cloud_cover": cloud,
      updated: "2026-10-04T12:09:34.232Z",
      "s2:product_type": "S2MSI2A",
      "s2:processing_baseline": "05.13",
    },
    assets: { thumbnail: { href: "https://example.test/preview.jpg" } },
  });
  const make = (h: Handler) => {
    const c = client("earth-search", h);
    return { ...c, p: new EarthSearchSatellite({ http: c.http, cache: c.cache }) };
  };

  it("searches Sentinel-2 L2A at the point (longitude first), newest first", async () => {
    const { p, calls } = make(() => json({ features: [feature("S2C_43PGQ_20261004", "2026-10-04T05:25:21.271000Z", 26.2)] }));
    await p.latest(12.9716, 77.5946, { limit: 3 }, at);
    const sent = JSON.parse(calls[0]!.init!.body as string);
    expect(calls[0]!.init!.method).toBe("POST");
    expect(sent).toMatchObject({
      collections: ["sentinel-2-l2a"],
      intersects: { type: "Point", coordinates: [77.595, 12.972] },
      limit: 3,
      sortby: [{ field: "properties.datetime", direction: "desc" }],
    });
  });

  it("returns every field the spec asks for, and never calls an old image LIVE", async () => {
    const { p } = make(() => json({ features: [feature("S2C_43PGQ_20261004", "2026-10-04T05:25:21.271000Z", 26.2)] }));
    const m = await p.latest(12.97, 77.59, {}, at);
    const s = m.value![0]!;
    expect(s).toMatchObject({
      satellite: "sentinel-2c",
      sensor: "msi",
      acquiredAt: "2026-10-04T05:25:21.271Z",
      processedAt: "2026-10-04T12:09:34.232Z",
      cloudPercent: 26.2,
      processingStatus: "S2MSI2A processed, baseline 05.13",
      thumbnailUrl: "https://example.test/preview.jpg",
    });
    expect(s.footprint.type).toBe("Polygon");
    expect(m.provenance.status).toBe("UPDATED");
    expect(m.provenance.notes.join(" ")).toContain("not a view of the present");
    expect(m.provenance.ageSeconds).toBeGreaterThan(2 * 86400);
  });

  it("drops scenes with an impossible cloud percentage", async () => {
    const { p } = make(() => json({ features: [feature("good", "2026-10-04T05:25:21Z", 40), feature("bad", "2026-10-03T05:25:21Z", 400)] }));
    const m = await p.latest(12.97, 77.59, {}, at);
    expect(m.value!.map((s) => s.id)).toEqual(["good"]);
  });

  it("reports UNAVAILABLE, not an invented scene, when none exists", async () => {
    const { p } = make(() => json({ features: [] }));
    const m = await p.latest(12.97, 77.59, {}, at);
    expect(m.value).toBeNull();
    expect(m.provenance.status).toBe("UNAVAILABLE");
  });
});
