/**
 * Terrain (03 §7, 02 P4) : journée de l'ouvrier, pointage (idempotent, hors ligne), heures par
 * jour et rapport journalier. Les calculs viennent de `packages/domain/field`.
 */
import { type ClockInputSchema, parseTenantSettings } from '@batimint/contracts';
import { emitEvent, type EventActor, type Tx } from '@batimint/db';
import {
  brusselsDate,
  brusselsMidnight,
  can,
  checkGeofence,
  computeWorkedTime,
  labourCost,
  requiresCheckInOut,
  type Role,
} from '@batimint/domain';
import type { z } from 'zod';
import type { TenantAuthContext } from '../context';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { iso, isoDate } from '../lib/tenant';

export const day = (s: string) => new Date(`${s}T00:00:00Z`);

export function initials(first: string, last: string): string {
  return `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase();
}

export async function employeeOf(tx: Tx, userId: string) {
  return tx.employee.findFirst({ where: { userId, active: true } });
}

export async function tenantSettings(tx: Tx, tenantId: string) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return parseTenantSettings(t.settings);
}

export function projectNeedsCheckInOut(p: {
  contractAmount: bigint;
  workplaceTotalAmount: bigint | null;
  checkInOutForced: boolean;
}): boolean {
  return p.checkInOutForced || requiresCheckInOut(p);
}

/**
 * Chantiers du jour d'un ouvrier : créneaux de planning (personne ou équipe), sinon les chantiers
 * en cours de son équipe, sinon ceux où il est pointé aujourd'hui.
 */
export async function projectsForDay(
  tx: Tx,
  employee: { id: string; teamId: string | null },
  today: string,
): Promise<string[]> {
  const slots = await tx.scheduleSlot.findMany({
    where: {
      startDay: { lte: day(today) },
      endDay: { gte: day(today) },
      OR: [{ employeeId: employee.id }, ...(employee.teamId ? [{ teamId: employee.teamId }] : [])],
    },
    // Affectation personnelle avant celle de l'équipe ; le matin avant l'après-midi.
    orderBy: [{ employeeId: { sort: 'asc', nulls: 'last' } }, { startHalf: 'asc' }, { startDay: 'asc' }],
    select: { projectId: true },
  });
  const ids = [...new Set(slots.map((s) => s.projectId))];
  if (ids.length) return ids;
  const open = await tx.timeEntry.findMany({
    where: { employeeId: employee.id, day: day(today) },
    orderBy: { at: 'desc' },
    select: { projectId: true },
  });
  if (open.length) return [...new Set(open.map((o) => o.projectId))];
  if (!employee.teamId) return [];
  const team = await tx.project.findMany({
    where: { teamId: employee.teamId, status: 'in_progress' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  return team.map((p) => p.id);
}

export function timeEntryDto(e: Awaited<ReturnType<Tx['timeEntry']['findUniqueOrThrow']>>) {
  return {
    id: e.id,
    projectId: e.projectId,
    employeeId: e.employeeId,
    kind: e.kind,
    at: e.at.toISOString(),
    day: isoDate(e.day)!,
    geofence: e.geofence as 'ok' | 'too_far' | 'no_position' | 'no_site_position',
    distanceMeters: e.distanceMeters,
    source: e.source as 'self' | 'team' | 'office',
    offline: e.offline,
    status: e.status,
    onssStatus: e.onssStatus as 'not_required' | 'pending' | 'sent' | 'failed',
    onssError: e.onssError,
  };
}

/** Enregistre un pointage. Rejouer le même identifiant renvoie le pointage déjà reçu. */
export async function recordClock(
  scope: {
    tx: Tx;
    auth: TenantAuthContext;
    actor: EventActor;
    audit: (action: string, entityType: string, entityId: string | null, changes?: unknown) => Promise<void>;
  },
  input: z.infer<typeof ClockInputSchema>,
) {
  const { tx, auth, actor, audit } = scope;
  const existing = await tx.timeEntry.findUnique({ where: { id: input.id } });
  if (existing) return existing;

  const me = await employeeOf(tx, auth.userId);
  const employeeId = input.employeeId ?? me?.id;
  if (!employeeId)
    throw badRequest(
      'no_employee',
      'Votre compte n’est lié à aucune fiche employé : demandez au bureau de la créer.',
    );
  const employee = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!employee || !employee.active) throw notFound('Cette personne');
  const forOther = employee.id !== me?.id;
  if (forOther) {
    // Le chef pointe son équipe ; le bureau peut corriger pour tout le monde.
    const sameTeam = Boolean(me?.teamId && me.teamId === employee.teamId);
    if (!(can(auth.role, 'time.clock_team') && (sameTeam || can(auth.role, 'projects.write'))))
      throw forbidden();
  } else if (!can(auth.role, 'time.clock')) throw forbidden();

  const project = await tx.project.findUnique({ where: { id: input.projectId }, include: { site: true } });
  if (!project) throw notFound('Ce chantier');
  if (project.status === 'closed')
    throw conflict('project_closed', 'Ce chantier est clôturé : le pointage n’est plus possible.');

  const at = new Date(input.at);
  if (at.getTime() > Date.now() + 5 * 60_000)
    throw badRequest(
      'clock_in_future',
      'L’heure du pointage est dans le futur : vérifiez l’heure du téléphone.',
    );
  const today = brusselsDate(at);
  const validated = await tx.timeEntry.findFirst({
    where: { employeeId: employee.id, projectId: project.id, day: day(today), status: 'validated' },
    select: { id: true },
  });
  if (validated && !can(auth.role, 'projects.write'))
    throw conflict(
      'day_validated',
      'Les heures de cette journée sont déjà validées : demandez au bureau de les corriger.',
    );

  const settings = await tenantSettings(tx, auth.tenantId);
  const site =
    project.site?.latitude && project.site.longitude
      ? { latitude: Number(project.site.latitude), longitude: Number(project.site.longitude) }
      : null;
  const position =
    input.latitude !== null &&
    input.latitude !== undefined &&
    input.longitude !== null &&
    input.longitude !== undefined
      ? { latitude: input.latitude, longitude: input.longitude, accuracy: input.accuracy ?? null }
      : null;
  const fence = checkGeofence({ site, position, toleranceMeters: settings.clockInToleranceMeters });

  const entry = await tx.timeEntry.create({
    data: {
      id: input.id,
      tenantId: auth.tenantId,
      projectId: project.id,
      employeeId: employee.id,
      kind: input.kind,
      at,
      day: day(today),
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      accuracyMeters:
        position?.accuracy !== null && position?.accuracy !== undefined
          ? Math.trunc(position.accuracy)
          : null,
      distanceMeters: 'distance' in fence ? fence.distance : null,
      geofence: fence.status,
      source: forOther
        ? can(auth.role, 'projects.write') && !can(auth.role, 'time.clock')
          ? 'office'
          : 'team'
        : 'self',
      offline: input.offline,
      note: input.note ?? null,
      recordedBy: auth.userId,
      onssStatus: projectNeedsCheckInOut(project) ? 'pending' : 'not_required',
    },
  });
  await audit('time_entry.recorded', 'time_entry', entry.id, {
    employeeId: employee.id,
    projectId: project.id,
    kind: input.kind,
    at: entry.at.toISOString(),
    geofence: fence.status,
    offline: input.offline,
  });
  await emitEvent(tx, {
    tenantId: auth.tenantId,
    type: 'time_entry.recorded.v1',
    aggregateType: 'project',
    aggregateId: project.id,
    payload: {
      timeEntryId: entry.id,
      projectId: project.id,
      employeeId: employee.id,
      kind: input.kind,
      day: today,
    },
    actor,
  });
  return entry;
}

/** Erreur métier lisible pour la synchro par lots (l'action est retirée de la file). */
export function actionError(err: unknown): { code: string; message: string } | null {
  if (err instanceof AppError && err.statusCode < 500) return { code: err.code, message: err.message };
  return null;
}

export interface TimesheetFilter {
  projectId?: string;
  employeeIds?: string[];
  from: string;
  to: string;
}

/** Heures par personne et par jour (et par chantier), anomalies comprises. */
export async function timesheet(tx: Tx, tenantId: string, role: Role, f: TimesheetFilter) {
  const entries = await tx.timeEntry.findMany({
    where: {
      ...(f.projectId ? { projectId: f.projectId } : {}),
      ...(f.employeeIds ? { employeeId: { in: f.employeeIds } } : {}),
      day: { gte: day(f.from), lte: day(f.to) },
    },
    orderBy: { at: 'asc' },
  });
  const employees = await tx.employee.findMany({
    where: { id: { in: [...new Set(entries.map((e) => e.employeeId))] } },
  });
  const byId = new Map(employees.map((e) => [e.id, e]));
  const settings = await tenantSettings(tx, tenantId);
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = `${e.employeeId}|${isoDate(e.day)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const withCost = can(role, 'projects.finance.read');
  const now = new Date();
  return [...groups.entries()]
    .map(([k, list]) => {
      const [employeeId, d] = k.split('|') as [string, string];
      const emp = byId.get(employeeId);
      const w = computeWorkedTime(
        list.map((e) => ({ id: e.id, kind: e.kind, at: e.at })),
        { breakMinutes: settings.breakMinutes, breakAfterMinutes: settings.breakAfterMinutes, now },
      );
      const anomalies = new Set<'double_in' | 'out_without_in' | 'too_far' | 'no_position'>(w.anomalies);
      for (const e of list) {
        if (e.geofence === 'too_far') anomalies.add('too_far');
        if (e.geofence === 'no_position') anomalies.add('no_position');
      }
      return {
        employeeId,
        name: emp ? `${emp.firstName} ${emp.lastName}` : '—',
        day: d,
        entries: list.map(timeEntryDto),
        grossMinutes: w.grossMinutes,
        breakMinutes: w.breakMinutes,
        netMinutes: w.netMinutes,
        open: Boolean(w.openSince),
        anomalies: [...anomalies],
        validated: list.every((e) => e.status === 'validated' || e.status === 'transmitted'),
        ...(withCost ? { cost: Number(labourCost(w.netMinutes, emp?.hourlyCost ?? 0n)) } : {}),
      };
    })
    .sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name, 'fr'));
}

