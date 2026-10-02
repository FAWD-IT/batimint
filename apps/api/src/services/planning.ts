/**
 * Planning (03 §6) : grille ressources × jours, conflits calculés par le domaine, date de début
 * du chantier tenue par le planning tant que les travaux n'ont pas démarré.
 */
import type { PlanningConflictDto, PlanningDto } from '@batimint/contracts';
import type { Tx } from '@batimint/db';
import {
  addDays,
  detectConflicts,
  firstPlannedDay,
  type Half,
  isBelgianPublicHoliday,
  isWorkingDay,
  type PlannedSlot,
  slotWorkingDays,
} from '@batimint/domain';
import { isoDate } from '../lib/tenant';
import { initials } from './field';
import { shortLabel } from './projects';

export const dayDate = (s: string) => new Date(`${s}T00:00:00Z`);

type SlotRow = Awaited<ReturnType<Tx['scheduleSlot']['findUniqueOrThrow']>>;

export function toPlanned(s: SlotRow): PlannedSlot {
  return {
    id: s.id,
    projectId: s.projectId,
    employeeId: s.employeeId,
    teamId: s.teamId,
    startDay: isoDate(s.startDay)!,
    startHalf: s.startHalf as Half,
    endDay: isoDate(s.endDay)!,
    endHalf: s.endHalf as Half,
  };
}

