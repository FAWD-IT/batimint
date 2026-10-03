import { z } from 'zod';
import { CentsSchema, Uuid } from './common';

export const TeamSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    color: z.string(),
    leaderEmployeeId: Uuid.nullable(),
    memberIds: z.array(Uuid),
  })
  .meta({ id: 'Team' });

export const TeamInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, { error: 'Couleur au format #RRGGBB' }),
  leaderEmployeeId: Uuid.nullable().optional(),
  memberIds: z.array(Uuid).max(200).optional(),
});

export const EmployeeSchema = z
  .object({
    id: Uuid,
    userId: Uuid.nullable(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    jobTitle: z.string().nullable(),
    rateProfile: z.string().nullable(),
    /** Absent pour les rôles sans accès aux prix. */
    hourlyCost: CentsSchema.optional(),
    skills: z.array(z.string()),
    hasInss: z.boolean(),
    inssMasked: z.string().nullable(),
    teamId: Uuid.nullable(),
    isSubcontractor: z.boolean(),
    active: z.boolean(),
    hiredOn: z.string().nullable(),
  })
  .meta({ id: 'Employee' });
export type EmployeeDto = z.infer<typeof EmployeeSchema>;

export const EmployeeInputSchema = z.object({
  id: Uuid.optional(),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  jobTitle: z.string().trim().max(80).nullable().optional(),
  rateProfile: z.string().max(40).nullable().optional(),
  hourlyCost: CentsSchema.min(0).optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** INSS en clair à la saisie ; jamais renvoyé sauf via l'endpoint sensible. */
  inss: z.string().trim().max(20).nullable().optional(),
  teamId: Uuid.nullable().optional(),
  isSubcontractor: z.boolean().optional(),
  active: z.boolean().optional(),
  hiredOn: z.iso.date().nullable().optional(),
});

export const AbsenceSchema = z
  .object({
    id: Uuid,
    employeeId: Uuid,
    kind: z.enum(['leave', 'sick', 'training', 'public_holiday', 'other']),
    startsOn: z.string(),
    endsOn: z.string(),
    halfDay: z.enum(['am', 'pm']).nullable(),
    note: z.string().nullable(),
  })
  .meta({ id: 'Absence' });

export const AbsenceInputSchema = z
  .object({
    kind: z.enum(['leave', 'sick', 'training', 'public_holiday', 'other']),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    halfDay: z.enum(['am', 'pm']).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, { error: 'La fin doit suivre le début.', path: ['endsOn'] });

export const IntegrationSchema = z
  .object({
    kind: z.enum(['peppol', 'accounting', 'payments', 'attendance', 'ai', 'inbound_email']),
    provider: z.string(),
    status: z.enum(['not_connected', 'pending', 'active', 'error']),
    externalId: z.string().nullable(),
    lastCheckedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    details: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'Integration' });

export const AuditEntrySchema = z
  .object({
    id: Uuid,
    actorType: z.string(),
    actorLabel: z.string().nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    changes: z.unknown().nullable(),
    occurredAt: z.string(),
  })
  .meta({ id: 'AuditEntry' });
