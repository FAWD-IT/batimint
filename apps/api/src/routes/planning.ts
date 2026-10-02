/**
 * Planning (03 §6, 02 P3) : grille, affectations (création, déplacement, redimensionnement,
 * suppression), conflits signalés sans bloquer, mon planning (terrain), abonnement iCal.
 */
import { randomBytes } from 'node:crypto';
import {
  CalendarFeedSchema,
  MyPlanningSchema,
  OkSchema,
  PlanningSchema,
  SlotInputSchema,
  SlotMutationSchema,
  SlotPatchSchema,
} from '@batimint/contracts';
import { emitEvent, hashPortalToken, type Tx, withSystem, withTenant } from '@batimint/db';
import {
  addDays,
  brusselsDate,
  buildICal,
  can,
  type Half,
  isValidRange,
  slotHalfDays,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { inTenant, type TenantScope } from '../lib/tenant';
import { employeeOf } from '../services/field';
import {
  conflictsBetween,
  dayDate,
  loadPlanning,
  slotDto,
  syncProjectStart,
  toPlanned,
} from '../services/planning';

const IsoDay = z.iso.date();
const MAX_DAYS = 62;

interface SlotFields {
  projectId: string;
  employeeId: string | null;
  teamId: string | null;
  taskId: string | null;
  startDay: string;
  startHalf: Half;
  endDay: string;
  endHalf: Half;
}

/** Vérifie une affectation (après fusion des changements) : cohérence et existence. */
async function checkSlot(tx: Tx, s: SlotFields): Promise<void> {
  if (Boolean(s.employeeId) === Boolean(s.teamId))
    throw badRequest('slot_resource', 'Choisissez une personne ou une équipe.');
  if (!isValidRange(s)) throw badRequest('slot_range', 'La fin doit suivre le début.');
  if (!slotHalfDays(s).length)
    throw badRequest(
      'slot_not_working',
      'Cette période ne contient aucun jour ouvré (week-end ou jour férié).',
    );
  const project = await tx.project.findUnique({ where: { id: s.projectId }, select: { status: true } });
  if (!project) throw notFound('Ce chantier');
  if (project.status === 'closed') throw badRequest('project_closed', 'Ce chantier est clôturé.');
  if (s.employeeId && !(await tx.employee.findFirst({ where: { id: s.employeeId, active: true } })))
    throw notFound('Cette personne');
  if (s.teamId && !(await tx.team.findFirst({ where: { id: s.teamId, archivedAt: null } })))
    throw notFound('Cette équipe');
  if (s.taskId && !(await tx.task.findFirst({ where: { id: s.taskId, projectId: s.projectId } })))
    throw notFound('Cette tâche');
}

async function mutationResult(tx: Tx, slot: Awaited<ReturnType<Tx['scheduleSlot']['findUniqueOrThrow']>>) {
  const p = toPlanned(slot);
  const task = slot.taskId
    ? await tx.task.findUnique({ where: { id: slot.taskId }, select: { title: true } })
    : null;
  const conflicts = (await conflictsBetween(tx, p.startDay, p.endDay)).filter((c) =>
    c.slotIds.includes(slot.id),
  );
  return { slot: slotDto(slot, task?.title ?? null), conflicts };
}

async function changed(
  scope: TenantScope,
  projectId: string,
  slotId: string,
  action: 'created' | 'updated' | 'deleted',
): Promise<void> {
  const startDate = await syncProjectStart(scope.tx, projectId);
  await emitEvent(scope.tx, {
    tenantId: scope.auth.tenantId,
    type: 'schedule.changed.v1',
    aggregateType: 'project',
    aggregateId: projectId,
    payload: { projectId, slotId, action, startDate },
    actor: scope.actor,
  });
}

export const planningRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/planning',
    {
      schema: {
        tags: ['planning'],
        summary: 'Grille du planning : équipes, personnes, affectations, congés, conflits',
        querystring: z.object({ from: IsoDay, to: IsoDay }),
        response: { 200: PlanningSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'planning.read', async ({ tx }) => {
        const { from, to } = req.query;
        if (to < from) throw badRequest('planning_range', 'La fin de la période doit suivre son début.');
        if (addDays(from, MAX_DAYS) < to)
          throw badRequest('planning_range', `La période affichée est limitée à ${MAX_DAYS} jours.`);
        return loadPlanning(tx, from, to);
      }),
  );

  app.post(
    '/planning/slots',
    {
      schema: {
        tags: ['planning'],
        summary: 'Affecter une personne ou une équipe à un chantier (identifiant fourni par le client)',
        body: SlotInputSchema,
        response: { 201: SlotMutationSchema },
      },
    },
    async (req, reply) => {
      const res = await inTenant(deps, req, 'planning.write', async (scope) => {
        const { tx, auth } = scope;
        const b = req.body;
        const existing = await tx.scheduleSlot.findUnique({ where: { id: b.id } });
        if (existing) return mutationResult(tx, existing);
        const fields: SlotFields = {
          projectId: b.projectId,
          employeeId: b.employeeId ?? null,
          teamId: b.teamId ?? null,
          taskId: b.taskId ?? null,
          startDay: b.startDay,
          startHalf: b.startHalf,
          endDay: b.endDay,
          endHalf: b.endHalf,
        };
        await checkSlot(tx, fields);
        const slot = await tx.scheduleSlot.create({
          data: {
            id: b.id,
            tenantId: auth.tenantId,
            ...fields,
            startDay: dayDate(fields.startDay),
            endDay: dayDate(fields.endDay),
            note: b.note ?? null,
            createdBy: auth.userId,
          },
        });
        await changed(scope, slot.projectId, slot.id, 'created');
        return mutationResult(tx, slot);
      });
      return reply.status(201).send(res);
    },
  );

  app.patch(
    '/planning/slots/:id',
    {
      schema: {
        tags: ['planning'],
        summary: 'Déplacer, redimensionner ou réaffecter une affectation',
        params: z.object({ id: z.uuid() }),
        body: SlotPatchSchema,
        response: { 200: SlotMutationSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'planning.write', async (scope) => {
        const { tx } = scope;
        const cur = await tx.scheduleSlot.findUnique({ where: { id: req.params.id } });
        if (!cur) throw notFound('Cette affectation');
        const b = req.body;
        const before = toPlanned(cur);
        const fields: SlotFields = {
          projectId: b.projectId ?? cur.projectId,
          // Passer d'une personne à une équipe (ou l'inverse) efface l'autre ressource.
          employeeId: b.teamId ? null : b.employeeId !== undefined ? b.employeeId : cur.employeeId,
          teamId: b.employeeId ? null : b.teamId !== undefined ? b.teamId : cur.teamId,
          taskId:
            b.projectId && b.projectId !== cur.projectId
              ? null
              : b.taskId !== undefined
                ? b.taskId
                : cur.taskId,
          startDay: b.startDay ?? before.startDay,
          startHalf: b.startHalf ?? before.startHalf,
          endDay: b.endDay ?? before.endDay,
          endHalf: b.endHalf ?? before.endHalf,
        };
        await checkSlot(tx, fields);
        const slot = await tx.scheduleSlot.update({
          where: { id: cur.id },
          data: {
            ...fields,
            startDay: dayDate(fields.startDay),
            endDay: dayDate(fields.endDay),
            ...(b.note !== undefined ? { note: b.note } : {}),
          },
        });
        await changed(scope, slot.projectId, slot.id, 'updated');
        if (cur.projectId !== slot.projectId) await changed(scope, cur.projectId, slot.id, 'deleted');
        return mutationResult(tx, slot);
      }),
  );

  app.delete(
    '/planning/slots/:id',
    {
      schema: {
        tags: ['planning'],
        summary: 'Retirer une affectation',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'planning.write', async (scope) => {
        const cur = await scope.tx.scheduleSlot.findUnique({ where: { id: req.params.id } });
        if (!cur) return { ok: true as const };
        await scope.tx.scheduleSlot.delete({ where: { id: cur.id } });
        await changed(scope, cur.projectId, cur.id, 'deleted');
        return { ok: true as const };
      }),
  );

  // -------------------------------------------------------------------------
  // Mon planning (vue terrain)
  // -------------------------------------------------------------------------
  app.get(
    '/field/planning',
    {
      schema: {
        tags: ['terrain'],
        summary: 'Mon planning des deux prochaines semaines',
        querystring: z.object({ days: z.coerce.number().int().min(1).max(31).default(14) }),
        response: { 200: MyPlanningSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'planning.read', async ({ tx, auth }) => {
        const me = await employeeOf(tx, auth.userId);
        if (!me) return { days: [] };
        const from = brusselsDate(new Date());
        const to = addDays(from, req.query.days - 1);
        const slots = await tx.scheduleSlot.findMany({
          where: {
            startDay: { lte: dayDate(to) },
            endDay: { gte: dayDate(from) },
            OR: [{ employeeId: me.id }, ...(me.teamId ? [{ teamId: me.teamId }] : [])],
          },
          include: { project: { include: { site: true } } },
          orderBy: [{ startDay: 'asc' }],
        });
        const teams = new Map(
          (
            await tx.team.findMany({
              where: { id: { in: slots.flatMap((s) => (s.teamId ? [s.teamId] : [])) } },
            })
          ).map((t) => [t.id, t.name]),
        );
        const tasks = new Map(
          (
            await tx.task.findMany({
              where: { id: { in: slots.flatMap((s) => (s.taskId ? [s.taskId] : [])) } },
              select: { id: true, title: true },
            })
          ).map((t) => [t.id, t.title]),
        );
        const byDay = new Map<string, z.infer<typeof MyPlanningSchema>['days'][number]['items']>();
        for (const s of slots) {
          const halves = slotHalfDays(toPlanned(s)).filter((h) => h.day >= from && h.day <= to);
          for (const day of [...new Set(halves.map((h) => h.day))]) {
            const mine = halves.filter((h) => h.day === day);
            byDay.set(day, [
              ...(byDay.get(day) ?? []),
              {
                slotId: s.id,
                half: mine.length === 2 ? 'day' : mine[0]!.half,
                projectId: s.projectId,
                projectName: s.project.name,
                address: s.project.site
                  ? `${s.project.site.street}, ${s.project.site.postalCode} ${s.project.site.city}`
                  : null,
                taskTitle: s.taskId ? (tasks.get(s.taskId) ?? null) : null,
                teamName: s.teamId ? (teams.get(s.teamId) ?? null) : null,
              },
            ]);
          }
        }
        return {
          days: [...byDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, items]) => ({ day, items: items.sort((a, b) => a.half.localeCompare(b.half)) })),
        };
      }),
  );

  // -------------------------------------------------------------------------
  // Abonnement iCal (par personne)
  // -------------------------------------------------------------------------
  app.post(
    '/planning/calendar-feeds',
    {
      schema: {
        tags: ['planning'],
        summary: 'Créer (ou renouveler) le lien iCal d’une personne',
        body: z.object({ employeeId: z.uuid().optional() }),
        response: { 200: CalendarFeedSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'planning.read', async ({ tx, auth, audit }) => {
        const me = await employeeOf(tx, auth.userId);
        const employeeId = req.body.employeeId ?? me?.id;
        if (!employeeId)
          throw badRequest(
            'no_employee',
            'Votre compte n’est lié à aucune fiche employé : demandez au bureau de la créer.',
          );
        if (employeeId !== me?.id && !can(auth.role, 'planning.write')) throw forbidden();
        if (!(await tx.employee.findUnique({ where: { id: employeeId } }))) throw notFound('Cette personne');
        // Un seul lien actif par personne : renouveler révoque l'ancien.
        await tx.calendarFeed.updateMany({
          where: { employeeId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const token = randomBytes(24).toString('base64url');
        await tx.calendarFeed.create({
          data: {
            tenantId: auth.tenantId,
            employeeId,
            tokenHash: hashPortalToken(token),
            createdBy: auth.userId,
          },
        });
        await audit('calendar_feed.created', 'employee', employeeId);
        return { url: `${deps.config.APP_URL.replace(/\/$/, '')}/api/v1/ical/${token}.ics` };
      }),
  );

  app.get(
    '/ical/:file',
    {
      schema: { tags: ['planning'], summary: 'Calendrier iCal d’une personne (lien secret)', hide: true },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const file = (req.params as { file: string }).file;
      const token = file.replace(/\.ics$/, '');
      const feed = await withSystem(deps.prisma, (tx) =>
        tx.calendarFeed.findUnique({ where: { tokenHash: hashPortalToken(token) } }),
      );
      if (!feed || feed.revokedAt) throw notFound('Ce calendrier');
      const ics = await withTenant(deps.prisma, feed.tenantId, null, async (tx) => {
        await tx.calendarFeed.update({ where: { id: feed.id }, data: { lastUsedAt: new Date() } });
        const emp = await tx.employee.findUniqueOrThrow({ where: { id: feed.employeeId } });
        const from = addDays(brusselsDate(new Date()), -30);
        const slots = await tx.scheduleSlot.findMany({
          where: {
            endDay: { gte: dayDate(from) },
            OR: [{ employeeId: emp.id }, ...(emp.teamId ? [{ teamId: emp.teamId }] : [])],
          },
          include: { project: { include: { site: true, customer: true } } },
          orderBy: { startDay: 'asc' },
          take: 500,
        });
        return buildICal({
          name: `Planning — ${emp.firstName} ${emp.lastName}`,
          events: slots.map((s) => ({
            uid: s.id,
            range: toPlanned(s),
            summary: `${s.project.name} (${s.project.number})`,
            location: s.project.site
              ? `${s.project.site.street}, ${s.project.site.postalCode} ${s.project.site.city}`
              : null,
            description: [s.project.customer.displayName, s.note].filter(Boolean).join('\n') || null,
            updatedAt: s.updatedAt,
          })),
        });
      });
      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('cache-control', 'private, max-age=300')
        .header('content-disposition', 'inline; filename="planning.ics"')
        .send(ics);
    },
  );
};
