-- PostGIS must exist before any geometry column. Creating an extension needs a privileged role: on a managed database
-- enable PostGIS once from the provider console and this statement is then a no-op.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "DataStatus" AS ENUM ('LIVE', 'UPDATED', 'FORECAST', 'ESTIMATED', 'SIMULATED', 'DEMO', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "GeometryKind" AS ENUM ('BUILDING_FOOTPRINT', 'USER_POLYGON');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geometry(Point,4326),
    "address" TEXT,
    "position_source" TEXT NOT NULL,
    "position_accuracy_m" DOUBLE PRECISION,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_geometry" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "kind" "GeometryKind" NOT NULL,
    "geom" geometry(Polygon,4326) NOT NULL,
    "area_m2" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_geometry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_provenance" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "data_type" TEXT NOT NULL,
    "status" "DataStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "observed_at" TIMESTAMPTZ(3),
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quality" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "processing_version" TEXT NOT NULL,
    "model_version" TEXT,
    "detail" JSONB,

    CONSTRAINT "data_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "request_id" TEXT,
    "ip" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_calls" (
    "id" BIGSERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status_code" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "error" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache_entries" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "stored_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cache_entries_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "properties_owner_id_idx" ON "properties"("owner_id");

-- CreateIndex
CREATE INDEX "property_geometry_property_id_idx" ON "property_geometry"("property_id");

-- CreateIndex
CREATE INDEX "data_provenance_entity_type_entity_id_idx" ON "data_provenance"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "data_provenance_provider_generated_at_idx" ON "data_provenance"("provider", "generated_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "provider_calls_provider_created_at_idx" ON "provider_calls"("provider", "created_at");

-- CreateIndex
CREATE INDEX "cache_entries_expires_at_idx" ON "cache_entries"("expires_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_geometry" ADD CONSTRAINT "property_geometry_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Hand-written part: things Prisma cannot express. Keep it in this migration so a fresh database is complete.
-- ---------------------------------------------------------------------------------------------------------

-- Range and shape checks: bad data is rejected by the database, not only by the API (spec sections 41 and 51).
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email") AND position('@' in "email") > 1);

ALTER TABLE "properties"
  ADD CONSTRAINT "properties_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "properties_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180),
  ADD CONSTRAINT "properties_accuracy_nonnegative" CHECK ("position_accuracy_m" IS NULL OR "position_accuracy_m" >= 0);

ALTER TABLE "property_geometry"
  ADD CONSTRAINT "property_geometry_area_positive" CHECK ("area_m2" > 0),
  ADD CONSTRAINT "property_geometry_valid" CHECK (ST_IsValid("geom"));

-- The honesty rule of the whole platform, enforced at the lowest level: a value may only be marked LIVE when it
-- carries the time it was observed. The API additionally applies the freshness window (platform/ARCHITECTURE.md D7).
ALTER TABLE "data_provenance"
  ADD CONSTRAINT "data_provenance_live_needs_observation_time" CHECK ("status" <> 'LIVE' OR "observed_at" IS NOT NULL),
  ADD CONSTRAINT "data_provenance_quality_range" CHECK ("quality" IS NULL OR "quality" BETWEEN 0 AND 1),
  ADD CONSTRAINT "data_provenance_confidence_range" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "data_provenance_latlon_range" CHECK (
    ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90) AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180));

ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_latency_nonnegative" CHECK ("latency_ms" >= 0);

-- Spatial indexes (named as Prisma names them, and declared in schema.prisma, so Prisma does not see drift).
CREATE INDEX "properties_location_idx" ON "properties" USING GIST ("location");
CREATE INDEX "property_geometry_geom_idx" ON "property_geometry" USING GIST ("geom");
CREATE INDEX "properties_owner_live_idx" ON "properties" ("owner_id") WHERE "deleted_at" IS NULL AND NOT "is_demo";

-- Keep the geometry column in step with latitude/longitude so the two can never disagree.
CREATE FUNCTION "properties_sync_location"() RETURNS trigger AS $$
BEGIN
  NEW."location" := ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "properties_sync_location_trg"
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "properties"
  FOR EACH ROW EXECUTE FUNCTION "properties_sync_location"();

-- Audit log is append-only. The one permitted change is the foreign key's ON DELETE SET NULL, which erases the user
-- link when an account is deleted (spec section 50); every other UPDATE and every DELETE is refused.
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF NEW."user_id" IS NULL
     AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only_trg"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();
