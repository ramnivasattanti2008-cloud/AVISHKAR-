import { z } from "zod";
import { AppError } from "../errors.js";
import { type Measured, observed, unavailable } from "../provenance/index.js";
import { checkCoordinates } from "../quality.js";
import { type Cache, cachedFetch } from "./cache.js";
import type { ProviderHttp } from "./http.js";

/** One satellite acquisition over a place (spec section 11). Metadata only: no imagery is downloaded. */
export interface SatelliteScene {
  id: string;
  satellite: string;
  sensor: string;
  acquiredAt: string;
  /** When the product was last processed or published by the catalogue. */
  processedAt: string | null;
  /** Cloud percentage over the whole scene as the provider reports it, 0..100; null when not reported. */
  cloudPercent: number | null;
  /** The scene footprint as a GeoJSON polygon. */
  footprint: { type: string; coordinates: unknown };
  source: string;
  processingStatus: string;
  thumbnailUrl: string | null;
}

export interface SatelliteProvider {
  readonly name: string;
  latest(latitude: number, longitude: number, opts?: { limit?: number }, ctx?: { requestId?: string; now?: () => Date }): Promise<Measured<SatelliteScene[]>>;
}

const Feature = z.object({
  id: z.string(),
  geometry: z.object({ type: z.string(), coordinates: z.unknown() }),
  properties: z.object({
    datetime: z.string(),
    platform: z.string().optional(),
    instruments: z.array(z.string()).optional(),
    "eo:cloud_cover": z.number().nullable().optional(),
    updated: z.string().optional(),
    "s2:product_type": z.string().optional(),
    "s2:processing_baseline": z.string().optional(),
  }),
  assets: z.record(z.string(), z.object({ href: z.string() })).optional(),
});
const SearchResponse = z.object({ features: z.array(Feature) });

const TTL_SECONDS = 6 * 3600; // new Sentinel-2 scenes appear every few days
const SOURCE = "Earth Search STAC catalogue (Element84), Sentinel-2 L2A";

/** Sentinel-2 L2A scene metadata through the open Earth Search STAC API. */
export class EarthSearchSatellite implements SatelliteProvider {
  readonly name = "earth-search";
  constructor(private readonly deps: { http: ProviderHttp; cache: Cache }) {}

  async latest(latitude: number, longitude: number, opts: { limit?: number } = {}, ctx: { requestId?: string; now?: () => Date } = {}): Promise<Measured<SatelliteScene[]>> {
    const c = checkCoordinates(latitude, longitude);
    if (!c.ok) throw new AppError("INVALID_COORDINATES", c.reason);
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 5), 1), 20);
    const lat = latitude.toFixed(3);
    const lon = longitude.toFixed(3);
    const now = ctx.now ?? (() => new Date());
    const got = await cachedFetch<SatelliteScene[]>(
      this.deps.cache,
      `satellite:earth-search:${lat}:${lon}:${limit}`,
      this.name,
      TTL_SECONDS,
      async () => {
        const r = await this.deps.http.postJson(
          "search",
          "/search",
          {
            collections: ["sentinel-2-l2a"],
            intersects: { type: "Point", coordinates: [Number(lon), Number(lat)] },
            limit,
            sortby: [{ field: "properties.datetime", direction: "desc" }],
          },
          { schema: SearchResponse, requestId: ctx.requestId },
        );
        return r.features.map(
          (f): SatelliteScene => ({
            id: f.id,
            satellite: f.properties.platform ?? "sentinel-2",
            sensor: f.properties.instruments?.[0] ?? "msi",
            acquiredAt: new Date(f.properties.datetime).toISOString(),
            processedAt: f.properties.updated ? new Date(f.properties.updated).toISOString() : null,
            cloudPercent: f.properties["eo:cloud_cover"] ?? null,
            footprint: f.geometry,
            source: SOURCE,
            processingStatus: `${f.properties["s2:product_type"] ?? "L2A"} processed${f.properties["s2:processing_baseline"] ? `, baseline ${f.properties["s2:processing_baseline"]}` : ""}`,
            thumbnailUrl: f.assets?.thumbnail?.href ?? null,
          }),
        );
      },
      now,
    );
    const where = { latitude, longitude };
    const scenes = got.value.filter((s) => s.cloudPercent === null || (s.cloudPercent >= 0 && s.cloudPercent <= 100));
    const newest = scenes[0];
    if (!newest) {
      return unavailable<SatelliteScene[]>("No Sentinel-2 scene found over this location.", { provider: this.name, source: SOURCE, dataType: "satellite_scenes", location: where, now: now() });
    }
    // An image is never "live": with a one-hour cadence anything older than 90 minutes is reported as UPDATED, with its age.
    const m = observed(scenes, { provider: this.name, source: SOURCE, dataType: "satellite_scenes", location: where, now: now(), observedAt: new Date(newest.acquiredAt), cadenceSeconds: 3600 });
    m.provenance.notes.push("Sentinel-2 revisits a place about every 5 days, so this is the latest image, not a view of the present.");
    if (got.stale) m.provenance.notes.push("Served from an older copy because the catalogue did not answer.");
    return m;
  }
}
