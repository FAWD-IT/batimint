/**
 * Achats et factures fournisseurs (03 §8, 02 P3.3, P6).
 */
import { z } from 'zod';
import { CentsSchema, DecimalString, Uuid } from './common';

const IsoDay = z.iso.date();
const optText = (max: number) => z.string().trim().max(max).nullable().optional();

export const PurchaseOrderLineInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  supplierCode: optText(60),
  unit: z.string().trim().min(1).max(12),
  quantity: DecimalString,
  unitPrice: CentsSchema.min(0),
  budgetLineId: Uuid.nullable().optional(),
  sourceKey: z.string().max(80).nullable().optional(),
});

export const PurchaseOrderInputSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  supplierId: Uuid,
  expectedOn: IsoDay.nullable().optional(),
  deliveryAddress: optText(300),
  notes: optText(2000),
  lines: z.array(PurchaseOrderLineInputSchema).min(1).max(200),
});
export type PurchaseOrderInput = z.input<typeof PurchaseOrderInputSchema>;

export const PurchaseOrderLineSchema = z.object({
  id: Uuid,
  description: z.string(),
  supplierCode: z.string().nullable(),
  unit: z.string(),
  quantity: DecimalString,
  unitPrice: CentsSchema,
  total: CentsSchema,
  budgetLineId: Uuid.nullable(),
  budgetLineLabel: z.string().nullable(),
  receivedQuantity: DecimalString,
  /** Ligne du devis d'origine (proposition de commande), conservée à l'édition du brouillon. */
  sourceKey: z.string().nullable(),
});

export const PurchaseOrderStatusSchema = z.enum([
  'draft',
  'sent',
  'partially_received',
  'received',
  'cancelled',
]);

export const PurchaseOrderSchema = z.object({
  id: Uuid,
  number: z.string().nullable(),
  status: PurchaseOrderStatusSchema,
  project: z.object({ id: Uuid, number: z.string(), name: z.string() }),
  supplier: z.object({ id: Uuid, name: z.string(), orderEmail: z.string().nullable() }),
  expectedOn: IsoDay.nullable(),
  deliveryAddress: z.string().nullable(),
  notes: z.string().nullable(),
  totalNet: CentsSchema,
  /** Déjà facturé sur ce BC (ventilations des factures rapprochées). */
  invoiced: CentsSchema,
  sentAt: z.string().nullable(),
  sentTo: z.string().nullable(),
  lines: z.array(PurchaseOrderLineSchema),
  createdAt: z.string(),
});
export type PurchaseOrderDto = z.infer<typeof PurchaseOrderSchema>;

export const PurchaseOrderSummarySchema = PurchaseOrderSchema.omit({ lines: true }).extend({
  lineCount: z.number().int(),
});
export type PurchaseOrderSummaryDto = z.infer<typeof PurchaseOrderSummarySchema>;

/** Matériaux du devis à commander, groupés par fournisseur (P3.3). */
export const OrderProposalSchema = z.object({
  groups: z.array(
    z.object({
      supplierId: Uuid.nullable(),
      supplierName: z.string().nullable(),
      total: CentsSchema,
      lines: z.array(
        PurchaseOrderLineInputSchema.extend({
          sourceKey: z.string(),
          budgetLineLabel: z.string().nullable(),
          alreadyOrdered: z.boolean(),
        }),
      ),
    }),
  ),
});
export type OrderProposalDto = z.infer<typeof OrderProposalSchema>;

export const PurchaseOrderSendSchema = z.object({
  email: z.email().optional(),
  message: optText(2000),
});

export const GoodsReceiptInputSchema = z.object({
  lines: z.array(z.object({ lineId: Uuid, quantity: DecimalString })).min(1),
  note: optText(1000),
});

// ---------------------------------------------------------------------------
// Factures fournisseurs
// ---------------------------------------------------------------------------

export const SupplierInvoiceStatusSchema = z.enum([
  'received',
  'to_allocate',
  'allocated',
  'validated',
  'to_pay',
  'blocked',
  'paid',
]);

