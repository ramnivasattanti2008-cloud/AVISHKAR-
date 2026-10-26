-- CreateEnum
CREATE TYPE "ForecastKind" AS ENUM ('SOLAR', 'LOAD');

-- CreateTable
CREATE TABLE "forecast_runs" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "kind" "ForecastKind" NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL,
    "issued_hour" TIMESTAMPTZ(3) NOT NULL,
    "first_hour" TIMESTAMPTZ(3) NOT NULL,
    "hours" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "series" JSONB NOT NULL,
    "basis" JSONB NOT NULL,
    "evaluated_at" TIMESTAMPTZ(3),
    "evaluation" JSONB,

    CONSTRAINT "forecast_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forecast_runs_property_id_kind_issued_at_idx" ON "forecast_runs"("property_id", "kind", "issued_at");

-- CreateIndex
CREATE UNIQUE INDEX "forecast_runs_property_id_kind_issued_hour_key" ON "forecast_runs"("property_id", "kind", "issued_hour");

-- AddForeignKey
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: the database refuses nonsense even if a bug in the API lets it through. (Prisma cannot express CHECKs.)
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_hours" CHECK ("hours" BETWEEN 1 AND 400);
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_shape" CHECK (jsonb_typeof("series") = 'object' AND jsonb_typeof("basis") = 'object' AND ("evaluation" IS NULL OR jsonb_typeof("evaluation") = 'object'));
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_issue_order" CHECK ("issued_hour" <= "issued_at" AND "issued_at" - "issued_hour" < INTERVAL '1 hour');
ALTER TABLE "forecast_runs" ADD CONSTRAINT "forecast_runs_evaluated_together" CHECK (("evaluated_at" IS NULL) = ("evaluation" IS NULL));
