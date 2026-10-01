/**
 * Avenants (02 P5) : brouillon → envoyé → signé | refusé. Le numéro légal (AV2026-001) est
 * attribué au premier envoi ; l'ordinal (« avenant n°2 ») à la création.
 */
import {
  ChangeOrderCreateSchema,
  ChangeOrderRefuseSchema,
  ChangeOrderSchema,
  ChangeOrderSendSchema,
  ChangeOrderSummarySchema,
  ChangeOrderUpdateSchema,
  OkSchema,
  parseTenantSettings,
} from '@batimint/contracts';
import { emitEvent, nextSequenceValue, type Tx } from '@batimint/db';
import { sha256 } from '@batimint/documents';
import {
  assertTransition,
  ChangeOrderStatus,
  formatDocumentNumber,
  IllegalTransitionError,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { inTenant } from '../lib/tenant';
import {
  assertEditable,
  changeOrderDto,
  loadChangeOrder,
  renderChangeOrderPdfFor,
  summaryOf,
  writeChangeOrderLines,
} from '../services/change-orders';

async function nextChangeOrderNumber(tx: Tx, tenantId: string): Promise<string> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const pattern = parseTenantSettings(t.settings).numbering.change_order;
  const year = new Date().getFullYear();
  return formatDocumentNumber(pattern, {
    year,
    sequence: await nextSequenceValue(tx, tenantId, 'change_order', year),
  });
}

function transition(from: ChangeOrderStatus, to: ChangeOrderStatus) {
  try {
    assertTransition(ChangeOrderStatus, from, to);
  } catch (e) {
    if (e instanceof IllegalTransitionError)
      throw conflict(
        'illegal_transition',
        'Cette action n’est pas possible dans l’état actuel de l’avenant.',
      );
    throw e;
  }
}

