-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('EXISTING', 'PLANNED');

-- CreateEnum
CREATE TYPE "AppliancePriority" AS ENUM ('CRITICAL', 'IMPORTANT', 'FLEXIBLE', 'DISCRETIONARY');

-- CreateEnum
CREATE TYPE "ApplianceEventSource" AS ENUM ('USER_LOGGED', 'NILM_ESTIMATE', 'METER_DERIVED');

-- AlterTable
ALTER TABLE "energy_twins" ADD COLUMN     "assets_snapshot" JSONB,
ADD COLUMN     "energy_dna_id" UUID,
ADD COLUMN     "mean_daily_load_kwh" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "batteries" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'EXISTING',
    "capacity_kwh" DOUBLE PRECISION NOT NULL,
    "max_charge_kw" DOUBLE PRECISION NOT NULL,
    "max_discharge_kw" DOUBLE PRECISION NOT NULL,
    "charge_efficiency" DOUBLE PRECISION,
    "discharge_efficiency" DOUBLE PRECISION,
    "min_soc" DOUBLE PRECISION,
    "max_soc" DOUBLE PRECISION,
    "reserve_soc" DOUBLE PRECISION,
    "max_cycles_per_day" DOUBLE PRECISION,
    "rated_cycles" INTEGER,
    "wear_inr_per_kwh" DOUBLE PRECISION,
    "current_soc" DOUBLE PRECISION,
    "current_soc_at" TIMESTAMPTZ(3),
    "installed_on" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "batteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_systems" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'EXISTING',
    "capacity_kwp" DOUBLE PRECISION NOT NULL,
    "tilt_deg" DOUBLE PRECISION NOT NULL,
    "azimuth_deg" DOUBLE PRECISION NOT NULL,
    "inverter_kw" DOUBLE PRECISION,
    "loss_fraction" DOUBLE PRECISION,
    "installed_on" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "solar_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evs" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "battery_kwh" DOUBLE PRECISION NOT NULL,
    "charger_kw" DOUBLE PRECISION NOT NULL,
    "charger_efficiency" DOUBLE PRECISION,
    "target_soc" DOUBLE PRECISION NOT NULL,
    "current_soc" DOUBLE PRECISION,
    "current_soc_at" TIMESTAMPTZ(3),
    "departure_time" TEXT NOT NULL,
    "departure_days" INTEGER[],
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appliances" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "priority" "AppliancePriority" NOT NULL,
    "rated_power_w" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "runtime_min_per_day" INTEGER,
    "schedule" JSONB,
    "earliest_start" TEXT,
    "latest_finish" TEXT,
    "duration_min" INTEGER,
    "interruptible" BOOLEAN NOT NULL DEFAULT false,
    "comfort_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appliances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appliance_events" (
    "id" UUID NOT NULL,
    "appliance_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "energy_kwh" DOUBLE PRECISION,
    "source" "ApplianceEventSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "uncertainty_kwh" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appliance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_imports" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "filename" TEXT,
    "sha256" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rows" INTEGER NOT NULL,
    "accepted" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "interval_minutes" INTEGER NOT NULL,
    "usage_column" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "from_ts" TIMESTAMPTZ(3),
    "to_ts" TIMESTAMPTZ(3),
    "quality" JSONB NOT NULL,
    "notes" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "energy_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_observations" (
    "id" BIGSERIAL NOT NULL,
    "property_id" UUID NOT NULL,
    "import_id" UUID,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "interval_minutes" INTEGER NOT NULL,
    "import_kwh" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "energy_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_dna" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "from_ts" TIMESTAMPTZ(3) NOT NULL,
    "to_ts" TIMESTAMPTZ(3) NOT NULL,
    "complete_days" INTEGER NOT NULL,
    "mean_daily_kwh" DOUBLE PRECISION NOT NULL,
    "weekday_daily_kwh" DOUBLE PRECISION,
    "weekend_daily_kwh" DOUBLE PRECISION,
    "peak_kw" DOUBLE PRECISION NOT NULL,
    "peak_hour" INTEGER NOT NULL,
    "baseload_kw" DOUBLE PRECISION NOT NULL,
    "patterns" JSONB NOT NULL,
    "unavailable" JSONB NOT NULL,

    CONSTRAINT "energy_dna_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batteries_property_id_idx" ON "batteries"("property_id");

-- CreateIndex
CREATE INDEX "solar_systems_property_id_idx" ON "solar_systems"("property_id");

-- CreateIndex
CREATE INDEX "evs_property_id_idx" ON "evs"("property_id");

-- CreateIndex
CREATE INDEX "appliances_property_id_idx" ON "appliances"("property_id");

-- CreateIndex
CREATE INDEX "appliance_events_appliance_id_started_at_idx" ON "appliance_events"("appliance_id", "started_at");

-- CreateIndex
CREATE INDEX "energy_imports_property_id_uploaded_at_idx" ON "energy_imports"("property_id", "uploaded_at");

-- CreateIndex
CREATE UNIQUE INDEX "energy_imports_property_id_sha256_key" ON "energy_imports"("property_id", "sha256");

-- CreateIndex
CREATE INDEX "energy_observations_import_id_idx" ON "energy_observations"("import_id");

-- CreateIndex
CREATE UNIQUE INDEX "energy_observations_property_id_ts_key" ON "energy_observations"("property_id", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "energy_dna_property_id_version_key" ON "energy_dna"("property_id", "version");

-- AddForeignKey
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_systems" ADD CONSTRAINT "solar_systems_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evs" ADD CONSTRAINT "evs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appliance_events" ADD CONSTRAINT "appliance_events_appliance_id_fkey" FOREIGN KEY ("appliance_id") REFERENCES "appliances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_imports" ADD CONSTRAINT "energy_imports_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_observations" ADD CONSTRAINT "energy_observations_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_observations" ADD CONSTRAINT "energy_observations_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "energy_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_dna" ADD CONSTRAINT "energy_dna_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Hand-written: the database refuses nonsense even if a bug in the API lets it through. (Prisma cannot express CHECKs.)
-- Ranges are physical plausibility limits for homes and small businesses, not product choices.

ALTER TABLE "batteries" ADD CONSTRAINT "batteries_sizes" CHECK ("capacity_kwh" > 0 AND "capacity_kwh" <= 100000 AND "max_charge_kw" > 0 AND "max_charge_kw" <= 100000 AND "max_discharge_kw" > 0 AND "max_discharge_kw" <= 100000);
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_efficiency" CHECK (("charge_efficiency" IS NULL OR "charge_efficiency" BETWEEN 0.5 AND 1) AND ("discharge_efficiency" IS NULL OR "discharge_efficiency" BETWEEN 0.5 AND 1));
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_soc_range" CHECK (("min_soc" IS NULL OR "min_soc" BETWEEN 0 AND 1) AND ("max_soc" IS NULL OR "max_soc" BETWEEN 0 AND 1) AND ("reserve_soc" IS NULL OR "reserve_soc" BETWEEN 0 AND 1) AND ("current_soc" IS NULL OR "current_soc" BETWEEN 0 AND 1));
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_soc_order" CHECK (COALESCE("min_soc", 0) < COALESCE("max_soc", 1) AND ("reserve_soc" IS NULL OR ("reserve_soc" >= COALESCE("min_soc", 0) AND "reserve_soc" <= COALESCE("max_soc", 1))));
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_cycles" CHECK (("max_cycles_per_day" IS NULL OR "max_cycles_per_day" BETWEEN 0.1 AND 10) AND ("rated_cycles" IS NULL OR "rated_cycles" BETWEEN 1 AND 100000) AND ("wear_inr_per_kwh" IS NULL OR "wear_inr_per_kwh" BETWEEN 0 AND 1000));

ALTER TABLE "solar_systems" ADD CONSTRAINT "solar_systems_sizes" CHECK ("capacity_kwp" > 0 AND "capacity_kwp" <= 100000 AND ("inverter_kw" IS NULL OR ("inverter_kw" > 0 AND "inverter_kw" <= 100000)));
ALTER TABLE "solar_systems" ADD CONSTRAINT "solar_systems_orientation" CHECK ("tilt_deg" BETWEEN 0 AND 90 AND "azimuth_deg" >= 0 AND "azimuth_deg" < 360);
ALTER TABLE "solar_systems" ADD CONSTRAINT "solar_systems_loss" CHECK ("loss_fraction" IS NULL OR "loss_fraction" BETWEEN 0 AND 0.5);

ALTER TABLE "evs" ADD CONSTRAINT "evs_sizes" CHECK ("battery_kwh" > 0 AND "battery_kwh" <= 500 AND "charger_kw" > 0 AND "charger_kw" <= 350 AND ("charger_efficiency" IS NULL OR "charger_efficiency" BETWEEN 0.5 AND 1));
ALTER TABLE "evs" ADD CONSTRAINT "evs_soc" CHECK ("target_soc" BETWEEN 0 AND 1 AND ("current_soc" IS NULL OR "current_soc" BETWEEN 0 AND 1));
ALTER TABLE "evs" ADD CONSTRAINT "evs_departure" CHECK ("departure_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND cardinality("departure_days") BETWEEN 1 AND 7 AND "departure_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]);

ALTER TABLE "appliances" ADD CONSTRAINT "appliances_sizes" CHECK ("rated_power_w" > 0 AND "rated_power_w" <= 1000000 AND "quantity" BETWEEN 1 AND 1000 AND ("runtime_min_per_day" IS NULL OR "runtime_min_per_day" BETWEEN 0 AND 1440));
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_window" CHECK (("earliest_start" IS NULL OR "earliest_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND ("latest_finish" IS NULL OR "latest_finish" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND ("duration_min" IS NULL OR "duration_min" BETWEEN 1 AND 1440));
-- A flexible appliance is one the optimiser may move, so it must say within which window and for how long.
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_flexible_has_window" CHECK ("priority" <> 'FLEXIBLE' OR ("earliest_start" IS NOT NULL AND "latest_finish" IS NOT NULL AND "duration_min" IS NOT NULL));
ALTER TABLE "appliances" ADD CONSTRAINT "appliances_schedule_array" CHECK ("schedule" IS NULL OR jsonb_typeof("schedule") = 'array');

ALTER TABLE "appliance_events" ADD CONSTRAINT "appliance_events_values" CHECK (("energy_kwh" IS NULL OR "energy_kwh" >= 0) AND ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1) AND ("uncertainty_kwh" IS NULL OR "uncertainty_kwh" >= 0) AND ("ended_at" IS NULL OR "ended_at" >= "started_at"));
-- An estimate is never stated as an exact figure: a NILM estimate carries its energy, its confidence and its uncertainty (spec section 29).
ALTER TABLE "appliance_events" ADD CONSTRAINT "appliance_events_nilm_has_uncertainty" CHECK ("source" <> 'NILM_ESTIMATE' OR ("energy_kwh" IS NOT NULL AND "confidence" IS NOT NULL AND "uncertainty_kwh" IS NOT NULL));

ALTER TABLE "energy_imports" ADD CONSTRAINT "energy_imports_counts" CHECK ("rows" >= 0 AND "accepted" >= 0 AND "rejected" >= 0 AND "duplicates" >= 0 AND "accepted" + "rejected" + "duplicates" = "rows");
ALTER TABLE "energy_imports" ADD CONSTRAINT "energy_imports_interval" CHECK ("interval_minutes" BETWEEN 1 AND 1440 AND length("sha256") = 64 AND ("from_ts" IS NULL OR "to_ts" IS NULL OR "to_ts" >= "from_ts"));
ALTER TABLE "energy_imports" ADD CONSTRAINT "energy_imports_json" CHECK (jsonb_typeof("quality") = 'object' AND jsonb_typeof("notes") = 'array');

ALTER TABLE "energy_observations" ADD CONSTRAINT "energy_observations_values" CHECK ("interval_minutes" BETWEEN 1 AND 1440 AND "import_kwh" >= 0 AND "import_kwh" <= 100000);

ALTER TABLE "energy_dna" ADD CONSTRAINT "energy_dna_values" CHECK ("complete_days" >= 1 AND "mean_daily_kwh" >= 0 AND "peak_hour" BETWEEN 0 AND 23 AND "peak_kw" >= 0 AND "baseload_kw" >= 0 AND "baseload_kw" <= "peak_kw" AND "to_ts" >= "from_ts");
ALTER TABLE "energy_dna" ADD CONSTRAINT "energy_dna_json" CHECK (jsonb_typeof("patterns") = 'object' AND jsonb_typeof("unavailable") = 'array');
