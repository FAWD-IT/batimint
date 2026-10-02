/**
 * Planning (03 §6, 02 P3) : affectations d'une personne ou d'une équipe à un chantier, en
 * demi-journées ouvrées, avec conflits et tâches à planifier.
 */
import { z } from 'zod';
import { Uuid } from './common';

const IsoDay = z.iso.date();
export const HalfSchema = z.enum(['am', 'pm']);

export const SlotInputSchema = z
  .object({
    /** Identifiant généré par le client (glisser-déposer optimiste, renvoi sans doublon). */
    id: Uuid,
    projectId: Uuid,
    employeeId: Uuid.nullable().optional(),
    teamId: Uuid.nullable().optional(),
    taskId: Uuid.nullable().optional(),
    startDay: IsoDay,
    startHalf: HalfSchema.default('am'),
    endDay: IsoDay,
    endHalf: HalfSchema.default('pm'),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((s) => Boolean(s.employeeId) !== Boolean(s.teamId), {
    error: 'Choisissez une personne ou une équipe.',
    path: ['employeeId'],
  });
export type SlotInput = z.input<typeof SlotInputSchema>;

export const SlotPatchSchema = z.object({
  projectId: Uuid.optional(),
  employeeId: Uuid.nullable().optional(),
  teamId: Uuid.nullable().optional(),
  taskId: Uuid.nullable().optional(),
  startDay: IsoDay.optional(),
  startHalf: HalfSchema.optional(),
  endDay: IsoDay.optional(),
  endHalf: HalfSchema.optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const PlanningSlotSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  employeeId: Uuid.nullable(),
  teamId: Uuid.nullable(),
  taskId: Uuid.nullable(),
  taskTitle: z.string().nullable(),
  startDay: IsoDay,
  startHalf: HalfSchema,
  endDay: IsoDay,
  endHalf: HalfSchema,
  /** Durée en jours ouvrés (au demi-jour). */
  workingDays: z.number(),
  note: z.string().nullable(),
  updatedAt: z.string(),
});
export type PlanningSlotDto = z.infer<typeof PlanningSlotSchema>;

export const PlanningConflictSchema = z.object({
  kind: z.enum(['double_booking', 'absence']),
  employeeId: Uuid,
  employeeName: z.string(),
  day: IsoDay,
  half: HalfSchema,
  slotIds: z.array(Uuid),
});
export type PlanningConflictDto = z.infer<typeof PlanningConflictSchema>;

export const PlanningSchema = z.object({
  from: IsoDay,
  to: IsoDay,
  days: z.array(z.object({ day: IsoDay, working: z.boolean(), holiday: z.boolean() })),
  teams: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      color: z.string(),
      memberIds: z.array(Uuid),
      leaderId: Uuid.nullable(),
    }),
  ),
  employees: z.array(
    z.object({
      id: Uuid,
      name: z.string(),
      initials: z.string(),
      teamId: Uuid.nullable(),
      jobTitle: z.string().nullable(),
    }),
  ),
  projects: z.array(
    z.object({
      id: Uuid,
      number: z.string(),
      name: z.string(),
      shortLabel: z.string(),
      status: z.string(),
      startDate: IsoDay.nullable(),
      endDate: IsoDay.nullable(),
    }),
  ),
  slots: z.array(PlanningSlotSchema),
  absences: z.array(
    z.object({
      id: Uuid,
      employeeId: Uuid,
      kind: z.string(),
      startsOn: IsoDay,
      endsOn: IsoDay,
      halfDay: HalfSchema.nullable(),
    }),
  ),
  conflicts: z.array(PlanningConflictSchema),
  /** Tâches des chantiers en préparation ou en cours sans affectation. */
  unplannedTasks: z.array(
    z.object({
      id: Uuid,
      projectId: Uuid,
      title: z.string(),
      post: z.string().nullable(),
      plannedHours: z.string(),
    }),
  ),
});
export type PlanningDto = z.infer<typeof PlanningSchema>;

export const SlotMutationSchema = z.object({
  slot: PlanningSlotSchema,
  /** Conflits qui touchent cette affectation (signalés, non bloquants). */
  conflicts: z.array(PlanningConflictSchema),
});

/** Mon planning (vue terrain) : affectations à venir, jour par jour. */
export const MyPlanningSchema = z.object({
  days: z.array(
    z.object({
      day: IsoDay,
      items: z.array(
        z.object({
          slotId: Uuid,
          half: z.enum(['day', 'am', 'pm']),
          projectId: Uuid,
          projectName: z.string(),
          address: z.string().nullable(),
          taskTitle: z.string().nullable(),
          teamName: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type MyPlanningDto = z.infer<typeof MyPlanningSchema>;

export const CalendarFeedSchema = z.object({ url: z.string() });
