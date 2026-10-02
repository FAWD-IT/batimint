-- CreateEnum
CREATE TYPE "SubcontractState" AS ENUM ('active', 'completed', 'cancelled');

-- AlterTable
ALTER TABLE "portal_tokens" ADD COLUMN     "supplier_id" UUID;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "works_declaration_ref" TEXT,
ADD COLUMN     "works_declared_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "supplier_invoices" ADD COLUMN     "blocked_reason" TEXT,
ADD COLUMN     "subcontract_id" UUID,
ADD COLUMN     "thirty_bis_check_id" UUID,
ADD COLUMN     "transfer_doc_key" TEXT,
ADD COLUMN     "transfer_doc_sha256" TEXT,
ADD COLUMN     "withholding_applied_at" TIMESTAMPTZ(3),
ADD COLUMN     "withholding_social" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "withholding_tax" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "subcontracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "project_id" UUID NOT NULL,
    "budget_line_id" UUID,
    "supplier_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "amount" BIGINT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "status" "SubcontractState" NOT NULL DEFAULT 'active',
    "installments" JSONB NOT NULL DEFAULT '[]',
    "creation_check_id" UUID,
    "pdf_key" TEXT,
    "pdf_sha256" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "subcontracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thirty_bis_checks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID,
    "subcontract_id" UUID,
    "supplier_invoice_id" UUID,
    "context" TEXT NOT NULL,
    "enterprise_number" TEXT NOT NULL,
    "has_social_debt" BOOLEAN NOT NULL,
    "has_tax_debt" BOOLEAN NOT NULL,
    "social_debt_amount" BIGINT,
    "tax_debt_amount" BIGINT,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "response" JSONB NOT NULL DEFAULT '{}',
    "proof_key" TEXT,
    "proof_sha256" TEXT,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "thirty_bis_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "expires_on" DATE,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'office',
    "alert_state" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "subcontractor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subcontracts_tenant_id_project_id_idx" ON "subcontracts"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "subcontracts_tenant_id_supplier_id_idx" ON "subcontracts"("tenant_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "subcontracts_tenant_id_number_key" ON "subcontracts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "thirty_bis_checks_tenant_id_supplier_id_checked_at_idx" ON "thirty_bis_checks"("tenant_id", "supplier_id", "checked_at");

-- CreateIndex
CREATE INDEX "thirty_bis_checks_tenant_id_supplier_invoice_id_idx" ON "thirty_bis_checks"("tenant_id", "supplier_invoice_id");

-- CreateIndex
CREATE INDEX "subcontractor_documents_tenant_id_supplier_id_idx" ON "subcontractor_documents"("tenant_id", "supplier_id");

-- CreateIndex
CREATE INDEX "portal_tokens_tenant_id_supplier_id_idx" ON "portal_tokens"("tenant_id", "supplier_id");

-- CreateIndex
CREATE INDEX "supplier_invoices_tenant_id_subcontract_id_idx" ON "supplier_invoices"("tenant_id", "subcontract_id");

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thirty_bis_checks" ADD CONSTRAINT "thirty_bis_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thirty_bis_checks" ADD CONSTRAINT "thirty_bis_checks_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thirty_bis_checks" ADD CONSTRAINT "thirty_bis_checks_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_documents" ADD CONSTRAINT "subcontractor_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_documents" ADD CONSTRAINT "subcontractor_documents_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Isolation par tenant (règle n°1).
SELECT rls.enable_tenant_isolation('"subcontracts"');
SELECT rls.enable_tenant_isolation('"thirty_bis_checks"');
SELECT rls.enable_tenant_isolation('"subcontractor_documents"');

-- Preuve 30bis (05 §7) : le résultat d'une consultation ne se modifie jamais.
CREATE OR REPLACE FUNCTION thirty_bis_checks_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.enterprise_number IS DISTINCT FROM OLD.enterprise_number
     OR NEW.has_social_debt IS DISTINCT FROM OLD.has_social_debt
     OR NEW.has_tax_debt IS DISTINCT FROM OLD.has_tax_debt
     OR NEW.social_debt_amount IS DISTINCT FROM OLD.social_debt_amount
     OR NEW.tax_debt_amount IS DISTINCT FROM OLD.tax_debt_amount
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.response IS DISTINCT FROM OLD.response
     OR NEW.checked_at IS DISTINCT FROM OLD.checked_at
     OR (OLD.proof_sha256 IS NOT NULL AND NEW.proof_sha256 IS DISTINCT FROM OLD.proof_sha256) THEN
    RAISE EXCEPTION 'Une consultation 30bis est une preuve : elle ne se modifie pas.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER thirty_bis_checks_immutable
  BEFORE UPDATE ON "thirty_bis_checks"
  FOR EACH ROW EXECUTE FUNCTION thirty_bis_checks_immutable();
