/**
 * Sous-traitance et conformité (03 §9, 05 §7, 02 P9) : sous-traitants, documents obligatoires,
 * contrats par poste, consultations 30bis, déclaration de travaux et portail sous-traitant.
 */
import { z } from 'zod';
import { CentsSchema, DecimalString, Uuid } from './common';

const IsoDay = z.iso.date();
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const SubcontractorDocumentKindSchema = z.enum([
  'rc_insurance',
  'social_certificate',
  'tax_certificate',
  'access_certificate',
  'other',
]);
export type SubcontractorDocumentKind = z.infer<typeof SubcontractorDocumentKindSchema>;

export const DocumentValiditySchema = z.enum(['valid', 'expiring', 'expired', 'missing']);

export const SubcontractorDocumentSchema = z.object({
  id: Uuid,
  kind: SubcontractorDocumentKindSchema,
  label: z.string().nullable(),
  expiresOn: IsoDay.nullable(),
  status: DocumentValiditySchema.exclude(['missing']),
  fileName: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  source: z.enum(['office', 'portal']),
  url: z.string(),
  createdAt: z.string(),
});
export type SubcontractorDocumentDto = z.infer<typeof SubcontractorDocumentSchema>;

export const DocumentRequirementSchema = z.object({
  kind: SubcontractorDocumentKindSchema,
  status: DocumentValiditySchema,
  expiresOn: IsoDay.nullable(),
  documentId: Uuid.nullable(),
});

export const ComplianceSchema = z.object({
  compliant: z.boolean(),
  issues: z.number().int(),
  requirements: z.array(DocumentRequirementSchema),
});
export type ComplianceDto = z.infer<typeof ComplianceSchema>;

export const ThirtyBisContextSchema = z.enum(['contract', 'invoice_received', 'payment', 'manual']);

export const ThirtyBisCheckSchema = z.object({
  id: Uuid,
  context: ThirtyBisContextSchema,
  enterpriseNumber: z.string(),
  hasSocialDebt: z.boolean(),
  hasTaxDebt: z.boolean(),
  socialDebtAmount: CentsSchema.nullable(),
  taxDebtAmount: CentsSchema.nullable(),
  provider: z.string(),
  reference: z.string(),
  checkedAt: z.string(),
  proofUrl: z.string().nullable(),
  subcontractNumber: z.string().nullable(),
  supplierInvoiceNumber: z.string().nullable(),
});
export type ThirtyBisCheckDto = z.infer<typeof ThirtyBisCheckSchema>;

export const InstallmentSchema = z.object({
  label: z.string(),
  percent: DecimalString,
  amount: CentsSchema,
  dueOn: IsoDay.nullable(),
});

export const SubcontractStatusSchema = z.enum(['active', 'completed', 'cancelled']);

export const SubcontractSchema = z.object({
  id: Uuid,
  number: z.string(),
  status: SubcontractStatusSchema,
  title: z.string(),
  scope: z.string().nullable(),
  amount: CentsSchema,
  startDate: IsoDay.nullable(),
  endDate: IsoDay.nullable(),
  installments: z.array(InstallmentSchema),
  project: z.object({ id: Uuid, number: z.string(), name: z.string() }),
  budgetLine: z.object({ id: Uuid, label: z.string() }).nullable(),
  supplier: z.object({
    id: Uuid,
    name: z.string(),
    enterpriseNumber: z.string().nullable(),
    email: z.string().nullable(),
  }),
  /** Montant HTVA déjà facturé par le sous-traitant sur ce contrat. */
  invoiced: CentsSchema,
  /** Retenues 30bis appliquées sur ce contrat (social + fiscal). */
  withheld: CentsSchema,
  creationCheck: ThirtyBisCheckSchema.nullable(),
  lastCheck: ThirtyBisCheckSchema.nullable(),
  compliance: ComplianceSchema,
  pdfUrl: z.string(),
  invoices: z.array(
    z.object({
      id: Uuid,
      number: z.string().nullable(),
      status: z.string(),
      totalNet: CentsSchema,
      totalGross: CentsSchema,
      withholding: CentsSchema,
      receivedAt: z.string(),
    }),
  ),
  createdAt: z.string(),
});
export type SubcontractDto = z.infer<typeof SubcontractSchema>;

export const SubcontractSummarySchema = SubcontractSchema.omit({ invoices: true, installments: true });
export type SubcontractSummaryDto = z.infer<typeof SubcontractSummarySchema>;