export const changeOrderRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/projects/:id/change-orders',
    {
      schema: {
        tags: ['avenants'],
        summary: 'Avenants du chantier',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ items: z.array(ChangeOrderSummarySchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx }) => {
        const rows = await tx.changeOrder.findMany({
          where: { projectId: req.params.id },
          orderBy: { ordinal: 'desc' },
        });
        const questions = rows.length
          ? await tx.comment.groupBy({
              by: ['subjectId'],
              where: {
                subjectType: 'change_order',
                subjectId: { in: rows.map((r) => r.id) },
                authorPortalToken: { not: null },
                resolvedAt: null,
                deletedAt: null,
              },
              _count: true,
            })
          : [];
        const open = new Map(questions.map((q) => [q.subjectId, q._count]));
        return { items: rows.map((r) => summaryOf(r, open.get(r.id) ?? 0)) };
      }),
  );

  app.post(
    '/projects/:id/change-orders',
    {
      schema: {
        tags: ['avenants'],
        summary: 'Créer un avenant (brouillon)',
        params: z.object({ id: z.uuid() }),
        body: ChangeOrderCreateSchema,
        response: { 201: ChangeOrderSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const b = req.body;
        if (b.id && (await tx.changeOrder.findUnique({ where: { id: b.id } })))
          return changeOrderDto(tx, b.id, auth.role);
        // Verrou du chantier : deux avenants créés en même temps n'ont pas le même rang.
        const locked = await tx.$queryRaw<{ status: string }[]>`
          SELECT status::text FROM projects WHERE id = ${req.params.id}::uuid FOR UPDATE`;
        if (!locked[0]) throw notFound('Ce chantier');
        if (locked[0].status === 'closed')
          throw conflict('project_closed', 'Ce chantier est clôturé : il ne reçoit plus d’avenant.');
        const last = await tx.changeOrder.aggregate({
          where: { projectId: req.params.id },
          _max: { ordinal: true },
        });
        const co = await tx.changeOrder.create({
          data: {
            id: b.id ?? uuidv7(),
            tenantId: auth.tenantId,
            projectId: req.params.id,
            ordinal: (last._max.ordinal ?? 0) + 1,
            title: b.title,
            description: b.description ?? null,
            delayDays: b.delayDays,
            createdBy: auth.userId,
          },
        });
        await writeChangeOrderLines(tx, co, b.lines, auth.role);
        await audit('change_order.created', 'change_order', co.id, { ordinal: co.ordinal, title: co.title });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'change_order.created.v1',
          aggregateType: 'project',
          aggregateId: co.projectId,
          payload: { projectId: co.projectId, changeOrderId: co.id },
          actor,
        });
        return changeOrderDto(tx, co.id, auth.role);
      });
      return reply.status(201).send(dto);
    },
  );

  app.get(
    '/change-orders/:id',
    {
      schema: {
        tags: ['avenants'],
        summary: 'Avenant',
        params: z.object({ id: z.uuid() }),
        response: { 200: ChangeOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', ({ tx, auth }) => changeOrderDto(tx, req.params.id, auth.role)),
  );

  app.put(
    '/change-orders/:id',
    {
      schema: {
        tags: ['avenants'],
        summary: 'Enregistrer un avenant en brouillon',
        params: z.object({ id: z.uuid() }),
        body: ChangeOrderUpdateSchema,
        response: { 200: ChangeOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor }) => {
        const co = await tx.changeOrder.findUnique({ where: { id: req.params.id } });
        if (!co) throw notFound('Cet avenant');
        assertEditable(co, req.body.revision, co.revision);
        const b = req.body;
        await tx.changeOrder.update({
          where: { id: co.id },
          data: {
            title: b.title,
            description: b.description ?? null,
            delayDays: b.delayDays,
            revision: { increment: 1 },
          },
        });
        await writeChangeOrderLines(tx, co, b.lines, auth.role);
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.updated.v1',
          aggregateType: 'project',
          aggregateId: co.projectId,
          payload: { projectId: co.projectId, fields: ['change_orders'] },
          actor,
        });
        return changeOrderDto(tx, co.id, auth.role);
      }),
  );

  app.delete(
    '/change-orders/:id',
    {
      schema: {
        tags: ['avenants'],
        summary: 'Supprimer un brouillon jamais envoyé',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const co = await tx.changeOrder.findUnique({ where: { id: req.params.id } });
        if (!co) throw notFound('Cet avenant');
        if (co.status !== 'draft' || co.number)
          throw conflict(
            'change_order_sent',
            'Un avenant déjà envoyé se conserve : retirez-le ou laissez-le refusé.',
          );
        await tx.changeOrder.delete({ where: { id: co.id } });
        await audit('change_order.deleted', 'change_order', co.id, { ordinal: co.ordinal });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.updated.v1',
          aggregateType: 'project',
          aggregateId: co.projectId,
          payload: { projectId: co.projectId, fields: ['change_orders'] },
          actor,
        });
        return { ok: true as const };
      }),
  );

  app.post(
    '/change-orders/:id/send',
    {
      schema: {
        tags: ['avenants'],
        summary: 'Envoyer l’avenant au client (portail et e-mail)',
        params: z.object({ id: z.uuid() }),
        body: ChangeOrderSendSchema,
        response: { 200: ChangeOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'quotes.send', async ({ tx, auth, actor, audit }) => {
        const co = await loadChangeOrder(tx, req.params.id);
        if (!co) throw notFound('Cet avenant');
        transition(co.status, 'sent');
        if (!co.lines.length)
          throw badRequest('empty_change_order', 'Ajoutez au moins une ligne à l’avenant.');
        const number = co.number ?? (await nextChangeOrderNumber(tx, auth.tenantId));
        const sentAt = new Date();
        await tx.changeOrder.update({ where: { id: co.id }, data: { number, sentAt } });
        const pdf = await renderChangeOrderPdfFor(tx, deps.integrations, co.id, { date: sentAt });
        const key = `t/${auth.tenantId}/change-orders/${co.id}/${number}-envoye.pdf`;
        await deps.integrations.storage.put({
          bucket: 'uploads',
          key,
          body: pdf,
          contentType: 'application/pdf',
        });
        await tx.changeOrder.update({
          where: { id: co.id },
          data: {
            status: 'sent',
            sentTo: req.body.email,
            pdfKey: key,
            pdfSha256: sha256(pdf),
            refusalReason: null,
          },
        });
        await audit('change_order.sent', 'change_order', co.id, { number, email: req.body.email });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'change_order.sent.v1',
          aggregateType: 'project',
          aggregateId: co.projectId,
          payload: {
            projectId: co.projectId,
            changeOrderId: co.id,
            email: req.body.email,
            message: req.body.message ?? null,
          },
          actor,
        });
        return changeOrderDto(tx, co.id, auth.role);
      }),
  );

  app.post(
    '/change-orders/:id/withdraw',
    {
      schema: {
        tags: ['avenants'],
        summary: 'Retirer l’avenant (retour en brouillon pour le modifier)',
        params: z.object({ id: z.uuid() }),
        response: { 200: ChangeOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const co = await tx.changeOrder.findUnique({ where: { id: req.params.id } });
        if (!co) throw notFound('Cet avenant');
        transition(co.status, 'draft');
        await tx.changeOrder.update({
          where: { id: co.id },
          data: { status: 'draft', revision: { increment: 1 } },
        });
        await audit('change_order.withdrawn', 'change_order', co.id, { from: co.status });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.updated.v1',
          aggregateType: 'project',
          aggregateId: co.projectId,
          payload: { projectId: co.projectId, fields: ['change_orders'] },
          actor,
        });
        return changeOrderDto(tx, co.id, auth.role);
      }),
  );

  app.post(
    '/change-orders/:id/refuse',
    {
      schema: {
        tags: ['avenants'],
        summary: 'Noter le refus du client (par téléphone, sur place…)',
        params: z.object({ id: z.uuid() }),
        body: ChangeOrderRefuseSchema,
        response: { 200: ChangeOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const co = await tx.changeOrder.findUnique({ where: { id: req.params.id } });
        if (!co) throw notFound('Cet avenant');
        transition(co.status, 'refused');
        await tx.changeOrder.update({
          where: { id: co.id },
          data: { status: 'refused', refusedAt: new Date(), refusalReason: req.body.reason ?? null },
        });
        await audit('change_order.refused', 'change_order', co.id, { reason: req.body.reason });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'change_order.refused.v1',
          aggregateType: 'project',
          aggregateId: co.projectId,
          payload: { projectId: co.projectId, changeOrderId: co.id, reason: req.body.reason ?? null },
          actor,
        });
        return changeOrderDto(tx, co.id, auth.role);
      }),
  );

  app.get(
    '/change-orders/:id/pdf',
    {
      schema: {
        tags: ['avenants'],
        summary: 'PDF de l’avenant (signé s’il l’est)',
        params: z.object({ id: z.uuid() }),
        hide: true,
      },
    },
    async (req, reply) => {
      const { pdf, name } = await inTenant(deps, req, 'projects.read', async ({ tx }) => {
        const co = await tx.changeOrder.findUnique({ where: { id: req.params.id } });
        if (!co) throw notFound('Cet avenant');
        const name = `${co.number ?? `avenant-${co.ordinal}`}.pdf`;
        if (co.status === 'signed' && co.signatureId) {
          const sig = await tx.signature.findUnique({ where: { id: co.signatureId } });
          if (sig?.documentKey)
            return { pdf: Buffer.from(await deps.integrations.storage.get('legal', sig.documentKey)), name };
        }
        return { pdf: await renderChangeOrderPdfFor(tx, deps.integrations, co.id), name };
      });
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${name}"`)
        .send(pdf);
    },
  );
};
