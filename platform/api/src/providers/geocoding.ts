import { z } from "zod";
import { AppError } from "../errors.js";
import { type Measured, humanAge, reference } from "../provenance/index.js";
import { checkCoordinates } from "../quality.js";
import { type Cache, cachedFetch } from "./cache.js";
import type { ProviderHttp } from "./http.js";

export interface GeocodeResult {
  label: string;
  latitude: number;
  longitude: number;
  /** What kind of place: city, suburb, building, road... as the provider reports it. */
  kind: string;
  importance?: number;
  /** [south, north, west, east] */
  boundingBox?: [number, number, number, number];
  osm?: { type: string; id: number };
  address?: Record<string, string>;
}

export interface GeocodingContext {
  requestId?: string;
  now?: () => Date;
}

/** Spec section 6: one interface, many possible providers. Implementations throw ProviderError when they cannot answer. */
export interface GeocodingProvider {
  readonly name: string;
  search(query: string, opts?: { limit?: number; countryCodes?: string[] }, ctx?: GeocodingContext): Promise<Measured<GeocodeResult[]>>;
  reverse(latitude: number, longitude: number, ctx?: GeocodingContext): Promise<Measured<GeocodeResult | null>>;
}

const Place = z.object({
  place_id: z.number(),
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
  category: z.string().optional(),
  type: z.string().optional(),
  importance: z.number().optional(),
  boundingbox: z.array(z.string()).length(4).optional(),
  osm_type: z.string().optional(),
  osm_id: z.number().optional(),
  address: z.record(z.string(), z.string()).optional(),
});
type Place = z.infer<typeof Place>;
const SearchResponse = z.array(Place);
const ReverseResponse = z.union([Place, z.object({ error: z.string() })]);

const SEARCH_TTL_S = 7 * 24 * 3600; // addresses are stable; Nominatim's policy asks clients to cache
const REVERSE_TTL_S = 30 * 24 * 3600;
const ATTRIBUTION = "Data © OpenStreetMap contributors (ODbL), via Nominatim.";

function toResult(p: Place): GeocodeResult | null {
  const latitude = Number(p.lat);
  const longitude = Number(p.lon);
  if (!checkCoordinates(latitude, longitude).ok) return null;
  const bb = p.boundingbox?.map(Number);
  const boundingBox = bb && bb.length === 4 && bb.every(Number.isFinite) ? ([bb[0]!, bb[1]!, bb[2]!, bb[3]!] as [number, number, number, number]) : undefined;
  return {
    label: p.display_name,
    latitude,
    longitude,
    kind: [p.category, p.type].filter(Boolean).join("/") || "place",
    importance: p.importance,
    boundingBox,
    osm: p.osm_type !== undefined && p.osm_id !== undefined ? { type: p.osm_type, id: p.osm_id } : undefined,
    address: p.address,
  };
}

/** Nominatim can return several OSM objects (a node and a way, say) under one display name; a person cannot tell them apart, so keep the first (most relevant). */
function dedupeByLabel(results: GeocodeResult[]): GeocodeResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const k = r.label.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class NominatimGeocoder implements GeocodingProvider {
  readonly name = "nominatim";
  constructor(private readonly deps: { http: ProviderHttp; cache: Cache }) {}

  async search(query: string, opts: { limit?: number; countryCodes?: string[] } = {}, ctx: GeocodingContext = {}): Promise<Measured<GeocodeResult[]>> {
    const q = query.trim().replace(/\s+/g, " ");
    if (q.length < 3 || q.length > 200) throw new AppError("VALIDATION_FAILED", "Search text must be 3 to 200 characters.");
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
    const countries = opts.countryCodes?.map((c) => c.toLowerCase()).sort().join(",");
    const now = ctx.now ?? (() => new Date());
    const key = `geocode:nominatim:search:${q.toLowerCase()}:${limit}:${countries ?? ""}`;
    const got = await cachedFetch(
      this.deps.cache,
      key,
      this.name,
      SEARCH_TTL_S,
      async () => {
        const places = await this.deps.http.getJson(
          "search",
          "/search",
          { q, format: "jsonv2", addressdetails: 1, limit, countrycodes: countries },
          { schema: SearchResponse, requestId: ctx.requestId },
        );
        return dedupeByLabel(places.map(toResult).filter((r): r is GeocodeResult => r !== null));
      },
      now,
    );
    return this.wrap(got, "geocode_search", now);
  }

  async reverse(latitude: number, longitude: number, ctx: GeocodingContext = {}): Promise<Measured<GeocodeResult | null>> {
    const c = checkCoordinates(latitude, longitude);
    if (!c.ok) throw new AppError("INVALID_COORDINATES", c.reason);
    const now = ctx.now ?? (() => new Date());
    const key = `geocode:nominatim:reverse:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
    const got = await cachedFetch(
      this.deps.cache,
      key,
      this.name,
      REVERSE_TTL_S,
      async () => {
        const r = await this.deps.http.getJson(
          "reverse",
          "/reverse",
          { lat: latitude, lon: longitude, format: "jsonv2", addressdetails: 1, zoom: 18 },
          { schema: ReverseResponse, requestId: ctx.requestId },
        );
        return "error" in r ? null : toResult(r);
      },
      now,
    );
    return this.wrap(got, "geocode_reverse", now, { latitude, longitude });
  }

  private wrap<T>(got: { value: T; storedAt: Date; stale: boolean }, dataType: string, now: () => Date, location?: { latitude: number; longitude: number }): Measured<T> {
    const m = reference(got.value, { provider: this.name, source: "OpenStreetMap Nominatim", dataType, now: now(), location, notes: [ATTRIBUTION] });
    if (got.stale) {
      m.provenance.notes.push(`Served from a copy stored ${humanAge((now().getTime() - got.storedAt.getTime()) / 1000)} ago because the geocoding service did not answer.`);
    }
    return m;
  }
}