export const InstallmentInputSchema = z.object({
  label: z.string().trim().max(120),
  percent: DecimalString,
  dueOn: IsoDay.nullable().optional(),
});

export const SubcontractInputSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  budgetLineId: Uuid.nullable().optional(),
  supplierId: Uuid,
  title: z.string().trim().min(1).max(200),
  scope: optText(4000),
  amount: CentsSchema.min(1),
  startDate: IsoDay.nullable().optional(),
  endDate: IsoDay.nullable().optional(),
  installments: z.array(InstallmentInputSchema).max(12).default([]),
});
export type SubcontractInput = z.input<typeof SubcontractInputSchema>;

export const SubcontractUpdateSchema = SubcontractInputSchema.omit({
  id: true,
  projectId: true,
  supplierId: true,
  installments: true,
})
  .partial()
  .extend({ installments: z.array(InstallmentInputSchema).max(12).optional() });

export const SubcontractorSummarySchema = z.object({
  id: Uuid,
  name: z.string(),
  enterpriseNumber: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  compliance: ComplianceSchema,
  lastCheck: ThirtyBisCheckSchema.nullable(),
  activeContracts: z.number().int(),
  contractedAmount: CentsSchema,
  portalInvitedAt: z.string().nullable(),
});
export type SubcontractorSummaryDto = z.infer<typeof SubcontractorSummarySchema>;

export const SubcontractorDetailSchema = SubcontractorSummarySchema.extend({
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  iban: z.string().nullable(),
  documents: z.array(SubcontractorDocumentSchema),
  contracts: z.array(SubcontractSummarySchema),
  checks: z.array(ThirtyBisCheckSchema),
});
export type SubcontractorDetailDto = z.infer<typeof SubcontractorDetailSchema>;

export const WorksDeclarationSchema = z.object({
  required: z.boolean(),
  reasons: z.array(z.enum(['amount', 'subcontractor'])),
  declaredAt: z.string().nullable(),
  reference: z.string().nullable(),
  /** Données pré-remplies pour le formulaire ONSS. */
  data: z.object({
    projectNumber: z.string(),
    projectName: z.string(),
    address: z.string().nullable(),
    startDate: IsoDay.nullable(),
    endDate: IsoDay.nullable(),
    contractAmount: CentsSchema,
    workplaceTotalAmount: CentsSchema.nullable(),
    principal: z.object({ name: z.string(), enterpriseNumber: z.string().nullable() }),
    contractor: z.object({ name: z.string(), enterpriseNumber: z.string().nullable() }),
    subcontractors: z.array(
      z.object({
        name: z.string(),
        enterpriseNumber: z.string().nullable(),
        title: z.string(),
        amount: CentsSchema,
        startDate: IsoDay.nullable(),
      }),
    ),
  }),
});
export type WorksDeclarationDto = z.infer<typeof WorksDeclarationSchema>;

export const WorksDeclarationInputSchema = z.object({
  reference: z.string().trim().min(3).max(60),
  declaredOn: IsoDay,
});

/* ------------------------------------------------------------------------------------------ */
/* Portail sous-traitant (/s/[token]) : vouvoiement                                           */

export const PortalSubcontractorSchema = z.object({
  tenant: z.object({
    name: z.string(),
    accent: z.string(),
    logoUrl: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  subcontractor: z.object({ name: z.string(), enterpriseNumber: z.string().nullable() }),
  missions: z.array(
    z.object({
      id: Uuid,
      number: z.string(),
      status: SubcontractStatusSchema,
      title: z.string(),
      scope: z.string().nullable(),
      amount: CentsSchema,
      invoiced: CentsSchema,
      startDate: IsoDay.nullable(),
      endDate: IsoDay.nullable(),
      project: z.object({ name: z.string(), address: z.string().nullable() }),
      contact: z.object({ name: z.string(), phone: z.string().nullable() }).nullable(),
      installments: z.array(InstallmentSchema),
      pdfUrl: z.string(),
    }),
  ),
  compliance: ComplianceSchema,
  documents: z.array(SubcontractorDocumentSchema),
  invoices: z.array(
    z.object({
      id: Uuid,
      number: z.string().nullable(),
      missionNumber: z.string().nullable(),
      totalGross: CentsSchema,
      /** `received`, `processing`, `approved`, `paid`. */
      state: z.enum(['received', 'processing', 'approved', 'paid']),
      withholding: CentsSchema,
      receivedAt: z.string(),
      paidAt: z.string().nullable(),
    }),
  ),
});
export type PortalSubcontractorDto = z.infer<typeof PortalSubcontractorSchema>;
