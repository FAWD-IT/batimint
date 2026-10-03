-- M6 — Planning : affectations en demi-journées (plage), tâche, liens iCal, date d'arrivée annoncée.

-- DropIndex
DROP INDEX "schedule_slots_tenant_id_day_idx";
DROP INDEX "schedule_slots_tenant_id_employee_id_day_idx";

-- AlterTable : le jour unique devient une plage (données existantes conservées).
ALTER TABLE "projects" ADD COLUMN "arrival_notified_on" DATE;

ALTER TABLE "schedule_slots" RENAME COLUMN "day" TO "start_day";
ALTER TABLE "schedule_slots"
  ADD COLUMN "end_day" DATE,
  ADD COLUMN "start_half" TEXT NOT NULL DEFAULT 'am',
  ADD COLUMN "end_half" TEXT NOT NULL DEFAULT 'pm',
  ADD COLUMN "task_id" UUID,
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "schedule_slots"
SET "end_day" = "start_day",
    "start_half" = CASE WHEN "start_time" >= '12:00' THEN 'pm' ELSE 'am' END,
    "end_half" = CASE WHEN "end_time" IS NOT NULL AND "end_time" <= '12:30' THEN 'am' ELSE 'pm' END;
ALTER TABLE "schedule_slots" ALTER COLUMN "end_day" SET NOT NULL;
ALTER TABLE "schedule_slots" DROP COLUMN "start_time", DROP COLUMN "end_time";
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_halves_check"
  CHECK ("start_half" IN ('am', 'pm') AND "end_half" IN ('am', 'pm') AND "end_day" >= "start_day");

-- CreateTable
CREATE TABLE "calendar_feeds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_token_hash_key" ON "calendar_feeds"("token_hash");
CREATE INDEX "calendar_feeds_tenant_id_employee_id_idx" ON "calendar_feeds"("tenant_id", "employee_id");
CREATE INDEX "schedule_slots_tenant_id_start_day_end_day_idx" ON "schedule_slots"("tenant_id", "start_day", "end_day");
CREATE INDEX "schedule_slots_tenant_id_employee_id_idx" ON "schedule_slots"("tenant_id", "employee_id");
CREATE INDEX "schedule_slots_tenant_id_project_id_idx" ON "schedule_slots"("tenant_id", "project_id");

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (CLAUDE.md règle n°1)
SELECT rls.enable_tenant_isolation('"calendar_feeds"');
