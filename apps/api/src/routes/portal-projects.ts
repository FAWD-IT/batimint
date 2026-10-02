/**
 * Portail chantier du client (02 P5, P8 ; maquette portail-client) : lien signé révocable, sans
 * compte. Le client suit son chantier, valide les avenants « À valider » ou pose une question
 * sur l'objet, et retrouve ses documents. Seul ce qui est marqué visible par le client sort ici.
 */
import {
  PortalChangeOrderRefuseSchema,
  PortalChangeOrderSignSchema,
  PortalCommentCreateSchema,
  PortalProjectSchema,
  projectPortalChannel,
} from '@batimint/contracts';
import {
  createPortalToken,
  emitEvent,
  type EventActor,
  hashPortalToken,
  loadProjectNumbers,
  portalUrl,
  type Tx,
  withSystem,
  withTenant,
  writeAudit,
} from '@batimint/db';
import { sha256 } from '@batimint/documents';
import {
  brusselsDate,
  computeChangeOrder,
  currentProjectStep,
  formatClockTime,
  portalAccent,
  shiftEndDate,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { AppError, conflict } from '../lib/errors';
import { iso, isoDate } from '../lib/tenant';
import { coLineInputs, renderChangeOrderPdfFor } from '../services/change-orders';
import { renderVersionPdf } from '../services/quotes';
import { driftThresholdOf } from '../services/projects';

const portalNotFound = () =>
  new AppError(
    404,
    'portal_link_invalid',
    'Ce lien n’est plus valable. Demandez un nouveau lien à l’entreprise.',
  );

async function resolveProjectToken(deps: AppDeps, token: string) {
  const row = await withSystem(deps.prisma, (tx) =>
    tx.portalToken.findUnique({ where: { tokenHash: hashPortalToken(token) } }),
  );
  if (!row || row.kind !== 'project' || !row.projectId || row.revokedAt || row.expiresAt < new Date())
    throw portalNotFound();
  return row as typeof row & { projectId: string };
}

const VISIBLE_CO = ['sent', 'signed', 'refused'] as const;

async function portalProjectDto(tx: Tx, projectId: string, token: string) {
  const p = await tx.project.findUnique({
    where: { id: projectId },
    include: { tenant: true, customer: true, site: true, quote: true },
  });
  if (!p) throw portalNotFound();
  const t = p.tenant;
  const numbers = (await loadProjectNumbers(tx, [p], await driftThresholdOf(tx, p.tenantId))).get(p.id)!;
  const base = `/api/v1/portal/projects/${encodeURIComponent(token)}`;

  const photos = await tx.attachment.findMany({
    where: { ownerType: 'project', ownerId: p.id, kind: 'photo', visibleToClient: true },
    orderBy: [{ takenAt: 'desc' }, { createdAt: 'desc' }],
    take: 40,
  });
  const latest = photos[0];
  const latestDay = latest ? brusselsDate(latest.takenAt ?? latest.createdAt) : null;
  const sameDay = latest
    ? photos.filter((ph) => brusselsDate(ph.takenAt ?? ph.createdAt) === latestDay).length
    : 0;

  const changeOrders = await tx.changeOrder.findMany({
    where: { projectId: p.id, status: { in: [...VISIBLE_CO] } },
    include: { lines: { orderBy: { position: 'asc' } } },
    orderBy: { ordinal: 'desc' },
  });
  const comments = await tx.comment.findMany({
    where: { projectId: p.id, visibleToClient: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  const commentDto = (c: (typeof comments)[number]) => ({
    id: c.id,
    body: c.body,
    authorLabel: c.authorLabel,
    fromClient: Boolean(c.authorPortalToken),
    createdAt: c.createdAt.toISOString(),
  });
  const timeline = await tx.timelineEntry.findMany({
    where: { projectId: p.id, visibleToClient: true },
    orderBy: { occurredAt: 'desc' },
    take: 20,
  });
  const today = brusselsDate(new Date());
  const headline = timeline.find((e) => brusselsDate(e.occurredAt) === today) ?? null;
  // Arrivée de l'équipe (vouvoiement) : « L'équipe de Karim est chez vous depuis 8 h 02 ».
  let headlineTitle = headline?.title ?? null;
  if (headline?.type === 'team.arrived') {
    const data = headline.data as {
      teamLabel?: string;
      isTeam?: boolean;
      since?: string;
      day?: string;
    } | null;
    const last = await tx.timeEntry.findMany({
      where: { projectId: p.id, day: new Date(`${today}T00:00:00Z`) },
      orderBy: { at: 'asc' },
      select: { employeeId: true, kind: true },
    });
    const state = new Map<string, string>();
    for (const e of last) state.set(e.employeeId, e.kind);
    const onSite = [...state.values()].some((k) => k === 'in');
    const who = data?.isTeam ? `L’équipe de ${data.teamLabel}` : (data?.teamLabel ?? 'Notre équipe');
    headlineTitle = onSite
      ? `${who} est chez vous depuis ${formatClockTime(new Date(data?.since ?? headline.occurredAt))}`
      : `${who} est passée chez vous aujourd’hui`;
  }
  const documents: {
    id: string;
    kind: 'quote' | 'change_order' | 'attachment';
    title: string;
    date: string | null;
    href: string;
  }[] = [];
  if (p.quote?.signedAt)
    documents.push({
      id: p.quote.id,
      kind: 'quote',
      title: `Devis ${p.quote.number ?? ''} signé`.replace(/\s+/g, ' '),
      date: iso(p.quote.signedAt),
      href: `${base}/quote.pdf`,
    });
  for (const co of changeOrders.filter((c) => c.status === 'signed'))
    documents.push({
      id: co.id,
      kind: 'change_order',
      title: `Avenant n°${co.ordinal} signé${co.number ? ` (${co.number})` : ''}`,
      date: iso(co.signedAt),
      href: `${base}/change-orders/${co.id}/pdf`,
    });
  const docs = await tx.attachment.findMany({
    where: { ownerType: 'project', ownerId: p.id, kind: 'document', visibleToClient: true },
    orderBy: { createdAt: 'desc' },
  });
  for (const d of docs)
    documents.push({
      id: d.id,
      kind: 'attachment',
      title: d.caption ?? d.fileName,
      date: iso(d.createdAt),
      href: `${base}/attachments/${d.id}`,
    });

  const manager = p.managerUserId ? await tx.user.findUnique({ where: { id: p.managerUserId } }) : null;
  const managerEmployee = p.managerUserId
    ? await tx.employee.findFirst({ where: { userId: p.managerUserId } })
    : null;
  const finalInvoice = await tx.invoice.findFirst({
    where: { projectId: p.id, type: 'final', status: { notIn: ['draft', 'cancelled'] } },
  });
  return {
    tenant: {
      name: t.name,
      accent: portalAccent(t.brandColor),
      logoUrl: t.logoKey ? `/api/v1/public/tenants/${t.slug}/logo` : null,
      email: t.email,
      phone: t.phone,
    },
    project: {
      name: p.name,
      number: p.number,
      status: p.status,
      step: currentProjectStep({
        status: p.status,
        progress: numbers.fin.progress,
        finalInvoiceIssued: Boolean(finalInvoice),
        fullyPaid: finalInvoice?.status === 'paid',
      }),
      progress: numbers.fin.progress.toDecimalPlaces(4).toString(),
      startDate: isoDate(p.startDate),
      endDate: isoDate(p.endDate),
      address: p.site ? `${p.site.street}, ${p.site.postalCode} ${p.site.city}` : null,
    },
    headline: headline ? { title: headlineTitle!, at: headline.occurredAt.toISOString() } : null,
    photoOfTheDay: latest
      ? {
          url: `${base}/attachments/${latest.id}`,
          caption: latest.caption,
          takenAt: (latest.takenAt ?? latest.createdAt).toISOString(),
          count: sameDay,
        }
      : null,
    changeOrders: changeOrders.map((co) => {
      const totals = computeChangeOrder(coLineInputs(co.lines));
      const net = new Map(totals.lines.map((l) => [l.id, l.netAmount]));
      return {
        id: co.id,
        ordinal: co.ordinal,
        number: co.number,
        title: co.title,
        description: co.description,
        status: co.status as (typeof VISIBLE_CO)[number],
        totalNet: Number(co.totalNet),
        totalGross: Number(co.totalGross),
        delayDays: co.delayDays,
        newEndDate: co.delayDays > 0 ? shiftEndDate(isoDate(p.endDate), co.delayDays) : null,
        lines: co.lines.map((l) => ({
          description: l.description,
          quantity: l.quantity.toString(),
          unit: l.unit,
          netAmount: Number(net.get(l.id) ?? 0n),
        })),
        vatBreakdown: totals.document.vatBreakdown.map((v) => ({
          category: v.category,
          ratePercent: v.ratePercent,
          regimes: v.regimes,
          taxableAmount: Number(v.taxableAmount),
          taxAmount: Number(v.taxAmount),
        })),
        signedAt: iso(co.signedAt),
        thread: comments
          .filter((c) => c.subjectType === 'change_order' && c.subjectId === co.id)
          .map(commentDto),
      };
    }),
    documents,
    timeline: timeline.map((e) => ({
      id: e.id,
      title: e.title,
      body: e.body,
      occurredAt: e.occurredAt.toISOString(),
    })),
    thread: comments.filter((c) => c.subjectType === 'project').map(commentDto),
    contact: manager
      ? { name: manager.name, phone: managerEmployee?.phone ?? t.phone, email: manager.email }
      : { name: t.name, phone: t.phone, email: t.email },
    customer: { displayName: p.customer.displayName },
  };
}

export const portalProjectRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const tokenParams = z.object({ token: z.string().min(20).max(200) });
  const coParams = tokenParams.extend({ id: z.uuid() });

  app.get(
    '/portal/projects/:token',
    {
      schema: {
        tags: ['portail'],
        summary: 'Chantier vu par le client',
        params: tokenParams,
        response: { 200: PortalProjectSchema },
      },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req) => {
      const t = await resolveProjectToken(deps, req.params.token);
      return withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        // « Vu par le client » dans le cockpit : une écriture au plus toutes les 5 minutes.
        if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 5 * 60_000)
          await tx.portalToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } });
        return portalProjectDto(tx, t.projectId, req.params.token);
      });
    },
  );

  app.get(
    '/portal/projects/:token/stream',
    {
      schema: {
        tags: ['portail'],
        summary: 'Flux temps réel du portail chantier',
        params: tokenParams,
        hide: true,
      },
      config: { rateLimit: false },
    },
    async (req, reply) => {
      const t = await resolveProjectToken(deps, req.params.token);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 5000\n');
      res.write('event: ready\ndata: {}\n\n');
      const unsubscribe = deps.realtime.subscribe({
        tenantId: t.tenantId,
        channels: new Set([projectPortalChannel(t.projectId)]),
        // Le portail ne reçoit que le sujet à rafraîchir, jamais de donnée.
        send: (msg) => res.write(`event: message\ndata: ${JSON.stringify({ topic: msg.topic })}\n\n`),
      });
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      });
    },
  );

  app.get(
    '/portal/projects/:token/quote.pdf',
    { schema: { tags: ['portail'], summary: 'Devis signé', params: tokenParams, hide: true } },
    async (req, reply) => {
      const t = await resolveProjectToken(deps, req.params.token);
      const { pdf, name } = await withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        const p = await tx.project.findUnique({ where: { id: t.projectId }, include: { quote: true } });
        if (!p?.quote) throw portalNotFound();
        const v = await tx.quoteVersion.findFirst({ where: { quoteId: p.quote.id, status: 'signed' } });
        if (!v) throw portalNotFound();
        const name = `${p.quote.number ?? 'devis'}-signe.pdf`;
        const stored = v.pdfKey
          ? await deps.integrations.storage.get('legal', v.pdfKey).catch(() => null)
          : null;
        if (stored) return { pdf: Buffer.from(stored), name };
        // Contrat repris sans PDF archivé (import, démo) : régénéré avec la preuve de signature.
        const sig = await tx.signature.findFirst({
          where: { subjectType: 'quote_version', subjectId: v.id },
        });
        const cert = await tx.vatCertificate.findFirst({ where: { quoteId: p.quote.id, status: 'signed' } });
        return {
          pdf: await renderVersionPdf(tx, deps.integrations, p.quote.id, v.id, {
            date: v.sentAt ?? p.quote.signedAt ?? new Date(),
            signature: sig ? { signerName: sig.signerName, signedAt: sig.signedAt, ip: sig.ip } : null,
            certificate: cert?.signedAt ? { signedAt: cert.signedAt } : null,
          }),
          name,
        };
      });
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${name}"`)
        .header('cache-control', 'private, no-store')
        .send(pdf);
    },
  );

  app.get(
    '/portal/projects/:token/change-orders/:id/pdf',
    { schema: { tags: ['portail'], summary: 'PDF d’un avenant', params: coParams, hide: true } },
    async (req, reply) => {
      const t = await resolveProjectToken(deps, req.params.token);
      const { pdf, name } = await withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        const co = await tx.changeOrder.findFirst({
          where: { id: req.params.id, projectId: t.projectId, status: { in: [...VISIBLE_CO] } },
        });
        if (!co) throw portalNotFound();
        const name = `${co.number ?? `avenant-${co.ordinal}`}.pdf`;
        if (co.signatureId) {
          const sig = await tx.signature.findUnique({ where: { id: co.signatureId } });
          if (sig?.documentKey)
            return { pdf: Buffer.from(await deps.integrations.storage.get('legal', sig.documentKey)), name };
        }
        if (co.pdfKey)
          return { pdf: Buffer.from(await deps.integrations.storage.get('uploads', co.pdfKey)), name };
        return { pdf: await renderChangeOrderPdfFor(tx, deps.integrations, co.id), name };
      });
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${name}"`)
        .header('cache-control', 'private, no-store')
        .send(pdf);
    },
  );

  app.get(
    '/portal/projects/:token/attachments/:id',
    { schema: { tags: ['portail'], summary: 'Photo ou document partagé', params: coParams, hide: true } },
    async (req, reply) => {
      const t = await resolveProjectToken(deps, req.params.token);
      const a = await withTenant(deps.prisma, t.tenantId, null, (tx) =>
        tx.attachment.findFirst({
          where: { id: req.params.id, ownerType: 'project', ownerId: t.projectId, visibleToClient: true },
        }),
      );
      if (!a) throw portalNotFound();
      const body = await deps.integrations.storage.get('uploads', a.storageKey);
      return reply
        .header('content-type', a.contentType)
        .header('cache-control', 'private, max-age=3600')
        .header('content-disposition', `inline; filename="${a.fileName.replace(/"/g, '')}"`)
        .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .send(Buffer.from(body));
    },
  );

  app.post(
    '/portal/projects/:token/change-orders/:id/sign',
    {
      schema: {
        tags: ['portail'],
        summary: 'Valider (signer) un avenant',
        params: coParams,
        body: PortalChangeOrderSignSchema,
        response: { 200: PortalProjectSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const t = await resolveProjectToken(deps, req.params.token);
      const b = req.body;
      return withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        // Verrou : un double clic ne signe pas deux fois.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM change_orders WHERE id = ${req.params.id}::uuid AND project_id = ${t.projectId}::uuid FOR UPDATE`;
        if (!locked[0]) throw portalNotFound();
        const co = await tx.changeOrder.findUniqueOrThrow({ where: { id: req.params.id } });
        if (co.status === 'signed') throw conflict('already_signed', 'Cet avenant est déjà validé. Merci !');
        if (co.status !== 'sent')
          throw conflict(
            'change_order_not_signable',
            'Cet avenant n’est plus à valider. Contactez l’entreprise.',
          );
        const now = new Date();
        const ip = req.ip;
        const userAgent = req.headers['user-agent'] ?? null;
        const pdf = await renderChangeOrderPdfFor(tx, deps.integrations, co.id, {
          date: co.sentAt ?? now,
          signature: { signerName: b.signerName, signedAt: now, ip },
        });
        const pdfHash = sha256(pdf);
        const pdfKey = `t/${t.tenantId}/change-orders/${co.id}/signed-${uuidv7()}.pdf`;
        await deps.integrations.storage.put({
          bucket: 'legal',
          key: pdfKey,
          body: pdf,
          contentType: 'application/pdf',
          metadata: { sha256: pdfHash },
        });
        const customer = await tx.customer.findUnique({ where: { id: t.customerId ?? '' } });
        const signature = await tx.signature.create({
          data: {
            tenantId: t.tenantId,
            subjectType: 'change_order',
            subjectId: co.id,
            signerName: b.signerName,
            signerEmail: customer?.email ?? t.email,
            signatureImage: b.signaturePath ?? null,
            acceptedTerms: true,
            ip,
            userAgent,
            documentSha256: pdfHash,
            documentKey: pdfKey,
            portalTokenId: t.id,
            signedAt: now,
          },
        });
        await tx.changeOrder.update({
          where: { id: co.id },
          data: { status: 'signed', signedAt: now, signatureId: signature.id },
        });
        const actor: EventActor = { type: 'portal', id: t.id, label: b.signerName };
        await writeAudit(tx, {
          tenantId: t.tenantId,
          actor,
          action: 'change_order.signed',
          entityType: 'change_order',
          entityId: co.id,
          changes: {
            number: co.number,
            ordinal: co.ordinal,
            documentSha256: pdfHash,
            totalNet: co.totalNet.toString(),
          },
          ip,
          userAgent,
          requestId: req.id,
        });
        await emitEvent(tx, {
          tenantId: t.tenantId,
          type: 'change_order.signed.v1',
          aggregateType: 'project',
          aggregateId: t.projectId,
          payload: { projectId: t.projectId, changeOrderId: co.id, signatureId: signature.id },
          actor,
        });
        return portalProjectDto(tx, t.projectId, req.params.token);
      });
    },
  );

  app.post(
    '/portal/projects/:token/change-orders/:id/refuse',
    {
      schema: {
        tags: ['portail'],
        summary: 'Refuser un avenant',
        params: coParams,
        body: PortalChangeOrderRefuseSchema,
        response: { 200: PortalProjectSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const t = await resolveProjectToken(deps, req.params.token);
      return withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        const co = await tx.changeOrder.findFirst({ where: { id: req.params.id, projectId: t.projectId } });
        if (!co) throw portalNotFound();
        if (co.status !== 'sent')
          throw conflict(
            'change_order_not_signable',
            'Cet avenant n’est plus à valider. Contactez l’entreprise.',
          );
        const customer = await tx.customer.findUnique({ where: { id: t.customerId ?? '' } });
        const actor: EventActor = { type: 'portal', id: t.id, label: customer?.displayName ?? 'Client' };
        await tx.changeOrder.update({
          where: { id: co.id },
          data: { status: 'refused', refusedAt: new Date(), refusalReason: req.body.reason ?? null },
        });
        await writeAudit(tx, {
          tenantId: t.tenantId,
          actor,
          action: 'change_order.refused',
          entityType: 'change_order',
          entityId: co.id,
          changes: { reason: req.body.reason ?? null },
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          requestId: req.id,
        });
        await emitEvent(tx, {
          tenantId: t.tenantId,
          type: 'change_order.refused.v1',
          aggregateType: 'project',
          aggregateId: t.projectId,
          payload: { projectId: t.projectId, changeOrderId: co.id, reason: req.body.reason ?? null },
          actor,
        });
        return portalProjectDto(tx, t.projectId, req.params.token);
      });
    },
  );

  app.post(
    '/portal/projects/:token/comments',
    {
      schema: {
        tags: ['portail'],
        summary: 'Poser une question sur le chantier ou un avenant',
        params: tokenParams,
        body: PortalCommentCreateSchema,
        response: { 200: PortalProjectSchema },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const t = await resolveProjectToken(deps, req.params.token);
      const b = req.body;
      return withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        const subjectId = b.subjectType === 'project' ? t.projectId : b.subjectId;
        if (b.subjectType === 'project' && b.subjectId && b.subjectId !== t.projectId) throw portalNotFound();
        if (
          b.subjectType === 'change_order' &&
          (!subjectId ||
            !(await tx.changeOrder.findFirst({
              where: { id: subjectId, projectId: t.projectId, status: { in: [...VISIBLE_CO] } },
            })))
        )
          throw portalNotFound();
        const customer = await tx.customer.findUnique({ where: { id: t.customerId ?? '' } });
        const label = customer?.displayName ?? 'Client';
        const c = await tx.comment.create({
          data: {
            tenantId: t.tenantId,
            subjectType: b.subjectType,
            subjectId: subjectId!,
            projectId: t.projectId,
            body: b.body,
            authorPortalToken: t.id,
            authorLabel: label,
            visibleToClient: true,
          },
        });
        await emitEvent(tx, {
          tenantId: t.tenantId,
          type: 'comment.added.v1',
          aggregateType: 'project',
          aggregateId: t.projectId,
          payload: {
            commentId: c.id,
            subjectType: b.subjectType,
            subjectId: subjectId!,
            projectId: t.projectId,
            fromClient: true,
            mentions: [],
          },
          actor: { type: 'portal', id: t.id, label },
        });
        return portalProjectDto(tx, t.projectId, req.params.token);
      });
    },
  );
};

/** Depuis le portail du devis signé : lien vers le suivi du chantier (même client). */
export async function projectLinkFromQuoteToken(
  deps: AppDeps,
  quoteToken: { tenantId: string; quoteId: string | null; customerId: string | null; email: string | null },
): Promise<string | null> {
  return withTenant(deps.prisma, quoteToken.tenantId, null, async (tx) => {
    if (!quoteToken.quoteId) return null;
    const p = await tx.project.findUnique({ where: { quoteId: quoteToken.quoteId } });
    if (!p) return null;
    const { token } = await createPortalToken(tx, {
      tenantId: quoteToken.tenantId,
      kind: 'project',
      projectId: p.id,
      customerId: p.customerId,
      email: quoteToken.email,
    });
    return portalUrl(deps.config.APP_URL, token);
  });
}
