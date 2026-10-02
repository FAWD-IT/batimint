/**
 * Terrain (03 §7, 02 P4) : journée de l'ouvrier, pointage et synchro hors ligne par lots,
 * signalements (→ avenant), bons de régie signés sur le chantier, heures et validation par le
 * chef, rapport journalier, export de secours Check In and Out.
 */
import {
  ClockInputSchema,
  DailyReportSchema,
  DailyReportUpdateSchema,
  FieldSyncRequestSchema,
  FieldSyncResponseSchema,
  FieldTodaySchema,
  IssueInputSchema,
  IssueSchema,
  OkSchema,
  parseTenantSettings,
  type TaskFieldUpdateSchema,
  TimeEntrySchema,
  TimesheetSchema,
  TimeValidateSchema,
  WorkOrderInputSchema,
  WorkOrderSchema,
  WorkOrderSignSchema,
} from '@batimint/contracts';
import { emitEvent, nextSequenceValue, type Tx } from '@batimint/db';
import { renderWorkOrderPdf, sha256 } from '@batimint/documents';
import {
  brusselsDate,
  brusselsMidnight,
  can,
  computeWorkedTime,
  dec,
  formatDocumentNumber,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { inTenant, iso, isoDate, type TenantScope } from '../lib/tenant';
import {
  actionError,
  dailyReport,
  day,
  employeeOf,
  initials,
  projectNeedsCheckInOut,
  projectsForDay,
  recordClock,
  tenantSettings,
  timeEntryDto,
  timesheet,
} from '../services/field';
import { addressLines } from '../services/quotes';

const IsoDay = z.iso.date();

async function issueDto(tx: Tx, i: Awaited<ReturnType<Tx['issue']['findUniqueOrThrow']>>) {
  const media = await tx.attachment.findMany({
    where: { ownerType: 'issue', ownerId: i.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, transcript: true, transcriptStatus: true },
  });
  const url = (id: string) => `/api/v1/attachments/${id}/file`;
  return {
    id: i.id,
    projectId: i.projectId,
    taskId: i.taskId,
    title: i.title,
    description: i.description,
    urgent: i.urgent,
    status: i.status,
    changeOrderId: i.changeOrderId,
    reporterLabel: i.reporterLabel,
    reportedAt: i.reportedAt.toISOString(),
    photos: media.filter((m) => m.kind === 'photo').map((m) => ({ id: m.id, url: url(m.id) })),
    voiceNotes: media
      .filter((m) => m.kind === 'voice_note')
      .map((m) => ({
        id: m.id,
        url: url(m.id),
        transcript: m.transcript,
        transcriptStatus: m.transcriptStatus,
      })),
  };
}

function workOrderDto(
  w: Awaited<ReturnType<Tx['workOrder']['findUniqueOrThrow']>> & {
    lines: {
      kind: string;
      description: string;
      employeeId: string | null;
      quantity: { toString(): string };
      unit: string;
    }[];
  },
) {
  return {
    id: w.id,
    projectId: w.projectId,
    number: w.number,
    day: isoDate(w.day)!,
    description: w.description,
    status: w.status,
    signerName: w.signerName,
    signedAt: iso(w.signedAt),
    lines: w.lines.map((l) => ({
      kind: l.kind as 'labour' | 'material',
      description: l.description,
      employeeId: l.employeeId,
      quantity: l.quantity.toString(),
      unit: l.unit,
    })),
    createdAt: w.createdAt.toISOString(),
  };
}

type WorkOrderForPdf = Awaited<ReturnType<Tx['workOrder']['findUniqueOrThrow']>> & {
  lines: { kind: string; description: string; quantity: { toString(): string }; unit: string }[];
  project: {
    number: string;
    name: string;
    customer: { displayName: string };
    site: { street: string; postalCode: string; city: string } | null;
    tenant: Parameters<typeof addressLines>[0] & {
      name: string;
      legalName: string | null;
      vatNumber: string | null;
      brandColor: string | null;
    };
  };
};

const WORK_ORDER_PDF_INCLUDE = {
  lines: { orderBy: { position: 'asc' as const } },
  project: { include: { customer: true, site: true, tenant: true } },
};

function workOrderPdf(
  w: WorkOrderForPdf,
  number: string | null,
  signature: { signerName: string; signedAt: Date; ip: string | null } | null,
): Promise<Buffer> {
  const t = w.project.tenant;
  return renderWorkOrderPdf({
    tenant: {
      name: t.legalName ?? t.name,
      lines: [...addressLines(t), ...(t.vatNumber ? [`TVA ${t.vatNumber}`] : [])],
      brandColor: t.brandColor,
    },
    customer: { name: w.project.customer.displayName },
    site: w.project.site
      ? `${w.project.site.street}, ${w.project.site.postalCode} ${w.project.site.city}`
      : null,
    projectRef: `${w.project.number} — ${w.project.name}`,
    workOrder: {
      number,
      day: w.day,
      description: w.description,
      lines: w.lines.map((l) => ({
        kind: l.kind as 'labour' | 'material',
        description: l.description,
        quantity: l.quantity.toString(),
        unit: l.unit,
      })),
    },
    signature,
  });
}

/** Signalement (idempotent par identifiant généré sur le téléphone). */
async function createIssue(scope: TenantScope, input: z.infer<typeof IssueInputSchema>) {
  const { tx, auth, actor } = scope;
  if (!can(auth.role, 'field.report')) throw forbidden();
  const existing = await tx.issue.findUnique({ where: { id: input.id } });
  if (existing) return existing;
  const project = await tx.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
  if (!project) throw notFound('Ce chantier');
  if (input.taskId && !(await tx.task.findFirst({ where: { id: input.taskId, projectId: project.id } })))
    throw notFound('Cette tâche');
  const issue = await tx.issue.create({
    data: {
      id: input.id,
      tenantId: auth.tenantId,
      projectId: project.id,
      taskId: input.taskId ?? null,
      title: input.title,
      description: input.description ?? null,
      urgent: input.urgent,
      reportedBy: auth.userId,
      reporterLabel: auth.name,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      reportedAt: new Date(input.at),
    },
  });
  await emitEvent(tx, {
    tenantId: auth.tenantId,
    type: 'issue.reported.v1',
    aggregateType: 'project',
    aggregateId: project.id,
    payload: { issueId: issue.id, projectId: project.id, urgent: issue.urgent },
    actor,
  });
  return issue;
}

/** Avancement d'une tâche depuis le terrain (tâche cochée, pourcentage). */
async function updateTaskFromField(scope: TenantScope, input: z.infer<typeof TaskFieldUpdateSchema>) {
  const { tx, auth, actor } = scope;
  if (!can(auth.role, 'tasks.update')) throw forbidden();
  const t = await tx.task.findFirst({ where: { id: input.taskId, projectId: input.projectId } });
  if (!t) throw notFound('Cette tâche');
  let status = input.status ?? (t.status as 'todo' | 'in_progress' | 'done');
  let progress = dec(t.progress.toString());
  if (input.progressPercent !== undefined) {
    progress = dec(input.progressPercent).dividedBy(100);
    if (input.status === undefined)
      status = progress.greaterThanOrEqualTo(1) ? 'done' : progress.isZero() ? 'todo' : 'in_progress';
  }
  if (status === 'done') progress = dec(1);
  if (status === 'todo' && input.progressPercent === undefined) progress = dec(0);
  const completed = status === 'done' && t.status !== 'done';
  const updated = await tx.task.update({
    where: { id: t.id },
    data: {
      status,
      progress: progress.toString(),
      completedAt: status === 'done' ? (t.completedAt ?? new Date()) : null,
      completedBy: status === 'done' ? (t.completedBy ?? auth.userId) : null,
    },
  });
  await emitEvent(tx, {
    tenantId: auth.tenantId,
    type: completed ? 'task.completed.v1' : 'task.updated.v1',
    aggregateType: 'project',
    aggregateId: t.projectId,
    payload: completed
      ? { projectId: t.projectId, taskId: t.id, budgetLineId: t.budgetLineId }
      : { projectId: t.projectId, taskId: t.id, fields: ['status', 'progress'] },
    actor,
  });
  return updated;
}

export const fieldRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  // -------------------------------------------------------------------------
  // Journée de l'ouvrier
  // -------------------------------------------------------------------------
  app.get(
    '/field/today',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Mon chantier du jour : adresse, équipe, pointage, tâches',
        querystring: z.object({ projectId: z.uuid().optional() }),
        response: { 200: FieldTodaySchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx, auth }) => {
        const today = brusselsDate(new Date());
        const me = await employeeOf(tx, auth.userId);
        const ids = me ? await projectsForDay(tx, me, today) : [];
        const chosenId = req.query.projectId ?? ids[0] ?? null;
        const settings = await tenantSettings(tx, auth.tenantId);
        const project = chosenId
          ? await tx.project.findUnique({ where: { id: chosenId }, include: { site: true, customer: true } })
          : null;
        const others = ids.length
          ? await tx.project.findMany({
              where: { id: { in: ids.filter((id) => id !== chosenId) } },
              select: { id: true, name: true, number: true },
            })
          : [];
        const entries = project
          ? await tx.timeEntry.findMany({
              where: { projectId: project.id, day: day(today) },
              orderBy: { at: 'asc' },
            })
          : [];
        const teamIds = new Set<string>(entries.map((e) => e.employeeId));
        if (me?.teamId)
          for (const e of await tx.employee.findMany({
            where: { teamId: me.teamId, active: true },
            select: { id: true },
          }))
            teamIds.add(e.id);
        if (project?.teamId)
          for (const e of await tx.employee.findMany({
            where: { teamId: project.teamId, active: true },
            select: { id: true },
          }))
            teamIds.add(e.id);
        const people = teamIds.size
          ? await tx.employee.findMany({
              where: { id: { in: [...teamIds] } },
              orderBy: [{ firstName: 'asc' }],
            })
          : [];
        const team = people.map((p) => {
          const mine = entries.filter((e) => e.employeeId === p.id);
          const last = mine.at(-1);
          return {
            employeeId: p.id,
            name: `${p.firstName} ${p.lastName}`,
            initials: initials(p.firstName, p.lastName),
            onSite: last?.kind === 'in',
            since: last?.kind === 'in' ? last.at.toISOString() : null,
          };
        });
        const mine = me ? entries.filter((e) => e.employeeId === me.id) : [];
        const w = computeWorkedTime(
          mine.map((e) => ({ id: e.id, kind: e.kind, at: e.at })),
          {
            breakMinutes: settings.breakMinutes,
            breakAfterMinutes: settings.breakAfterMinutes,
            now: new Date(),
          },
        );
        const openMinutes = w.sessions.find((s) => !s.end)?.minutes ?? 0;
        // Tâches du jour : en cours, terminées aujourd'hui, assignées à moi ; complétées par les
        // suivantes à faire (ordre du devis) pour en montrer au moins trois, six au plus.
        const candidates = project
          ? await tx.task.findMany({
              where: {
                projectId: project.id,
                OR: [{ status: { not: 'done' } }, { completedAt: { gte: brusselsMidnight(today) } }],
              },
              include: { budgetLine: { select: { label: true, position: true } } },
              orderBy: [{ position: 'asc' }],
              take: 200,
            })
          : [];
        const rank = (x: (typeof candidates)[number]) => x.budgetLine?.position ?? 999;
        candidates.sort((a, b) => rank(a) - rank(b) || a.position - b.position);
        const focus = candidates.filter(
          (x) =>
            x.status !== 'todo' ||
            (me && x.assigneeEmployeeId === me.id) ||
            (x.completedAt && x.completedAt >= brusselsMidnight(today)),
        );
        const upcoming = candidates.filter((x) => !focus.includes(x) && !x.assigneeEmployeeId);
        const tasks = [...focus, ...upcoming.slice(0, Math.max(0, 3 - focus.length))].slice(0, 6);
        const photoCounts = tasks.length
          ? await tx.attachment.groupBy({
              by: ['taskId'],
              where: { taskId: { in: tasks.map((t) => t.id) }, kind: 'photo' },
              _count: true,
            })
          : [];
        const photos = new Map(photoCounts.map((p) => [p.taskId, p._count]));
        return {
          day: today,
          employee: me
            ? {
                id: me.id,
                firstName: me.firstName,
                name: `${me.firstName} ${me.lastName}`,
                teamId: me.teamId,
              }
            : null,
          project: project
            ? {
                id: project.id,
                number: project.number,
                name: project.name,
                address: project.site
                  ? `${project.site.street}, ${project.site.postalCode} ${project.site.city}`
                  : null,
                latitude: project.site?.latitude ? Number(project.site.latitude) : null,
                longitude: project.site?.longitude ? Number(project.site.longitude) : null,
                customerName: project.customer.displayName,
                customerPhone: project.customer.phone,
                accessNotes: project.site?.accessNotes ?? null,
                checkInOut: projectNeedsCheckInOut(project),
              }
            : null,
          otherProjects: others,
          team,
          clock: {
            status: w.openSince ? ('in' as const) : ('out' as const),
            since: w.openSince?.toISOString() ?? null,
            workedMinutes: w.netMinutes + openMinutes,
            validated: mine.length > 0 && mine.every((e) => e.status === 'validated'),
          },
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status as 'todo' | 'in_progress' | 'done',
            progress: t.status === 'done' ? '1' : t.progress.toString(),
            post: t.budgetLine?.label ?? null,
            photoCount: photos.get(t.id) ?? 0,
          })),
          openIssues: project
            ? await tx.issue.count({ where: { projectId: project.id, status: 'open' } })
            : 0,
          draftWorkOrders: project
            ? await tx.workOrder.count({ where: { projectId: project.id, status: 'draft' } })
            : 0,
          toleranceMeters: settings.clockInToleranceMeters,
          can: {
            clockTeam: can(auth.role, 'time.clock_team'),
            validate: can(auth.role, 'time.validate'),
            workOrders: can(auth.role, 'work_orders.create'),
          },
        };
      }),
  );

  app.get(
    '/field/hours',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Mes heures (tous chantiers), par jour',
        querystring: z.object({ from: IsoDay.optional(), to: IsoDay.optional() }),
        response: { 200: TimesheetSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx, auth }) => {
        const to = req.query.to ?? brusselsDate(new Date());
        const from =
          req.query.from ?? brusselsDate(new Date(Date.parse(`${to}T12:00:00Z`) - 13 * 86_400_000));
        const me = await employeeOf(tx, auth.userId);
        if (!me) return { from, to, rows: [] };
        return {
          from,
          to,
          rows: await timesheet(tx, auth.tenantId, auth.role, { employeeIds: [me.id], from, to }),
        };
      }),
  );

  app.post(
    '/field/clock',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Pointer l’arrivée ou le départ (identifiant généré sur le téléphone)',
        body: ClockInputSchema,
        response: { 200: TimeEntrySchema },
      },
    },
    (req) => inTenant(deps, req, null, async (scope) => timeEntryDto(await recordClock(scope, req.body))),
  );

  app.post(
    '/field/sync',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Synchronisation hors ligne par lots (pointages, tâches, signalements)',
        body: FieldSyncRequestSchema,
        response: { 200: FieldSyncResponseSchema },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const results: z.infer<typeof FieldSyncResponseSchema>['results'] = [];
      // Une transaction par action : une action refusée ne bloque pas les suivantes.
      for (const action of req.body.actions) {
        try {
          const r = await inTenant(deps, req, null, async (scope) => {
            if (action.type === 'clock') {
              const e = await recordClock(scope, action.data);
              return { geofence: e.geofence as 'ok' | 'too_far' | 'no_position' | 'no_site_position' };
            }
            if (action.type === 'task') {
              await updateTaskFromField(scope, action.data);
              return {};
            }
            await createIssue(scope, action.data);
            return {};
          });
          results.push({ id: action.id, ok: true, error: null, ...r });
        } catch (err) {
          const e = actionError(err);
          if (!e) throw err; // erreur technique : le téléphone réessaiera tout le lot
          results.push({ id: action.id, ok: false, error: e });
        }
      }
      return { results };
    },
  );

  // -------------------------------------------------------------------------
  // Signalements
  // -------------------------------------------------------------------------
  app.post(
    '/issues',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Signaler un problème sur le chantier',
        body: IssueInputSchema,
        response: { 201: IssueSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, null, async (scope) =>
        issueDto(scope.tx, await createIssue(scope, req.body)),
      );
      return reply.status(201).send(dto);
    },
  );

  app.get(
    '/projects/:id/issues',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Signalements du chantier',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ items: z.array(IssueSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx }) => {
        const rows = await tx.issue.findMany({
          where: { projectId: req.params.id },
          orderBy: { reportedAt: 'desc' },
        });
        const items = [];
        for (const r of rows) items.push(await issueDto(tx, r));
        return { items };
      }),
  );

  app.patch(
    '/issues/:id',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Marquer un signalement résolu (ou le rouvrir)',
        params: z.object({ id: z.uuid() }),
        body: z.object({ status: z.enum(['open', 'resolved']) }),
        response: { 200: IssueSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor }) => {
        const i = await tx.issue.findUnique({ where: { id: req.params.id } });
        if (!i) throw notFound('Ce signalement');
        const updated = await tx.issue.update({
          where: { id: i.id },
          data: { status: req.body.status, resolvedAt: req.body.status === 'resolved' ? new Date() : null },
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.updated.v1',
          aggregateType: 'project',
          aggregateId: i.projectId,
          payload: { projectId: i.projectId, fields: ['issues'] },
          actor,
        });
        return issueDto(tx, updated);
      }),
  );

  app.post(
    '/issues/:id/change-order',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Créer l’avenant à partir du signalement (02 P5.1)',
        params: z.object({ id: z.uuid() }),
        response: { 201: z.object({ changeOrderId: z.uuid() }) },
      },
    },
    async (req, reply) => {
      const res = await inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const i = await tx.issue.findUnique({ where: { id: req.params.id } });
        if (!i) throw notFound('Ce signalement');
        if (i.changeOrderId) return { changeOrderId: i.changeOrderId };
        await tx.$queryRaw`SELECT 1 FROM projects WHERE id = ${i.projectId}::uuid FOR UPDATE`;
        const last = await tx.changeOrder.aggregate({
          where: { projectId: i.projectId },
          _max: { ordinal: true },
        });
        const co = await tx.changeOrder.create({
          data: {
            id: uuidv7(),
            tenantId: auth.tenantId,
            projectId: i.projectId,
            ordinal: (last._max.ordinal ?? 0) + 1,
            title: i.title,
            description: i.description,
            issueId: i.id,
            createdBy: auth.userId,
          },
        });
        await tx.issue.update({
          where: { id: i.id },
          data: { status: 'change_order', changeOrderId: co.id },
        });
        await audit('change_order.created', 'change_order', co.id, { fromIssue: i.id, ordinal: co.ordinal });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'change_order.created.v1',
          aggregateType: 'project',
          aggregateId: i.projectId,
          payload: { projectId: i.projectId, changeOrderId: co.id },
          actor,
        });
        return { changeOrderId: co.id };
      });
      return reply.status(201).send(res);
    },
  );

  // -------------------------------------------------------------------------
  // Bons de régie
  // -------------------------------------------------------------------------
  app.post(
    '/work-orders',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Préparer un bon de régie (brouillon, sans prix)',
        body: WorkOrderInputSchema,
        response: { 200: WorkOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'work_orders.create', async ({ tx, auth }) => {
        const b = req.body;
        const existing = await tx.workOrder.findUnique({ where: { id: b.id } });
        if (existing && existing.status !== 'draft')
          throw conflict('work_order_signed', 'Ce bon de régie est signé : il ne se modifie plus.');
        if (!(await tx.project.findUnique({ where: { id: b.projectId }, select: { id: true } })))
          throw notFound('Ce chantier');
        if (existing) {
          await tx.workOrderLine.deleteMany({ where: { workOrderId: b.id } });
          await tx.workOrder.update({
            where: { id: b.id },
            data: { description: b.description, day: day(b.day) },
          });
        } else {
          await tx.workOrder.create({
            data: {
              id: b.id,
              tenantId: auth.tenantId,
              projectId: b.projectId,
              day: day(b.day),
              description: b.description,
              createdBy: auth.userId,
            },
          });
        }
        await tx.workOrderLine.createMany({
          data: b.lines.map((l, position) => ({
            tenantId: auth.tenantId,
            workOrderId: b.id,
            position,
            kind: l.kind,
            description: l.description,
            employeeId: l.employeeId ?? null,
            quantity: l.quantity,
            unit: l.unit,
          })),
        });
        return workOrderDto(
          await tx.workOrder.findUniqueOrThrow({
            where: { id: b.id },
            include: { lines: { orderBy: { position: 'asc' } } },
          }),
        );
      }),
  );

  app.post(
    '/work-orders/:id/sign',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Faire signer le bon de régie au client, sur le téléphone',
        params: z.object({ id: z.uuid() }),
        body: WorkOrderSignSchema,
        response: { 200: WorkOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'work_orders.create', async ({ tx, auth, actor, audit }) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM work_orders WHERE id = ${req.params.id}::uuid FOR UPDATE`;
        if (!locked[0]) throw notFound('Ce bon de régie');
        const w = await tx.workOrder.findUniqueOrThrow({
          where: { id: req.params.id },
          include: {
            lines: { orderBy: { position: 'asc' } },
            project: { include: { customer: true, site: true, tenant: true } },
          },
        });
        if (w.status !== 'draft') throw conflict('work_order_signed', 'Ce bon de régie est déjà signé.');
        const now = new Date();
        const year = now.getFullYear();
        const pattern = parseTenantSettings(w.project.tenant.settings).numbering.work_order;
        const number = formatDocumentNumber(pattern, {
          year,
          sequence: await nextSequenceValue(tx, auth.tenantId, 'work_order', year),
        });
        const pdf = await workOrderPdf(w, number, {
          signerName: req.body.signerName,
          signedAt: now,
          ip: req.ip,
        });
        const hash = sha256(pdf);
        const key = `t/${auth.tenantId}/work-orders/${w.id}/${number}-signe.pdf`;
        await deps.integrations.storage.put({
          bucket: 'legal',
          key,
          body: pdf,
          contentType: 'application/pdf',
          metadata: { sha256: hash },
        });
        const sig = await tx.signature.create({
          data: {
            tenantId: auth.tenantId,
            subjectType: 'work_order',
            subjectId: w.id,
            signerName: req.body.signerName,
            signerEmail: w.project.customer.email,
            signatureImage: req.body.signaturePath ?? null,
            acceptedTerms: true,
            ip: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
            documentSha256: hash,
            documentKey: key,
            signedAt: now,
          },
        });
        const signed = await tx.workOrder.update({
          where: { id: w.id },
          data: {
            status: 'signed',
            number,
            signerName: req.body.signerName,
            signedAt: now,
            signatureId: sig.id,
            pdfKey: key,
          },
          include: { lines: { orderBy: { position: 'asc' } } },
        });
        await audit('work_order.signed', 'work_order', w.id, {
          number,
          signerName: req.body.signerName,
          documentSha256: hash,
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'work_order.signed.v1',
          aggregateType: 'project',
          aggregateId: w.projectId,
          payload: { workOrderId: w.id, projectId: w.projectId, signatureId: sig.id },
          actor,
        });
        return workOrderDto(signed);
      }),
  );

  app.get(
    '/projects/:id/work-orders',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Bons de régie du chantier',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ items: z.array(WorkOrderSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx }) => ({
        items: (
          await tx.workOrder.findMany({
            where: { projectId: req.params.id },
            include: { lines: { orderBy: { position: 'asc' } } },
            orderBy: { createdAt: 'desc' },
          })
        ).map(workOrderDto),
      })),
  );

  app.get(
    '/work-orders/:id/pdf',
    {
      schema: {
        tags: ['terrain'],
        summary: 'PDF du bon de régie signé',
        params: z.object({ id: z.uuid() }),
        hide: true,
      },
    },
    async (req, reply) => {
      const { w, pdf } = await inTenant(deps, req, 'projects.read', async ({ tx }) => {
        const w = await tx.workOrder.findUnique({
          where: { id: req.params.id },
          include: WORK_ORDER_PDF_INCLUDE,
        });
        if (!w || w.status === 'draft') throw notFound('Ce bon de régie signé');
        if (w.pdfKey) return { w, pdf: Buffer.from(await deps.integrations.storage.get('legal', w.pdfKey)) };
        // Bon signé sans PDF conservé (données importées) : régénéré depuis la signature.
        const sig = w.signatureId ? await tx.signature.findUnique({ where: { id: w.signatureId } }) : null;
        return {
          w,
          pdf: await workOrderPdf(
            w,
            w.number,
            sig ? { signerName: sig.signerName, signedAt: sig.signedAt, ip: sig.ip } : null,
          ),
        };
      });
      const body = pdf;
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${w.number ?? 'bon-de-regie'}.pdf"`)
        .send(Buffer.from(body));
    },
  );

  // -------------------------------------------------------------------------
  // Heures, validation par le chef, rapport journalier
  // -------------------------------------------------------------------------
  app.get(
    '/projects/:id/timesheet',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Heures par personne et par jour (anomalies, validation)',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ from: IsoDay.optional(), to: IsoDay.optional() }),
        response: { 200: TimesheetSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx, auth }) => {
        const to = req.query.to ?? brusselsDate(new Date());
        const from =
          req.query.from ?? brusselsDate(new Date(Date.parse(`${to}T12:00:00Z`) - 13 * 86_400_000));
        // L'Ouvrier ne voit que ses propres heures.
        const me = await employeeOf(tx, auth.userId);
        const own = !can(auth.role, 'time.validate') && !can(auth.role, 'projects.write');
        if (own && !me) return { from, to, rows: [] };
        const rows = await timesheet(tx, auth.tenantId, auth.role, {
          projectId: req.params.id,
          from,
          to,
          ...(own ? { employeeIds: [me!.id] } : {}),
        });
        return { from, to, rows };
      }),
  );

  app.post(
    '/projects/:id/timesheet/validate',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Valider les heures d’une journée (chef de chantier)',
        params: z.object({ id: z.uuid() }),
        body: TimeValidateSchema,
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'time.validate', async ({ tx, auth, actor, audit }) => {
        const { day: d, employeeIds } = req.body;
        const entries = await tx.timeEntry.findMany({
          where: { projectId: req.params.id, day: day(d), employeeId: { in: employeeIds } },
        });
        if (!entries.length)
          throw badRequest('nothing_to_validate', 'Aucun pointage à valider pour cette journée.');
        const settings = await tenantSettings(tx, auth.tenantId);
        for (const id of employeeIds) {
          const list = entries.filter((e) => e.employeeId === id);
          const w = computeWorkedTime(
            list.map((e) => ({ id: e.id, kind: e.kind, at: e.at })),
            { breakMinutes: settings.breakMinutes, breakAfterMinutes: settings.breakAfterMinutes },
          );
          if (w.openSince)
            throw conflict(
              'day_open',
              'Une personne est encore pointée sur place : pointez son départ avant de valider.',
            );
        }
        await tx.timeEntry.updateMany({
          where: { id: { in: entries.map((e) => e.id) }, status: { in: ['recorded', 'synced'] } },
          data: { status: 'validated', validatedAt: new Date(), validatedBy: auth.userId },
        });
        await audit('time_entries.validated', 'project', req.params.id, { day: d, employeeIds });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'time_entries.validated.v1',
          aggregateType: 'project',
          aggregateId: req.params.id,
          payload: { projectId: req.params.id, day: d, employeeIds },
          actor,
        });
        return { ok: true as const };
      }),
  );

  app.get(
    '/projects/:id/daily-reports/:day',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Rapport journalier (généré, notes du chef)',
        params: z.object({ id: z.uuid(), day: IsoDay }),
        response: { 200: DailyReportSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', ({ tx, auth }) =>
        dailyReport(tx, auth.tenantId, auth.role, req.params.id, req.params.day),
      ),
  );

  app.put(
    '/projects/:id/daily-reports/:day',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Compléter ou arrêter le rapport journalier',
        params: z.object({ id: z.uuid(), day: IsoDay }),
        body: DailyReportUpdateSchema,
        response: { 200: DailyReportSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'field.report', async ({ tx, auth, actor }) => {
        if (!can(auth.role, 'time.clock_team') && !can(auth.role, 'projects.write')) throw forbidden();
        const { id, day: d } = req.params;
        const current = await dailyReport(tx, auth.tenantId, auth.role, id, d);
        const b = req.body;
        await tx.dailyReport.upsert({
          where: { projectId_day: { projectId: id, day: day(d) } },
          create: {
            tenantId: auth.tenantId,
            projectId: id,
            day: day(d),
            notes: b.notes ?? null,
            weather: b.weather ?? null,
            summary: current,
            ...(b.close ? { closedAt: new Date(), closedBy: auth.userId } : {}),
          },
          update: {
            ...(b.notes !== undefined ? { notes: b.notes } : {}),
            ...(b.weather !== undefined ? { weather: b.weather } : {}),
            summary: current,
            ...(b.close ? { closedAt: new Date(), closedBy: auth.userId } : {}),
          },
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.updated.v1',
          aggregateType: 'project',
          aggregateId: id,
          payload: { projectId: id, fields: ['daily_report'] },
          actor,
        });
        return dailyReport(tx, auth.tenantId, auth.role, id, d);
      }),
  );

  app.post(
    '/projects/:id/attendance/retry',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Retransmettre à l’ONSS les présences en échec (Check In and Out)',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ count: z.number().int() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'time.validate', async ({ tx, auth, actor, audit }) => {
        const failed = await tx.timeEntry.findMany({
          where: { projectId: req.params.id, onssStatus: 'failed' },
          select: { id: true },
        });
        if (!failed.length) return { count: 0 };
        const ids = failed.map((f) => f.id);
        await tx.timeEntry.updateMany({
          where: { id: { in: ids } },
          data: { onssStatus: 'pending', onssError: null },
        });
        await audit('attendance.retry_requested', 'project', req.params.id, { count: ids.length });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'attendance.retry_requested.v1',
          aggregateType: 'project',
          aggregateId: req.params.id,
          payload: { projectId: req.params.id, timeEntryIds: ids },
          actor,
        });
        return { count: ids.length };
      }),
  );

  // Export de secours Check In and Out (05 §8) : si la transmission ONSS est indisponible.
  app.get(
    '/projects/:id/attendance.csv',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Export des présences IN/OUT (secours Check In and Out)',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ from: IsoDay.optional(), to: IsoDay.optional() }),
        hide: true,
      },
    },
    async (req, reply) => {
      const csv = await inTenant(deps, req, 'time.validate', async ({ tx }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id }, include: { site: true } });
        if (!p) throw notFound('Ce chantier');
        const entries = await tx.timeEntry.findMany({
          where: {
            projectId: p.id,
            ...(req.query.from || req.query.to
              ? {
                  day: {
                    ...(req.query.from ? { gte: day(req.query.from) } : {}),
                    ...(req.query.to ? { lte: day(req.query.to) } : {}),
                  },
                }
              : {}),
          },
          orderBy: { at: 'asc' },
        });
        const emps = await tx.employee.findMany({
          where: { id: { in: [...new Set(entries.map((e) => e.employeeId))] } },
        });
        const byId = new Map(emps.map((e) => [e.id, e]));
        const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const lines = [
          [
            'chantier',
            'adresse',
            'travailleur',
            'inss_connu',
            'type',
            'horodatage',
            'statut_onss',
            'reference_onss',
          ].join(';'),
          ...entries.map((e) => {
            const emp = byId.get(e.employeeId);
            return [
              esc(p.number),
              esc(p.site ? `${p.site.street}, ${p.site.postalCode} ${p.site.city}` : ''),
              esc(emp ? `${emp.firstName} ${emp.lastName}` : ''),
              emp?.inssEnc ? 'oui' : 'non',
              e.kind === 'in' ? 'IN' : 'OUT',
              e.at.toISOString(),
              e.onssStatus,
              esc(e.onssReference ?? ''),
            ].join(';');
          }),
        ];
        return `\uFEFF${lines.join('\r\n')}\r\n`;
      });
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="presences-check-in-out.csv"')
        .send(csv);
    },
  );
};
