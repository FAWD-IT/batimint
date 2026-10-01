import { DEFAULT_NUMBER_PATTERNS, FEATURES, isValidNumberPattern, PLANS } from '@batimint/domain';
import { z } from 'zod';
import { CentsSchema, DecimalString, RoleSchema, Uuid } from './common';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const CompanySchema = z
  .object({
    id: Uuid,
    name: z.string(),
    legalName: z.string().nullable(),
    slug: z.string(),
    legalForm: z.string().nullable(),
    enterpriseNumber: z.string().nullable(),
    vatNumber: z.string().nullable(),
    vatValidatedAt: z.string().nullable(),
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    iban: z.string().nullable(),
    bic: z.string().nullable(),
    logoUrl: z.string().nullable(),
    brandColor: z.string().nullable(),
    brandColorAccessible: z.boolean(),
    termsAndConditions: z.string().nullable(),
    legalMentions: z.string().nullable(),
    documentLocale: z.string(),
    inboundEmail: z.string().nullable(),
  })
  .meta({ id: 'Company' });
export type CompanyDto = z.infer<typeof CompanySchema>;

export const CompanyUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    legalName: optionalText(160),
    legalForm: optionalText(20),
    enterpriseNumber: optionalText(20),
    street: optionalText(160),
    postalCode: optionalText(10),
    city: optionalText(80),
    country: z.string().length(2).toUpperCase(),
    email: optionalText(254),
    phone: optionalText(40),
    website: optionalText(200),
    iban: optionalText(40),
    bic: optionalText(11),
    brandColor: optionalText(7),
    termsAndConditions: optionalText(50_000),
    legalMentions: optionalText(2_000),
    documentLocale: z.enum(['fr', 'nl']),
  })
  .partial();
export type CompanyUpdate = z.infer<typeof CompanyUpdateSchema>;

export const VatLookupRequestSchema = z.object({ number: z.string().trim().min(9).max(20) });
export const VatLookupResponseSchema = z
  .object({
    valid: z.boolean(),
    vatNumber: z.string(),
    enterpriseNumber: z.string().nullable(),
    name: z.string().nullable(),
    legalForm: z.string().nullable(),
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    source: z.enum(['vies', 'mock', 'unavailable']),
  })
  .meta({ id: 'VatLookup' });

// ---------------------------------------------------------------------------
// Paramètres métier (03 §1)
// ---------------------------------------------------------------------------

export const RateProfileSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(60),
  /** Coût horaire chargé (centimes). */
  costPerHour: CentsSchema.min(0),
  /** Prix de vente horaire HTVA (centimes). */
  salePerHour: CentsSchema.min(0),
});

const NumberingSchema = z.object(
  Object.fromEntries(
    Object.entries(DEFAULT_NUMBER_PATTERNS).map(([k, v]) => [
      k,
      z
        .string()
        .refine(isValidNumberPattern, { error: 'Modèle invalide : il doit contenir {SEQ}.' })
        .default(v),
    ]),
  ) as Record<keyof typeof DEFAULT_NUMBER_PATTERNS, z.ZodDefault<z.ZodString>>,
);

export const TenantSettingsSchema = z
  .object({
    rateProfiles: z.array(RateProfileSchema).max(30).default([]),
    /** Coefficient de frais généraux appliqué au prix de revient. */
    overheadCoefficient: DecimalString.default('1.10'),
    /** Coefficient de marge par défaut (prix de vente = revient × frais × marge). */
    marginCoefficient: DecimalString.default('1.25'),
    breakMinutes: z.number().int().min(0).max(180).default(30),
    breakAfterMinutes: z.number().int().min(0).max(720).default(360),
    paymentTermsDays: z.number().int().min(0).max(120).default(30),
    quoteValidityDays: z.number().int().min(1).max(365).default(30),
    depositPercent: DecimalString.default('30'),
    retentionPercent: DecimalString.default('0'),
    retentionMonths: z.number().int().min(0).max(120).default(12),
    dunningDays: z.array(z.number().int().min(1).max(365)).max(6).default([3, 15, 30]),
    lateInterestEnabled: z.boolean().default(false),
    lumpSumIndemnityEnabled: z.boolean().default(false),
    driftThresholdPercent: DecimalString.default('10'),
    progressApprovalB2C: z.boolean().default(true),
    progressApprovalB2B: z.boolean().default(false),
    clockInToleranceMeters: z.number().int().min(50).max(5000).default(300),
    numbering: NumberingSchema.default(DEFAULT_NUMBER_PATTERNS),
  })
  .meta({ id: 'TenantSettings' });
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

/** Paramètres stockés (JSON) → paramètres complets avec valeurs par défaut. */
export function parseTenantSettings(raw: unknown): TenantSettings {
  const parsed = TenantSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : TenantSettingsSchema.parse({});
}

// ---------------------------------------------------------------------------
// Onboarding, abonnement
// ---------------------------------------------------------------------------

export const OnboardingSchema = z
  .object({
    steps: z.array(z.object({ step: z.string(), done: z.boolean(), href: z.string() })),
    completed: z.number().int(),
    total: z.number().int(),
    complete: z.boolean(),
    dismissed: z.boolean(),
  })
  .meta({ id: 'Onboarding' });

export const SubscriptionSchema = z
  .object({
    plan: z.enum(PLANS),
    trialEndsAt: z.string().nullable(),
    trialDaysLeft: z.number().int().nullable(),
    billableSeats: z.number().int(),
    totalMembers: z.number().int(),
    features: z.array(z.enum(FEATURES)),
  })
  .meta({ id: 'Subscription' });

export const PlanUpdateSchema = z.object({ plan: z.enum(PLANS) });

// ---------------------------------------------------------------------------
// Membres et invitations
// ---------------------------------------------------------------------------

export const MemberSchema = z
  .object({
    id: Uuid,
    userId: Uuid,
    name: z.string(),
    email: z.string(),
    role: RoleSchema,
    status: z.enum(['active', 'disabled']),
    lastLoginAt: z.string().nullable(),
    isCurrentUser: z.boolean(),
  })
  .meta({ id: 'Member' });

export const InvitationSchema = z
  .object({
    id: Uuid,
    email: z.string(),
    name: z.string().nullable(),
    role: RoleSchema,
    status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    expiresAt: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: 'Invitation' });

export const MembersResponseSchema = z.object({
  members: z.array(MemberSchema),
  invitations: z.array(InvitationSchema),
});

export const InvitationCreateSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Adresse e-mail invalide' })),
  name: z.string().trim().max(120).optional(),
  role: RoleSchema,
});

export const MemberUpdateSchema = z.object({
  role: RoleSchema.optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const InvitationLookupSchema = z.object({
  tenantName: z.string(),
  email: z.string(),
  role: RoleSchema,
  inviterName: z.string().nullable(),
  accountExists: z.boolean(),
});

export const InvitationAcceptSchema = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(10).max(200).optional(),
});
