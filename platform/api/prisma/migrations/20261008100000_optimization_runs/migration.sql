-- CreateEnum
CREATE TYPE "PlanMode" AS ENUM ('SAVE_MONEY', 'INDEPENDENCE', 'RESILIENCE', 'GREEN', 'REVENUE', 'BALANCED');

-- CreateTable
CREATE TABLE "optimization_runs" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "mode" "PlanMode" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "step_hours" DOUBLE PRECISION NOT NULL,
    "steps" INTEGER NOT NULL,
    "net_cost_inr" DOUBLE PRECISION NOT NULL,
    "baseline_net_cost_inr" DOUBLE PRECISION NOT NULL,
    "savings_inr" DOUBLE PRECISION NOT NULL,
    "engine_version" TEXT NOT NULL,
    "plan" JSONB NOT NULL,

    CONSTRAINT "optimization_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "optimization_runs_property_id_created_at_idx" ON "optimization_runs"("property_id", "created_at");

-- AddForeignKey
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: the database refuses nonsense even if a bug in the API lets it through. (Prisma cannot express CHECKs.)
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_horizon" CHECK ("steps" BETWEEN 2 AND 400 AND "step_hours" IN (0.25, 0.5, 1));
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_shape" CHECK (jsonb_typeof("plan") = 'object');
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_savings" CHECK (abs(("baseline_net_cost_inr" - "net_cost_inr") - "savings_inr") < 0.01);
