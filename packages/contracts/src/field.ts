/**
 * Terrain (03 §7, 02 P4) : journée de l'ouvrier, pointages hors ligne (identifiants générés sur
 * le téléphone, synchro par lots idempotente), signalements, bons de régie, heures et rapport
 * journalier. Aucun prix dans ces échanges (l'Ouvrier ne voit pas les montants).
 */
import { z } from 'zod';
import { DecimalString, Uuid } from './common';

const IsoDay = z.iso.date();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const GeofenceStatusSchema = z.enum(['ok', 'too_far', 'no_position', 'no_site_position']);

export const FieldPersonSchema = z.object({
  employeeId: Uuid,
  name: z.string(),
  initials: z.string(),
  onSite: z.boolean(),
  since: z.string().nullable(),
});

export const FieldTaskSchema = z.object({
  id: Uuid,
  title: z.string(),
  status: z.enum(['todo', 'in_progress', 'done']),
  progress: DecimalString,
  post: z.string().nullable(),
  photoCount: z.number().int(),
});

export const FieldTodaySchema = z.object({
  day: IsoDay,
  employee: z
    .object({ id: Uuid, firstName: z.string(), name: z.string(), teamId: Uuid.nullable() })
    .nullable(),
  project: z
    .object({
      id: Uuid,
      number: z.string(),
      name: z.string(),
      address: z.string().nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      customerName: z.string(),
      customerPhone: z.string().nullable(),
      accessNotes: z.string().nullable(),
      checkInOut: z.boolean(),
    })
    .nullable(),
  otherProjects: z.array(z.object({ id: Uuid, name: z.string(), number: z.string() })),
  team: z.array(FieldPersonSchema),
  clock: z.object({
    status: z.enum(['out', 'in']),
    since: z.string().nullable(),
    workedMinutes: z.number().int(),
    validated: z.boolean(),
  }),
  tasks: z.array(FieldTaskSchema),
  openIssues: z.number().int(),
  draftWorkOrders: z.number().int(),
  toleranceMeters: z.number().int(),
  can: z.object({ clockTeam: z.boolean(), validate: z.boolean(), workOrders: z.boolean() }),
});
export type FieldTodayDto = z.infer<typeof FieldTodaySchema>;

export const ClockInputSchema = z.object({
  /** UUIDv7 généré sur le téléphone : un renvoi après coupure ne crée pas de doublon. */
  id: Uuid,
  projectId: Uuid,
  /** Absent : l'ouvrier connecté. Présent : le chef pointe un membre de son équipe. */
  employeeId: Uuid.optional(),
  kind: z.enum(['in', 'out']),
  at: z.iso.datetime({ offset: true }),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  offline: z.boolean().default(false),
  note: optText(500),
});
export type ClockInput = z.input<typeof ClockInputSchema>;

export const TimeEntrySchema = z.object({
  id: Uuid,
  projectId: Uuid,
  employeeId: Uuid,
  kind: z.enum(['in', 'out']),
  at: z.string(),
  day: IsoDay,
  geofence: GeofenceStatusSchema,
  distanceMeters: z.number().int().nullable(),
  source: z.enum(['self', 'team', 'office']),
  offline: z.boolean(),
  status: z.enum(['recorded', 'synced', 'validated', 'transmitted']),
  onssStatus: z.enum(['not_required', 'pending', 'sent', 'failed']),
  onssError: z.string().nullable(),
});
export type TimeEntryDto = z.infer<typeof TimeEntrySchema>;

export const IssueInputSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  taskId: Uuid.nullable().optional(),
  title: z.string().trim().min(3).max(200),
  description: optText(2000),
  urgent: z.boolean().default(false),
  at: z.iso.datetime({ offset: true }),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

export const TaskFieldUpdateSchema = z.object({
  projectId: Uuid,
  taskId: Uuid,
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
});

export const FieldActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clock'), id: Uuid, data: ClockInputSchema }),
  z.object({ type: z.literal('task'), id: Uuid, data: TaskFieldUpdateSchema }),
  z.object({ type: z.literal('issue'), id: Uuid, data: IssueInputSchema }),
]);
export type FieldAction = z.input<typeof FieldActionSchema>;

