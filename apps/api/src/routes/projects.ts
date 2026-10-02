/**
 * Chantier, objet pivot (03 §5, maquette cockpit-chantier) : liste, cockpit, fiche, statut,
 * fil du chantier (entrées + commentaires), tâches, coûts imputés à la main et lien de portail.
 */
import {
  CentsSchema,
  OkSchema,
  PortalLinkRequestSchema,
  PortalLinkResponseSchema,
  ProjectListQuerySchema,
  ProjectSchema,
  ProjectStatusChangeSchema,
  ProjectSummarySchema,
  ProjectTimelinePageSchema,
  ProjectTimelineQuerySchema,
  ProjectUpdateSchema,
  TaskCreateSchema,
  TaskSchema,
  TaskUpdateSchema,
} from '@batimint/contracts';
import { createPortalToken, emitEvent, portalUrl, type Tx } from '@batimint/db';
import {
  assertTransition,
  can,
  dec,
  IllegalTransitionError,
  type ProjectStatus,
  ProjectStatus as ProjectStatusMachine,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { inTenant, iso, isoDate } from '../lib/tenant';
import { PROJECT_SUMMARY_INCLUDE, projectDetail, projectSummaries } from '../services/projects';

const ACTIVE: ProjectStatus[] = ['in_progress', 'suspended'];
const VIEW_STATUSES: Record<string, ProjectStatus[] | null> = {
  active: ACTIVE,
  preparation: ['preparation'],
  finished: ['provisional_acceptance', 'final_acceptance', 'closed'],
  all: null,
};

const MONEY_TYPES = [
  'project.created',
  'change_order.signed',
  'change_order.refused',
  'invoice.issued',
  'invoice.paid',
  'supplier_invoice.allocated',
  'project.cost_recorded',
  'budget.drift_detected',
];
const FIELD_TYPES = ['photo.added', 'task.completed', 'time_entry.created', 'issue.reported', 'team.arrived'];

const day = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

async function taskDto(tx: Tx, rows: Awaited<ReturnType<Tx['task']['findMany']>>, withAmounts: boolean) {
  const employeeIds = rows.map((t) => t.assigneeEmployeeId).filter((x): x is string => Boolean(x));
  const employees = employeeIds.length
    ? await tx.employee.findMany({ where: { id: { in: employeeIds } } })
    : [];
  const byId = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));
  const photoCounts = rows.length
    ? await tx.attachment.groupBy({
        by: ['taskId'],
        where: { taskId: { in: rows.map((t) => t.id) }, kind: 'photo' },
        _count: true,
      })
    : [];
  const photos = new Map(photoCounts.map((p) => [p.taskId, p._count]));
  return rows.map((t) => ({
    id: t.id,
    budgetLineId: t.budgetLineId,
    position: t.position,
    title: t.title,
    description: t.description,
    status: t.status as 'todo' | 'in_progress' | 'done',
    progress: t.status === 'done' ? '1' : t.progress.toString(),
    quantity: t.quantity?.toString() ?? null,
    unit: t.unit,
    plannedHours: t.plannedHours.toString(),
    ...(withAmounts ? { amount: Number(t.amount) } : {}),
    assignee: t.assigneeEmployeeId
      ? { id: t.assigneeEmployeeId, name: byId.get(t.assigneeEmployeeId) ?? '—' }
      : null,
    dueDate: isoDate(t.dueDate),
    checklist: Array.isArray(t.checklist)
      ? (t.checklist as { id: string; label: string; done: boolean }[])
      : [],
    photoCount: photos.get(t.id) ?? 0,
    fromQuote: Boolean(t.quoteLineKey),
    completedAt: iso(t.completedAt),
  }));
}

