import { OPPORTUNITY_STAGES } from '@batimint/domain';
import { z } from 'zod';
import { CentsSchema, Uuid } from './common';

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const CustomerSchema = z
  .object({
    id: Uuid,
    kind: z.enum(['individual', 'company']),
    status: z.enum(['prospect', 'customer']),
    displayName: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    companyName: z.string().nullable(),
    legalForm: z.string().nullable(),
    enterpriseNumber: z.string().nullable(),
    vatNumber: z.string().nullable(),
    vatLiable: z.boolean(),
    peppolId: z.string().nullable(),
    peppolReachable: z.boolean().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string(),
    notes: z.string().nullable(),
    tags: z.array(z.string()),
    source: z.string().nullable(),
    paymentTermsDays: z.number().int().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'Customer' });
export type CustomerDto = z.infer<typeof CustomerSchema>;

export const CustomerInputSchema = z.object({
  id: Uuid.optional(),
  kind: z.enum(['individual', 'company']),
  firstName: opt(80),
  lastName: opt(80),
  companyName: opt(160),
  legalForm: opt(20),
  enterpriseNumber: opt(20),
  vatLiable: z.boolean().optional(),
  email: opt(254),
  phone: opt(40),
  street: opt(160),
  postalCode: opt(10),
  city: opt(80),
  country: z.string().length(2).toUpperCase().optional(),
  notes: opt(5000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  source: opt(40),
  paymentTermsDays: z.number().int().min(0).max(120).nullable().optional(),
  /** Ignore les doublons détectés (après confirmation de l'utilisateur). */
  force: z.boolean().optional(),
});

export const ContactSchema = z.object({
  id: Uuid,
  customerId: Uuid,
  firstName: z.string().nullable(),
  lastName: z.string(),
  jobTitle: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
});
export const ContactInputSchema = z.object({
  firstName: opt(80),
  lastName: z.string().trim().min(1).max(80),
  jobTitle: opt(80),
  email: opt(254),
  phone: opt(40),
  isPrimary: z.boolean().optional(),
});

export const SiteSchema = z
  .object({
    id: Uuid,
    customerId: Uuid,
    label: z.string().nullable(),
    street: z.string(),
    postalCode: z.string(),
    city: z.string(),
    country: z.string(),
    isPrivateDwelling: z.boolean(),
    firstOccupancyYear: z.number().int().nullable(),
    accessNotes: z.string().nullable(),
  })
  .meta({ id: 'Site' });
export const SiteInputSchema = z.object({
  label: opt(80),
  street: z.string().trim().min(2).max(160),
  postalCode: z.string().trim().min(4).max(10),
  city: z.string().trim().min(1).max(80),
  country: z.string().length(2).toUpperCase().optional(),
  isPrivateDwelling: z.boolean().optional(),
  firstOccupancyYear: z.number().int().min(1700).max(2100).nullable().optional(),
  accessNotes: opt(1000),
});

export const LeadSchema = z
  .object({
    id: Uuid,
    source: z.enum(['web_form', 'email', 'manual', 'phone']),
    status: z.enum(['new', 'converted', 'discarded']),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    companyName: z.string().nullable(),
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    message: z.string().nullable(),
    customerId: Uuid.nullable(),
    opportunityId: Uuid.nullable(),
    receivedAt: z.string(),
  })
  .meta({ id: 'Lead' });

export const LeadInputSchema = z.object({
  source: z.enum(['manual', 'phone']).default('manual'),
  name: z.string().trim().min(2).max(120),
  email: opt(254),
  phone: opt(40),
  companyName: opt(160),
  street: opt(160),
  postalCode: opt(10),
  city: opt(80),
  message: opt(5000),
});

/** Formulaire web embarquable (public). */
export const PublicLeadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Adresse e-mail invalide' })),
  phone: opt(40),
  street: opt(160),
  postalCode: opt(10),
  city: opt(80),
  message: z.string().trim().min(5).max(5000),
  /** Champ piège invisible : doit rester vide. */
  website: z.string().max(200).optional(),
  /** Temps de saisie en millisecondes (anti-robot). */
  fillMs: z.number().int().min(0).max(86_400_000).optional(),
  consent: z.literal(true, { error: 'Merci d’accepter d’être recontacté.' }),
});

export const OpportunitySchema = z
  .object({
    id: Uuid,
    customerId: Uuid,
    customerName: z.string(),
    siteId: Uuid.nullable(),
    siteLabel: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    stage: z.enum(OPPORTUNITY_STAGES),
    position: z.number().int(),
    estimatedAmount: CentsSchema.nullable().optional(),
    trade: z.string().nullable(),
    ownerUserId: Uuid.nullable(),
    lostReason: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    visitCount: z.number().int(),
    attachmentCount: z.number().int(),
  })
  .meta({ id: 'Opportunity' });
export type OpportunityDto = z.infer<typeof OpportunitySchema>;

export const OpportunityInputSchema = z.object({
  id: Uuid.optional(),
  customerId: Uuid,
  siteId: Uuid.nullable().optional(),
  title: z.string().trim().min(2).max(160),
  description: opt(5000),
  estimatedAmount: CentsSchema.min(0).nullable().optional(),
  trade: opt(40),
  ownerUserId: Uuid.nullable().optional(),
});

export const OpportunityMoveSchema = z.object({
  stage: z.enum(OPPORTUNITY_STAGES),
  /** Index cible dans la colonne. */
  position: z.number().int().min(0),
  lostReason: opt(500),
});

export const MeasurementSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().max(20),
  unit: z.string().trim().max(10),
});
export const ChecklistItemSchema = z.object({ label: z.string().trim().min(1).max(160), done: z.boolean() });

export const SiteVisitSchema = z
  .object({
    id: Uuid,
    opportunityId: Uuid,
    scheduledAt: z.string().nullable(),
    visitedAt: z.string().nullable(),
    visitorEmployeeId: Uuid.nullable(),
    trade: z.string().nullable(),
    measurements: z.array(MeasurementSchema),
    checklist: z.array(ChecklistItemSchema),
    notes: z.string().nullable(),
  })
  .meta({ id: 'SiteVisit' });

export const SiteVisitInputSchema = z.object({
  id: Uuid.optional(),
  scheduledAt: z.iso.datetime().nullable().optional(),
  visitedAt: z.iso.datetime().nullable().optional(),
  visitorEmployeeId: Uuid.nullable().optional(),
  trade: opt(40),
  measurements: z.array(MeasurementSchema).max(100).optional(),
  checklist: z.array(ChecklistItemSchema).max(100).optional(),
  notes: opt(10_000),
});

export const AttachmentSchema = z
  .object({
    id: Uuid,
    ownerType: z.string(),
    ownerId: Uuid,
    kind: z.enum(['photo', 'document', 'voice_note']),
    fileName: z.string(),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    url: z.string(),
    takenAt: z.string().nullable(),
    caption: z.string().nullable(),
    transcript: z.string().nullable(),
    transcriptStatus: z.string().nullable(),
    visibleToClient: z.boolean(),
    createdAt: z.string(),
  })
  .meta({ id: 'Attachment' });
export type AttachmentDto = z.infer<typeof AttachmentSchema>;

export const TimelineItemSchema = z.object({
  type: z.enum(['lead', 'opportunity', 'visit', 'note', 'quote', 'project', 'invoice']),
  id: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  at: z.string(),
  href: z.string().nullable(),
});
