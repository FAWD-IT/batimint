-- CreateEnum
CREATE TYPE "AccountingDocumentType" AS ENUM ('invoice', 'supplier_invoice', 'payment', 'supplier_payment');

-- CreateTable
CREATE TABLE "accounting_syncs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_type" "AccountingDocumentType" NOT NULL,
    "document_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "partner_name" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "external_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "entry" JSONB,
    "last_attempt_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounting_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_syncs_tenant_id_status_idx" ON "accounting_syncs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "accounting_syncs_tenant_id_document_date_idx" ON "accounting_syncs"("tenant_id", "document_date");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_syncs_tenant_id_document_type_document_id_key" ON "accounting_syncs"("tenant_id", "document_type", "document_id");

-- AddForeignKey
ALTER TABLE "accounting_syncs" ADD CONSTRAINT "accounting_syncs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Isolation par tenant (règle n°1).
SELECT rls.enable_tenant_isolation('"accounting_syncs"');
