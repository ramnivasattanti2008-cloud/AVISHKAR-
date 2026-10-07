import { AppError } from "../errors.js";
import type { Db } from "../db.js";
import type { GeometryKind, Prisma, Property } from "../generated/prisma/client.js";
import { type PositionSource, checkPositionSource, describePosition } from "../providers/positioning.js";
import { checkCoordinates, isNearIndia } from "../quality.js";

export const GEOMETRY_UNAVAILABLE = "BUILDING GEOMETRY UNAVAILABLE: analysis uses the point location.";
/** A drawn roof outline must lie within this distance of the property point, so a typo cannot attach a far-away shape. */
export const MAX_POLYGON_DISTANCE_M = 500;
export const MAX_POLYGON_AREA_M2 = 1_000_000;

export interface GeometryDto {
  id: string;
  kind: GeometryKind;
  source: string;
  areaM2: number;
  geojson: unknown;
}

export interface PropertyDto {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  position: { source: PositionSource; label: string; note: string; accuracyM: number | null; description: string };
  geometry: { status: "AVAILABLE" | "UNAVAILABLE"; message: string | null; items: GeometryDto[] };
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatePropertyInput {
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  positionSource: string;
  positionAccuracyM?: number;
}

export interface PropertyPolicy {
  navicEnabled: boolean;
}

function toDto(p: Property, geometries: GeometryDto[], policy: PropertyPolicy): PropertyDto {
  const chk = checkPositionSource(p.positionSource, policy);
  // A stored source that is no longer acceptable (for example navic after the receiver was disabled) is shown as-is, plainly.
  const src = (chk.ok ? chk.info.source : p.positionSource) as PositionSource;
  const label = chk.ok ? chk.info.label : p.positionSource;
  const note = chk.ok ? chk.info.note : "Source is no longer recognised by this server.";
  const warnings: string[] = [];
  if (!isNearIndia(p.latitude, p.longitude)) warnings.push("This location is outside India; Indian tariffs and schemes will not apply.");
  return {
    id: p.id,
    name: p.name,
    latitude: p.latitude,
    longitude: p.longitude,
    address: p.address,
    position: {
      source: src,
      label,
      note,
      accuracyM: p.positionAccuracyM,
      description: chk.ok ? describePosition(src, p.positionAccuracyM) : `POSITION SOURCE: ${label}`,
    },
    geometry: geometries.length ? { status: "AVAILABLE", message: null, items: geometries } : { status: "UNAVAILABLE", message: GEOMETRY_UNAVAILABLE, items: [] },
    warnings,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

interface GeometryRow {
  id: string;
  property_id: string;
  kind: GeometryKind;
  source: string;
  area_m2: number;
  geojson: unknown;
}

async function geometriesFor(db: Db, propertyIds: string[]): Promise<Map<string, GeometryDto[]>> {
  const out = new Map<string, GeometryDto[]>();
  if (!propertyIds.length) return out;
  const rows = await db.$queryRaw<GeometryRow[]>`
    SELECT id::text AS id, property_id::text AS property_id, kind::text AS kind, source, area_m2,
           ST_AsGeoJSON(geom)::json AS geojson
    FROM property_geometry
    WHERE property_id = ANY(${propertyIds}::uuid[])
    ORDER BY created_at`;
  for (const r of rows) {
    const list = out.get(r.property_id) ?? [];
    list.push({ id: r.id, kind: r.kind, source: r.source, areaM2: r.area_m2, geojson: r.geojson });
    out.set(r.property_id, list);
  }
  return out;
}

export async function createProperty(db: Db, ownerId: string, input: CreatePropertyInput, policy: PropertyPolicy): Promise<PropertyDto> {
  const c = checkCoordinates(input.latitude, input.longitude);
  if (!c.ok) throw new AppError("INVALID_COORDINATES", c.reason);
  const src = checkPositionSource(input.positionSource, policy);
  if (!src.ok) throw new AppError("VALIDATION_FAILED", src.reason, { field: "positionSource" });
  const p = await db.property.create({
    data: {
      ownerId,
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      address: input.address,
      positionSource: src.info.source,
      positionAccuracyM: input.positionAccuracyM,
    },
  });
  return toDto(p, [], policy);
}

/** Properties the user owns. Not-yours and demo properties are indistinguishable from missing ones. */
async function findOwned(db: Db, userId: string, id: string): Promise<Property> {
  const p = await db.property.findFirst({ where: { id, ownerId: userId, deletedAt: null, isDemo: false } });
  if (!p) throw new AppError("NOT_FOUND", "Property not found.");
  return p;
}

export async function getProperty(db: Db, userId: string, id: string, policy: PropertyPolicy): Promise<PropertyDto> {
  const p = await findOwned(db, userId, id);
  const g = await geometriesFor(db, [p.id]);
  return toDto(p, g.get(p.id) ?? [], policy);
}

export async function listProperties(db: Db, userId: string, policy: PropertyPolicy, limit = 100): Promise<PropertyDto[]> {
  const rows = await db.property.findMany({
    where: { ownerId: userId, deletedAt: null, isDemo: false },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
  const g = await geometriesFor(db, rows.map((r) => r.id));
  return rows.map((r) => toDto(r, g.get(r.id) ?? [], policy));
}

export async function updateProperty(
  db: Db,
  userId: string,
  id: string,
  patch: { name?: string; address?: string | null },
  policy: PropertyPolicy,
): Promise<PropertyDto> {
  await findOwned(db, userId, id);
  const data: Prisma.PropertyUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.address !== undefined) data.address = patch.address;
  const p = await db.property.update({ where: { id }, data });
  const g = await geometriesFor(db, [p.id]);
  return toDto(p, g.get(p.id) ?? [], policy);
}

export async function deleteProperty(db: Db, userId: string, id: string): Promise<void> {
  await findOwned(db, userId, id);
  await db.property.delete({ where: { id } });
}

/**
 * Attach a polygon the user drew (spec section 7, method 5). It is validated by PostGIS, must be near the property and
 * of plausible size. The platform never invents a footprint: when none exists the geometry stays UNAVAILABLE.
 */
export async function addUserPolygon(
  db: Db,
  userId: string,
  propertyId: string,
  ring: [number, number][],
  policy: PropertyPolicy,
): Promise<PropertyDto> {
  const p = await findOwned(db, userId, propertyId);
  if (ring.length < 4) throw new AppError("VALIDATION_FAILED", "A polygon needs at least 4 points (the first repeated as the last).");
  for (const [lon, lat] of ring) {
    const c = checkCoordinates(lat, lon);
    if (!c.ok) throw new AppError("INVALID_COORDINATES", `Polygon point [${lon}, ${lat}]: ${c.reason}`);
  }
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) throw new AppError("VALIDATION_FAILED", "The polygon must be closed: the last point must equal the first.");
  const geojson = JSON.stringify({ type: "Polygon", coordinates: [ring] });

  let check: { valid: boolean; area_m2: number; distance_m: number }[];
  try {
    check = await db.$queryRaw<{ valid: boolean; area_m2: number; distance_m: number }[]>`
      SELECT ST_IsValid(g) AS valid,
             ST_Area(g::geography) AS area_m2,
             ST_Distance(g::geography, ST_SetSRID(ST_MakePoint(${p.longitude}::float8, ${p.latitude}::float8), 4326)::geography) AS distance_m
      FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}::text), 4326) AS g) s`;
  } catch {
    throw new AppError("VALIDATION_FAILED", "The polygon could not be read as a valid shape.");
  }
  const r = check[0];
  if (!r || !r.valid) throw new AppError("VALIDATION_FAILED", "The polygon is not a valid shape (it may cross itself).");
  if (!(r.area_m2 > 0)) throw new AppError("VALIDATION_FAILED", "The polygon has no area.");
  if (r.area_m2 > MAX_POLYGON_AREA_M2) throw new AppError("VALIDATION_FAILED", `The polygon is larger than ${MAX_POLYGON_AREA_M2} m2; draw the roof or plot, not a district.`);
  if (r.distance_m > MAX_POLYGON_DISTANCE_M) {
    throw new AppError("VALIDATION_FAILED", `The polygon is ${Math.round(r.distance_m)} m from the property point; it must be within ${MAX_POLYGON_DISTANCE_M} m.`);
  }
  await db.$executeRaw`
    INSERT INTO property_geometry (id, property_id, kind, geom, area_m2, source, created_at)
    VALUES (gen_random_uuid(), ${propertyId}::uuid, 'USER_POLYGON'::"GeometryKind",
            ST_SetSRID(ST_GeomFromGeoJSON(${geojson}::text), 4326), ${r.area_m2}::float8, 'user', now())`;
  return getProperty(db, userId, propertyId, policy);
}
