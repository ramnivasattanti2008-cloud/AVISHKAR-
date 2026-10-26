-- CreateEnum
CREATE TYPE "JobTrigger" AS ENUM ('SCHEDULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'OK', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ControlMode" AS ENUM ('OBSERVE', 'RECOMMEND', 'APPROVE', 'AUTOMATE');

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('BATTERY_CHARGE', 'BATTERY_DISCHARGE', 'APPLIANCE_RUN', 'EV_CHARGE');

-- CreateEnum
CREATE TYPE "ProposalState" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'APPLIED', 'FAILED', 'ROLLED_BACK', 'BLOCKED');

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job" TEXT NOT NULL,
    "trigger" "JobTrigger" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "status" "JobStatus" NOT NULL,
    "summary" JSONB,
    "error" TEXT,
    "requested_by" UUID,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_settings" (
    "property_id" UUID NOT NULL,
    "mode" "ControlMode" NOT NULL DEFAULT 'RECOMMEND',
    "max_charge_kw" DOUBLE PRECISION,
    "max_discharge_kw" DOUBLE PRECISION,
    "min_soc_percent" DOUBLE PRECISION,
    "automate_until" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "control_settings_pkey" PRIMARY KEY ("property_id")
);

-- CreateTable
CREATE TABLE "control_proposals" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "plan_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "command" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "state" "ProposalState" NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by" UUID,
    "decision_note" TEXT,
    "result" JSONB,
    "safety" JSONB NOT NULL,

    CONSTRAINT "control_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_job_started_at_idx" ON "job_runs"("job", "started_at" DESC);

-- CreateIndex
CREATE INDEX "control_proposals_property_id_created_at_idx" ON "control_proposals"("property_id", "created_at");

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_settings" ADD CONSTRAINT "control_settings_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_settings" ADD CONSTRAINT "control_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_proposals" ADD CONSTRAINT "control_proposals_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_proposals" ADD CONSTRAINT "control_proposals_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "optimization_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_proposals" ADD CONSTRAINT "control_proposals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Hand-written: the database refuses nonsense even if a bug in the API lets it through. (Prisma cannot express CHECKs.)

-- A job run is RUNNING exactly while it has no end time, and a failure always says why.
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_finished" CHECK (("status" = 'RUNNING') = ("finished_at" IS NULL));
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_order" CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at");
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_failure_says_why" CHECK ("status" <> 'FAILED' OR ("error" IS NOT NULL AND char_length("error") > 0));
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_name" CHECK (char_length("job") BETWEEN 1 AND 60);
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_summary_shape" CHECK ("summary" IS NULL OR jsonb_typeof("summary") = 'object');
-- Only an administrator's manual run names who asked.
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_requester" CHECK ("trigger" = 'MANUAL' OR "requested_by" IS NULL);

-- Safety limits are positive powers and a share between 0 and 100; AUTOMATE always has an end, and nothing else has one.
ALTER TABLE "control_settings" ADD CONSTRAINT "control_settings_limits" CHECK (
  ("max_charge_kw" IS NULL OR "max_charge_kw" > 0)
  AND ("max_discharge_kw" IS NULL OR "max_discharge_kw" > 0)
  AND ("min_soc_percent" IS NULL OR "min_soc_percent" BETWEEN 0 AND 100)
);
ALTER TABLE "control_settings" ADD CONSTRAINT "control_settings_automate_ends" CHECK (("mode" = 'AUTOMATE') = ("automate_until" IS NOT NULL));

-- A move has a start before its end and a command; a decision always has a time, and only an open move lacks one.
ALTER TABLE "control_proposals" ADD CONSTRAINT "control_proposals_window" CHECK ("ends_at" > "starts_at");
ALTER TABLE "control_proposals" ADD CONSTRAINT "control_proposals_shape" CHECK (jsonb_typeof("command") = 'object' AND jsonb_typeof("safety") = 'object' AND ("result" IS NULL OR jsonb_typeof("result") = 'object'));
ALTER TABLE "control_proposals" ADD CONSTRAINT "control_proposals_decision_time" CHECK ("state" IN ('PROPOSED', 'BLOCKED') OR "decided_at" IS NOT NULL);
ALTER TABLE "control_proposals" ADD CONSTRAINT "control_proposals_reason" CHECK (char_length("reason") BETWEEN 1 AND 1000);
-- Only a move that passed its safety checks can have been approved or applied.
ALTER TABLE "control_proposals" ADD CONSTRAINT "control_proposals_blocked_never_approved" CHECK ("state" NOT IN ('APPROVED', 'APPLIED') OR ("safety" ->> 'ok') = 'true');
