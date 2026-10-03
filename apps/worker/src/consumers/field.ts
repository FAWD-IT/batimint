/**
 * Terrain (03 §7, 02 P4) — effets secondaires idempotents des pointages et du chantier :
 *  - fil : arrivée de l'équipe (une entrée par jour, visible du client), signalements avec leurs
 *    photos, bons de régie signés ;
 *  - coût main-d'œuvre : recalculé par personne et par jour, réparti sur les postes ;
 *  - Check In and Out (ONSS) : transmission des présences, échec visible et rejouable ;
 *  - temps réel : vue terrain et cockpit.
 */
import {
  parseEventPayload,
  parseTenantSettings,
  projectChannel,
  projectPortalChannel,
  tenantChannel,
} from '@batimint/contracts';
import { emitEvent, loadProjectNumbers, type Tx } from '@batimint/db';
import {
  allocateLabour,
  brusselsDate,
  computeWorkedTime,
  dec,
  formatClockTime,
  labourCost,
} from '@batimint/domain';
import { IntegrationError } from '@batimint/integrations';
import type { Consumer, ConsumerContext } from '../consumer';
import { notify, office } from './shared';

const dayDate = (d: string) => new Date(`${d}T00:00:00Z`);
const SYSTEM = { type: 'system' as const, label: 'Batimint' };

async function publishField(ctx: ConsumerContext, projectId: string, topics: string[]): Promise<void> {
  for (const topic of topics)
    await ctx.publish({ channel: projectChannel(projectId), topic, ref: projectId });
  await ctx.publish({ channel: tenantChannel(ctx.event.tenantId), topic: 'field', ref: projectId });
}

async function recipients(tx: Tx, tenantId: string, managerUserId: string | null): Promise<string[]> {
  const ids = (await office(tx, tenantId)).map((m) => m.userId);
  return managerUserId ? [managerUserId, ...ids] : ids;
}

/** « l'équipe de Karim » (chef d'équipe), sinon le prénom de la personne. */
export async function teamLabelOf(
  tx: Tx,
  employee: { firstName: string; teamId: string | null },
): Promise<{ label: string; isTeam: boolean }> {
  if (employee.teamId) {
    const team = await tx.team.findUnique({ where: { id: employee.teamId } });
    const leader = team?.leaderEmployeeId
      ? await tx.employee.findUnique({ where: { id: team.leaderEmployeeId }, select: { firstName: true } })
      : null;
    if (leader) return { label: leader.firstName, isTeam: true };
    if (team) return { label: team.name, isTeam: true };
  }
  return { label: employee.firstName, isTeam: false };
}

// ---------------------------------------------------------------------------
// Fil du chantier
// ---------------------------------------------------------------------------