/** Rapport journalier : calculé depuis les données du jour, notes du chef conservées. */
export async function dailyReport(tx: Tx, tenantId: string, role: Role, projectId: string, d: string) {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw notFound('Ce chantier');
  const stored = await tx.dailyReport.findUnique({ where: { projectId_day: { projectId, day: day(d) } } });
  const rows = await timesheet(tx, tenantId, role, { projectId, from: d, to: d });
  const start = brusselsMidnight(d);
  const end = new Date(start.getTime() + 86_400_000);
  const inDay = (x: Date) => brusselsDate(x) === d;
  const tasks = (
    await tx.task.findMany({
      where: {
        projectId,
        completedAt: { gte: new Date(start.getTime() - 3_600_000), lt: new Date(end.getTime() + 3_600_000) },
      },
      select: { id: true, title: true, completedAt: true },
    })
  ).filter((t) => t.completedAt && inDay(t.completedAt));
  const photos = (
    await tx.attachment.findMany({
      where: {
        ownerType: 'project',
        ownerId: projectId,
        kind: 'photo',
        createdAt: { gte: new Date(start.getTime() - 3_600_000), lt: new Date(end.getTime() + 3_600_000) },
      },
      orderBy: { createdAt: 'asc' },
    })
  ).filter((p) => inDay(p.takenAt ?? p.createdAt));
  const issues = (
    await tx.issue.findMany({
      where: {
        projectId,
        reportedAt: { gte: new Date(start.getTime() - 3_600_000), lt: new Date(end.getTime() + 3_600_000) },
      },
    })
  ).filter((i) => inDay(i.reportedAt));
  const workOrders = await tx.workOrder.findMany({ where: { projectId, day: day(d) } });
  const closer = stored?.closedBy ? await tx.user.findUnique({ where: { id: stored.closedBy } }) : null;
  return {
    projectId,
    day: d,
    workers: rows.map((r) => ({
      employeeId: r.employeeId,
      name: r.name,
      minutes: r.netMinutes,
      validated: r.validated,
    })),
    tasksCompleted: tasks.map((t) => ({ id: t.id, title: t.title })),
    photos: photos.map((p) => ({ id: p.id, url: `/api/v1/attachments/${p.id}/file`, caption: p.caption })),
    issues: issues.map((i) => ({ id: i.id, title: i.title, urgent: i.urgent })),
    workOrders: workOrders.map((w) => ({ id: w.id, number: w.number, description: w.description })),
    notes: stored?.notes ?? null,
    weather: stored?.weather ?? null,
    closedAt: iso(stored?.closedAt),
    closedBy: closer?.name ?? null,
  };
}
