-- CreateEnum
CREATE TYPE "ProgressStatementState" AS ENUM ('draft', 'submitted', 'approved', 'disputed', 'invoiced');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('transfer', 'bancontact', 'card', 'cash', 'online', 'other');

-- AlterEnum
ALTER TYPE "InvoiceType" ADD VALUE 'credit_note';

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'item';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amount_credited" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "amount_paid" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "buyer" JSONB,
ADD COLUMN     "credited_invoice_id" UUID,
ADD COLUMN     "delivered_at" TIMESTAMPTZ(3),
ADD COLUMN     "delivery_channel" TEXT,
ADD COLUMN     "delivery_message" TEXT,
ADD COLUMN     "delivery_status" TEXT,
ADD COLUMN     "intro" TEXT,
ADD COLUMN     "issue_date" DATE,
ADD COLUMN     "issued_by" UUID,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paid_at" TIMESTAMPTZ(3),
ADD COLUMN     "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "pdf_key" TEXT,
ADD COLUMN     "pdf_sha256" TEXT,
ADD COLUMN     "peppol_document_id" TEXT,
ADD COLUMN     "progress_statement_id" UUID,
ADD COLUMN     "reminders_paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retention_amount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "retention_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "seller" JSONB,
ADD COLUMN     "sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "sent_to" TEXT,
ADD COLUMN     "service_period_end" DATE,
ADD COLUMN     "service_period_start" DATE,
ADD COLUMN     "structured_communication" TEXT,
ADD COLUMN     "ubl_key" TEXT,
ADD COLUMN     "ubl_sha256" TEXT,
ADD COLUMN     "vat_breakdown" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "vat_mentions" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "retention_percent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "progress_statements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" "ProgressStatementState" NOT NULL DEFAULT 'draft',
    "period_end" DATE NOT NULL,
    "contract_amount" BIGINT NOT NULL DEFAULT 0,
    "previous_amount" BIGINT NOT NULL DEFAULT 0,
    "cumulative_amount" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_name" TEXT,
    "disputed_at" TIMESTAMPTZ(3),
    "dispute_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "progress_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_statement_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "budget_line_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "contract_amount" BIGINT NOT NULL,
    "previous_amount" BIGINT NOT NULL,
    "cumulative_amount" BIGINT NOT NULL,
    "cumulative_percent" DECIMAL(7,4) NOT NULL,
    "unit" TEXT,
    "total_quantity" DECIMAL(14,4),
    "cumulative_quantity" DECIMAL(14,4),

    CONSTRAINT "progress_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "received_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "external_id" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "expires_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dunning_steps" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "days_late" INTEGER NOT NULL,
    "balance" BIGINT NOT NULL,
    "fee" BIGINT NOT NULL DEFAULT 0,
    "interest" BIGINT NOT NULL DEFAULT 0,
    "sent_to" TEXT,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dunning_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "progress_statements_tenant_id_status_idx" ON "progress_statements"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "progress_statements_project_id_ordinal_key" ON "progress_statements"("project_id", "ordinal");

-- CreateIndex
CREATE INDEX "progress_statement_lines_tenant_id_statement_id_idx" ON "progress_statement_lines"("tenant_id", "statement_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_invoice_id_idx" ON "payments"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_external_id_key" ON "payments"("tenant_id", "external_id");

-- CreateIndex
CREATE INDEX "payment_links_tenant_id_invoice_id_idx" ON "payment_links"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_provider_external_id_key" ON "payment_links"("provider", "external_id");

-- CreateIndex
CREATE INDEX "dunning_steps_tenant_id_invoice_id_idx" ON "dunning_steps"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "dunning_steps_invoice_id_step_key" ON "dunning_steps"("invoice_id", "step");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_invoice_id_idx" ON "invoice_lines"("tenant_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_progress_statement_id_key" ON "invoices"("progress_statement_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_customer_id_idx" ON "invoices"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_credited_invoice_id_idx" ON "invoices"("tenant_id", "credited_invoice_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_statements" ADD CONSTRAINT "progress_statements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_statements" ADD CONSTRAINT "progress_statements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_statement_lines" ADD CONSTRAINT "progress_statement_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_statement_lines" ADD CONSTRAINT "progress_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "progress_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dunning_steps" ADD CONSTRAINT "dunning_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dunning_steps" ADD CONSTRAINT "dunning_steps_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Retenue de garantie des chantiers existants : reprise des paramètres du tenant.
UPDATE "projects" p SET "retention_percent" = COALESCE((t."settings"->>'retentionPercent')::numeric, 0)
FROM "tenants" t WHERE t."id" = p."tenant_id";

-- Règle n°4 : une facture émise est immuable (défense en profondeur, en plus de l'API).
CREATE OR REPLACE FUNCTION invoice_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'draft' AND (
    NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."type" <> OLD."type"
    OR NEW."customer_id" <> OLD."customer_id"
    OR NEW."issue_date" IS DISTINCT FROM OLD."issue_date"
    OR NEW."due_date" IS DISTINCT FROM OLD."due_date"
    OR NEW."total_net" <> OLD."total_net"
    OR NEW."total_vat" <> OLD."total_vat"
    OR NEW."total_gross" <> OLD."total_gross"
    OR NEW."retention_amount" <> OLD."retention_amount"
    OR NEW."vat_breakdown" IS DISTINCT FROM OLD."vat_breakdown"
    OR NEW."seller" IS DISTINCT FROM OLD."seller"
    OR NEW."buyer" IS DISTINCT FROM OLD."buyer"
    OR NEW."structured_communication" IS DISTINCT FROM OLD."structured_communication"
    OR NEW."status" = 'draft'
  ) THEN
    RAISE EXCEPTION 'La facture % est émise : elle ne se modifie plus (note de crédit).', OLD."number"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "invoices_immutable" BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoice_immutable();

CREATE OR REPLACE FUNCTION invoice_lines_immutable() RETURNS trigger AS $$
BEGIN
  IF (SELECT "status" FROM "invoices" WHERE "id" = OLD."invoice_id") <> 'draft' THEN
    RAISE EXCEPTION 'Les lignes d''une facture émise ne se modifient plus.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "invoice_lines_immutable" BEFORE UPDATE ON "invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_immutable();

-- RLS (CLAUDE.md règle n°1)
SELECT rls.enable_tenant_isolation('"progress_statements"');
SELECT rls.enable_tenant_isolation('"progress_statement_lines"');
SELECT rls.enable_tenant_isolation('"payments"');
SELECT rls.enable_tenant_isolation('"payment_links"');
SELECT rls.enable_tenant_isolation('"dunning_steps"');
