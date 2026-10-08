-- CreateTable
CREATE TABLE "scenarios" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "name" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "annual_savings_inr" DOUBLE PRECISION NOT NULL,
    "engine_version" TEXT NOT NULL,

    CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scenarios_property_id_created_at_idx" ON "scenarios"("property_id", "created_at");

-- AddForeignKey
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: the database refuses nonsense even if a bug in the API lets it through. (Prisma cannot express CHECKs.)
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_name" CHECK (char_length("name") BETWEEN 1 AND 80);
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_shape" CHECK (jsonb_typeof("request") = 'object' AND jsonb_typeof("result") = 'object');
