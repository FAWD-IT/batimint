import { QUOTE_LINE_KINDS, VAT_REGIME_LIST } from '@batimint/domain';
import { z } from 'zod';
import { CentsSchema, DecimalString, Uuid } from './common';

export const VatRegimeSchema = z.enum(VAT_REGIME_LIST as [string, ...string[]]);
export const QuoteStatusSchema = z.enum([
  'draft',
  'sent',
  'viewed',
  'signed',
  'refused',
  'expired',
  'superseded',
]);

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

// ---------------------------------------------------------------------------
// Contenu d'une version (éditeur)
// ---------------------------------------------------------------------------

export const QuoteLineSchema = z.object({
  id: Uuid,
  key: Uuid,
  kind: z.enum(QUOTE_LINE_KINDS),
  itemId: Uuid.nullable(),
  code: z.string().nullable(),
  description: z.string(),
  unit: z.string(),
  quantity: DecimalString,
  unitPrice: CentsSchema,
  /** Absents pour les rôles sans accès aux prix de revient. */
  unitCost: CentsSchema.optional(),
  laborHours: DecimalString,
  vatRegime: VatRegimeSchema,
  vatSuggested: VatRegimeSchema,
  vatJustification: z.string().nullable(),
  discountPercent: DecimalString,
});
export type QuoteLineDto = z.infer<typeof QuoteLineSchema>;

export const QuoteSectionSchema = z.object({
  id: Uuid,
  key: Uuid,
  title: z.string(),
  description: z.string().nullable(),
  optional: z.boolean(),
  selected: z.boolean(),
  lines: z.array(QuoteLineSchema),
});
export type QuoteSectionDto = z.infer<typeof QuoteSectionSchema>;

export const DepositSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('percent'), value: DecimalString }),
    z.object({ kind: z.literal('amount'), value: CentsSchema }),
  ])
  .nullable();

export const PaymentScheduleSchema = z
  .array(z.object({ label: z.string().trim().min(1).max(120), percent: DecimalString }))
  .max(12);

export const VatBreakdownSchema = z.array(
  z.object({
    category: z.string(),
    ratePercent: z.string(),
    regimes: z.array(z.string()),
    taxableAmount: CentsSchema,
    taxAmount: CentsSchema,
  }),
);

export const QuoteTotalsSchema = z.object({
  totalNet: CentsSchema,
  totalVat: CentsSchema,
  totalGross: CentsSchema,
  vatBreakdown: VatBreakdownSchema,
  depositAmount: CentsSchema,
  optionsAvailable: CentsSchema,
  laborHours: DecimalString,
  hasReverseCharge: z.boolean(),
  totalCost: CentsSchema.optional(),
  totalMargin: CentsSchema.optional(),
  marginRate: DecimalString.nullable().optional(),
  sections: z.array(
    z.object({
      key: Uuid,
      included: z.boolean(),
      netAmount: CentsSchema,
      laborHours: DecimalString,
      cost: CentsSchema.optional(),
      marginRate: DecimalString.nullable().optional(),
    }),
  ),
  lines: z.array(
    z.object({
      key: Uuid,
      netAmount: CentsSchema,
      cost: CentsSchema.optional(),
      marginRate: DecimalString.nullable().optional(),
    }),
  ),
});
export type QuoteTotalsDto = z.infer<typeof QuoteTotalsSchema>;

