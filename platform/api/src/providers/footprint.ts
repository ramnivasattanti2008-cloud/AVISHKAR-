import { z } from "zod";
import { AppError, ProviderError } from "../errors.js";
import { distanceToRingM, isClosed, pointInRing, polygonAreaM2, type Ring } from "../geo.js";
import { type Measured, reference, unavailable } from "../provenance/index.js";
import { checkCoordinates } from "../quality.js";
import { type Cache, cachedFetch } from "./cache.js";
import { withFailover } from "./failover.js";
import type { ProviderHttp } from "./http.js";

export interface Footprint {
  /** Where the outline came from, for example way/52060140 in OpenStreetMap. */
  sourceRef: string;
  ring: Ring;
  areaM2: number;
  /** True when the clicked point lies inside the outline; otherwise the nearest outline within the search radius. */
  containsPoint: boolean;
  distanceM: number;
  tags: { building?: string; levels?: string; name?: string };
}

export interface BuildingFootprintProvider {
  readonly name: string;
  find(latitude: number, longitude: number, opts?: { radiusM?: number }, ctx?: { requestId?: string; now?: () => Date }): Promise<Measured<Footprint | null>>;
}

const Element = z.object({
  type: z.string(),
  id: z.number(),
  tags: z.record(z.string(), z.string()).optional(),
  geometry: z.array(z.object({ lat: z.number(), lon: z.number() })).optional(),
});
const OverpassResponse = z.object({ elements: z.array(Element), remark: z.string().optional() });

const TTL_SECONDS = 30 * 24 * 3600; // building outlines change slowly
const MIN_AREA_M2 = 4;
const MAX_AREA_M2 = 1_000_000;
const ATTRIBUTION = "Building outline © OpenStreetMap contributors (ODbL), via Overpass API.";

/** Choose the outline that contains the point, else the nearest one within the radius. Exported for tests. */
export function chooseFootprint(
  elements: z.infer<typeof OverpassResponse>["elements"],
  latitude: number,
  longitude: number,
  radiusM: number,
): Footprint | null {
  let best: (Footprint & { rank: number }) | null = null;
  for (const e of elements) {
    if (e.type !== "way" || !e.geometry) continue;
    const ring: Ring = e.geometry.map((g) => [g.lon, g.lat]);
    if (!isClosed(ring)) continue;
    const areaM2 = polygonAreaM2(ring);
    if (areaM2 < MIN_AREA_M2 || areaM2 > MAX_AREA_M2) continue;
    const inside = pointInRing(longitude, latitude, ring);
    const distanceM = inside ? 0 : distanceToRingM(longitude, latitude, ring);
    if (!inside && distanceM > radiusM) continue;
    const cand = {
      sourceRef: `way/${e.id}`,
      ring,
      areaM2,
      containsPoint: inside,
      distanceM,
      tags: { building: e.tags?.building, levels: e.tags?.["building:levels"], name: e.tags?.name },
      rank: inside ? 0 : 1 + distanceM,
    };
    if (!best || cand.rank < best.rank) best = cand;
  }
  if (!best) return null;
  const { rank: _rank, ...fp } = best;
  return fp;
}

/** OpenStreetMap building outlines through the Overpass API, trying each configured server in turn. */
export class OverpassFootprints implements BuildingFootprintProvider {
  readonly name = "overpass";
  constructor(private readonly deps: { http: ProviderHttp; cache: Cache; baseUrls: string[] }) {}

  async find(latitude: number, longitude: number, opts: { radiusM?: number } = {}, ctx: { requestId?: string; now?: () => Date } = {}): Promise<Measured<Footprint | null>> {
    const c = checkCoordinates(latitude, longitude);
    if (!c.ok) throw new AppError("INVALID_COORDINATES", c.reason);
    const radiusM = Math.min(Math.max(opts.radiusM ?? 30, 5), 100);
    const lat = latitude.toFixed(5);
    const lon = longitude.toFixed(5);
    const now = ctx.now ?? (() => new Date());
    const query = `[out:json][timeout:25];way(around:${radiusM},${lat},${lon})["building"];out geom 20;`;
    const got = await cachedFetch(
      this.deps.cache,
      `footprint:overpass:${lat}:${lon}:${radiusM}`,
      this.name,
      TTL_SECONDS,
      async () => {
        const servers = this.deps.baseUrls.map((u) => ({ name: new URL(u).hostname, url: u }));
        const r = await withFailover(servers, "footprint", (s) =>
          this.deps.http.getJson("footprint", "/api/interpreter", { data: query }, { schema: OverpassResponse, requestId: ctx.requestId, baseUrl: s.url }).then((res) => {
            // Overpass reports a query that ran out of time or memory as a remark on an otherwise valid reply.
            if (res.remark && /runtime error/i.test(res.remark)) throw new ProviderError(this.name, "footprint", `Overpass: ${res.remark}`, "PROVIDER_BAD_RESPONSE");
            return res;
          }),
        );
        return { footprint: chooseFootprint(r.value.elements, latitude, longitude, radiusM), server: r.provider };
      },
      now,
    );
    const where = { latitude, longitude };
    if (!got.value.footprint) {
      return unavailable<Footprint | null>(
        `BUILDING GEOMETRY UNAVAILABLE: no building outline within ${radiusM} m of this point in OpenStreetMap. Analysis uses the point location; you can draw the roof yourself.`,
        { provider: this.name, source: "OpenStreetMap via Overpass API", dataType: "building_footprint", location: where, now: now() },
      );
    }
    const m = reference<Footprint | null>(got.value.footprint, {
      provider: this.name,
      source: "OpenStreetMap via Overpass API",
      dataType: "building_footprint",
      location: where,
      now: now(),
      notes: [ATTRIBUTION],
    });
    if (!got.value.footprint.containsPoint) m.provenance.notes.push(`The point is ${Math.round(got.value.footprint.distanceM)} m outside this outline; it is the nearest building.`);
    if (got.stale) m.provenance.notes.push("Served from an older copy because the Overpass servers did not answer.");
    return m;
  }
}