export function slotDto(s: SlotRow, taskTitle: string | null) {
  const p = toPlanned(s);
  return {
    ...p,
    taskId: s.taskId,
    taskTitle,
    workingDays: slotWorkingDays(p),
    note: s.note,
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Affectations qui chevauchent une période (bornes incluses). */
export function overlapping(from: string, to: string) {
  return { startDay: { lte: dayDate(to) }, endDay: { gte: dayDate(from) } };
}

async function teamMembers(tx: Tx): Promise<Map<string, string[]>> {
  const rows = await tx.employee.findMany({
    where: { active: true, teamId: { not: null } },
    select: { id: true, teamId: true },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.teamId!, [...(map.get(r.teamId!) ?? []), r.id]);
  return map;
}

/**
 * Conflits sur une période pour les personnes concernées (toutes les affectations et congés
 * de la période sont pris en compte, pas seulement ceux affichés).
 */
export async function conflictsBetween(tx: Tx, from: string, to: string): Promise<PlanningConflictDto[]> {
  const slots = await tx.scheduleSlot.findMany({ where: overlapping(from, to) });
  const absences = await tx.absence.findMany({
    where: { startsOn: { lte: dayDate(to) }, endsOn: { gte: dayDate(from) } },
  });
  const members = await teamMembers(tx);
  const raw = detectConflicts({
    slots: slots.map(toPlanned),
    absences: absences.map((a) => ({
      employeeId: a.employeeId,
      startsOn: isoDate(a.startsOn)!,
      endsOn: isoDate(a.endsOn)!,
      halfDay: (a.halfDay as Half | null) ?? null,
    })),
    teamMembers: members,
  }).filter((c) => c.day >= from && c.day <= to);
  if (!raw.length) return [];
  const people = await tx.employee.findMany({
    where: { id: { in: [...new Set(raw.map((c) => c.employeeId))] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const names = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  return raw.map((c) => ({ ...c, employeeName: names.get(c.employeeId) ?? '—' }));
}

/**
 * Tant que le chantier n'a pas démarré, sa date de début suit la première demi-journée
 * planifiée (le client la voit sur son portail). Renvoie la nouvelle date si elle a changé.
 */
export async function syncProjectStart(tx: Tx, projectId: string): Promise<string | null> {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { status: true, startDate: true },
  });
  if (!project || project.status !== 'preparation') return null;
  const slots = await tx.scheduleSlot.findMany({ where: { projectId } });
  const first = firstPlannedDay(slots.map(toPlanned));
  const current = isoDate(project.startDate);
  if (!first || first === current) return null;
  await tx.project.update({ where: { id: projectId }, data: { startDate: dayDate(first) } });
  return first;
}

export async function loadPlanning(tx: Tx, from: string, to: string): Promise<PlanningDto> {
  const days: PlanningDto['days'] = [];
  for (let d = from; d <= to; d = addDays(d, 1))
    days.push({ day: d, working: isWorkingDay(d), holiday: isBelgianPublicHoliday(d) });

  // Requêtes séquentielles : une transaction n'exécute qu'une requête à la fois.
  const teams = await tx.team.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' } });
  const employees = await tx.employee.findMany({
    where: { active: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  const slots = await tx.scheduleSlot.findMany({
    where: overlapping(from, to),
    orderBy: [{ startDay: 'asc' }, { startHalf: 'asc' }],
  });
  const absences = await tx.absence.findMany({
    where: { startsOn: { lte: dayDate(to) }, endsOn: { gte: dayDate(from) } },
    orderBy: { startsOn: 'asc' },
  });

  // Chantiers à planifier (préparation, en cours, suspendus) + ceux déjà présents sur la période.
  const projects = await tx.project.findMany({
    where: {
      OR: [
        { status: { in: ['preparation', 'in_progress', 'suspended'] } },
        { id: { in: [...new Set(slots.map((s) => s.projectId))] } },
      ],
    },
    include: { customer: true, site: true },
    orderBy: [{ status: 'asc' }, { number: 'asc' }],
  });
  const planned = await tx.scheduleSlot.findMany({
    where: { taskId: { not: null } },
    select: { taskId: true },
  });
  const plannedTaskIds = new Set(planned.map((p) => p.taskId!));
  // Un chantier affecté en bloc (sans tâche précise) a toutes ses tâches planifiées.
  const wholeProjects = new Set(
    (
      await tx.scheduleSlot.findMany({
        where: { taskId: null },
        select: { projectId: true },
        distinct: ['projectId'],
      })
    ).map((s) => s.projectId),
  );
  const taskRows = await tx.task.findMany({
    where: {
      projectId: { in: projects.filter((p) => p.status !== 'suspended').map((p) => p.id) },
      status: { not: 'done' },
    },
    include: { budgetLine: { select: { label: true, position: true } } },
    orderBy: [{ position: 'asc' }],
  });
  const taskTitles = new Map(taskRows.map((t) => [t.id, t.title]));
  const missing = slots.filter((s) => s.taskId && !taskTitles.has(s.taskId)).map((s) => s.taskId!);
  if (missing.length)
    for (const t of await tx.task.findMany({
      where: { id: { in: missing } },
      select: { id: true, title: true },
    }))
      taskTitles.set(t.id, t.title);

  const members = new Map<string, string[]>();
  for (const e of employees) if (e.teamId) members.set(e.teamId, [...(members.get(e.teamId) ?? []), e.id]);

  return {
    from,
    to,
    days,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      memberIds: members.get(t.id) ?? [],
      leaderId: t.leaderEmployeeId,
    })),
    employees: employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      initials: initials(e.firstName, e.lastName),
      teamId: e.teamId,
      jobTitle: e.jobTitle,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      number: p.number,
      name: p.name,
      shortLabel: shortLabel(p.customer, p.site?.city ?? null),
      status: p.status,
      startDate: isoDate(p.startDate),
      endDate: isoDate(p.endDate),
    })),
    slots: slots.map((s) => slotDto(s, s.taskId ? (taskTitles.get(s.taskId) ?? null) : null)),
    absences: absences.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      kind: a.kind,
      startsOn: isoDate(a.startsOn)!,
      endsOn: isoDate(a.endsOn)!,
      halfDay: (a.halfDay as Half | null) ?? null,
    })),
    conflicts: await conflictsBetween(tx, from, to),
    unplannedTasks: taskRows
      .filter((t) => !plannedTaskIds.has(t.id) && !wholeProjects.has(t.projectId))
      .sort(
        (a, b) =>
          (a.budgetLine?.position ?? 999) - (b.budgetLine?.position ?? 999) || a.position - b.position,
      )
      .slice(0, 200)
      .map((t) => ({
        id: t.id,
        projectId: t.projectId,
        title: t.title,
        post: t.budgetLine?.label ?? null,
        plannedHours: t.plannedHours.toString(),
      })),
  };
}
