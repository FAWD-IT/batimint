/**
 * Pièces jointes (photos, documents, notes vocales) rattachées à un objet. Envoi direct du fichier
 * (corps brut, 25 Mo max) ; lecture via l'API avec contrôle d'accès RLS.
 */
import { createHash } from 'node:crypto';
import { AttachmentSchema, OkSchema } from '@batimint/contracts';
import { emitEvent, type Tx } from '@batimint/db';
import { type Action, can } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { inTenant, iso } from '../lib/tenant';

const MAX_BYTES = 25 * 1024 * 1024;
const OWNER_TYPES = ['opportunity', 'site_visit', 'customer'] as const;
type OwnerType = (typeof OWNER_TYPES)[number];

const WRITE_PERMISSION: Record<OwnerType, Action> = {
  opportunity: 'site_visits.write',
  site_visit: 'site_visits.write',
  customer: 'customers.write',
};
const READ_PERMISSION: Record<OwnerType, Action> = {
  opportunity: 'leads.read',
  site_visit: 'leads.read',
  customer: 'customers.read',
};

const ALLOWED =
  /^(image\/(jpeg|png|webp|heic|heif)|audio\/(webm|ogg|mpeg|mp4|aac|wav|x-m4a)|application\/pdf|video\/mp4)$/;

type Row = Awaited<ReturnType<Tx['attachment']['findUniqueOrThrow']>>;
export const toAttachmentDto = (a: Row) => ({
  id: a.id,
  ownerType: a.ownerType,
  ownerId: a.ownerId,
  kind: a.kind,
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: a.sizeBytes,
  url: `/api/v1/attachments/${a.id}/file`,
  takenAt: iso(a.takenAt),
  caption: a.caption,
  transcript: a.transcript,
  transcriptStatus: a.transcriptStatus,
  visibleToClient: a.visibleToClient,
  createdAt: a.createdAt.toISOString(),
});

async function ownerExists(tx: Tx, type: OwnerType, id: string): Promise<boolean> {
  if (type === 'opportunity')
    return Boolean(await tx.opportunity.findUnique({ where: { id }, select: { id: true } }));
  if (type === 'site_visit')
    return Boolean(await tx.siteVisit.findUnique({ where: { id }, select: { id: true } }));
  return Boolean(await tx.customer.findUnique({ where: { id }, select: { id: true } }));
}

export const attachmentRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.addContentTypeParser(
    /^(image|audio|video)\/.+|application\/(pdf|octet-stream)$/,
    { parseAs: 'buffer', bodyLimit: MAX_BYTES },
    (_r, body, done) => done(null, body),
  );

  app.post(
    '/attachments',
    {
      schema: {
        tags: ['fichiers'],
        summary: 'Envoyer une photo, un document ou une note vocale (corps brut, en-tête X-File-Name)',
        querystring: z.object({
          ownerType: z.enum(OWNER_TYPES),
          ownerId: z.uuid(),
          kind: z.enum(['photo', 'document', 'voice_note']),
          id: z.uuid().optional(),
          takenAt: z.iso.datetime().optional(),
          lat: z.coerce.number().min(-90).max(90).optional(),
          lng: z.coerce.number().min(-180).max(180).optional(),
          caption: z.string().max(500).optional(),
        }),
        response: { 201: AttachmentSchema },
      },
    },
    async (req, reply) => {
      const q = req.query;
      const body = req.body as Buffer | undefined;
      const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('empty_file', 'Le fichier est vide.');
      if (!ALLOWED.test(contentType))
        throw badRequest(
          'unsupported_file',
          'Format non pris en charge (photo JPEG/PNG/WebP/HEIC, PDF ou enregistrement audio).',
        );
      const fileName = decodeURIComponent(
        String(req.headers['x-file-name'] ?? `${q.kind}.${contentType.split('/')[1]}`),
      )
        .replace(/[^\w.\-() ]+/g, '_')
        .slice(0, 120);
      const dto = await inTenant(deps, req, WRITE_PERMISSION[q.ownerType], async ({ tx, auth, actor }) => {
        if (!(await ownerExists(tx, q.ownerType, q.ownerId))) throw notFound('Cet élément');
        if (q.id) {
          const existing = await tx.attachment.findUnique({ where: { id: q.id } });
          if (existing) return toAttachmentDto(existing);
        }
        const id = q.id ?? uuidv7();
        const key = `t/${auth.tenantId}/${q.ownerType}/${q.ownerId}/${id}-${fileName}`;
        await deps.integrations.storage.put({ bucket: 'uploads', key, body, contentType });
        const a = await tx.attachment.create({
          data: {
            id,
            tenantId: auth.tenantId,
            ownerType: q.ownerType,
            ownerId: q.ownerId,
            kind: q.kind,
            storageKey: key,
            fileName,
            contentType,
            sizeBytes: body.length,
            sha256: createHash('sha256').update(body).digest('hex'),
            takenAt: q.takenAt ? new Date(q.takenAt) : new Date(),
            latitude: q.lat ?? null,
            longitude: q.lng ?? null,
            caption: q.caption ?? null,
            transcriptStatus: q.kind === 'voice_note' ? 'pending' : null,
            createdBy: auth.userId,
          },
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'attachment.added.v1',
          aggregateType: q.ownerType,
          aggregateId: q.ownerId,
          payload: { attachmentId: a.id, ownerType: q.ownerType, ownerId: q.ownerId, kind: q.kind },
          actor,
        });
        return toAttachmentDto(a);
      });
      return reply.status(201).send(dto);
    },
  );

  app.get(
    '/attachments',
    {
      schema: {
        tags: ['fichiers'],
        summary: "Pièces jointes d'un objet",
        querystring: z.object({ ownerType: z.enum(OWNER_TYPES), ownerId: z.uuid() }),
        response: { 200: z.object({ items: z.array(AttachmentSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, READ_PERMISSION[req.query.ownerType], async ({ tx }) => ({
        items: (
          await tx.attachment.findMany({
            where: { ownerType: req.query.ownerType, ownerId: req.query.ownerId },
            orderBy: { createdAt: 'desc' },
          })
        ).map(toAttachmentDto),
      })),
  );

  app.get(
    '/attachments/:id/file',
    {
      schema: {
        tags: ['fichiers'],
        summary: 'Contenu du fichier',
        params: z.object({ id: z.uuid() }),
        hide: true,
      },
    },
    async (req, reply) => {
      const a = await inTenant(deps, req, null, async ({ tx }) =>
        tx.attachment.findUnique({ where: { id: req.params.id } }),
      );
      if (!a) throw notFound('Ce fichier');
      const body = await deps.integrations.storage.get('uploads', a.storageKey);
      return reply
        .header('content-type', a.contentType)
        .header('cache-control', 'private, max-age=86400, immutable')
        .header('content-disposition', `inline; filename="${a.fileName.replace(/"/g, '')}"`)
        .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .send(Buffer.from(body));
    },
  );

  app.delete(
    '/attachments/:id',
    {
      schema: {
        tags: ['fichiers'],
        summary: 'Supprimer une pièce jointe',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, null, async ({ tx, auth, audit }) => {
        const a = await tx.attachment.findUnique({ where: { id: req.params.id } });
        if (!a) throw notFound('Ce fichier');
        const perm = WRITE_PERMISSION[a.ownerType as OwnerType] ?? 'projects.write';
        if (!can(auth.role, perm)) throw forbidden();
        await tx.attachment.delete({ where: { id: a.id } });
        await audit('attachment.deleted', a.ownerType, a.ownerId, { fileName: a.fileName });
        return { ok: true as const };
      }),
  );
};
