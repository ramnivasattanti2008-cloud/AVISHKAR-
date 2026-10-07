import { z } from "zod";
import { DATA_STATUSES } from "./provenance/index.js";

/** Shared response shapes. They double as the OpenAPI documentation (spec section 68). */

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string().describe("Stable machine-readable code, for example INVALID_COORDINATES."),
    message: z.string().describe("Plain-language explanation for the user."),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export const GeoPoint = z.object({ latitude: z.number(), longitude: z.number() });

export const ProvenanceSchema = z.object({
  provider: z.string(),
  source: z.string(),
  dataType: z.string(),
  status: z.enum(DATA_STATUSES).describe("LIVE, UPDATED, FORECAST, ESTIMATED, SIMULATED, DEMO, REFERENCE or UNAVAILABLE."),
  observedAt: z.string().optional(),
  generatedAt: z.string(),
  validFor: z.string().optional(),
  location: GeoPoint.optional(),
  quality: z.number().optional(),
  confidence: z.number().optional(),
  processingVersion: z.string(),
  modelVersion: z.string().optional(),
  ageSeconds: z.number().optional(),
  notes: z.array(z.string()),
});

/** A value together with where it came from and how far to trust it (spec sections 3, 40). */
export const measured = <T extends z.ZodType>(value: T) =>
  z.object({ value: value.nullable(), unit: z.string().optional(), provenance: ProvenanceSchema });

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(["USER", "ADMIN"]),
  displayName: z.string().nullable(),
});

export const PositionSchema = z.object({
  source: z.string(),
  label: z.string(),
  note: z.string(),
  accuracyM: z.number().nullable(),
  description: z.string(),
});

export const GeometrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(["BUILDING_FOOTPRINT", "USER_POLYGON"]),
  source: z.string(),
  areaM2: z.number(),
  geojson: z.unknown(),
});

export const PropertySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  address: z.string().nullable(),
  position: PositionSchema,
  geometry: z.object({
    status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    message: z.string().nullable(),
    items: z.array(GeometrySchema),
  }),
  warnings: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const GeocodeResultSchema = z.object({
  label: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  kind: z.string(),
  importance: z.number().optional(),
  boundingBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  osm: z.object({ type: z.string(), id: z.number() }).optional(),
  address: z.record(z.string(), z.string()).optional(),
});
