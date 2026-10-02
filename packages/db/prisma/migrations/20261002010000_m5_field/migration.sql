-- CreateEnum
CREATE TYPE "TimeEntryKind" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('recorded', 'synced', 'validated', 'transmitted');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('open', 'change_order', 'resolved');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('draft', 'signed', 'invoiced');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "check_in_out_forced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "workplace_total_amount" BIGINT;

-- CreateTable
CREATE TABLE "schedule_slots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "employee_id" UUID,
    "team_id" UUID,
    "day" DATE NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "kind" "TimeEntryKind" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "day" DATE NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "accuracy_meters" INTEGER,
    "distance_meters" INTEGER,
    "geofence" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'self',
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'synced',
    "note" TEXT,
    "recorded_by" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_at" TIMESTAMPTZ(3),
    "validated_by" UUID,
    "onss_status" TEXT NOT NULL DEFAULT 'not_required',
    "onss_reference" TEXT,
    "onss_error" TEXT,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "IssueStatus" NOT NULL DEFAULT 'open',
    "change_order_id" UUID,
    "reported_by" UUID,
    "reporter_label" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "reported_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" TEXT,
    "day" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'draft',
    "signer_name" TEXT,
    "signature_id" UUID,
    "signed_at" TIMESTAMPTZ(3),
    "pdf_key" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "employee_id" UUID,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "work_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "weather" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_slots_tenant_id_day_idx" ON "schedule_slots"("tenant_id", "day");

-- CreateIndex
CREATE INDEX "schedule_slots_tenant_id_employee_id_day_idx" ON "schedule_slots"("tenant_id", "employee_id", "day");

-- CreateIndex
CREATE INDEX "time_entries_tenant_id_project_id_day_idx" ON "time_entries"("tenant_id", "project_id", "day");

-- CreateIndex
CREATE INDEX "time_entries_tenant_id_employee_id_day_idx" ON "time_entries"("tenant_id", "employee_id", "day");

-- CreateIndex
CREATE INDEX "issues_tenant_id_project_id_status_idx" ON "issues"("tenant_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_project_id_idx" ON "work_orders"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_tenant_id_number_key" ON "work_orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "work_order_lines_work_order_id_position_idx" ON "work_order_lines"("work_order_id", "position");

-- CreateIndex
CREATE INDEX "daily_reports_tenant_id_day_idx" ON "daily_reports"("tenant_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_project_id_day_key" ON "daily_reports"("project_id", "day");

-- AddForeignKey
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_lines" ADD CONSTRAINT "work_order_lines_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Isolation multi-tenant (CLAUDE.md règle n°1).
SELECT rls.enable_tenant_isolation('"schedule_slots"');
SELECT rls.enable_tenant_isolation('"time_entries"');
SELECT rls.enable_tenant_isolation('"issues"');
SELECT rls.enable_tenant_isolation('"work_orders"');
SELECT rls.enable_tenant_isolation('"work_order_lines"');
SELECT rls.enable_tenant_isolation('"daily_reports"');
