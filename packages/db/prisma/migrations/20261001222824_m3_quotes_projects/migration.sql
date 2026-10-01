-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('draft', 'sent', 'viewed', 'signed', 'refused', 'expired', 'superseded');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('preparation', 'in_progress', 'suspended', 'provisional_acceptance', 'final_acceptance', 'closed');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('deposit', 'progress', 'work_order', 'final', 'retention_release', 'free');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'sent', 'delivered', 'partially_paid', 'paid', 'cancelled');

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "customer_id" UUID,
    "site_id" UUID,
    "opportunity_id" UUID,
    "status" "QuoteStatus" NOT NULL DEFAULT 'draft',
    "current_version_id" UUID,
    "validity_days" INTEGER NOT NULL DEFAULT 30,
    "valid_until" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "viewed_at" TIMESTAMPTZ(3),
    "signed_at" TIMESTAMPTZ(3),
    "refused_at" TIMESTAMPTZ(3),
    "refusal_reason" TEXT,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "owner_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'draft',
    "intro" TEXT,
    "notes" TEXT,
    "global_discount_percent" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "deposit_kind" TEXT,
    "deposit_value" DECIMAL(16,4),
    "payment_schedule" JSONB NOT NULL DEFAULT '[]',
    "vat_context" JSONB NOT NULL DEFAULT '{}',
    "total_net" BIGINT NOT NULL DEFAULT 0,
    "total_vat" BIGINT NOT NULL DEFAULT 0,
    "total_gross" BIGINT NOT NULL DEFAULT 0,
    "total_cost" BIGINT NOT NULL DEFAULT 0,
    "deposit_amount" BIGINT NOT NULL DEFAULT 0,
    "pdf_key" TEXT,
    "pdf_sha256" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_sections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "quote_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'item',
    "item_id" UUID,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'u',
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "unit_price" BIGINT NOT NULL DEFAULT 0,
    "unit_cost" BIGINT NOT NULL DEFAULT 0,
    "labor_hours" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "vat_regime" TEXT NOT NULL,
    "vat_suggested" TEXT NOT NULL,
    "vat_justification" TEXT,
    "discount_percent" DECIMAL(6,4) NOT NULL DEFAULT 0,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signer_email" TEXT,
    "signature_image" TEXT,
    "accepted_terms" BOOLEAN NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "document_sha256" TEXT NOT NULL,
    "document_key" TEXT,
    "portal_token_id" UUID,
    "signed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_certificates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "site_id" UUID,
    "project_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "first_occupancy_year" INTEGER,
    "declarations" JSONB NOT NULL DEFAULT '{}',
    "signature_id" UUID,
    "signed_at" TIMESTAMPTZ(3),
    "pdf_key" TEXT,
    "pdf_sha256" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vat_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "quote_id" UUID,
    "project_id" UUID,
    "customer_id" UUID,
    "email" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "portal_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "site_id" UUID,
    "quote_id" UUID,
    "opportunity_id" UUID,
    "status" "ProjectStatus" NOT NULL DEFAULT 'preparation',
    "contract_amount" BIGINT NOT NULL DEFAULT 0,
    "manager_user_id" UUID,
    "start_date" DATE,
    "end_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "quote_section_key" UUID,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "budgeted_cost" BIGINT NOT NULL DEFAULT 0,
    "sale_amount" BIGINT NOT NULL DEFAULT 0,
    "labor_hours" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "budget_line_id" UUID,
    "quote_line_key" UUID,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "quantity" DECIMAL(14,4),
    "unit" TEXT,
    "planned_hours" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "customer_id" UUID NOT NULL,
    "quote_id" UUID,
    "type" "InvoiceType" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "number" TEXT,
    "title" TEXT NOT NULL,
    "total_net" BIGINT NOT NULL DEFAULT 0,
    "total_vat" BIGINT NOT NULL DEFAULT 0,
    "total_gross" BIGINT NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ(3),
    "due_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'u',
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "unit_price" BIGINT NOT NULL,
    "vat_regime" TEXT NOT NULL,
    "budget_line_id" UUID,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "customer_id" UUID,
    "opportunity_id" UUID,
    "quote_id" UUID,
    "project_id" UUID,
    "visible_to_client" BOOLEAN NOT NULL DEFAULT false,
    "actor_label" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotes_tenant_id_status_idx" ON "quotes"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "quotes_opportunity_id_idx" ON "quotes"("opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_tenant_id_number_key" ON "quotes"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_quote_id_version_key" ON "quote_versions"("quote_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "quote_sections_version_id_key_key" ON "quote_sections"("version_id", "key");

-- CreateIndex
CREATE INDEX "quote_lines_section_id_idx" ON "quote_lines"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_lines_version_id_key_key" ON "quote_lines"("version_id", "key");

-- CreateIndex
CREATE INDEX "signatures_subject_type_subject_id_idx" ON "signatures"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "vat_certificates_quote_id_key" ON "vat_certificates"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_tokens_token_hash_key" ON "portal_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "portal_tokens_tenant_id_quote_id_idx" ON "portal_tokens"("tenant_id", "quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_quote_id_key" ON "projects"("quote_id");

-- CreateIndex
CREATE INDEX "projects_tenant_id_status_idx" ON "projects"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "projects_tenant_id_number_key" ON "projects"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_project_id_quote_section_key_key" ON "budget_lines"("project_id", "quote_section_key");

-- CreateIndex
CREATE INDEX "tasks_project_id_position_idx" ON "tasks"("project_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_project_id_quote_line_key_key" ON "tasks"("project_id", "quote_line_key");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_status_idx" ON "invoices"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_number_key" ON "invoices"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_quote_id_type_key" ON "invoices"("quote_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "timeline_entries_event_id_key" ON "timeline_entries"("event_id");

-- CreateIndex
CREATE INDEX "timeline_entries_tenant_id_project_id_occurred_at_idx" ON "timeline_entries"("tenant_id", "project_id", "occurred_at");

-- CreateIndex
CREATE INDEX "timeline_entries_tenant_id_quote_id_idx" ON "timeline_entries"("tenant_id", "quote_id");

-- CreateIndex
CREATE INDEX "timeline_entries_tenant_id_customer_id_idx" ON "timeline_entries"("tenant_id", "customer_id");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_sections" ADD CONSTRAINT "quote_sections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_sections" ADD CONSTRAINT "quote_sections_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quote_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quote_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "quote_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_certificates" ADD CONSTRAINT "vat_certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_certificates" ADD CONSTRAINT "vat_certificates_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolation multi-tenant (CLAUDE.md règle 1)
SELECT rls.enable_tenant_isolation('"quotes"');
SELECT rls.enable_tenant_isolation('"quote_versions"');
SELECT rls.enable_tenant_isolation('"quote_sections"');
SELECT rls.enable_tenant_isolation('"quote_lines"');
SELECT rls.enable_tenant_isolation('"signatures"');
SELECT rls.enable_tenant_isolation('"vat_certificates"');
SELECT rls.enable_tenant_isolation('"portal_tokens"');
SELECT rls.enable_tenant_isolation('"projects"');
SELECT rls.enable_tenant_isolation('"budget_lines"');
SELECT rls.enable_tenant_isolation('"tasks"');
SELECT rls.enable_tenant_isolation('"invoices"');
SELECT rls.enable_tenant_isolation('"invoice_lines"');
SELECT rls.enable_tenant_isolation('"timeline_entries"');

-- Les signatures sont des preuves : ajout seul, comme le journal d'audit.
CREATE TRIGGER signatures_append_only
  BEFORE UPDATE OR DELETE ON "signatures"
  FOR EACH ROW WHEN (current_setting('app.allow_tenant_purge', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION rls.forbid_mutation();

-- Recherche des devis par numéro ou intitulé.
CREATE INDEX quotes_search_idx ON "quotes" USING gin (rls.search_text(coalesce("number", ''), "title") gin_trgm_ops);
