import { z } from 'zod';
import { ActionSchema, Email, RoleSchema, Uuid } from './common';

export const PASSWORD_MIN_LENGTH = 10;

export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: `Au moins ${PASSWORD_MIN_LENGTH} caractères` })
  .max(200);

export const SignupRequestSchema = z
  .object({
    companyName: z.string().trim().min(2).max(120),
    name: z.string().trim().min(2).max(120),
    email: Email,
    password: Password,
    enterpriseNumber: z.string().trim().max(20).optional(),
  })
  .meta({ id: 'SignupRequest' });
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z
  .object({ email: Email, password: z.string().min(1).max(200), totp: z.string().regex(/^\d{6}$/).optional() })
  .meta({ id: 'LoginRequest' });
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const MagicLinkRequestSchema = z.object({ email: Email }).meta({ id: 'MagicLinkRequest' });
export const TokenRequestSchema = z.object({ token: z.string().min(20).max(200) });
export const PasswordResetConfirmSchema = z.object({ token: z.string().min(20).max(200), password: Password });
export const TotpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/, { error: 'Code à 6 chiffres' }) });

export const LoginResponseSchema = z
  .object({
    status: z.enum(['ok', 'mfa_required']),
    /** Jeton de session (aussi posé en cookie httpOnly). Utilisé par l'app mobile en Bearer. */
    sessionToken: z.string().optional(),
  })
  .meta({ id: 'LoginResponse' });

export const TenantSummarySchema = z
  .object({
    id: Uuid,
    name: z.string(),
    slug: z.string(),
    logoUrl: z.string().nullable(),
    brandColor: z.string().nullable(),
    role: RoleSchema,
  })
  .meta({ id: 'TenantSummary' });
export type TenantSummary = z.infer<typeof TenantSummarySchema>;

export const MeResponseSchema = z
  .object({
    user: z.object({
      id: Uuid,
      email: z.string(),
      name: z.string(),
      locale: z.string(),
      totpEnabled: z.boolean(),
      isPlatformAdmin: z.boolean(),
    }),
    tenant: TenantSummarySchema.nullable(),
    role: RoleSchema.nullable(),
    permissions: z.array(ActionSchema),
    tenants: z.array(TenantSummarySchema),
    impersonating: z.boolean(),
  })
  .meta({ id: 'Me' });
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const SwitchTenantSchema = z.object({ tenantId: Uuid });

export const SessionInfoSchema = z.object({
  id: Uuid,
  current: z.boolean(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
});
