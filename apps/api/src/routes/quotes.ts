/**
 * Devis (03 §4, 02 P2.3–P2.7) : création depuis l'affaire, éditeur (enregistrement versionné),
 * bibliothèque et ouvrages éclatables, dictée IA, PDF, envoi, refus, duplication et modèles.
 */
import {
  DraftLinesRequestSchema,
  DraftLinesResponseSchema,
  OkSchema,
  parseTenantSettings,
  QuoteContentSchema,
  QuoteCreateSchema,
  QuoteSchema,
  QuoteSendSchema,
  QuoteSummarySchema,
  QuoteVersionSchema,
} from '@batimint/contracts';
import {
  copyVersionContent,
  emitEvent,
  nextSequenceValue,
  replaceVersionContent,
  type Tx,
} from '@batimint/db';
import { sha256 } from '@batimint/documents';
import {
  can,
  computeSalePrice,
  diffQuoteVersions,
  formatDocumentNumber,
  type NumberedDocumentType,
  quoteValidUntil,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { inTenant, iso } from '../lib/tenant';
import { searchItemIds } from './library';
import {
  lineSuggestion,
  loadQuoteRow,
  quoteDto,
  refreshVersionTotals,
  renderVersionPdf,
  saveQuoteContent,
  suggestVat,
  versionDto,
} from '../services/quotes';

async function nextNumber(tx: Tx, tenantId: string, type: NumberedDocumentType): Promise<string> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const pattern = parseTenantSettings(t.settings).numbering[type];
  const year = new Date().getFullYear();
  return formatDocumentNumber(pattern, { year, sequence: await nextSequenceValue(tx, tenantId, type, year) });
}

async function coefs(tx: Tx, tenantId: string) {
  const s = parseTenantSettings(
    (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })).settings,
  );
  return { overheadCoefficient: s.overheadCoefficient, marginCoefficient: s.marginCoefficient, settings: s };
}

