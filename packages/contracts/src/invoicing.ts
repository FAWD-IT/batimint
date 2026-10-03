/**
 * Facturation et encaissement (03 §10, 02 P7, P8) : factures, notes de crédit, états
 * d'avancement, paiements, liens de paiement, relances, encours.
 */
import { z } from 'zod';
import { CentsSchema, DecimalString, Uuid } from './common';
import { VatRegimeSchema } from './quotes';

const IsoDay = z.iso.date();
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const InvoiceTypeSchema = z.enum([
  'deposit',
  'progress',
  'work_order',
  'final',
  'retention_release',
  'free',
  'credit_note',
]);
export type InvoiceType = z.infer<typeof InvoiceTypeSchema>;

export const InvoiceStatusSchema = z.enum([
  'draft',
  'issued',
  'sent',
  'delivered',
  'partially_paid',
  'paid',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// Brouillon (création, modification)
// ---------------------------------------------------------------------------

export const InvoiceLineInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  unit: z.string().trim().min(1).max(12),
  quantity: DecimalString,
  unitPrice: CentsSchema.min(0),
  vatRegime: VatRegimeSchema,
  budgetLineId: Uuid.nullable().optional(),
  kind: z.enum(['item', 'deduction']).default('item'),
});
export type InvoiceLineInput = z.input<typeof InvoiceLineInputSchema>;

export const InvoiceDraftInputSchema = z.object({
  id: Uuid,
  type: z.enum(['free', 'work_order', 'deposit', 'final']).default('free'),
  customerId: Uuid,
  projectId: Uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  intro: optText(2000),
  notes: optText(2000),
  paymentTermsDays: z.number().int().min(0).max(120).optional(),
  servicePeriodStart: IsoDay.nullable().optional(),
  servicePeriodEnd: IsoDay.nullable().optional(),
  lines: z.array(InvoiceLineInputSchema).min(1).max(300),
});
export type InvoiceDraftInput = z.input<typeof InvoiceDraftInputSchema>;

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

const InvoiceVatBreakdownSchema = z.object({
  category: z.string(),
  ratePercent: z.string(),
  taxableAmount: CentsSchema,
  taxAmount: CentsSchema,
});

export const InvoicePartySchema = z.object({
  name: z.string(),
  vatNumber: z.string().nullable(),
  enterpriseNumber: z.string().nullable(),
  address: z.string().nullable(),
  email: z.string().nullable(),
});

export const PaymentSchema = z.object({
  id: Uuid,
  amount: CentsSchema,
  receivedOn: IsoDay,
  method: z.enum(['transfer', 'bancontact', 'card', 'cash', 'online', 'other']),
  source: z.string(),
  reference: z.string().nullable(),
  createdAt: z.string(),
});
export type PaymentDto = z.infer<typeof PaymentSchema>;

export const DunningStepSchema = z.object({
  step: z.number().int(),
  kind: z.enum(['reminder', 'formal_notice']),
  daysLate: z.number().int(),
  fee: CentsSchema,
  interest: CentsSchema,
  sentTo: z.string().nullable(),
  sentAt: z.string(),
});

export const InvoiceSummarySchema = z.object({
  id: Uuid,
  type: InvoiceTypeSchema,
  status: InvoiceStatusSchema,
  number: z.string().nullable(),
  title: z.string(),
  customer: z.object({ id: Uuid, displayName: z.string(), kind: z.enum(['individual', 'company']) }),
  project: z.object({ id: Uuid, number: z.string(), name: z.string() }).nullable(),
  issueDate: IsoDay.nullable(),
  dueDate: IsoDay.nullable(),
  totalNet: CentsSchema,
  totalVat: CentsSchema,
  totalGross: CentsSchema,
  retentionAmount: CentsSchema,
  amountPaid: CentsSchema,
  amountCredited: CentsSchema,
  /** Reste à encaisser (TVAC − retenue − paiements − notes de crédit). */
  balance: CentsSchema,
  overdue: z.boolean(),
  daysLate: z.number().int(),
  deliveryChannel: z.enum(['peppol', 'email']).nullable(),
  deliveryStatus: z.string().nullable(),
  remindersSent: z.number().int(),
  createdAt: z.string(),
});
export type InvoiceSummaryDto = z.infer<typeof InvoiceSummarySchema>;

export const InvoiceLineSchema = z.object({
  id: Uuid,
  kind: z.enum(['item', 'deduction']),
  description: z.string(),
  unit: z.string(),
  quantity: DecimalString,
  unitPrice: CentsSchema,
  vatRegime: VatRegimeSchema,
  budgetLineId: Uuid.nullable(),
  netAmount: CentsSchema,
});

