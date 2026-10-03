-- CreateEnum
CREATE TYPE "ChangeOrderStatus" AS ENUM ('draft', 'sent', 'signed', 'refused');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('supplier_invoice', 'purchase_order', 'labour', 'stock', 'equipment', 'subcontract', 'other');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "task_id" UUID;

-- AlterTable
ALTER TABLE "budget_lines" ADD COLUMN     "change_order_id" UUID;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "description" TEXT,
ADD COLUMN     "suspended_reason" TEXT,
ADD COLUMN     "team_id" UUID;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "amount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "assignee_employee_id" UUID,
ADD COLUMN     "change_order_line_id" UUID,
ADD COLUMN     "checklist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "completed_by" UUID,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "due_date" DATE,
ADD COLUMN     "progress" DECIMAL(5,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "timeline_entries" ADD COLUMN     "amount" BIGINT,
ADD COLUMN     "change_order_id" UUID,
ADD COLUMN     "data" JSONB;

-- CreateTable
CREATE TABLE "change_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ChangeOrderStatus" NOT NULL DEFAULT 'draft',
    "delay_days" INTEGER NOT NULL DEFAULT 0,
    "issue_id" UUID,
    "total_net" BIGINT NOT NULL DEFAULT 0,
    "total_vat" BIGINT NOT NULL DEFAULT 0,
    "total_gross" BIGINT NOT NULL DEFAULT 0,
    "total_cost" BIGINT NOT NULL DEFAULT 0,
    "labor_hours" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(3),
    "sent_to" TEXT,
    "signed_at" TIMESTAMPTZ(3),
    "refused_at" TIMESTAMPTZ(3),
    "refusal_reason" TEXT,
    "signature_id" UUID,
    "pdf_key" TEXT,
    "pdf_sha256" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "change_order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "budget_line_id" UUID,
    "new_post_label" TEXT,
    "item_id" UUID,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'u',
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "unit_price" BIGINT NOT NULL,
    "unit_cost" BIGINT NOT NULL DEFAULT 0,
    "labor_hours" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "discount_percent" DECIMAL(7,4),
    "vat_regime" TEXT NOT NULL,

    CONSTRAINT "change_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_costs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "budget_line_id" UUID,
    "category" "CostCategory" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "project_id" UUID,
    "body" TEXT NOT NULL,
    "mentions" UUID[] DEFAULT ARRAY[]::UUID[],
    "author_user_id" UUID,
    "author_portal_token_id" UUID,
    "author_label" TEXT NOT NULL,
    "visible_to_client" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_orders_tenant_id_status_idx" ON "change_orders"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_project_id_ordinal_key" ON "change_orders"("project_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_tenant_id_number_key" ON "change_orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "change_order_lines_change_order_id_position_idx" ON "change_order_lines"("change_order_id", "position");

-- CreateIndex
CREATE INDEX "project_costs_tenant_id_project_id_idx" ON "project_costs"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_costs_tenant_id_category_source_type_source_id_key" ON "project_costs"("tenant_id", "category", "source_type", "source_id");

-- CreateIndex
CREATE INDEX "comments_tenant_id_subject_type_subject_id_created_at_idx" ON "comments"("tenant_id", "subject_type", "subject_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_tenant_id_project_id_created_at_idx" ON "comments"("tenant_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "portal_tokens_tenant_id_project_id_idx" ON "portal_tokens"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_change_order_line_id_key" ON "tasks"("change_order_line_id");

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_lines" ADD CONSTRAINT "change_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_order_lines" ADD CONSTRAINT "change_order_lines_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "change_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Isolation multi-tenant (CLAUDE.md règle n°1).
SELECT rls.enable_tenant_isolation('"change_orders"');
SELECT rls.enable_tenant_isolation('"change_order_lines"');
SELECT rls.enable_tenant_isolation('"project_costs"');
SELECT rls.enable_tenant_isolation('"comments"');

-- Recherche instantanée (liste des chantiers, ⌘K).
CREATE INDEX projects_search_idx ON "projects" USING gin (rls.search_text("number", "name") gin_trgm_ops);
CREATE INDEX timeline_entries_change_order_idx ON "timeline_entries" ("tenant_id", "change_order_id");