export const projectRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/projects',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Chantiers (actifs, en préparation, terminés)',
        querystring: ProjectListQuerySchema,
        response: { 200: z.object({ items: z.array(ProjectSummarySchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx, auth }) => {
        const { view, q, customerId, limit } = req.query;
        const statuses = VIEW_STATUSES[view];
        const term = q?.trim();
        const rows = await tx.project.findMany({
          where: {
            ...(statuses ? { status: { in: statuses } } : {}),
            ...(customerId ? { customerId } : {}),
            ...(term
              ? {
                  OR: [
                    { name: { contains: term, mode: 'insensitive' as const } },
                    { number: { contains: term, mode: 'insensitive' as const } },
                    { customer: { displayName: { contains: term, mode: 'insensitive' as const } } },
                    { site: { city: { contains: term, mode: 'insensitive' as const } } },
                  ],
                }
              : {}),
          },
          include: PROJECT_SUMMARY_INCLUDE,
          orderBy: [{ updatedAt: 'desc' }],
          take: limit,
        });
        return { items: await projectSummaries(tx, rows, auth.tenantId, auth.role) };
      }),
  );

  app.get(
    '/projects/people',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Personnes à mentionner (@) et à qui assigner une tâche : noms seulement',
        response: {
          200: z.object({
            members: z.array(z.object({ userId: z.uuid(), name: z.string() })),
            employees: z.array(z.object({ id: z.uuid(), name: z.string(), jobTitle: z.string().nullable() })),
          }),
        },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx }) => {
        const members = await tx.membership.findMany({
          where: { status: 'active' },
          include: { user: { select: { id: true, name: true } } },
        });
        const employees = await tx.employee.findMany({
          where: { active: true },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        });
        return {
          members: members
            .map((m) => ({ userId: m.user.id, name: m.user.name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
          employees: employees.map((e) => ({
            id: e.id,
            name: `${e.firstName} ${e.lastName}`.trim(),
            jobTitle: e.jobTitle,
          })),
        };
      }),
  );

  app.get(
    '/projects/:id',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Cockpit du chantier',
        params: z.object({ id: z.uuid() }),
        response: { 200: ProjectSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', ({ tx, auth }) =>
        projectDetail(tx, req.params.id, auth.tenantId, auth.role),
      ),
  );

  app.patch(
    '/projects/:id',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Modifier la fiche du chantier',
        params: z.object({ id: z.uuid() }),
        body: ProjectUpdateSchema,
        response: { 200: ProjectSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id } });
        if (!p) throw notFound('Ce chantier');
        const b = req.body;
        const start = b.startDate !== undefined ? b.startDate : isoDate(p.startDate);
        const end = b.endDate !== undefined ? b.endDate : isoDate(p.endDate);
        if (start && end && end < start)
          throw badRequest('invalid_dates', 'La date de fin doit suivre la date de début.');
        if (b.managerUserId) {
          const m = await tx.membership.findFirst({ where: { userId: b.managerUserId, status: 'active' } });
          if (!m) throw badRequest('invalid_manager', 'Cette personne ne fait pas partie de l’entreprise.');
        }
        if (b.teamId && !(await tx.team.findUnique({ where: { id: b.teamId } })))
          throw notFound('Cette équipe');
        const data = {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.description !== undefined ? { description: b.description } : {}),
          ...(b.managerUserId !== undefined ? { managerUserId: b.managerUserId } : {}),
          ...(b.teamId !== undefined ? { teamId: b.teamId } : {}),
          ...(b.startDate !== undefined ? { startDate: day(b.startDate) } : {}),
          ...(b.endDate !== undefined ? { endDate: day(b.endDate) } : {}),
        };
        await tx.project.update({ where: { id: p.id }, data });
        const fields = Object.keys(data);
        if (fields.length) {
          await audit('project.updated', 'project', p.id, b);
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'project.updated.v1',
            aggregateType: 'project',
            aggregateId: p.id,
            payload: { projectId: p.id, fields },
            actor,
          });
        }
        return projectDetail(tx, p.id, auth.tenantId, auth.role);
      }),
  );

  app.post(
    '/projects/:id/status',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Changer le statut (préparation → en cours ⇄ suspendu → réceptions → clôturé)',
        params: z.object({ id: z.uuid() }),
        body: ProjectStatusChangeSchema,
        response: { 200: ProjectSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id } });
        if (!p) throw notFound('Ce chantier');
        const { to, reason } = req.body;
        try {
          assertTransition(ProjectStatusMachine, p.status, to);
        } catch (e) {
          if (e instanceof IllegalTransitionError)
            throw conflict(
              'illegal_transition',
              'Ce changement de statut n’est pas possible depuis le statut actuel.',
            );
          throw e;
        }
        // Les réceptions passent par leur PV signé (M10).
        if (to === 'provisional_acceptance' || to === 'final_acceptance' || to === 'closed')
          throw conflict('reception_required', 'La réception se fait avec un PV signé par le client.');
        if (to === 'suspended' && !reason)
          throw badRequest('reason_required', 'Indiquez la raison de la suspension.');
        await tx.project.update({
          where: { id: p.id },
          data: {
            status: to,
            suspendedReason: to === 'suspended' ? (reason ?? null) : null,
            ...(to === 'in_progress' && !p.startDate
              ? { startDate: day(new Date().toISOString().slice(0, 10)) }
              : {}),
          },
        });
        await audit('project.status_changed', 'project', p.id, { from: p.status, to, reason });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.status_changed.v1',
          aggregateType: 'project',
          aggregateId: p.id,
          payload: { projectId: p.id, from: p.status, to, reason: reason ?? null },
          actor,
        });
        return projectDetail(tx, p.id, auth.tenantId, auth.role);
      }),
  );

  app.post(
    '/projects/:id/portal-link',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Lien du portail client (ouvert ici, ou envoyé par e-mail)',
        params: z.object({ id: z.uuid() }),
        body: PortalLinkRequestSchema,
        response: { 200: PortalLinkResponseSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id }, include: { customer: true } });
        if (!p) throw notFound('Ce chantier');
        if (req.body.send) {
          const email = req.body.email ?? p.customer.email;
          if (!email) throw badRequest('email_required', 'Indiquez l’adresse e-mail du client.');
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'project.portal_shared.v1',
            aggregateType: 'project',
            aggregateId: p.id,
            payload: { projectId: p.id, email, message: req.body.message ?? null },
            actor,
          });
          await audit('project.portal_shared', 'project', p.id, { email });
          return { url: null, sentTo: email };
        }
        const { token } = await createPortalToken(tx, {
          tenantId: auth.tenantId,
          kind: 'project',
          projectId: p.id,
          customerId: p.customerId,
          email: p.customer.email,
          createdBy: auth.userId,
        });
        await audit('project.portal_link_created', 'project', p.id);
        return { url: portalUrl(deps.config.APP_URL, token), sentTo: null };
      }),
  );

  // -------------------------------------------------------------------------
  // Fil du chantier
  // -------------------------------------------------------------------------

  app.get(
    '/projects/:id/timeline',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Fil du chantier : événements et commentaires, du plus récent au plus ancien',
        params: z.object({ id: z.uuid() }),
        querystring: ProjectTimelineQuerySchema,
        response: { 200: ProjectTimelinePageSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx, auth }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id }, select: { id: true } });
        if (!p) throw notFound('Ce chantier');
        const { filter, before, limit } = req.query;
        const prices = can(auth.role, 'pricing.read');
        const beforeDate = before ? new Date(before) : undefined;
        const entries =
          filter === 'comments'
            ? []
            : await tx.timelineEntry.findMany({
                where: {
                  projectId: p.id,
                  ...(beforeDate ? { occurredAt: { lt: beforeDate } } : {}),
                  ...(filter === 'client' ? { visibleToClient: true } : {}),
                  ...(filter === 'money' ? { type: { in: MONEY_TYPES } } : {}),
                  ...(filter === 'field' ? { type: { in: FIELD_TYPES } } : {}),
                },
                orderBy: { occurredAt: 'desc' },
                take: limit,
              });
        const comments =
          filter === 'money' || filter === 'field'
            ? []
            : await tx.comment.findMany({
                where: {
                  projectId: p.id,
                  deletedAt: null,
                  ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
                  ...(filter === 'client' ? { visibleToClient: true } : {}),
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
              });
        const photoIds = entries.flatMap((e) =>
          Array.isArray((e.data as { photoIds?: string[] } | null)?.photoIds)
            ? (e.data as { photoIds: string[] }).photoIds
            : [],
        );
        const photos = photoIds.length
          ? await tx.attachment.findMany({
              where: { id: { in: photoIds } },
              select: { id: true, caption: true },
            })
          : [];
        const photoById = new Map(photos.map((ph) => [ph.id, ph]));
        const items = [
          ...entries.map((e) => ({
            id: e.id,
            kind: 'entry' as const,
            type: e.type,
            title: e.title,
            body: e.body,
            occurredAt: e.occurredAt.toISOString(),
            amount: prices && e.amount !== null ? Number(e.amount) : null,
            actorLabel: e.actorLabel,
            visibleToClient: e.visibleToClient,
            photos: ((e.data as { photoIds?: string[] } | null)?.photoIds ?? [])
              .map((id) => photoById.get(id))
              .filter((x): x is { id: string; caption: string | null } => Boolean(x))
              .map((ph) => ({ id: ph.id, url: `/api/v1/attachments/${ph.id}/file`, caption: ph.caption })),
            changeOrderId: e.changeOrderId,
            comment: null,
          })),
          ...comments.map((c) => ({
            id: c.id,
            kind: 'comment' as const,
            type: c.authorPortalToken ? 'comment.client' : 'comment',
            title: c.authorLabel,
            body: c.body,
            occurredAt: c.createdAt.toISOString(),
            amount: null,
            actorLabel: c.authorLabel,
            visibleToClient: c.visibleToClient,
            photos: [],
            changeOrderId: c.subjectType === 'change_order' ? c.subjectId : null,
            comment: {
              authorUserId: c.authorUserId,
              fromClient: Boolean(c.authorPortalToken),
              subjectType: c.subjectType,
              subjectId: c.subjectId,
              mine: c.authorUserId === auth.userId,
            },
          })),
        ]
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .slice(0, limit);
        const full = entries.length === limit || comments.length === limit;
        return { items, nextBefore: full && items.length ? items.at(-1)!.occurredAt : null };
      }),
  );

  // -------------------------------------------------------------------------
  // Tâches
  // -------------------------------------------------------------------------

  app.get(
    '/projects/:id/tasks',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Tâches du chantier (par poste)',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ items: z.array(TaskSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx, auth }) => {
        const rows = await tx.task.findMany({
          where: { projectId: req.params.id },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        });
        return { items: await taskDto(tx, rows, can(auth.role, 'pricing.read')) };
      }),
  );

  app.post(
    '/projects/:id/tasks',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Ajouter une tâche',
        params: z.object({ id: z.uuid() }),
        body: TaskCreateSchema,
        response: { 201: TaskSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'projects.write', async ({ tx, auth, actor }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id } });
        if (!p) throw notFound('Ce chantier');
        const b = req.body;
        if (b.id) {
          const existing = await tx.task.findUnique({ where: { id: b.id } });
          if (existing) return (await taskDto(tx, [existing], can(auth.role, 'pricing.read')))[0]!;
        }
        if (
          b.budgetLineId &&
          !(await tx.budgetLine.findFirst({ where: { id: b.budgetLineId, projectId: p.id } }))
        )
          throw notFound('Ce poste');
        const last = await tx.task.aggregate({ where: { projectId: p.id }, _max: { position: true } });
        const t = await tx.task.create({
          data: {
            id: b.id ?? uuidv7(),
            tenantId: auth.tenantId,
            projectId: p.id,
            budgetLineId: b.budgetLineId,
            position: (last._max.position ?? -1) + 1,
            title: b.title,
            description: b.description ?? null,
            assigneeEmployeeId: b.assigneeEmployeeId ?? null,
            dueDate: day(b.dueDate ?? null),
          },
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'task.updated.v1',
          aggregateType: 'project',
          aggregateId: p.id,
          payload: { projectId: p.id, taskId: t.id, fields: ['created'] },
          actor,
        });
        return (await taskDto(tx, [t], can(auth.role, 'pricing.read')))[0]!;
      });
      return reply.status(201).send(dto);
    },
  );

  app.patch(
    '/projects/:id/tasks/:taskId',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Mettre à jour une tâche (statut, avancement, checklist, assignation)',
        params: z.object({ id: z.uuid(), taskId: z.uuid() }),
        body: TaskUpdateSchema,
        response: { 200: TaskSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'tasks.update', async ({ tx, auth, actor }) => {
        const t = await tx.task.findFirst({ where: { id: req.params.taskId, projectId: req.params.id } });
        if (!t) throw notFound('Cette tâche');
        const b = req.body;
        // Ouvriers et chefs de chantier : avancement et checklist ; le reste est réservé au bureau.
        const structural = b.title !== undefined || b.description !== undefined || b.dueDate !== undefined;
        if ((structural || b.assigneeEmployeeId !== undefined) && !can(auth.role, 'projects.write'))
          throw forbidden();
        if (b.assigneeEmployeeId && !(await tx.employee.findUnique({ where: { id: b.assigneeEmployeeId } })))
          throw notFound('Cette personne');
        let status = b.status ?? (t.status as 'todo' | 'in_progress' | 'done');
        let progress = dec(t.progress.toString());
        if (b.progressPercent !== undefined) {
          progress = dec(b.progressPercent).dividedBy(100);
          if (b.status === undefined)
            status = progress.greaterThanOrEqualTo(1) ? 'done' : progress.isZero() ? 'todo' : 'in_progress';
        }
        if (b.status === 'done') progress = dec(1);
        if (b.status === 'todo' && b.progressPercent === undefined) progress = dec(0);
        if (b.status === 'in_progress' && progress.greaterThanOrEqualTo(1)) progress = dec('0.5');
        const completed = status === 'done' && t.status !== 'done';
        const updated = await tx.task.update({
          where: { id: t.id },
          data: {
            ...(b.title !== undefined ? { title: b.title } : {}),
            ...(b.description !== undefined ? { description: b.description } : {}),
            ...(b.assigneeEmployeeId !== undefined ? { assigneeEmployeeId: b.assigneeEmployeeId } : {}),
            ...(b.dueDate !== undefined ? { dueDate: day(b.dueDate) } : {}),
            ...(b.checklist !== undefined ? { checklist: b.checklist } : {}),
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
            : { projectId: t.projectId, taskId: t.id, fields: Object.keys(b) },
          actor,
        });
        return (await taskDto(tx, [updated], can(auth.role, 'pricing.read')))[0]!;
      }),
  );

  app.delete(
    '/projects/:id/tasks/:taskId',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Supprimer une tâche ajoutée à la main',
        params: z.object({ id: z.uuid(), taskId: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const t = await tx.task.findFirst({ where: { id: req.params.taskId, projectId: req.params.id } });
        if (!t) throw notFound('Cette tâche');
        if (t.quoteLineKey || t.changeOrderLineId)
          throw conflict(
            'task_from_contract',
            'Cette tâche vient du devis ou d’un avenant : elle ne se supprime pas.',
          );
        await tx.attachment.updateMany({ where: { taskId: t.id }, data: { taskId: null } });
        await tx.task.delete({ where: { id: t.id } });
        await audit('task.deleted', 'project', t.projectId, { taskId: t.id, title: t.title });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'task.updated.v1',
          aggregateType: 'project',
          aggregateId: t.projectId,
          payload: { projectId: t.projectId, taskId: t.id, fields: ['deleted'] },
          actor,
        });
        return { ok: true as const };
      }),
  );

  // -------------------------------------------------------------------------
  // Coûts imputés à la main (frais divers ; les autres sources arrivent par leurs modules)
  // -------------------------------------------------------------------------

  app.post(
    '/projects/:id/costs',
    {
      schema: {
        tags: ['chantiers'],
        summary: 'Imputer un coût divers sur un poste',
        params: z.object({ id: z.uuid() }),
        body: z.object({
          id: z.uuid().optional(),
          budgetLineId: z.uuid().nullable(),
          label: z.string().trim().min(2).max(200),
          amount: CentsSchema.refine((v) => v !== 0, 'Montant attendu'),
          occurredAt: z.iso.date().optional(),
        }),
        response: { 201: z.object({ id: z.uuid() }) },
      },
    },
    async (req, reply) => {
      const res = await inTenant(deps, req, 'projects.finance.read', async ({ tx, auth, actor, audit }) => {
        if (!can(auth.role, 'projects.write')) throw forbidden();
        const p = await tx.project.findUnique({ where: { id: req.params.id } });
        if (!p) throw notFound('Ce chantier');
        const b = req.body;
        if (
          b.budgetLineId &&
          !(await tx.budgetLine.findFirst({ where: { id: b.budgetLineId, projectId: p.id } }))
        )
          throw notFound('Ce poste');
        const id = b.id ?? uuidv7();
        const existing = await tx.projectCost.findUnique({ where: { id } });
        if (existing) return { id };
        await tx.projectCost.create({
          data: {
            id,
            tenantId: auth.tenantId,
            projectId: p.id,
            budgetLineId: b.budgetLineId,
            category: 'other',
            sourceType: 'manual',
            sourceId: id,
            label: b.label,
            amount: BigInt(b.amount),
            occurredAt: b.occurredAt ? new Date(`${b.occurredAt}T12:00:00Z`) : new Date(),
          },
        });
        await audit('project.cost_recorded', 'project', p.id, {
          costId: id,
          label: b.label,
          amount: b.amount,
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.cost_recorded.v1',
          aggregateType: 'project',
          aggregateId: p.id,
          payload: {
            projectId: p.id,
            costId: id,
            budgetLineId: b.budgetLineId,
            category: 'other',
            amount: String(b.amount),
          },
          actor,
        });
        return { id };
      });
      return reply.status(201).send(res);
    },
  );
};
