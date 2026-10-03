/**
 * Comptabilité (03 §13, 02 P12) : connexion Chift, paramétrage (comptes, journaux, codes TVA),
 * statut de synchronisation par document, reprise sur erreur.
 */
import { z } from 'zod';
import { CentsSchema, Uuid } from './common';

const IsoDay = z.iso.date();

export const AccountingSyncStatusSchema = z.enum(['waiting', 'pending', 'synced', 'error']);
export const AccountingDocumentTypeSchema = z.enum([
  'invoice',
  'supplier_invoice',
  'payment',
  'supplier_payment',
]);

export const AccountingEntryLineSchema = z.object({
  account: z.string(),
  label: z.string(),
  debit: CentsSchema,
  credit: CentsSchema,
  vatCode: z.string().nullable(),
  vatGrid: z.string().nullable(),
});

export const AccountingSyncSchema = z.object({
  id: Uuid,
  documentType: AccountingDocumentTypeSchema,
  documentId: Uuid,
  number: z.string(),
  date: IsoDay,
  partner: z.string(),
  amount: CentsSchema,
  status: AccountingSyncStatusSchema,
  externalId: z.string().nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  syncedAt: z.string().nullable(),
  journal: z.string().nullable(),
  lines: z.array(AccountingEntryLineSchema),
  link: z.string(),
});
export type AccountingSyncDto = z.infer<typeof AccountingSyncSchema>;

const Code = z.string().trim().min(1).max(20);

export const AccountingMappingSchema = z.object({
  accounts: z.object({
    customers: Code,
    suppliers: Code,
    sales: Code,
    purchasesMaterials: Code,
    purchasesSubcontracting: Code,
    vatDue: Code,
    vatDeductible: Code,
    bank: Code,
    withholding: Code,
  }),
  journals: z.object({ sales: Code, creditNotes: Code, purchases: Code, bank: Code }),
  salesVatCodes: z.object({
    standard_21: Code,
    intermediate_12: Code,
    reduced_6: Code,
    zero: Code,
    reverse_charge: Code,
    exempt: Code,
    intra_community: Code,
    export: Code,
  }),
  purchaseVatCodes: z.object({
    '21': Code,
    '12': Code,
    '6': Code,
    '0': Code,
    reverse_charge: Code,
    intra_community: Code,
  }),
});
export type AccountingMappingDto = z.infer<typeof AccountingMappingSchema>;

export const AccountingOverviewSchema = z.object({
  connection: z.object({
    status: z.enum(['not_connected', 'pending', 'active', 'error']),
    provider: z.string(),
    software: z.string().nullable(),
    connectedAt: z.string().nullable(),
    lastError: z.string().nullable(),
  }),
  counts: z.object({
    waiting: z.number().int(),
    pending: z.number().int(),
    synced: z.number().int(),
    error: z.number().int(),
  }),
  mapping: AccountingMappingSchema,
  /** Référentiels du logiciel comptable pour le paramétrage (vides tant que non connecté). */
  ledger: z.object({
    accounts: z.array(z.object({ number: z.string(), label: z.string() })),
    journals: z.array(z.object({ code: z.string(), label: z.string(), type: z.string() })),
    vatCodes: z.array(
      z.object({ code: z.string(), label: z.string(), ratePercent: z.string(), scope: z.string() }),
    ),
  }),
});
export type AccountingOverviewDto = z.infer<typeof AccountingOverviewSchema>;

export const AccountingSyncQuerySchema = z.object({
  status: AccountingSyncStatusSchema.optional(),
  type: AccountingDocumentTypeSchema.optional(),
  from: IsoDay.optional(),
  to: IsoDay.optional(),
});

/** Exports du comptable par période (P12). */
export const AccountingExportSchema = z.enum([
  'sales',
  'purchases',
  'payments',
  'sales-ubl',
  'purchases-documents',
]);
export type AccountingExport = z.infer<typeof AccountingExportSchema>;
