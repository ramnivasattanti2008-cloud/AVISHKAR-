-- CreateEnum
CREATE TYPE "DataQuality" AS ENUM ('MINIMAL', 'PARTIAL', 'FULL');

-- CreateTable
CREATE TABLE "satellite_observations" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "satellite" TEXT NOT NULL,
    "sensor" TEXT NOT NULL,
    "acquired_at" TIMESTAMPTZ(3) NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "cloud_percent" DOUBLE PRECISION,
    "footprint" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "processing_status" TEXT NOT NULL,
    "thumbnail_url" TEXT,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "satellite_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_twins" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "data_quality" "DataQuality" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "confidence_basis" JSONB NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevation_m" DOUBLE PRECISION,
    "geometry_kind" "GeometryKind",
    "roof_area_m2" DOUBLE PRECISION,
    "usable_roof_area_m2" DOUBLE PRECISION,
    "solar_capacity_kw_estimate" DOUBLE PRECISION,
    "ghi_kwh_m2_day" DOUBLE PRECISION,
    "clear_sky_kwh_m2_day" DOUBLE PRECISION,
    "clearness_index" DOUBLE PRECISION,
    "yield_kwh_per_kwp_day" DOUBLE PRECISION,
    "estimated_daily_generation_kwh" DOUBLE PRECISION,
    "forecast_next_24h_ghi_kwh_m2" DOUBLE PRECISION,
    "forecast_next_24h_kwh_per_kwp" DOUBLE PRECISION,
    "satellite_observation_id" UUID,
    "sources" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL,
    "unavailable" JSONB NOT NULL,

    CONSTRAINT "energy_twins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "satellite_observations_acquired_at_idx" ON "satellite_observations"("acquired_at");

-- CreateIndex
CREATE UNIQUE INDEX "satellite_observations_provider_scene_id_key" ON "satellite_observations"("provider", "scene_id");

-- CreateIndex
CREATE UNIQUE INDEX "energy_twins_property_id_version_key" ON "energy_twins"("property_id", "version");

-- AddForeignKey
ALTER TABLE "energy_twins" ADD CONSTRAINT "energy_twins_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
