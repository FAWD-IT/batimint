-- CreateEnum
CREATE TYPE "ReceptionKind" AS ENUM ('provisional', 'final');

-- CreateEnum
CREATE TYPE "ReceptionStatus" AS ENUM ('draft', 'signed');

-- CreateEnum
CREATE TYPE "StockMovementKind" AS ENUM ('in', 'out', 'transfer', 'adjustment');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "retention_due_date" DATE,
ADD COLUMN     "retention_released_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "stock_average_cost" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "final_acceptance_planned_on" DATE,
ADD COLUMN     "final_accepted_on" DATE,
ADD COLUMN     "provisional_accepted_on" DATE;

-- AlterTable
ALTER TABLE "purchase_order_lines" ADD COLUMN     "item_id" UUID;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "stock_location_id" UUID,
ALTER COLUMN "project_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "receptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "kind" "ReceptionKind" NOT NULL,
    "status" "ReceptionStatus" NOT NULL DEFAULT 'draft',
    "number" TEXT,
    "reception_date" DATE NOT NULL,
    "attendees" TEXT,
    "notes" TEXT,
    "planned_final_date" DATE,
    "signer_name" TEXT,
    "signature_id" UUID,
    "signed_at" TIMESTAMPTZ(3),
    "pdf_key" TEXT,
    "pdf_sha256" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "receptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserves" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reception_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "budget_line_id" UUID,
    "photo_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "task_id" UUID,
    "lifted_at" TIMESTAMPTZ(3),
    "lifted_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'depot',
    "employee_id" UUID,
    "address" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "min_quantity" DECIMAL(14,4),
    "reorder_quantity" DECIMAL(14,4),
    "alerted_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "kind" "StockMovementKind" NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "total_cost" BIGINT NOT NULL,
    "location_id" UUID NOT NULL,
    "to_location_id" UUID,
    "project_id" UUID,
    "budget_line_id" UUID,
    "purchase_order_id" UUID,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "serial_number" TEXT,
    "daily_cost" BIGINT NOT NULL DEFAULT 0,
    "purchased_on" DATE,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "budget_line_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "daily_cost" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "equipment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "done_on" DATE,
    "interval_months" INTEGER,
    "cost" BIGINT,
    "notes" TEXT,
    "alert_state" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "maintenance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receptions_tenant_id_project_id_idx" ON "receptions"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "receptions_tenant_id_number_key" ON "receptions"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "reserves_task_id_key" ON "reserves"("task_id");

-- CreateIndex
CREATE INDEX "reserves_tenant_id_project_id_idx" ON "reserves"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "stock_locations_tenant_id_idx" ON "stock_locations"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_levels_tenant_id_item_id_idx" ON "stock_levels"("tenant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_location_id_item_id_key" ON "stock_levels"("location_id", "item_id");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_item_id_occurred_at_idx" ON "stock_movements"("tenant_id", "item_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_project_id_idx" ON "stock_movements"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "equipment_tenant_id_idx" ON "equipment"("tenant_id");

-- CreateIndex
CREATE INDEX "equipment_assignments_tenant_id_equipment_id_idx" ON "equipment_assignments"("tenant_id", "equipment_id");

-- CreateIndex
CREATE INDEX "equipment_assignments_tenant_id_project_id_idx" ON "equipment_assignments"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "maintenance_events_tenant_id_equipment_id_idx" ON "maintenance_events"("tenant_id", "equipment_id");

-- CreateIndex
CREATE INDEX "maintenance_events_tenant_id_due_on_idx" ON "maintenance_events"("tenant_id", "due_on");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_stock_location_id_fkey" FOREIGN KEY ("stock_location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserves" ADD CONSTRAINT "reserves_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserves" ADD CONSTRAINT "reserves_reception_id_fkey" FOREIGN KEY ("reception_id") REFERENCES "receptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_assignments" ADD CONSTRAINT "equipment_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_events" ADD CONSTRAINT "maintenance_events_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Isolation par tenant (règle n°1).
SELECT rls.enable_tenant_isolation('"receptions"');
SELECT rls.enable_tenant_isolation('"reserves"');
SELECT rls.enable_tenant_isolation('"stock_locations"');
SELECT rls.enable_tenant_isolation('"stock_levels"');
SELECT rls.enable_tenant_isolation('"stock_movements"');
SELECT rls.enable_tenant_isolation('"equipment"');
SELECT rls.enable_tenant_isolation('"equipment_assignments"');
SELECT rls.enable_tenant_isolation('"maintenance_events"');

-- Un PV signé est un document légal : ni ses données ni ses réserves ne changent (seule la levée
-- d'une réserve est enregistrée).
CREATE OR REPLACE FUNCTION receptions_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'signed' AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."reception_date" IS DISTINCT FROM OLD."reception_date"
    OR NEW."notes" IS DISTINCT FROM OLD."notes"
    OR NEW."attendees" IS DISTINCT FROM OLD."attendees"
    OR NEW."signer_name" IS DISTINCT FROM OLD."signer_name"
    OR NEW."signed_at" IS DISTINCT FROM OLD."signed_at"
    OR NEW."pdf_sha256" IS DISTINCT FROM OLD."pdf_sha256"
  ) THEN
    RAISE EXCEPTION 'Un PV de réception signé ne se modifie pas.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receptions_immutable
  BEFORE UPDATE ON "receptions"
  FOR EACH ROW EXECUTE FUNCTION receptions_immutable();
