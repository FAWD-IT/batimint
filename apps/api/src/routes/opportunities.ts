/**
 * Pipeline d'opportunités en kanban et visites techniques (03 §2, 02 P2.2).
 */
import {
  OkSchema,
  OpportunityInputSchema,
  OpportunityMoveSchema,
  OpportunitySchema,
  SiteVisitInputSchema,
  SiteVisitSchema,
} from '@batimint/contracts';
import { emitEvent, type Tx } from '@batimint/db';
import { can, OPPORTUNITY_STAGES, type Role } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, notFound } from '../lib/errors';
import { inTenant, iso } from '../lib/tenant';

const include = {
  customer: { select: { displayName: true } },
  site: { select: { label: true, street: true, city: true } },
  _count: { select: { visits: true } },
} as const;

type OppRow = Awaited<ReturnType<Tx['opportunity']['findUniqueOrThrow']>> & {
  customer: { displayName: string };
  site: { label: string | null; street: string; city: string } | null;
  _count: { visits: number };
};

export function toOpportunityDto(o: OppRow, role: Role, attachmentCount = 0) {
  return {
    id: o.id,
    customerId: o.customerId,
    customerName: o.customer.displayName,
    siteId: o.siteId,
    siteLabel: o.site ? o.site.label || `${o.site.street}, ${o.site.city}` : null,
    title: o.title,
    description: o.description,
    stage: o.stage,
    position: o.position,
    ...(can(role, 'pricing.read')
      ? { estimatedAmount: o.estimatedAmount === null ? null : Number(o.estimatedAmount) }
      : {}),
    trade: o.trade,
    ownerUserId: o.ownerUserId,
    lostReason: o.lostReason,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    visitCount: o._count.visits,
    attachmentCount,
  };
}

type VisitRow = Awaited<ReturnType<Tx['siteVisit']['findUniqueOrThrow']>>;
const toVisitDto = (v: VisitRow) => ({
  id: v.id,
  opportunityId: v.opportunityId,
  scheduledAt: iso(v.scheduledAt),
  visitedAt: iso(v.visitedAt),
  visitorEmployeeId: v.visitorEmployeeId,
  trade: v.trade,
  measurements: (v.measurements ?? []) as { label: string; value: string; unit: string }[],
  checklist: (v.checklist ?? []) as { label: string; done: boolean }[],
  notes: v.notes,
});

async function attachmentCounts(tx: Tx, ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await tx.attachment.groupBy({
    by: ['ownerId'],
    where: { ownerType: 'opportunity', ownerId: { in: ids } },
    _count: true,
  });
  return new Map(rows.map((r) => [r.ownerId, r._count]));
}