export const DiscrepancySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('price'),
    description: z.string(),
    ordered: CentsSchema,
    invoiced: CentsSchema,
    percent: z.number(),
  }),
  z.object({
    kind: z.literal('quantity'),
    description: z.string(),
    ordered: z.string(),
    invoiced: z.string(),
  }),
  z.object({ kind: z.literal('unordered'), description: z.string(), amount: CentsSchema }),
  z.object({ kind: z.literal('total'), ordered: CentsSchema, invoiced: CentsSchema, percent: z.number() }),
]);
export type DiscrepancyDto = z.infer<typeof DiscrepancySchema>;

export const AllocationSuggestionSchema = z.object({
  projectId: Uuid,
  projectLabel: z.string(),
  budgetLineId: Uuid.nullable(),
  budgetLineLabel: z.string().nullable(),
  score: z.number(),
  reason: z.string(),
});

export const SupplierInvoiceSchema = z.object({
  id: Uuid,
  source: z.enum(['peppol', 'upload', 'email']),
  supplier: z.object({ id: Uuid.nullable(), name: z.string(), vatNumber: z.string().nullable() }),
  number: z.string().nullable(),
  issueDate: IsoDay.nullable(),
  dueDate: IsoDay.nullable(),
  totalNet: CentsSchema,
  totalVat: CentsSchema,
  totalGross: CentsSchema,
  orderReference: z.string().nullable(),
  /** Remarque libre du fournisseur (référence client, adresse, personne qui a enlevé). */
  notes: z.string().nullable(),
  status: SupplierInvoiceStatusSchema,
  matchMethod: z.string().nullable(),
  matchConfidence: z.number().nullable(),
  purchaseOrder: z.object({ id: Uuid, number: z.string().nullable() }).nullable(),
  project: z.object({ id: Uuid, number: z.string(), name: z.string() }).nullable(),
  suggestions: z.array(AllocationSuggestionSchema),
  discrepancies: z.array(DiscrepancySchema),
  allocations: z.array(
    z.object({
      id: Uuid,
      projectId: Uuid,
      projectLabel: z.string(),
      budgetLineId: Uuid.nullable(),
      budgetLineLabel: z.string().nullable(),
      amount: CentsSchema,
    }),
  ),
  lines: z.array(
    z.object({
      description: z.string(),
      supplierCode: z.string().nullable(),
      quantity: DecimalString,
      unitPrice: CentsSchema,
      net: CentsSchema,
      vatRate: z.string().nullable(),
    }),
  ),
  documentUrl: z.string().nullable(),
  receivedAt: z.string(),
});
export type SupplierInvoiceDto = z.infer<typeof SupplierInvoiceSchema>;

export const SupplierInvoiceSummarySchema = SupplierInvoiceSchema.omit({
  lines: true,
  allocations: true,
}).extend({
  allocatedProjects: z.array(z.string()),
});
export type SupplierInvoiceSummaryDto = z.infer<typeof SupplierInvoiceSummarySchema>;

/** Ventilation manuelle (boîte « À imputer ») : la somme doit égaler le total HTVA. */
export const AllocationInputSchema = z.object({
  allocations: z
    .array(z.object({ projectId: Uuid, budgetLineId: Uuid.nullable(), amount: CentsSchema.min(1) }))
    .min(1)
    .max(50),
});

/** Simulation d'une facture reçue par Peppol (fournisseur d'accès en mode mock). */
export const PeppolSimulationSchema = z.object({
  supplierId: Uuid,
  number: z.string().trim().min(1).max(40),
  orderReference: optText(60),
  buyerReference: optText(60),
  note: optText(500),
  deliveryAddress: z
    .object({
      street: z.string().trim().min(1),
      postalCode: z.string().trim().min(4),
      city: z.string().trim().min(1),
    })
    .nullable()
    .optional(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1),
        supplierCode: optText(60),
        quantity: DecimalString,
        unitPrice: CentsSchema.min(0),
        vatRate: z.enum(['0', '6', '12', '21']).default('21'),
      }),
    )
    .min(1),
});