export const FieldSyncRequestSchema = z.object({ actions: z.array(FieldActionSchema).min(1).max(200) });
export const FieldSyncResponseSchema = z.object({
  results: z.array(
    z.object({
      id: Uuid,
      ok: z.boolean(),
      /** Erreur définitive : l'action est retirée de la file et montrée à l'ouvrier. */
      error: z.object({ code: z.string(), message: z.string() }).nullable(),
      geofence: GeofenceStatusSchema.nullable().optional(),
    }),
  ),
});

export const IssueSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  taskId: Uuid.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  urgent: z.boolean(),
  status: z.enum(['open', 'change_order', 'resolved']),
  changeOrderId: Uuid.nullable(),
  reporterLabel: z.string(),
  reportedAt: z.string(),
  photos: z.array(z.object({ id: Uuid, url: z.string() })),
  voiceNotes: z.array(
    z.object({
      id: Uuid,
      url: z.string(),
      transcript: z.string().nullable(),
      transcriptStatus: z.string().nullable(),
    }),
  ),
});
export type IssueDto = z.infer<typeof IssueSchema>;

export const WorkOrderLineInputSchema = z.object({
  kind: z.enum(['labour', 'material']),
  description: z.string().trim().min(1).max(500),
  employeeId: Uuid.nullable().optional(),
  quantity: DecimalString,
  unit: z.string().trim().min(1).max(12),
});

export const WorkOrderInputSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  day: IsoDay,
  description: z.string().trim().min(3).max(4000),
  lines: z.array(WorkOrderLineInputSchema).min(1).max(50),
});

export const WorkOrderSignSchema = z.object({
  signerName: z.string().trim().min(2).max(120),
  signaturePath: z.string().max(60_000).nullable().optional(),
  acceptTerms: z.literal(true, { error: 'Le client doit confirmer les travaux réalisés.' }),
});

export const WorkOrderSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  number: z.string().nullable(),
  day: IsoDay,
  description: z.string(),
  status: z.enum(['draft', 'signed', 'invoiced']),
  signerName: z.string().nullable(),
  signedAt: z.string().nullable(),
  lines: z.array(
    z.object({
      kind: z.enum(['labour', 'material']),
      description: z.string(),
      employeeId: Uuid.nullable(),
      quantity: DecimalString,
      unit: z.string(),
    }),
  ),
  createdAt: z.string(),
});
export type WorkOrderDto = z.infer<typeof WorkOrderSchema>;

export const TimesheetRowSchema = z.object({
  employeeId: Uuid,
  name: z.string(),
  day: IsoDay,
  entries: z.array(TimeEntrySchema),
  grossMinutes: z.number().int(),
  breakMinutes: z.number().int(),
  netMinutes: z.number().int(),
  open: z.boolean(),
  anomalies: z.array(z.enum(['double_in', 'out_without_in', 'too_far', 'no_position'])),
  validated: z.boolean(),
  /** Coût main-d'œuvre (rôles avec accès aux coûts). */
  cost: z.number().int().optional(),
});
export type TimesheetRowDto = z.infer<typeof TimesheetRowSchema>;

export const TimesheetSchema = z.object({
  from: IsoDay,
  to: IsoDay,
  rows: z.array(TimesheetRowSchema),
});

export const TimeValidateSchema = z.object({
  day: IsoDay,
  employeeIds: z.array(Uuid).min(1).max(100),
});

export const DailyReportSchema = z.object({
  projectId: Uuid,
  day: IsoDay,
  workers: z.array(
    z.object({ employeeId: Uuid, name: z.string(), minutes: z.number().int(), validated: z.boolean() }),
  ),
  tasksCompleted: z.array(z.object({ id: Uuid, title: z.string() })),
  photos: z.array(z.object({ id: Uuid, url: z.string(), caption: z.string().nullable() })),
  issues: z.array(z.object({ id: Uuid, title: z.string(), urgent: z.boolean() })),
  workOrders: z.array(z.object({ id: Uuid, number: z.string().nullable(), description: z.string() })),
  notes: z.string().nullable(),
  weather: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedBy: z.string().nullable(),
});
export type DailyReportDto = z.infer<typeof DailyReportSchema>;

export const DailyReportUpdateSchema = z.object({
  notes: optText(5000),
  weather: optText(100),
  close: z.boolean().optional(),
});