export const opportunityRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/opportunities',
    {
      schema: {
        tags: ['crm'],
        summary: "Pipeline d'opportunités",
        querystring: z.object({
          customerId: z.uuid().optional(),
          includeClosed: z.coerce.boolean().default(true),
        }),
        response: { 200: z.object({ items: z.array(OpportunitySchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'leads.read', async ({ tx, auth }) => {
        const since = new Date(Date.now() - 90 * 86_400_000);
        const rows = (await tx.opportunity.findMany({
          where: {
            ...(req.query.customerId ? { customerId: req.query.customerId } : {}),
            // Les colonnes « gagnée » et « perdue » ne montrent que les 90 derniers jours.
            OR: [
              { stage: { notIn: ['won', 'lost'] } },
              ...(req.query.includeClosed ? [{ updatedAt: { gte: since } }] : []),
            ],
          },
          include,
          orderBy: [{ stage: 'asc' }, { position: 'asc' }, { createdAt: 'desc' }],
          take: 500,
        })) as OppRow[];
        const counts = await attachmentCounts(
          tx,
          rows.map((r) => r.id),
        );
        return { items: rows.map((r) => toOpportunityDto(r, auth.role, counts.get(r.id) ?? 0)) };
      }),
  );

  app.get(
    '/opportunities/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Détail d’une opportunité avec ses visites',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ opportunity: OpportunitySchema, visits: z.array(SiteVisitSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'leads.read', async ({ tx, auth }) => {
        const o = (await tx.opportunity.findUnique({
          where: { id: req.params.id },
          include,
        })) as OppRow | null;
        if (!o) throw notFound('Cette opportunité');
        const visits = await tx.siteVisit.findMany({
          where: { opportunityId: o.id },
          orderBy: { createdAt: 'asc' },
        });
        const counts = await attachmentCounts(tx, [o.id]);
        return {
          opportunity: toOpportunityDto(o, auth.role, counts.get(o.id) ?? 0),
          visits: visits.map(toVisitDto),
        };
      }),
  );

  app.post(
    '/opportunities',
    {
      schema: {
        tags: ['crm'],
        summary: 'Créer une opportunité',
        body: OpportunityInputSchema,
        response: { 201: OpportunitySchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'leads.write', async ({ tx, auth, actor, audit }) => {
        if (!(await tx.customer.findUnique({ where: { id: req.body.customerId } })))
          throw notFound('Ce client');
        const top = await tx.opportunity.findFirst({ where: { stage: 'new' }, orderBy: { position: 'asc' } });
        const o = (await tx.opportunity.create({
          data: {
            ...(req.body.id ? { id: req.body.id } : {}),
            tenantId: auth.tenantId,
            customerId: req.body.customerId,
            siteId: req.body.siteId ?? null,
            title: req.body.title,
            description: req.body.description ?? null,
            estimatedAmount:
              req.body.estimatedAmount === undefined || req.body.estimatedAmount === null
                ? null
                : BigInt(req.body.estimatedAmount),
            trade: req.body.trade ?? null,
            ownerUserId: req.body.ownerUserId ?? auth.userId,
            position: (top?.position ?? 0) - 1,
            createdBy: auth.userId,
          },
          include,
        })) as OppRow;
        await audit('opportunity.created', 'opportunity', o.id, { title: o.title });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'opportunity.created.v1',
          aggregateType: 'opportunity',
          aggregateId: o.id,
          payload: { opportunityId: o.id, customerId: o.customerId },
          actor,
        });
        return toOpportunityDto(o, auth.role);
      });
      return reply.status(201).send(dto);
    },
  );

  app.put(
    '/opportunities/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Modifier une opportunité',
        params: z.object({ id: z.uuid() }),
        body: OpportunityInputSchema,
        response: { 200: OpportunitySchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'leads.write', async ({ tx, auth }) => {
        if (!(await tx.opportunity.findUnique({ where: { id: req.params.id } })))
          throw notFound('Cette opportunité');
        const o = (await tx.opportunity.update({
          where: { id: req.params.id },
          data: {
            customerId: req.body.customerId,
            siteId: req.body.siteId ?? null,
            title: req.body.title,
            description: req.body.description ?? null,
            ...(req.body.estimatedAmount !== undefined
              ? {
                  estimatedAmount:
                    req.body.estimatedAmount === null ? null : BigInt(req.body.estimatedAmount),
                }
              : {}),
            trade: req.body.trade ?? null,
            ...(req.body.ownerUserId !== undefined ? { ownerUserId: req.body.ownerUserId } : {}),
          },
          include,
        })) as OppRow;
        return toOpportunityDto(o, auth.role);
      }),
  );

  /** Glisser-déposer dans le kanban : change d'étape et réordonne la colonne. */
  app.post(
    '/opportunities/:id/move',
    {
      schema: {
        tags: ['crm'],
        summary: 'Déplacer dans le pipeline',
        params: z.object({ id: z.uuid() }),
        body: OpportunityMoveSchema,
        response: { 200: OpportunitySchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'leads.write', async ({ tx, auth, actor, audit }) => {
        const o = await tx.opportunity.findUnique({ where: { id: req.params.id } });
        if (!o) throw notFound('Cette opportunité');
        const { stage, position } = req.body;
        if (stage === 'lost' && !req.body.lostReason && o.stage !== 'lost') {
          throw badRequest(
            'lost_reason_required',
            'Indiquez pourquoi cette affaire est perdue (prix, délai, concurrent…).',
          );
        }
        const column = await tx.opportunity.findMany({
          where: { stage, id: { not: o.id } },
          orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
          select: { id: true },
        });
        const ordered = [...column.map((c) => c.id)];
        ordered.splice(Math.min(position, ordered.length), 0, o.id);
        for (const [i, id] of ordered.entries())
          await tx.opportunity.update({ where: { id }, data: { position: i } });
        const updated = (await tx.opportunity.update({
          where: { id: o.id },
          data: {
            stage,
            lostReason: stage === 'lost' ? (req.body.lostReason ?? o.lostReason) : null,
            wonAt: stage === 'won' ? (o.wonAt ?? new Date()) : null,
            lostAt: stage === 'lost' ? (o.lostAt ?? new Date()) : null,
          },
          include,
        })) as OppRow;
        if (o.stage !== stage) {
          if (stage === 'won')
            await tx.customer.update({ where: { id: o.customerId }, data: { status: 'customer' } });
          await audit('opportunity.stage_changed', 'opportunity', o.id, {
            stage: { from: o.stage, to: stage },
            lostReason: req.body.lostReason ?? undefined,
          });
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'opportunity.stage_changed.v1',
            aggregateType: 'opportunity',
            aggregateId: o.id,
            payload: { opportunityId: o.id, from: o.stage, to: stage },
            actor,
          });
        }
        return toOpportunityDto(updated, auth.role);
      }),
  );

  // --- Visites techniques ---
  const visitData = (b: z.infer<typeof SiteVisitInputSchema>) => ({
    ...(b.scheduledAt !== undefined ? { scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null } : {}),
    ...(b.visitedAt !== undefined ? { visitedAt: b.visitedAt ? new Date(b.visitedAt) : null } : {}),
    ...(b.visitorEmployeeId !== undefined ? { visitorEmployeeId: b.visitorEmployeeId } : {}),
    ...(b.trade !== undefined ? { trade: b.trade } : {}),
    ...(b.measurements ? { measurements: b.measurements } : {}),
    ...(b.checklist ? { checklist: b.checklist } : {}),
    ...(b.notes !== undefined ? { notes: b.notes } : {}),
  });

  app.post(
    '/opportunities/:id/visits',
    {
      schema: {
        tags: ['crm'],
        summary: 'Planifier ou démarrer une visite technique',
        params: z.object({ id: z.uuid() }),
        body: SiteVisitInputSchema,
        response: { 201: SiteVisitSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'site_visits.write', async ({ tx, auth }) => {
        const o = await tx.opportunity.findUnique({ where: { id: req.params.id } });
        if (!o) throw notFound('Cette opportunité');
        const v = await tx.siteVisit.create({
          data: {
            ...(req.body.id ? { id: req.body.id } : {}),
            ...visitData(req.body),
            tenantId: auth.tenantId,
            opportunityId: o.id,
            createdBy: auth.userId,
          },
        });
        if (o.stage === 'new' && v.scheduledAt) {
          await tx.opportunity.update({ where: { id: o.id }, data: { stage: 'visit_planned' } });
        }
        return toVisitDto(v);
      });
      return reply.status(201).send(dto);
    },
  );

  app.put(
    '/visits/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Compléter une visite technique',
        params: z.object({ id: z.uuid() }),
        body: SiteVisitInputSchema,
        response: { 200: SiteVisitSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'site_visits.write', async ({ tx }) => {
        if (!(await tx.siteVisit.findUnique({ where: { id: req.params.id } })))
          throw notFound('Cette visite');
        return toVisitDto(
          await tx.siteVisit.update({ where: { id: req.params.id }, data: visitData(req.body) }),
        );
      }),
  );

  app.get(
    '/opportunity-stages',
    { schema: { hide: true, response: { 200: z.object({ stages: z.array(z.string()) }) } } },
    async () => ({ stages: [...OPPORTUNITY_STAGES] }),
  );

  app.delete(
    '/visits/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Supprimer une visite',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'site_visits.write', async ({ tx }) => {
        const res = await tx.siteVisit.deleteMany({ where: { id: req.params.id } });
        if (!res.count) throw notFound('Cette visite');
        return { ok: true as const };
      }),
  );
};
