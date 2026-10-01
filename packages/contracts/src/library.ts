import { IMPORT_FIELDS, ITEM_KINDS } from '@batimint/domain';
import { z } from 'zod';
import { CentsSchema, DecimalString, Uuid } from './common';

export const VatRateChoice = z.enum(['auto', 'standard_21', 'intermediate_12', 'reduced_6', 'zero']);

export const ItemSchema = z
  .object({
    id: Uuid,
    code: z.string(),
    kind: z.enum(ITEM_KINDS),
    name: z.string(),
    description: z.string().nullable(),
    unit: z.string(),
    /** Prix de revient (absent pour les rôles sans accès aux prix). */
    purchasePrice: CentsSchema.optional(),
    salePrice: CentsSchema.nullable().optional(),
    /** Prix de vente effectif (forcé ou calculé par coefficient). */
    effectiveSalePrice: CentsSchema.optional(),
    saleCoefficient: DecimalString.nullable().optional(),
    vatRate: VatRateChoice,
    laborHours: DecimalString,
    trade: z.string().nullable(),
    category: z.string().nullable(),
    supplierId: Uuid.nullable(),
    supplierName: z.string().nullable(),
    archived: z.boolean(),
    components: z
      .array(
        z.object({
          itemId: Uuid,
          code: z.string(),
          name: z.string(),
          unit: z.string(),
          quantity: DecimalString,
          unitCost: CentsSchema.optional(),
        }),
      )
      .optional(),
    usedInCount: z.number().int(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Item' });
export type ItemDto = z.infer<typeof ItemSchema>;

export const ItemInputSchema = z.object({
  id: Uuid.optional(),
  code: z.string().trim().min(1).max(60),
  kind: z.enum(ITEM_KINDS),
  name: z.string().trim().min(2).max(300),
  description: z.string().trim().max(5000).nullable().optional(),
  unit: z.string().trim().min(1).max(12),
  purchasePrice: CentsSchema.min(0).optional(),
  salePrice: CentsSchema.min(0).nullable().optional(),
  saleCoefficient: DecimalString.nullable().optional(),
  vatRate: VatRateChoice.optional(),
  laborHours: DecimalString.optional(),
  trade: z.string().trim().max(40).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  supplierId: Uuid.nullable().optional(),
  supplierCode: z.string().trim().max(60).nullable().optional(),
  components: z
    .array(z.object({ itemId: Uuid, quantity: DecimalString }))
    .max(100)
    .optional(),
});

export const PriceHistorySchema = z.object({
  purchasePrice: CentsSchema,
  salePrice: CentsSchema.nullable(),
  source: z.string(),
  changedAt: z.string(),
});

export const ImportMappingSchema = z.partialRecord(z.enum(IMPORT_FIELDS), z.number().int().min(0).max(200));

export const ImportPreviewSchema = z
  .object({
    fileId: z.string(),
    fileName: z.string(),
    headers: z.array(z.string()),
    sampleRows: z.array(z.array(z.string())),
    totalRows: z.number().int(),
    suggestedMapping: ImportMappingSchema,
  })
  .meta({ id: 'ImportPreview' });

export const ImportRequestSchema = z.object({
  fileId: z.string().regex(/^[0-9a-f-]{36}\.(csv|xlsx)$/),
  mapping: ImportMappingSchema,
  dryRun: z.boolean().default(false),
  trade: z.string().trim().max(40).nullable().optional(),
});

export const ImportReportSchema = z
  .object({
    dryRun: z.boolean(),
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    errors: z.array(z.object({ row: z.number().int(), field: z.string().nullable(), message: z.string() })),
    durationMs: z.number().int(),
  })
  .meta({ id: 'ImportReport' });

export const SupplierSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    enterpriseNumber: z.string().nullable(),
    vatNumber: z.string().nullable(),
    email: z.string().nullable(),
    orderEmail: z.string().nullable(),
    phone: z.string().nullable(),
    city: z.string().nullable(),
    paymentTermsDays: z.number().int(),
    isSubcontractor: z.boolean(),
  })
  .meta({ id: 'Supplier' });

export const SupplierInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  enterpriseNumber: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().max(254).nullable().optional(),
  orderEmail: z.string().trim().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  street: z.string().trim().max(160).nullable().optional(),
  postalCode: z.string().trim().max(10).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(120).optional(),
  isSubcontractor: z.boolean().optional(),
});