export const quoteRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/quotes',
    {
      schema: {
        tags: ['devis'],
        summary: 'Devis (et modèles)',
        querystring: z.object({
          status: z.string().max(80).optional(),
          opportunityId: z.uuid().optional(),
          customerId: z.uuid().optional(),
          templates: z.stringbool().default(false),
          q: z.string().max(100).optional(),
        }),
        response: { 200: z.object({ items: z.array(QuoteSummarySchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'quotes.read', async ({ tx }) => {
        const { status, opportunityId, customerId, templates, q } = req.query;
        const statuses = status?.split(',').filter(Boolean);
        const rows = await tx.quote.findMany({
          where: {
            archivedAt: null,
            isTemplate: templates,
            ...(statuses?.length ? { status: { in: statuses as never[] } } : {}),
            ...(opportunityId ? { opportunityId } : {}),
            ...(customerId ? { customerId } : {}),
            ...(q?.trim()
              ? {
                  OR: [
                    { title: { contains: q.trim(), mode: 'insensitive' as const } },
                    { number: { contains: q.trim(), mode: 'insensitive' as const } },
                    { customer: { displayName: { contains: q.trim(), mode: 'insensitive' as const } } },
                  ],
                }
              : {}),
          },
          include: {
            customer: { select: { displayName: true } },
            versions: true,
            project: { select: { id: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        });
        return {
          items: rows.map((r) => {
            const v = r.versions.find((x) => x.id === r.currentVersionId) ?? r.versions.at(-1);
            return {
              id: r.id,
              number: r.number,
              title: r.title,
              status: r.status,
              isTemplate: r.isTemplate,
              customerName: r.customer?.displayName ?? null,
              opportunityId: r.opportunityId,
              projectId: r.project?.id ?? null,
              version: v?.version ?? 1,
              totalNet: Number(v?.totalNet ?? 0),
              totalGross: Number(v?.totalGross ?? 0),
              sentAt: iso(r.sentAt),
              viewedAt: iso(r.viewedAt),
              signedAt: iso(r.signedAt),
              validUntil: iso(r.validUntil),
              updatedAt: r.updatedAt.toISOString(),
            };
          }),
        };
      }),
  );

  app.post(
    '/quotes',
    {
      schema: {
        tags: ['devis'],
        summary: 'Créer un devis (depuis une affaire, un modèle ou en dupliquant)',
        body: QuoteCreateSchema,
        response: { 201: QuoteSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'quotes.write', async ({ tx, auth, actor, audit }) => {
        const b = req.body;
        if (b.id) {
          const existing = await tx.quote.findUnique({ where: { id: b.id } });
          if (existing) return quoteDto(tx, existing.id, auth.role);
        }
        let customerId = b.customerId ?? null;
        let siteId = b.siteId ?? null;
        const opp = b.opportunityId
          ? await tx.opportunity.findUnique({ where: { id: b.opportunityId } })
          : null;
        if (b.opportunityId && !opp) throw notFound('Cette affaire');
        if (opp) {
          customerId = opp.customerId;
          siteId = siteId ?? opp.siteId;
        }
        const isTemplate = Boolean(b.isTemplate);
        if (!isTemplate && !customerId)
          throw badRequest('customer_required', 'Choisissez le client du devis (ou partez de son affaire).');
        const { settings } = await coefs(tx, auth.tenantId);
        const source = b.fromQuoteId ? await tx.quote.findUnique({ where: { id: b.fromQuoteId } }) : null;
        if (b.fromQuoteId && !source?.currentVersionId) throw notFound('Ce devis ou modèle');
        const quote = await tx.quote.create({
          data: {
            ...(b.id ? { id: b.id } : {}),
            tenantId: auth.tenantId,
            number: isTemplate ? null : await nextNumber(tx, auth.tenantId, 'quote'),
            title: b.title,
            customerId: isTemplate ? null : customerId,
            siteId: isTemplate ? null : siteId,
            opportunityId: isTemplate ? null : (opp?.id ?? null),
            isTemplate,
            validityDays: source?.validityDays ?? settings.quoteValidityDays,
            ownerUserId: auth.userId,
            createdBy: auth.userId,
          },
          include: { customer: true, site: true },
        });
        const version = await tx.quoteVersion.create({
          data: {
            tenantId: auth.tenantId,
            quoteId: quote.id,
            version: 1,
            depositKind: 'percent',
            depositValue: settings.depositPercent,
            vatContext: suggestVat(quote.customer, quote.site),
            createdBy: auth.userId,
          },
        });
        await tx.quote.update({ where: { id: quote.id }, data: { currentVersionId: version.id } });
        if (source?.currentVersionId) {
          await copyVersionContent(tx, auth.tenantId, source.currentVersionId, version.id, {
            freshKeys: uuidv7,
          });
          const from = await tx.quoteVersion.findUniqueOrThrow({ where: { id: source.currentVersionId } });
          await tx.quoteVersion.update({
            where: { id: version.id },
            data: {
              intro: from.intro,
              notes: from.notes,
              globalDiscountPercent: from.globalDiscountPercent,
              depositKind: from.depositKind,
              depositValue: from.depositValue,
              paymentSchedule: from.paymentSchedule as object,
            },
          });
          // Un modèle n'a pas de client : les régimes de TVA sont réalignés sur le nouveau client.
          if (!isTemplate) {
            const suggestion = suggestVat(quote.customer, quote.site);
            const lines = await tx.quoteLine.findMany({ where: { versionId: version.id } });
            const items = await tx.item.findMany({
              where: { id: { in: lines.map((l) => l.itemId).filter((x): x is string => Boolean(x)) } },
              select: { id: true, vatRate: true },
            });
            const rate = new Map(items.map((i) => [i.id, i.vatRate]));
            for (const l of lines) {
              const s = lineSuggestion(l.itemId ? rate.get(l.itemId) : null, suggestion.regime);
              if (l.vatSuggested !== s || l.vatRegime !== s)
                await tx.quoteLine.update({
                  where: { id: l.id },
                  data: { vatSuggested: s, vatRegime: l.vatJustification ? l.vatRegime : s },
                });
            }
          }
        } else {
          await replaceVersionContent(tx, auth.tenantId, version.id, {
            sections: [
              { key: uuidv7(), title: opp?.title ?? b.title, optional: false, selected: false, lines: [] },
            ],
          });
        }
        await refreshVersionTotals(tx, version.id);
        if (opp && (opp.stage === 'new' || opp.stage === 'visit_planned')) {
          await tx.opportunity.update({ where: { id: opp.id }, data: { stage: 'quoting' } });
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'opportunity.stage_changed.v1',
            aggregateType: 'opportunity',
            aggregateId: opp.id,
            payload: { opportunityId: opp.id, from: opp.stage, to: 'quoting' },
            actor,
          });
        }
        await audit('quote.created', 'quote', quote.id, {
          number: quote.number,
          fromQuoteId: b.fromQuoteId ?? null,
        });
        return quoteDto(tx, quote.id, auth.role);
      });
      return reply.status(201).send(dto);
    },
  );

  app.get(
    '/quotes/:id',
    {
      schema: {
        tags: ['devis'],
        summary: 'Devis avec sa version courante, ses versions et son fil',
        params: z.object({ id: z.uuid() }),
        response: { 200: QuoteSchema },
      },
    },
    (req) => inTenant(deps, req, 'quotes.read', ({ tx, auth }) => quoteDto(tx, req.params.id, auth.role)),
  );

  app.get(
    '/quotes/:id/versions/:versionId',
    {
      schema: {
        tags: ['devis'],
        summary: 'Une version figée du devis',
        params: z.object({ id: z.uuid(), versionId: z.uuid() }),
        response: { 200: QuoteVersionSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'quotes.read', async ({ tx, auth }) => {
        const v = await tx.quoteVersion.findFirst({
          where: { id: req.params.versionId, quoteId: req.params.id },
        });
        if (!v) throw notFound('Cette version');
        return versionDto(tx, v.id, auth.role);
      }),
  );

  app.get(
    '/quotes/:id/compare',
    {
      schema: {
        tags: ['devis'],
        summary: 'Comparatif entre deux versions',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ from: z.uuid(), to: z.uuid() }),
        response: {
          200: z.object({
            changes: z.array(
              z.object({
                kind: z.enum(['added', 'removed', 'changed']),
                sectionTitle: z.string(),
                description: z.string(),
                fields: z.array(z.string()),
                before: z.object({ quantity: z.string(), unitPrice: z.number() }).optional(),
                after: z.object({ quantity: z.string(), unitPrice: z.number() }).optional(),
              }),
            ),
            totalGrossBefore: z.number(),
            totalGrossAfter: z.number(),
          }),
        },
      },
    },
    (req) =>
      inTenant(deps, req, 'quotes.read', async ({ tx, auth }) => {
        const load = async (vid: string) => {
          const v = await tx.quoteVersion.findFirst({ where: { id: vid, quoteId: req.params.id } });
          if (!v) throw notFound('Cette version');
          return versionDto(tx, v.id, auth.role);
        };
        const a = await load(req.query.from);
        const b = await load(req.query.to);
        const shape = (v: Awaited<ReturnType<typeof versionDto>>) =>
          v.sections.map((s) => ({
            title: s.title,
            lines: s.lines
              .filter((l) => l.kind === 'item')
              .map((l) => ({
                key: l.key,
                description: l.description,
                unit: l.unit,
                quantity: l.quantity,
                unitPrice: BigInt(l.unitPrice),
                vatRegime: l.vatRegime,
                discountPercent: l.discountPercent,
              })),
          }));
        return {
          changes: diffQuoteVersions(shape(a), shape(b)).map(({ before, after, ...c }) => ({
            ...c,
            ...(before ? { before: { quantity: before.quantity, unitPrice: Number(before.unitPrice) } } : {}),
            ...(after ? { after: { quantity: after.quantity, unitPrice: Number(after.unitPrice) } } : {}),
          })),
          totalGrossBefore: a.totals.totalGross,
          totalGrossAfter: b.totals.totalGross,
        };
      }),
  );

  app.put(
    '/quotes/:id/content',
    {
      schema: {
        tags: ['devis'],
        summary: 'Enregistrer le contenu (nouvelle version automatique si le devis a été envoyé)',
        params: z.object({ id: z.uuid() }),
        body: QuoteContentSchema,
        response: { 200: QuoteSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'quotes.write', async ({ tx, auth, audit }) => {
        const quote = await loadQuoteRow(tx, req.params.id);
        if (!quote) throw notFound('Ce devis');
        const { newVersion } = await saveQuoteContent(
          tx,
          { tenantId: auth.tenantId, userId: auth.userId },
          quote,
          req.body,
        );
        if (newVersion) await audit('quote.version_created', 'quote', quote.id, { number: quote.number });
        const overrides = req.body.sections.flatMap((s) => s.lines.filter((l) => l.vatJustification));
        if (overrides.length)
          await audit('quote.vat_overridden', 'quote', quote.id, {
            lines: overrides.map((l) => ({
              key: l.key,
              regime: l.vatRegime,
              justification: l.vatJustification,
            })),
          });
        return quoteDto(tx, quote.id, auth.role);
      }),
  );

  app.get(
    '/quotes/:id/pdf',
    {
      schema: {
        tags: ['devis'],
        summary: 'PDF du devis (version courante, ou version demandée)',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ versionId: z.uuid().optional() }),
      },
    },
    async (req, reply) => {
      const { pdf, name } = await inTenant(deps, req, 'quotes.read', async ({ tx }) => {
        const q = await tx.quote.findUnique({ where: { id: req.params.id } });
        if (!q?.currentVersionId) throw notFound('Ce devis');
        const versionId = req.query.versionId ?? q.currentVersionId;
        const v = await tx.quoteVersion.findFirst({ where: { id: versionId, quoteId: q.id } });
        if (!v) throw notFound('Cette version');
        // Document figé (envoyé ou signé) : on sert exactement le PDF émis.
        const stored = v.pdfKey
          ? await deps.integrations.storage
              .get(v.status === 'signed' ? 'legal' : 'uploads', v.pdfKey)
              .catch(() => null)
          : null;
        return {
          pdf: stored ? Buffer.from(stored) : await renderVersionPdf(tx, deps.integrations, q.id, v.id),
          name: `${q.number ?? 'modele'}-v${v.version}.pdf`,
        };
      });
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${name}"`)
        .header('cache-control', 'private, no-store')
        .send(pdf);
    },
  );

  app.post(
    '/quotes/:id/send',
    {
      schema: {
        tags: ['devis'],
        summary: 'Envoyer le devis au client (e-mail avec lien vers le portail)',
        params: z.object({ id: z.uuid() }),
        body: QuoteSendSchema,
        response: { 200: QuoteSchema },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    (req) =>
      inTenant(
        deps,
        req,
        'quotes.send',
        async ({ tx, auth, actor, audit }) => {
          const q = await loadQuoteRow(tx, req.params.id);
          if (!q?.currentVersionId) throw notFound('Ce devis');
          if (q.isTemplate)
            throw badRequest(
              'template_not_sendable',
              'Un modèle ne s’envoie pas : créez un devis à partir de lui.',
            );
          if (q.status === 'signed') throw conflict('quote_signed', 'Ce devis est déjà signé.');
          const v = q.versions.find((x) => x.id === q.currentVersionId)!;
          const lineCount = await tx.quoteLine.count({ where: { versionId: v.id, kind: 'item' } });
          if (!lineCount)
            throw badRequest('quote_empty', 'Ajoutez au moins une ligne chiffrée avant d’envoyer le devis.');
          const now = new Date();
          const firstSend = v.status === 'draft';
          const validUntil = firstSend ? quoteValidUntil(now, q.validityDays) : q.validUntil;
          if (firstSend) {
            await tx.quote.update({ where: { id: q.id }, data: { validUntil } });
            await tx.quoteVersion.update({ where: { id: v.id }, data: { sentAt: now } });
            const pdf = await renderVersionPdf(tx, deps.integrations, q.id, v.id, { date: now });
            const key = `t/${auth.tenantId}/quotes/${q.id}/v${v.version}-${uuidv7()}.pdf`;
            await deps.integrations.storage.put({
              bucket: 'uploads',
              key,
              body: pdf,
              contentType: 'application/pdf',
            });
            await tx.quoteVersion.update({
              where: { id: v.id },
              data: { status: 'sent', pdfKey: key, pdfSha256: sha256(pdf) },
            });
          }
          await tx.quote.update({
            where: { id: q.id },
            data: {
              status: firstSend ? 'sent' : q.status,
              sentAt: now,
              reminderSentAt: null,
              ...(firstSend ? { viewedAt: null } : {}),
            },
          });
          if (q.customer && !q.customer.email)
            await tx.customer.update({ where: { id: q.customer.id }, data: { email: req.body.email } });
          await audit('quote.sent', 'quote', q.id, { version: v.version, email: req.body.email });
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'quote.sent.v1',
            aggregateType: 'quote',
            aggregateId: q.id,
            payload: {
              quoteId: q.id,
              versionId: v.id,
              version: v.version,
              email: req.body.email,
              message: req.body.message ?? null,
            },
            actor,
          });
          if (q.opportunityId) {
            const opp = await tx.opportunity.findUnique({ where: { id: q.opportunityId } });
            if (opp && ['new', 'visit_planned', 'quoting'].includes(opp.stage)) {
              await tx.opportunity.update({ where: { id: opp.id }, data: { stage: 'sent' } });
              await emitEvent(tx, {
                tenantId: auth.tenantId,
                type: 'opportunity.stage_changed.v1',
                aggregateType: 'opportunity',
                aggregateId: opp.id,
                payload: { opportunityId: opp.id, from: opp.stage, to: 'sent' },
                actor,
              });
            }
          }
          return quoteDto(tx, q.id, auth.role);
        },
        { timeoutMs: 30_000 },
      ),
  );

  app.post(
    '/quotes/:id/refuse',
    {
      schema: {
        tags: ['devis'],
        summary: 'Marquer le devis comme refusé (refus reçu par téléphone ou e-mail)',
        params: z.object({ id: z.uuid() }),
        body: z.object({ reason: z.string().trim().max(500).nullable().optional() }),
        response: { 200: QuoteSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'quotes.write', async ({ tx, auth, actor, audit }) => {
        const q = await tx.quote.findUnique({ where: { id: req.params.id } });
        if (!q) throw notFound('Ce devis');
        if (!['sent', 'viewed'].includes(q.status))
          throw conflict('quote_not_sent', 'Seul un devis envoyé peut être marqué comme refusé.');
        await tx.quote.update({
          where: { id: q.id },
          data: { status: 'refused', refusedAt: new Date(), refusalReason: req.body.reason ?? null },
        });
        if (q.currentVersionId)
          await tx.quoteVersion.update({ where: { id: q.currentVersionId }, data: { status: 'refused' } });
        await audit('quote.refused', 'quote', q.id, { reason: req.body.reason ?? null });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'quote.refused.v1',
          aggregateType: 'quote',
          aggregateId: q.id,
          payload: { quoteId: q.id, reason: req.body.reason ?? null },
          actor,
        });
        return quoteDto(tx, q.id, auth.role);
      }),
  );

  app.delete(
    '/quotes/:id',
    {
      schema: {
        tags: ['devis'],
        summary: 'Archiver un devis non signé (ou un modèle)',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'quotes.write', async ({ tx, audit }) => {
        const q = await tx.quote.findUnique({ where: { id: req.params.id } });
        if (!q) throw notFound('Ce devis');
        if (q.status === 'signed')
          throw conflict('quote_signed', 'Un devis signé est conservé : il fait partie du contrat.');
        await tx.quote.update({ where: { id: q.id }, data: { archivedAt: new Date() } });
        await audit('quote.archived', 'quote', q.id);
        return { ok: true as const };
      }),
  );

  // --- Bibliothèque → lignes de devis (ouvrages éclatables) ---
  app.get(
    '/quotes/library-lines/:itemId',
    {
      schema: {
        tags: ['devis'],
        summary: 'Lignes de devis prêtes à insérer pour un article (ou les composants d’un ouvrage)',
        params: z.object({ itemId: z.uuid() }),
        querystring: z.object({
          explode: z.stringbool().default(false),
          quantity: z
            .string()
            .regex(/^\d+(\.\d+)?$/)
            .default('1'),
        }),
        response: {
          200: z.object({
            lines: z.array(
              z.object({
                itemId: z.uuid(),
                code: z.string(),
                description: z.string(),
                unit: z.string(),
                quantity: z.string(),
                unitPrice: z.number(),
                unitCost: z.number().optional(),
                laborHours: z.string(),
                vatRate: z.string(),
              }),
            ),
          }),
        },
      },
    },
    (req) =>
      inTenant(deps, req, 'quotes.write', async ({ tx, auth }) => {
        const c = await coefs(tx, auth.tenantId);
        const item = await tx.item.findUnique({
          where: { id: req.params.itemId },
          include: { components: { orderBy: { position: 'asc' }, include: { item: true } } },
        });
        if (!item) throw notFound('Cet article');
        const withCost = can(auth.role, 'pricing.read');
        const toLine = (i: typeof item, quantity: string) => ({
          itemId: i.id,
          code: i.code,
          description: i.description ? `${i.name}\n${i.description}` : i.name,
          unit: i.unit,
          quantity,
          unitPrice: Number(
            computeSalePrice({
              cost: i.purchasePrice,
              salePrice: i.salePrice,
              itemCoefficient: i.saleCoefficient?.toString() ?? null,
              overheadCoefficient: c.overheadCoefficient,
              marginCoefficient: c.marginCoefficient,
            }),
          ),
          ...(withCost ? { unitCost: Number(i.purchasePrice) } : {}),
          laborHours: i.laborHours.toString(),
          vatRate: i.vatRate,
        });
        if (req.query.explode && item.kind === 'assembly' && item.components.length) {
          return {
            lines: item.components.map((comp) =>
              toLine(comp.item as typeof item, comp.quantity.times(req.query.quantity).toString()),
            ),
          };
        }
        return { lines: [toLine(item, req.query.quantity)] };
      }),
  );

  app.post(
    '/quotes/:id/draft-lines',
    {
      schema: {
        tags: ['devis'],
        summary: 'Dictée : texte → lignes proposées depuis la bibliothèque (à valider une par une)',
        params: z.object({ id: z.uuid() }),
        body: DraftLinesRequestSchema,
        response: { 200: DraftLinesResponseSchema },
      },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    (req) =>
      inTenant(deps, req, 'quotes.write', async ({ tx, auth }) => {
        const c = await coefs(tx, auth.tenantId);
        // Candidats : recherche floue sur chaque morceau dicté, plus le reste de la bibliothèque.
        const ids = new Set<string>();
        for (const part of req.body.text
          .split(/[\n;,]| et /i)
          .map((p) => p.trim())
          .filter((p) => p.length > 2))
          for (const id of await searchItemIds(
            tx,
            part.replace(/^\d+([.,]\d+)?\s*\S+\s*(de|d')?\s*/i, ''),
            15,
          ))
            ids.add(id);
        const items = await tx.item.findMany({
          where: { archivedAt: null, ...(ids.size ? { id: { in: [...ids] } } : {}) },
          take: 300,
        });
        const { lines } = await deps.integrations.ai.draftQuoteLines(
          req.body.text,
          items.map((i) => ({ id: i.id, code: i.code, name: i.name, unit: i.unit })),
        );
        const byId = new Map(items.map((i) => [i.id, i]));
        const withCost = can(auth.role, 'pricing.read');
        return {
          lines: lines.map((l, idx) => {
            const i = l.itemId ? byId.get(l.itemId) : undefined;
            return {
              source: req.body.text.split(/[\n;]/)[idx]?.trim() ?? l.description,
              description: l.description,
              quantity: l.quantity,
              unit: l.unit,
              confidence: l.confidence,
              item: i
                ? {
                    id: i.id,
                    code: i.code,
                    name: i.name,
                    unit: i.unit,
                    kind: i.kind,
                    salePrice: Number(
                      computeSalePrice({
                        cost: i.purchasePrice,
                        salePrice: i.salePrice,
                        itemCoefficient: i.saleCoefficient?.toString() ?? null,
                        overheadCoefficient: c.overheadCoefficient,
                        marginCoefficient: c.marginCoefficient,
                      }),
                    ),
                    ...(withCost ? { purchasePrice: Number(i.purchasePrice) } : {}),
                    laborHours: i.laborHours.toString(),
                    vatRate: i.vatRate,
                  }
                : null,
            };
          }),
        };
      }),
  );
};
