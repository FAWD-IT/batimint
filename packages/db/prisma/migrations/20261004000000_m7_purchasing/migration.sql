-- M7 — Achats et Peppol entrant : bons de commande, réceptions, factures fournisseurs, ventilation.
-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('draft', 'sent', 'partially_received', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "SupplierInvoiceSource" AS ENUM ('peppol', 'upload', 'email');

-- CreateEnum
CREATE TYPE "SupplierInvoiceState" AS ENUM ('received', 'to_allocate', 'allocated', 'validated', 'to_pay', 'blocked', 'paid');

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "number" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'draft',
    "expected_on" DATE,
    "delivery_address" TEXT,
    "notes" TEXT,
    "total_net" BIGINT NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(3),
    "sent_to" TEXT,
    "pdf_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "supplier_code" TEXT,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "budget_line_id" UUID,
    "source_key" TEXT,
    "received_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" UUID,
    "note" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source" "SupplierInvoiceSource" NOT NULL,
    "external_id" TEXT,
    "supplier_id" UUID,
    "supplier_name" TEXT NOT NULL,
    "supplier_vat" TEXT,
    "number" TEXT,
    "issue_date" DATE,
    "due_date" DATE,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "total_net" BIGINT NOT NULL DEFAULT 0,
    "total_vat" BIGINT NOT NULL DEFAULT 0,
    "total_gross" BIGINT NOT NULL DEFAULT 0,
    "order_reference" TEXT,
    "delivery_address" TEXT,
    "notes" TEXT,
    "status" "SupplierInvoiceState" NOT NULL DEFAULT 'received',
    "match_method" TEXT,
    "match_confidence" DECIMAL(4,3),
    "purchase_order_id" UUID,
    "project_id" UUID,
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "discrepancies" JSONB NOT NULL DEFAULT '[]',
    "document_key" TEXT,
    "document_type" TEXT,
    "extraction" JSONB,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocated_at" TIMESTAMPTZ(3),
    "allocated_by" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "validated_by" UUID,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "supplier_code" TEXT,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "unit_price" BIGINT NOT NULL DEFAULT 0,
    "net" BIGINT NOT NULL DEFAULT 0,
    "vat_rate" DECIMAL(5,2),

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "budget_line_id" UUID,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "cost_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_project_id_idx" ON "purchase_orders"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_supplier_id_idx" ON "purchase_orders"("tenant_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_number_key" ON "purchase_orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_purchase_order_id_idx" ON "purchase_order_lines"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipts_tenant_id_purchase_order_id_idx" ON "goods_receipts"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "supplier_invoices_tenant_id_status_idx" ON "supplier_invoices"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "supplier_invoices_tenant_id_supplier_id_idx" ON "supplier_invoices"("tenant_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_tenant_id_external_id_key" ON "supplier_invoices"("tenant_id", "external_id");

-- CreateIndex
CREATE INDEX "supplier_invoice_lines_tenant_id_invoice_id_idx" ON "supplier_invoice_lines"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "cost_allocations_tenant_id_invoice_id_idx" ON "cost_allocations"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "cost_allocations_tenant_id_project_id_idx" ON "cost_allocations"("tenant_id", "project_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocations" ADD CONSTRAINT "cost_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS (CLAUDE.md règle n°1)
SELECT rls.enable_tenant_isolation('"purchase_orders"');
SELECT rls.enable_tenant_isolation('"purchase_order_lines"');
SELECT rls.enable_tenant_isolation('"goods_receipts"');
SELECT rls.enable_tenant_isolation('"supplier_invoices"');
SELECT rls.enable_tenant_isolation('"supplier_invoice_lines"');
SELECT rls.enable_tenant_isolation('"cost_allocations"');
