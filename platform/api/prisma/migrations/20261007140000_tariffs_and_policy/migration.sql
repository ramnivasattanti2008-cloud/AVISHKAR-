-- CreateEnum
CREATE TYPE "ConsumerType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'AGRICULTURAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FixedChargeBasis" AS ENUM ('PER_CONNECTION_MONTH', 'PER_KW_MONTH');

-- CreateEnum
CREATE TYPE "ExportRateBasis" AS ENUM ('REGULATOR_ORDER', 'USER_ENTERED', 'ASSUMPTION', 'NONE');

-- CreateEnum
CREATE TYPE "MeteringMode" AS ENUM ('NET_METERING', 'NET_BILLING', 'GROSS_METERING', 'NONE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "energy_twins" ADD COLUMN     "tariff_plan_id" UUID,
ADD COLUMN     "tariff_snapshot" JSONB;

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "tariff_plan_id" UUID;

-- CreateTable
CREATE TABLE "tariff_plans" (
    "id" UUID NOT NULL,
    "seed_key" TEXT,
    "owner_id" UUID,
    "name" TEXT NOT NULL,
    "state" TEXT,
    "discom" TEXT,
    "category" TEXT,
    "consumer_type" "ConsumerType" NOT NULL,
    "tou_blocks" JSONB NOT NULL,
    "slabs" JSONB,
    "fixed_charge_inr" DOUBLE PRECISION,
    "fixed_charge_basis" "FixedChargeBasis",
    "export_rate" DOUBLE PRECISION,
    "export_rate_basis" "ExportRateBasis" NOT NULL DEFAULT 'NONE',
    "metering_mode" "MeteringMode" NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "tariff_year" TEXT,
    "effective_from" DATE,
    "effective_to" DATE,
    "verified_at" TIMESTAMPTZ(3),
    "notes" JSONB NOT NULL DEFAULT '[]',
    "extras" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "tariff_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_rules" (
    "id" UUID NOT NULL,
    "seed_key" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "applies_to" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "stated_as" TEXT,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "effective_from" DATE,
    "effective_to" DATE,
    "verified_at" TIMESTAMPTZ(3),
    "notes" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "policy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tariff_plans_seed_key_key" ON "tariff_plans"("seed_key");

-- CreateIndex
CREATE INDEX "tariff_plans_state_consumer_type_idx" ON "tariff_plans"("state", "consumer_type");

-- CreateIndex
CREATE INDEX "tariff_plans_owner_id_idx" ON "tariff_plans"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_rules_seed_key_key" ON "policy_rules"("seed_key");

-- CreateIndex
CREATE INDEX "policy_rules_program_region_idx" ON "policy_rules"("program", "region");

-- CreateIndex
CREATE INDEX "properties_tariff_plan_id_idx" ON "properties"("tariff_plan_id");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_tariff_plan_id_fkey" FOREIGN KEY ("tariff_plan_id") REFERENCES "tariff_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_twins" ADD CONSTRAINT "energy_twins_tariff_plan_id_fkey" FOREIGN KEY ("tariff_plan_id") REFERENCES "tariff_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: the database refuses nonsense even if a bug in the API lets it through. (Prisma cannot express CHECKs.)

-- A plan is either curated (no owner, has a seed key) or a user's own (has an owner, no seed key).
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_curated_xor_owned" CHECK (("owner_id" IS NULL) <> ("seed_key" IS NULL));
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_tou_blocks_array" CHECK (jsonb_typeof("tou_blocks") = 'array' AND jsonb_array_length("tou_blocks") BETWEEN 1 AND 48);
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_slabs_array" CHECK ("slabs" IS NULL OR (jsonb_typeof("slabs") = 'array' AND jsonb_array_length("slabs") BETWEEN 1 AND 20));
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_notes_array" CHECK (jsonb_typeof("notes") = 'array');
-- A fixed charge has an amount and a basis together; an export rate has a basis (NONE exactly when there is no rate).
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_fixed_charge_pair" CHECK (("fixed_charge_inr" IS NULL) = ("fixed_charge_basis" IS NULL) AND ("fixed_charge_inr" IS NULL OR "fixed_charge_inr" >= 0));
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_export_rate_basis" CHECK (("export_rate" IS NULL) = ("export_rate_basis" = 'NONE') AND ("export_rate" IS NULL OR ("export_rate" >= 0 AND "export_rate" <= 100)));
ALTER TABLE "tariff_plans" ADD CONSTRAINT "tariff_plans_effective_order" CHECK ("effective_from" IS NULL OR "effective_to" IS NULL OR "effective_to" >= "effective_from");

ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_rule_object" CHECK (jsonb_typeof("rule") = 'object');
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_notes_array" CHECK (jsonb_typeof("notes") = 'array');
ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_effective_order" CHECK ("effective_from" IS NULL OR "effective_to" IS NULL OR "effective_to" >= "effective_from");