export const QuoteVersionSchema = z.object({
  id: Uuid,
  version: z.number().int(),
  status: QuoteStatusSchema,
  intro: z.string().nullable(),
  notes: z.string().nullable(),
  globalDiscountPercent: DecimalString,
  deposit: DepositSchema,
  paymentSchedule: PaymentScheduleSchema,
  sections: z.array(QuoteSectionSchema),
  totals: QuoteTotalsSchema,
  revision: z.number().int(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type QuoteVersionDto = z.infer<typeof QuoteVersionSchema>;

export const VatSuggestionSchema = z.object({
  regime: VatRegimeSchema,
  reason: z.string(),
  requiresCertificate: z.boolean(),
  dwellingAgeYears: z.number().int().nullable(),
});

export const QuoteSchema = z
  .object({
    id: Uuid,
    number: z.string().nullable(),
    title: z.string(),
    status: QuoteStatusSchema,
    isTemplate: z.boolean(),
    customer: z
      .object({
        id: Uuid,
        displayName: z.string(),
        email: z.string().nullable(),
        kind: z.enum(['individual', 'company']),
        vatLiable: z.boolean(),
      })
      .nullable(),
    site: z
      .object({
        id: Uuid,
        label: z.string().nullable(),
        street: z.string(),
        postalCode: z.string(),
        city: z.string(),
        firstOccupancyYear: z.number().int().nullable(),
        isPrivateDwelling: z.boolean(),
      })
      .nullable(),
    opportunityId: Uuid.nullable(),
    projectId: Uuid.nullable(),
    validityDays: z.number().int(),
    validUntil: z.string().nullable(),
    sentAt: z.string().nullable(),
    viewedAt: z.string().nullable(),
    signedAt: z.string().nullable(),
    refusedAt: z.string().nullable(),
    vatSuggestion: VatSuggestionSchema,
    certificate: z
      .object({ status: z.enum(['pending', 'signed']), signedAt: z.string().nullable() })
      .nullable(),
    signature: z
      .object({
        signerName: z.string(),
        signedAt: z.string(),
        ip: z.string().nullable(),
        documentSha256: z.string(),
      })
      .nullable(),
    currentVersion: QuoteVersionSchema,
    versions: z.array(
      z.object({
        id: Uuid,
        version: z.number().int(),
        status: QuoteStatusSchema,
        totalGross: CentsSchema,
        createdAt: z.string(),
        sentAt: z.string().nullable(),
      }),
    ),
    timeline: z.array(
      z.object({
        id: Uuid,
        type: z.string(),
        title: z.string(),
        body: z.string().nullable(),
        occurredAt: z.string(),
      }),
    ),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Quote' });
export type QuoteDto = z.infer<typeof QuoteSchema>;

export const QuoteSummarySchema = z.object({
  id: Uuid,
  number: z.string().nullable(),
  title: z.string(),
  status: QuoteStatusSchema,
  isTemplate: z.boolean(),
  customerName: z.string().nullable(),
  opportunityId: Uuid.nullable(),
  projectId: Uuid.nullable(),
  version: z.number().int(),
  totalNet: CentsSchema,
  totalGross: CentsSchema,
  sentAt: z.string().nullable(),
  viewedAt: z.string().nullable(),
  signedAt: z.string().nullable(),
  validUntil: z.string().nullable(),
  updatedAt: z.string(),
});
export type QuoteSummaryDto = z.infer<typeof QuoteSummarySchema>;

export const QuoteCreateSchema = z.object({
  id: Uuid.optional(),
  opportunityId: Uuid.nullable().optional(),
  customerId: Uuid.nullable().optional(),
  siteId: Uuid.nullable().optional(),
  title: z.string().trim().min(2).max(200),
  /** Partir d'un modèle ou dupliquer un devis existant. */
  fromQuoteId: Uuid.nullable().optional(),
  isTemplate: z.boolean().optional(),
});

const LineInputSchema = z.object({
  key: Uuid,
  kind: z.enum(QUOTE_LINE_KINDS),
  itemId: Uuid.nullable().optional(),
  code: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(4000),
  unit: z.string().trim().min(1).max(12).default('u'),
  quantity: DecimalString,
  unitPrice: CentsSchema,
  unitCost: CentsSchema.optional(),
  laborHours: DecimalString.optional(),
  vatRegime: VatRegimeSchema,
  vatJustification: text(500),
  discountPercent: DecimalString.optional(),
});

export const QuoteContentSchema = z.object({
  /** Révision connue de l'éditeur (concurrence optimiste). */
  revision: z.number().int().min(0),
  title: z.string().trim().min(2).max(200).optional(),
  validityDays: z.number().int().min(1).max(365).optional(),
  intro: text(5000),
  notes: text(10_000),
  globalDiscountPercent: DecimalString.optional(),
  deposit: DepositSchema.optional(),
  paymentSchedule: PaymentScheduleSchema.optional(),
  sections: z
    .array(
      z.object({
        key: Uuid,
        title: z.string().trim().max(200),
        description: text(4000),
        optional: z.boolean().default(false),
        selected: z.boolean().default(false),
        lines: z.array(LineInputSchema).max(500),
      }),
    )
    .max(100),
});
export type QuoteContentInput = z.input<typeof QuoteContentSchema>;

export const QuoteSendSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Adresse e-mail invalide' })),
  message: text(5000),
});

export const DraftLinesRequestSchema = z.object({ text: z.string().trim().min(3).max(5000) });
export const DraftLinesResponseSchema = z.object({
  lines: z.array(
    z.object({
      source: z.string(),
      description: z.string(),
      quantity: DecimalString,
      unit: z.string(),
      confidence: z.number(),
      item: z
        .object({
          id: Uuid,
          code: z.string(),
          name: z.string(),
          unit: z.string(),
          kind: z.string(),
          salePrice: CentsSchema,
          purchasePrice: CentsSchema.optional(),
          laborHours: DecimalString,
          vatRate: z.string(),
        })
        .nullable(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Portail client (public, par jeton)
// ---------------------------------------------------------------------------

export const PortalQuoteSchema = z
  .object({
    tenant: z.object({
      name: z.string(),
      legalName: z.string().nullable(),
      accent: z.string(),
      logoUrl: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      address: z.string().nullable(),
      vatNumber: z.string().nullable(),
      termsAndConditions: z.string().nullable(),
    }),
    quote: z.object({
      number: z.string().nullable(),
      title: z.string(),
      status: QuoteStatusSchema,
      version: z.number().int(),
      sentAt: z.string().nullable(),
      validUntil: z.string().nullable(),
      signedAt: z.string().nullable(),
      intro: z.string().nullable(),
      notes: z.string().nullable(),
      paymentSchedule: PaymentScheduleSchema,
      depositPercent: z.string().nullable(),
    }),
    customer: z.object({ displayName: z.string(), email: z.string().nullable() }),
    site: z.object({ address: z.string(), firstOccupancyYear: z.number().int().nullable() }).nullable(),
    sections: z.array(
      z.object({
        key: Uuid,
        title: z.string(),
        description: z.string().nullable(),
        optional: z.boolean(),
        selected: z.boolean(),
        lines: z.array(
          z.object({
            key: Uuid,
            kind: z.enum(QUOTE_LINE_KINDS),
            description: z.string(),
            unit: z.string(),
            quantity: DecimalString,
            unitPrice: CentsSchema,
            discountPercent: DecimalString,
            vatRegime: VatRegimeSchema,
            netAmount: CentsSchema,
          }),
        ),
      }),
    ),
    totals: QuoteTotalsSchema.pick({
      totalNet: true,
      totalVat: true,
      totalGross: true,
      vatBreakdown: true,
      depositAmount: true,
      optionsAvailable: true,
      hasReverseCharge: true,
    }),
    certificateRequired: z.boolean(),
    certificateSigned: z.boolean(),
    signature: z.object({ signerName: z.string(), signedAt: z.string() }).nullable(),
    projectCreated: z.boolean(),
  })
  .meta({ id: 'PortalQuote' });
export type PortalQuoteDto = z.infer<typeof PortalQuoteSchema>;

export const PortalSignSchema = z.object({
  signerName: z.string().trim().min(2).max(120),
  acceptTerms: z.literal(true, { error: 'Cochez la case pour accepter le devis.' }),
  /** Tracé SVG (path « d ») de la signature manuscrite ; facultatif si le nom saisi tient lieu de signature. */
  signaturePath: z.string().max(60_000).nullable().optional(),
  /** Choix des postes optionnels : clé du poste → retenu. */
  options: z.record(z.string(), z.boolean()).default({}),
  certificate: z
    .object({
      firstOccupancyYear: z.number().int().min(1700).max(2100),
      privateDwelling: z.literal(true),
      overTenYears: z.literal(true),
      finalConsumer: z.literal(true),
    })
    .nullable()
    .optional(),
});
export type PortalSignInput = z.input<typeof PortalSignSchema>;
