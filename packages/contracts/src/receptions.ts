/**
 * Réception et clôture (03 §5, 02 P10) : PV provisoire avec réserves, PV définitif, facture
 * finale, libération de la retenue, rapport de rentabilité et suggestions de prix.
 */
import { z } from 'zod';
import { CentsSchema, DecimalString, Uuid } from './common';

const IsoDay = z.iso.date();

export const ReceptionKindSchema = z.enum(['provisional', 'final']);

export const ReserveSchema = z.object({
  id: Uuid,
  position: z.number().int(),
  description: z.string(),
  location: z.string().nullable(),
  budgetLine: z.object({ id: Uuid, label: z.string() }).nullable(),
  photos: z.array(z.object({ id: Uuid, url: z.string(), thumbUrl: z.string().nullable() })),
  taskId: Uuid.nullable(),
  liftedAt: z.string().nullable(),
});
export type ReserveDto = z.infer<typeof ReserveSchema>;

export const ReceptionSchema = z.object({
  id: Uuid,
  kind: ReceptionKindSchema,
  status: z.enum(['draft', 'signed']),
  number: z.string().nullable(),
  receptionDate: IsoDay,
  attendees: z.string().nullable(),
  notes: z.string().nullable(),
  plannedFinalDate: IsoDay.nullable(),
  signerName: z.string().nullable(),
  signedAt: z.string().nullable(),
  pdfUrl: z.string().nullable(),
  reserves: z.array(ReserveSchema),
  project: z.object({ id: Uuid, number: z.string(), name: z.string() }),
  /** Ce qui empêche encore la signature (chantier pas en cours, réserves non levées…). */
  blockers: z.array(z.string()),
});
export type ReceptionDto = z.infer<typeof ReceptionSchema>;

export const ReserveInputSchema = z.object({
  id: Uuid,
  description: z.string().trim().min(1).max(1000),
  location: z.string().trim().max(120).nullable().optional(),
  budgetLineId: Uuid.nullable().optional(),
  photoIds: z.array(Uuid).max(12).default([]),
});

export const ReceptionDraftInputSchema = z.object({
  kind: ReceptionKindSchema,
  receptionDate: IsoDay,
  attendees: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  reserves: z.array(ReserveInputSchema).max(100).default([]),
});
export type ReceptionDraftInput = z.input<typeof ReceptionDraftInputSchema>;

export const ReceptionSignSchema = z.object({
  signerName: z.string().trim().min(2).max(120),
  /** Tracé de la signature (chemin SVG), facultatif. */
  signaturePath: z.string().max(200_000).nullable().optional(),
  acceptTerms: z.literal(true),
});

/** Situation des réceptions du chantier (onglet « Réception » et vue terrain). */
export const ProjectReceptionSchema = z.object({
  projectStatus: z.string(),
  provisionalAcceptedOn: IsoDay.nullable(),
  finalAcceptancePlannedOn: IsoDay.nullable(),
  finalAcceptedOn: IsoDay.nullable(),
  closedAt: z.string().nullable(),
  openReserves: z.number().int(),
  receptions: z.array(ReceptionSchema),
  finalInvoice: z.object({ id: Uuid, number: z.string().nullable(), status: z.string() }).nullable(),
  /** Retenues de garantie du chantier : retenues, libérées. */
  retention: z.object({ held: CentsSchema, released: CentsSchema, releasedAt: z.string().nullable() }),
  /** Actions possibles maintenant. */
  can: z.object({
    provisional: z.boolean(),
    final: z.boolean(),
    finalInvoice: z.boolean(),
    close: z.boolean(),
  }),
});
export type ProjectReceptionDto = z.infer<typeof ProjectReceptionSchema>;

export const ProfitabilityPostSchema = z.object({
  id: Uuid,
  label: z.string(),
  revenue: CentsSchema,
  budgetedCost: CentsSchema,
  actualCost: CentsSchema,
  costVariance: CentsSchema,
  costVarianceRatio: DecimalString.nullable(),
  plannedMargin: DecimalString.nullable(),
  actualMargin: DecimalString.nullable(),
  plannedHours: DecimalString,
  actualHours: DecimalString,
  actualByCategory: z.record(z.string(), CentsSchema),
});

export const PriceSuggestionSchema = z.object({
  itemId: Uuid,
  itemName: z.string(),
  itemCode: z.string(),
  field: z.enum(['unitCost', 'laborHours']),
  current: z.string(),
  suggested: z.string(),
  variance: DecimalString,
});
export type PriceSuggestionDto = z.infer<typeof PriceSuggestionSchema>;

export const ProfitabilitySchema = z.object({
  project: z.object({ id: Uuid, number: z.string(), name: z.string(), status: z.string() }),
  revenue: CentsSchema,
  budgetedCost: CentsSchema,
  actualCost: CentsSchema,
  plannedMargin: DecimalString.nullable(),
  actualMargin: DecimalString.nullable(),
  plannedHours: DecimalString,
  actualHours: DecimalString,
  invoiced: CentsSchema,
  collected: CentsSchema,
  posts: z.array(ProfitabilityPostSchema),
  suggestions: z.array(PriceSuggestionSchema),
});
export type ProfitabilityDto = z.infer<typeof ProfitabilitySchema>;

export const ApplySuggestionsSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: Uuid,
        field: z.enum(['unitCost', 'laborHours']),
        value: z.string().regex(/^\d+(\.\d+)?$/),
      }),
    )
    .min(1)
    .max(200),
});
