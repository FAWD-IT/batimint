/**
 * Commentaires sur les objets (03 §5 « commentaires et mentions @ », §14 « fils de discussion ») :
 * fil interne, ou réponse partagée avec le client sur le portail. Les mentions sont encodées
 * `@[Nom](userId)` par l'éditeur ; seules les personnes actives du tenant sont notifiées.
 */
import { CommentCreateSchema, CommentSchema, CommentSubjectTypeSchema, OkSchema } from '@batimint/contracts';
import { emitEvent, type Tx } from '@batimint/db';
import { can, parseMentions } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { forbidden, notFound } from '../lib/errors';
import { inTenant, iso } from '../lib/tenant';

type Subject = z.infer<typeof CommentSubjectTypeSchema>;

/** Chantier de rattachement de l'objet commenté (null si l'objet n'existe pas). */
async function subjectProject(
  tx: Tx,
  type: Subject,
  id: string,
): Promise<{ projectId: string | null } | null> {
  if (type === 'project') {
    const p = await tx.project.findUnique({ where: { id }, select: { id: true } });
    return p ? { projectId: p.id } : null;
  }
  if (type === 'change_order') {
    const c = await tx.changeOrder.findUnique({ where: { id }, select: { projectId: true } });
    return c ? { projectId: c.projectId } : null;
  }
  if (type === 'task') {
    const t = await tx.task.findUnique({ where: { id }, select: { projectId: true } });
    return t ? { projectId: t.projectId } : null;
  }
  const q = await tx.quote.findUnique({ where: { id }, select: { project: { select: { id: true } } } });
  return q ? { projectId: q.project?.id ?? null } : null;
}

type Row = Awaited<ReturnType<Tx['comment']['findUniqueOrThrow']>>;
export const toCommentDto = (c: Row, userId: string | null) => ({
  id: c.id,
  subjectType: c.subjectType as Subject,
  subjectId: c.subjectId,
  body: c.body,
  authorLabel: c.authorLabel,
  authorUserId: c.authorUserId,
  fromClient: Boolean(c.authorPortalToken),
  visibleToClient: c.visibleToClient,
  resolvedAt: iso(c.resolvedAt),
  createdAt: c.createdAt.toISOString(),
  mine: Boolean(userId && c.authorUserId === userId),
});

export const commentRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/comments',
    {
      schema: {
        tags: ['commentaires'],
        summary: 'Fil de discussion d’un objet',
        querystring: z.object({ subjectType: CommentSubjectTypeSchema, subjectId: z.uuid() }),
        response: { 200: z.object({ items: z.array(CommentSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx, auth }) => {
        const rows = await tx.comment.findMany({
          where: { subjectType: req.query.subjectType, subjectId: req.query.subjectId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        return { items: rows.map((c) => toCommentDto(c, auth.userId)) };
      }),
  );

  app.post(
    '/comments',
    {
      schema: {
        tags: ['commentaires'],
        summary: 'Commenter (avec mentions @) ou répondre au client',
        body: CommentCreateSchema,
        response: { 201: CommentSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'projects.read', async ({ tx, auth, actor, audit }) => {
        const b = req.body;
        if (b.id) {
          const existing = await tx.comment.findUnique({ where: { id: b.id } });
          if (existing) return toCommentDto(existing, auth.userId);
        }
        const subject = await subjectProject(tx, b.subjectType, b.subjectId);
        if (!subject) throw notFound('Cet élément');
        if (b.visibleToClient && !can(auth.role, 'projects.write')) throw forbidden();
        const mentioned = parseMentions(b.body);
        const members = mentioned.length
          ? await tx.membership.findMany({
              where: { userId: { in: mentioned }, status: 'active' },
              select: { userId: true },
            })
          : [];
        const mentions = members.map((m) => m.userId).filter((id) => id !== auth.userId);
        const c = await tx.comment.create({
          data: {
            id: b.id ?? uuidv7(),
            tenantId: auth.tenantId,
            subjectType: b.subjectType,
            subjectId: b.subjectId,
            projectId: subject.projectId,
            body: b.body,
            mentions,
            authorUserId: auth.userId,
            authorLabel: auth.name,
            visibleToClient: b.visibleToClient,
          },
        });
        // Répondre au client sur un objet clôt ses questions ouvertes sur cet objet.
        if (b.visibleToClient)
          await tx.comment.updateMany({
            where: {
              subjectType: b.subjectType,
              subjectId: b.subjectId,
              authorPortalToken: { not: null },
              resolvedAt: null,
            },
            data: { resolvedAt: new Date() },
          });
        if (b.visibleToClient)
          await audit('comment.client_reply', b.subjectType, b.subjectId, { commentId: c.id });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'comment.added.v1',
          aggregateType: subject.projectId ? 'project' : b.subjectType,
          aggregateId: subject.projectId ?? b.subjectId,
          payload: {
            commentId: c.id,
            subjectType: b.subjectType,
            subjectId: b.subjectId,
            projectId: subject.projectId,
            fromClient: false,
            mentions,
          },
          actor,
        });
        return toCommentDto(c, auth.userId);
      });
      return reply.status(201).send(dto);
    },
  );

  app.post(
    '/comments/:id/resolve',
    {
      schema: {
        tags: ['commentaires'],
        summary: 'Marquer la question du client comme traitée',
        params: z.object({ id: z.uuid() }),
        response: { 200: CommentSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor }) => {
        const c = await tx.comment.findUnique({ where: { id: req.params.id } });
        if (!c || c.deletedAt) throw notFound('Ce commentaire');
        const updated = await tx.comment.update({
          where: { id: c.id },
          data: { resolvedAt: c.resolvedAt ?? new Date() },
        });
        if (c.projectId)
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'project.updated.v1',
            aggregateType: 'project',
            aggregateId: c.projectId,
            payload: { projectId: c.projectId, fields: ['comments'] },
            actor,
          });
        return toCommentDto(updated, auth.userId);
      }),
  );

  app.delete(
    '/comments/:id',
    {
      schema: {
        tags: ['commentaires'],
        summary: 'Supprimer son commentaire',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx, auth, actor }) => {
        const c = await tx.comment.findUnique({ where: { id: req.params.id } });
        if (!c || c.deletedAt) throw notFound('Ce commentaire');
        if (c.authorUserId !== auth.userId) throw forbidden();
        // Une réponse déjà lue par le client reste au fil (preuve de l'échange).
        if (c.visibleToClient) throw forbidden('Une réponse partagée avec le client ne se supprime pas.');
        await tx.comment.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
        if (c.projectId)
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'project.updated.v1',
            aggregateType: 'project',
            aggregateId: c.projectId,
            payload: { projectId: c.projectId, fields: ['comments'] },
            actor,
          });
        return { ok: true as const };
      }),
  );
};
