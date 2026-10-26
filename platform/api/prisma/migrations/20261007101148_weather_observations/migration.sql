-- CreateEnum
CREATE TYPE "ObservationKind" AS ENUM ('ANALYSIS', 'FORECAST', 'HISTORICAL');

-- CreateTable
CREATE TABLE "weather_observations" (
    "id" BIGSERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "lat_cell" INTEGER NOT NULL,
    "lon_cell" INTEGER NOT NULL,
    "variable" TEXT NOT NULL,
    "kind" "ObservationKind" NOT NULL,
    "valid_at" TIMESTAMPTZ(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "weather_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "weather_observations_lat_cell_lon_cell_variable_valid_at_idx" ON "weather_observations"("lat_cell", "lon_cell", "variable", "valid_at");

-- CreateIndex
CREATE INDEX "weather_observations_fetched_at_idx" ON "weather_observations"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "weather_observations_provider_lat_cell_lon_cell_variable_ki_key" ON "weather_observations"("provider", "lat_cell", "lon_cell", "variable", "kind", "valid_at", "fetched_at");