async function issuePhotoIds(tx: Tx, issueId: string): Promise<string[]> {
  const rows = await tx.attachment.findMany({
    where: { ownerType: 'issue', ownerId: issueId, kind: 'photo' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export const fieldTimeline: Consumer = {
  name: 'field-timeline',
  events: ['time_entry.recorded.v1', 'issue.reported.v1', 'work_order.signed.v1', 'attachment.added.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const actor = (event.actor as { label?: string } | null)?.label ?? null;
    const base = { tenantId: event.tenantId, eventId: event.id, actorLabel: actor };

    if (event.type === 'attachment.added.v1') {
      // Photo jointe à un signalement : ajoutée à l'entrée du fil de ce signalement.
      const p = parseEventPayload('attachment.added.v1', event.payload);
      if (p.ownerType !== 'issue' || p.kind !== 'photo') return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`issue:${p.ownerId}`}))`;
      const entry = await tx.timelineEntry.findFirst({
        where: { type: 'issue.reported', data: { path: ['issueId'], equals: p.ownerId } },
      });
      if (!entry) return; // l'entrée sera créée avec ses photos
      await tx.timelineEntry.update({
        where: { id: entry.id },
        data: { data: { issueId: p.ownerId, photoIds: await issuePhotoIds(tx, p.ownerId) } },
      });
      if (entry.projectId) await publishField(ctx, entry.projectId, ['timeline', 'issues']);
      return;
    }

    const projectId = (event.payload as { projectId: string }).projectId;
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) return;
    const common = { ...base, customerId: project.customerId, projectId };

    switch (event.type) {
      case 'time_entry.recorded.v1': {
        const p = parseEventPayload('time_entry.recorded.v1', event.payload);
        if (p.kind !== 'in') {
          await publishField(ctx, projectId, ['field', 'timesheet']);
          return;
        }
        const entry = await tx.timeEntry.findUnique({ where: { id: p.timeEntryId } });
        const employee = await tx.employee.findUnique({ where: { id: p.employeeId } });
        if (!entry || !employee) return;
        // Une seule entrée « arrivée » par chantier et par jour : les arrivées suivantes la complètent.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arrival:${projectId}:${p.day}`}))`;
        const existing = await tx.timelineEntry.findFirst({
          where: { projectId, type: 'team.arrived', data: { path: ['day'], equals: p.day } },
        });
        if (existing) {
          const data = existing.data as { employeeIds?: string[] } & Record<string, unknown>;
          const ids = [...new Set([...(data.employeeIds ?? []), employee.id])];
          const earlier = entry.at < existing.occurredAt;
          await tx.timelineEntry.update({
            where: { id: existing.id },
            data: {
              data: { ...data, employeeIds: ids, ...(earlier ? { since: entry.at.toISOString() } : {}) },
              body: `${ids.length} personne${ids.length > 1 ? 's' : ''} sur place`,
              ...(earlier ? { occurredAt: entry.at } : {}),
            },
          });
        } else {
          const team = await teamLabelOf(tx, employee);
          await tx.timelineEntry.create({
            data: {
              ...common,
              type: 'team.arrived',
              title: team.isTeam
                ? `Équipe de ${team.label} arrivée sur chantier`
                : `${team.label} est arrivé·e sur chantier`,
              body: `Pointage à ${formatClockTime(entry.at)}`,
              occurredAt: entry.at,
              visibleToClient: true,
              data: {
                day: p.day,
                teamLabel: team.label,
                isTeam: team.isTeam,
                since: entry.at.toISOString(),
                employeeIds: [employee.id],
              },
            },
          });
        }
        await publishField(ctx, projectId, ['field', 'timesheet', 'timeline']);
        await ctx.publish({
          channel: projectPortalChannel(projectId),
          topic: 'project',
          ref: projectId,
        });
        return;
      }
      case 'issue.reported.v1': {
        const p = parseEventPayload('issue.reported.v1', event.payload);
        const issue = await tx.issue.findUnique({ where: { id: p.issueId } });
        if (!issue) return;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`issue:${issue.id}`}))`;
        const task = issue.taskId ? await tx.task.findUnique({ where: { id: issue.taskId } }) : null;
        await tx.timelineEntry.create({
          data: {
            ...common,
            actorLabel: issue.reporterLabel,
            type: 'issue.reported',
            title: `${issue.urgent ? 'Signalement urgent' : 'Signalement'} : ${issue.title}`,
            body:
              [issue.description, task ? `Tâche : ${task.title}` : null].filter(Boolean).join(' · ') || null,
            occurredAt: issue.reportedAt,
            data: { issueId: issue.id, photoIds: await issuePhotoIds(tx, issue.id) },
          },
        });
        await notify(ctx, await recipients(tx, event.tenantId, project.managerUserId), {
          type: issue.urgent ? 'issue.urgent' : 'issue.reported',
          title: `${issue.urgent ? 'Urgent — ' : ''}${issue.reporterLabel} signale un problème sur ${project.name}`,
          body: issue.title,
          link: `/chantiers/${project.id}?onglet=terrain`,
        });
        await publishField(ctx, projectId, ['timeline', 'issues', 'project']);
        return;
      }
      case 'work_order.signed.v1': {
        const p = parseEventPayload('work_order.signed.v1', event.payload);
        const w = await tx.workOrder.findUnique({ where: { id: p.workOrderId } });
        if (!w) return;
        await tx.timelineEntry.create({
          data: {
            ...common,
            type: 'work_order.signed',
            title: `Bon de régie ${w.number ?? ''} signé par ${w.signerName ?? 'le client'}`.replace(
              '  ',
              ' ',
            ),
            body: w.description.split('\n')[0]!.slice(0, 300),
            occurredAt: w.signedAt ?? event.occurredAt,
            visibleToClient: true,
            data: { workOrderId: w.id },
          },
        });
        await notify(ctx, await recipients(tx, event.tenantId, project.managerUserId), {
          type: 'work_order.signed',
          title: `Bon de régie signé sur ${project.name}`,
          body: `${w.number ?? ''} · ${w.signerName ?? ''} — à facturer en régie`,
          link: `/chantiers/${project.id}?onglet=terrain`,
        });
        await publishField(ctx, projectId, ['timeline', 'work_orders', 'project']);
        await ctx.publish({ channel: projectPortalChannel(projectId), topic: 'project', ref: projectId });
        return;
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Coût main-d'œuvre (04 « Engagé ») : recalculé à chaque pointage, par personne et par jour
// ---------------------------------------------------------------------------

export const LABOUR_SOURCE = 'time_entry';

export async function recomputeLabour(
  ctx: ConsumerContext,
  input: { projectId: string; employeeId: string; day: string },
): Promise<void> {
  const { tx, event } = ctx;
  const { projectId, employeeId, day } = input;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`labour:${projectId}:${employeeId}:${day}`}))`;
  const project = await tx.project.findUnique({ where: { id: projectId } });
  const employee = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!project || !employee) return;
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: event.tenantId },
    select: { settings: true },
  });
  const settings = parseTenantSettings(tenant.settings);
  const entries = await tx.timeEntry.findMany({
    where: { projectId, employeeId, day: dayDate(day) },
    orderBy: { at: 'asc' },
  });
  const w = computeWorkedTime(
    entries.map((e) => ({ id: e.id, kind: e.kind, at: e.at })),
    { breakMinutes: settings.breakMinutes, breakAfterMinutes: settings.breakAfterMinutes },
  );
  const cost = labourCost(w.netMinutes, employee.hourlyCost);

  // Postes touchés ce jour-là (tâches avancées ou terminées), sinon prorata du reste à faire.
  const lines = await tx.budgetLine.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
  const threshold = dec(settings.driftThresholdPercent).dividedBy(100).toString();
  const numbers = (await loadProjectNumbers(tx, [project], threshold)).get(projectId);
  const progressOf = new Map(numbers?.fin.lines.map((l) => [l.id, l.progress.toString()]) ?? []);
  const tasks = await tx.task.findMany({
    where: { projectId, budgetLineId: { not: null } },
    select: { budgetLineId: true, updatedAt: true, completedAt: true, assigneeEmployeeId: true },
  });
  const touched = new Set(
    tasks
      .filter(
        (t) =>
          brusselsDate(t.completedAt ?? t.updatedAt) === day &&
          (!t.assigneeEmployeeId || t.assigneeEmployeeId === employeeId),
      )
      .map((t) => t.budgetLineId!),
  );
  const shares = allocateLabour(
    cost,
    lines.map((l) => ({
      id: l.id,
      plannedHours: l.laborHours.toString(),
      progress: progressOf.get(l.id) ?? '0',
      touchedToday: touched.has(l.id),
    })),
  );
  const rows: { budgetLineId: string | null; amount: bigint }[] =
    cost > 0n && !shares.length ? [{ budgetLineId: null, amount: cost }] : shares;

  const prefix = `${employeeId}:${day}:`;
  const current = await tx.projectCost.findMany({
    where: { projectId, category: 'labour', sourceType: LABOUR_SOURCE, sourceId: { startsWith: prefix } },
  });
  const wanted = new Map(rows.map((r) => [`${prefix}${r.budgetLineId ?? 'none'}`, r]));
  const stale = current.filter((c) => !wanted.has(c.sourceId)).map((c) => c.id);
  if (stale.length) await tx.projectCost.deleteMany({ where: { id: { in: stale } } });
  const label = `Main-d’œuvre ${employee.firstName} ${employee.lastName.slice(0, 1)}. — ${day.split('-').reverse().join('/')}`;
  for (const [sourceId, r] of wanted) {
    const before = current.find((c) => c.sourceId === sourceId);
    if (before && before.amount === r.amount && before.budgetLineId === r.budgetLineId) continue;
    const row = await tx.projectCost.upsert({
      where: {
        tenantId_category_sourceType_sourceId: {
          tenantId: event.tenantId,
          category: 'labour',
          sourceType: LABOUR_SOURCE,
          sourceId,
        },
      },
      create: {
        tenantId: event.tenantId,
        projectId,
        budgetLineId: r.budgetLineId,
        category: 'labour',
        sourceType: LABOUR_SOURCE,
        sourceId,
        label,
        amount: r.amount,
        occurredAt: entries.at(-1)?.at ?? new Date(),
      },
      update: { amount: r.amount, budgetLineId: r.budgetLineId, label },
    });
    await emitEvent(tx, {
      tenantId: event.tenantId,
      type: 'project.cost_recorded.v1',
      aggregateType: 'project',
      aggregateId: projectId,
      payload: {
        projectId,
        costId: row.id,
        budgetLineId: row.budgetLineId,
        category: 'labour',
        amount: row.amount.toString(),
      },
      actor: SYSTEM,
    });
  }
  if (stale.length || wanted.size) await publishField(ctx, projectId, ['project', 'budget']);
}

export const labourCosts: Consumer = {
  name: 'labour-costs',
  events: ['time_entry.recorded.v1', 'time_entries.validated.v1'],
  async handle(ctx) {
    const { event } = ctx;
    if (event.type === 'time_entry.recorded.v1') {
      const p = parseEventPayload('time_entry.recorded.v1', event.payload);
      await recomputeLabour(ctx, p);
      return;
    }
    const p = parseEventPayload('time_entries.validated.v1', event.payload);
    for (const employeeId of p.employeeIds)
      await recomputeLabour(ctx, { projectId: p.projectId, employeeId, day: p.day });
  },
};

// ---------------------------------------------------------------------------
// Check In and Out at Work (05 §8)
// ---------------------------------------------------------------------------

export const checkInOutTransmission: Consumer = {
  name: 'check-in-out',
  events: ['time_entry.recorded.v1', 'attendance.retry_requested.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const ids =
      event.type === 'time_entry.recorded.v1'
        ? [parseEventPayload('time_entry.recorded.v1', event.payload).timeEntryId]
        : parseEventPayload('attendance.retry_requested.v1', event.payload).timeEntryIds;
    const entries = await tx.timeEntry.findMany({
      where: { id: { in: ids }, onssStatus: { in: ['pending', 'failed'] } },
      orderBy: { at: 'asc' },
    });
    if (!entries.length) return;
    const project = await tx.project.findUniqueOrThrow({
      where: { id: entries[0]!.projectId },
      include: { site: true, tenant: true },
    });
    const { workplaceId } = await deps.integrations.attendance.declareWorkplace({
      reference: project.number,
      name: project.name,
      address: project.site?.street ?? '',
      postalCode: project.site?.postalCode ?? '',
      city: project.site?.city ?? '',
      startDate: project.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: project.endDate?.toISOString().slice(0, 10) ?? null,
      contractor: {
        enterpriseNumber: project.tenant.enterpriseNumber,
        name: project.tenant.legalName ?? project.tenant.name,
      },
    });
    const failures: string[] = [];
    for (const e of entries) {
      const emp = await tx.employee.findUniqueOrThrow({ where: { id: e.employeeId } });
      let inss: string | null = null;
      if (emp.inssEnc && deps.cipher) {
        try {
          inss = deps.cipher.decrypt(emp.inssEnc);
        } catch {
          inss = null;
        }
      }
      try {
        const receipt = await deps.integrations.attendance.registerPresence({
          kind: e.kind,
          at: e.at,
          workplaceId,
          worker: {
            employeeId: emp.id,
            name: `${emp.firstName} ${emp.lastName}`,
            inss,
            isSelfEmployed: emp.isSubcontractor,
          },
        });
        await tx.timeEntry.update({
          where: { id: e.id },
          data: { onssStatus: 'sent', onssReference: receipt.reference, onssError: null },
        });
      } catch (err) {
        // Panne passagère : pg-boss rejoue le job. Refus définitif : visible et rejouable.
        if (!(err instanceof IntegrationError) || err.retryable) throw err;
        await tx.timeEntry.update({
          where: { id: e.id },
          data: { onssStatus: 'failed', onssError: err.message },
        });
        failures.push(err.message);
      }
    }
    if (failures.length)
      await notify(ctx, await recipients(tx, event.tenantId, project.managerUserId), {
        type: 'onss.failed',
        title: `Présence non transmise à l’ONSS sur ${project.name}`,
        body: failures[0]!,
        link: `/chantiers/${project.id}?onglet=terrain`,
      });
    await publishField(ctx, project.id, ['timesheet']);
  },
};

export const fieldRealtime: Consumer = {
  name: 'field-realtime',
  events: ['time_entries.validated.v1'],
  async handle(ctx) {
    const p = parseEventPayload('time_entries.validated.v1', ctx.event.payload);
    await publishField(ctx, p.projectId, ['field', 'timesheet', 'daily_report']);
  },
};