export const InvoiceSchema = InvoiceSummarySchema.extend({
  intro: z.string().nullable(),
  notes: z.string().nullable(),
  paymentTermsDays: z.number().int(),
  servicePeriodStart: IsoDay.nullable(),
  servicePeriodEnd: IsoDay.nullable(),
  structuredCommunication: z.string().nullable(),
  retentionPercent: DecimalString,
  vatBreakdown: z.array(InvoiceVatBreakdownSchema),
  vatMentions: z.array(z.string()),
  seller: InvoicePartySchema.nullable(),
  buyer: InvoicePartySchema.nullable(),
  lines: z.array(InvoiceLineSchema),
  payments: z.array(PaymentSchema),
  dunning: z.array(DunningStepSchema),
  remindersPaused: z.boolean(),
  creditedInvoice: z.object({ id: Uuid, number: z.string().nullable() }).nullable(),
  creditNotes: z.array(
    z.object({
      id: Uuid,
      number: z.string().nullable(),
      status: InvoiceStatusSchema,
      totalGross: CentsSchema,
    }),
  ),
  progressStatement: z.object({ id: Uuid, ordinal: z.number().int() }).nullable(),
  sentTo: z.string().nullable(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  deliveryMessage: z.string().nullable(),
  issuedAt: z.string().nullable(),
  /** Peut être émise maintenant ; sinon, la raison (attestation 6 % manquante, IBAN…). */
  issueBlockers: z.array(z.string()),
  pdfUrl: z.string().nullable(),
  ublUrl: z.string().nullable(),
  openPaymentLink: z.object({ url: z.string(), amount: CentsSchema }).nullable(),
});
export type InvoiceDto = z.infer<typeof InvoiceSchema>;

export const InvoiceListQuerySchema = z.object({
  view: z.enum(['draft', 'open', 'overdue', 'paid', 'all']).default('open'),
  projectId: Uuid.optional(),
  customerId: Uuid.optional(),
  q: z.string().trim().max(120).optional(),
});

export const InvoiceListSchema = z.object({
  items: z.array(InvoiceSummarySchema),
  counts: z.object({ draft: z.number().int(), open: z.number().int(), overdue: z.number().int() }),
  /** Encours (solde des factures émises non payées) et part échue. */
  receivable: CentsSchema,
  overdueAmount: CentsSchema,
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const PaymentInputSchema = z.object({
  id: Uuid,
  amount: CentsSchema.min(1),
  receivedOn: IsoDay,
  method: z.enum(['transfer', 'bancontact', 'card', 'cash', 'other']).default('transfer'),
  reference: optText(140),
});

export const CreditNoteInputSchema = z.object({
  id: Uuid,
  reason: z.string().trim().min(2).max(200),
  /** Absent : note de crédit totale. Sinon, un montant HTVA par ligne d'origine (index). */
  lines: z
    .array(z.object({ index: z.number().int().min(0), amount: CentsSchema.min(1) }))
    .min(1)
    .optional(),
});

export const ReceivablesSchema = z.object({
  total: CentsSchema,
  buckets: z.object({
    notDue: CentsSchema,
    d1_30: CentsSchema,
    d31_60: CentsSchema,
    d61_90: CentsSchema,
    over90: CentsSchema,
  }),
  customers: z.array(
    z.object({
      customer: z.object({ id: Uuid, displayName: z.string() }),
      total: CentsSchema,
      overdue: CentsSchema,
      oldestDaysLate: z.number().int(),
      invoices: z.number().int(),
    }),
  ),
});
export type ReceivablesDto = z.infer<typeof ReceivablesSchema>;

// ---------------------------------------------------------------------------
// États d'avancement (P7)
// ---------------------------------------------------------------------------

export const ProgressStatementStatusSchema = z.enum([
  'draft',
  'submitted',
  'approved',
  'disputed',
  'invoiced',
]);

export const ProgressLineSchema = z.object({
  budgetLineId: Uuid,
  label: z.string(),
  contractAmount: CentsSchema,
  previousAmount: CentsSchema,
  previousPercent: DecimalString,
  cumulativeAmount: CentsSchema,
  cumulativePercent: DecimalString,
  periodAmount: CentsSchema,
  unit: z.string().nullable(),
  totalQuantity: DecimalString.nullable(),
  cumulativeQuantity: DecimalString.nullable(),
  /** Avancement des tâches du poste (pré-remplissage). */
  taskPercent: DecimalString,
});
export type ProgressLineDto = z.infer<typeof ProgressLineSchema>;

export const ProgressStatementSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  ordinal: z.number().int(),
  status: ProgressStatementStatusSchema,
  periodEnd: IsoDay,
  note: z.string().nullable(),
  contractAmount: CentsSchema,
  previousAmount: CentsSchema,
  cumulativeAmount: CentsSchema,
  periodAmount: CentsSchema,
  cumulativePercent: DecimalString,
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  disputeReason: z.string().nullable(),
  invoice: z.object({ id: Uuid, number: z.string().nullable(), status: InvoiceStatusSchema }).nullable(),
  /** Le client doit approuver avant facturation (B2C, selon les paramètres). */
  approvalRequired: z.boolean(),
  lines: z.array(ProgressLineSchema),
});
export type ProgressStatementDto = z.infer<typeof ProgressStatementSchema>;

export const ProgressStatementInputSchema = z.object({
  id: Uuid,
  periodEnd: IsoDay,
  note: optText(2000),
  lines: z
    .array(
      z.object({
        budgetLineId: Uuid,
        mode: z.enum(['percent', 'quantity', 'amount']),
        value: DecimalString,
      }),
    )
    .min(1),
});
export type ProgressStatementInput = z.input<typeof ProgressStatementInputSchema>;

export const PortalStatementDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), signerName: z.string().trim().min(2).max(120) }),
  z.object({ decision: z.literal('dispute'), reason: z.string().trim().min(3).max(2000) }),
]);
