/**
 * Portail client (02 P2.7–P2.9) : lien signé par devis, sans compte. Le client consulte, choisit
 * ses options, télécharge le PDF et signe (signature électronique simple, 05 §10), avec
 * l'attestation TVA 6 % dans le même flux (05 §3). Vouvoiement côté interface.
 */
import { createHash } from 'node:crypto';
import { PortalQuoteSchema, PortalSignSchema } from '@batimint/contracts';
import {
  emitEvent,
  type EventActor,
  loadVersionContent,
  type Tx,
  withSystem,
  withTenant,
  writeAudit,
} from '@batimint/db';
import { sha256 } from '@batimint/documents';
import {
  computeQuote,
  dwellingAge,
  isSectionIncluded,
  portalAccent,
  RENOVATION_MIN_DWELLING_AGE_YEARS,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { AppError, badRequest, conflict } from '../lib/errors';
import { iso } from '../lib/tenant';
import { refreshVersionTotals, renderVersionPdf, totalsDto } from '../services/quotes';

const CERTIFICATE_TEXT_VERSION = '2026-1';

const portalNotFound = () =>
  new AppError(
    404,
    'portal_link_invalid',
    'Ce lien n’est plus valable. Demandez un nouveau lien à l’entreprise.',
  );

async function resolveToken(deps: AppDeps, token: string) {
  const hash = createHash('sha256').update(token).digest('hex');
  const row = await withSystem(deps.prisma, (tx) =>
    tx.portalToken.findUnique({ where: { tokenHash: hash } }),
  );
  if (!row || row.kind !== 'quote' || !row.quoteId || row.revokedAt || row.expiresAt < new Date())
    throw portalNotFound();
  return row;
}

/** Version présentée au client : la dernière envoyée (une nouvelle version en préparation reste interne). */
async function presentedVersion(tx: Tx, quoteId: string) {
  return tx.quoteVersion.findFirst({
    where: { quoteId, sentAt: { not: null } },
    orderBy: { version: 'desc' },
  });
}

async function portalDto(tx: Tx, quoteId: string) {
  const q = await tx.quote.findUnique({
    where: { id: quoteId },
    include: {
      tenant: true,
      customer: true,
      site: true,
      vatCertificates: true,
      project: { select: { id: true } },
    },
  });
  const v = q ? await presentedVersion(tx, q.id) : null;
  if (!q || !v) throw portalNotFound();
  const loaded = (await loadVersionContent(tx, v.id))!;
  const totals = computeQuote(loaded.content);
  const lineNet = new Map(totals.lines.map((l) => [l.id, l.netAmount]));
  const signature =
    v.status === 'signed'
      ? await tx.signature.findFirst({ where: { subjectType: 'quote_version', subjectId: v.id } })
      : null;
  const t = q.tenant;
  const certificateRequired = loaded.content.sections.some((s) =>
    s.lines.some((l) => l.kind === 'item' && l.vatRegime === 'reduced_6'),
  );
  return {
    tenant: {
      name: t.name,
      legalName: t.legalName,
      accent: portalAccent(t.brandColor),
      logoUrl: t.logoKey ? `/api/v1/public/tenants/${t.slug}/logo` : null,
      email: t.email,
      phone: t.phone,
      address:
        [t.street, [t.postalCode, t.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
      vatNumber: t.vatNumber,
      termsAndConditions: t.termsAndConditions,
    },
    quote: {
      number: q.number,
      title: q.title,
      status: v.status,
      version: v.version,
      sentAt: iso(v.sentAt),
      validUntil: iso(q.validUntil),
      signedAt: iso(q.signedAt),
      intro: v.intro,
      notes: v.notes,
      paymentSchedule: (v.paymentSchedule as { label: string; percent: string }[]) ?? [],
      depositPercent: v.depositKind === 'percent' && v.depositValue ? v.depositValue.toString() : null,
    },
    customer: { displayName: q.customer?.displayName ?? '', email: q.customer?.email ?? null },
    site: q.site
      ? {
          address: `${q.site.street}, ${q.site.postalCode} ${q.site.city}`,
          firstOccupancyYear: q.site.firstOccupancyYear,
        }
      : null,
    sections: loaded.content.sections.map((s) => ({
      key: s.id,
      title: s.title,
      description: s.description,
      optional: s.optional,
      selected: s.selected,
      lines: s.lines.map((l) => ({
        key: l.id,
        kind: l.kind,
        description: l.description,
        unit: l.unit,
        quantity: String(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPercent: String(l.discountPercent ?? '0'),
        vatRegime: l.vatRegime,
        netAmount: Number(lineNet.get(l.id) ?? 0n),
      })),
    })),
    totals: (({
      totalNet,
      totalVat,
      totalGross,
      vatBreakdown,
      depositAmount,
      optionsAvailable,
      hasReverseCharge,
    }) => ({
      totalNet,
      totalVat,
      totalGross,
      vatBreakdown,
      depositAmount,
      optionsAvailable,
      hasReverseCharge,
    }))(totalsDto(totals, loaded.content, false)),
    certificateRequired,
    certificateSigned: q.vatCertificates.some((c) => c.status === 'signed'),
    signature: signature
      ? { signerName: signature.signerName, signedAt: signature.signedAt.toISOString() }
      : null,
    projectCreated: Boolean(q.project),
  };
}

export const portalRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const tokenParams = z.object({ token: z.string().min(20).max(200) });

  app.get(
    '/portal/quotes/:token',
    {
      schema: {
        tags: ['portail'],
        summary: 'Devis vu par le client (lien du portail)',
        params: tokenParams,
        response: { 200: PortalQuoteSchema },
      },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req) => {
      const t = await resolveToken(deps, req.params.token);
      return withTenant(deps.prisma, t.tenantId, null, (tx) => portalDto(tx, t.quoteId!));
    },
  );

  app.post(
    '/portal/quotes/:token/view',
    {
      schema: {
        tags: ['portail'],
        summary: 'Le client a ouvert le devis (tracé une fois par envoi)',
        params: tokenParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const t = await resolveToken(deps, req.params.token);
      await withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        await tx.portalToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } });
        const q = await tx.quote.findUnique({ where: { id: t.quoteId! }, include: { customer: true } });
        const v = q ? await presentedVersion(tx, q.id) : null;
        if (!q || !v || q.status !== 'sent' || v.status !== 'sent') return;
        const now = new Date();
        await tx.quote.update({ where: { id: q.id }, data: { status: 'viewed', viewedAt: now } });
        await tx.quoteVersion.update({ where: { id: v.id }, data: { status: 'viewed' } });
        await emitEvent(tx, {
          tenantId: t.tenantId,
          type: 'quote.viewed.v1',
          aggregateType: 'quote',
          aggregateId: q.id,
          payload: { quoteId: q.id, versionId: v.id },
          actor: { type: 'portal', id: t.id, label: q.customer?.displayName ?? 'Client' },
        });
      });
      return { ok: true as const };
    },
  );

  app.get(
    '/portal/quotes/:token/pdf',
    { schema: { tags: ['portail'], summary: 'PDF du devis (signé le cas échéant)', params: tokenParams } },
    async (req, reply) => {
      const t = await resolveToken(deps, req.params.token);
      const { pdf, name } = await withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        const q = await tx.quote.findUniqueOrThrow({ where: { id: t.quoteId! } });
        const v = await presentedVersion(tx, q.id);
        if (!v) throw portalNotFound();
        const stored = v.pdfKey
          ? await deps.integrations.storage
              .get(v.status === 'signed' ? 'legal' : 'uploads', v.pdfKey)
              .catch(() => null)
          : null;
        return {
          pdf: stored ? Buffer.from(stored) : await renderVersionPdf(tx, deps.integrations, q.id, v.id),
          name: `${q.number ?? 'devis'}${v.status === 'signed' ? '-signe' : ''}.pdf`,
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
    '/portal/quotes/:token/sign',
    {
      schema: {
        tags: ['portail'],
        summary: 'Signer le devis (et l’attestation 6 % si nécessaire)',
        params: tokenParams,
        body: PortalSignSchema,
        response: { 200: PortalQuoteSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const t = await resolveToken(deps, req.params.token);
      const b = req.body;
      return withTenant(
        deps.prisma,
        t.tenantId,
        null,
        async (tx) => {
          const q = await tx.quote.findUnique({
            where: { id: t.quoteId! },
            include: { customer: true, site: true, versions: true },
          });
          const v = q ? await presentedVersion(tx, q.id) : null;
          if (!q || !v) throw portalNotFound();
          if (v.status === 'signed' || q.status === 'signed')
            throw conflict('already_signed', 'Ce devis est déjà signé. Merci !');
          const now = new Date();
          if (!['sent', 'viewed'].includes(v.status) || (q.validUntil && q.validUntil < now))
            throw conflict(
              'quote_not_signable',
              'Ce devis n’est plus valable. Contactez l’entreprise pour recevoir une version à jour.',
            );

          // Options choisies par le client.
          const sections = await tx.quoteSection.findMany({ where: { versionId: v.id } });
          for (const s of sections.filter((x) => x.optional && x.key in b.options))
            await tx.quoteSection.update({ where: { id: s.id }, data: { selected: b.options[s.key]! } });

          const loaded = (await loadVersionContent(tx, v.id))!;
          const needsCertificate = loaded.content.sections.some(
            (s) =>
              isSectionIncluded(s) && s.lines.some((l) => l.kind === 'item' && l.vatRegime === 'reduced_6'),
          );
          if (needsCertificate) {
            if (!b.certificate)
              throw badRequest(
                'certificate_required',
                'Le taux de TVA de 6 % demande votre attestation : cochez les déclarations et indiquez l’année de première occupation.',
              );
            const age = dwellingAge(b.certificate.firstOccupancyYear, now) ?? 0;
            if (age < RENOVATION_MIN_DWELLING_AGE_YEARS)
              throw badRequest(
                'dwelling_too_recent',
                'Le taux de 6 % s’applique aux logements occupés depuis au moins 10 ans. Contactez l’entreprise pour adapter le devis.',
              );
          }
          await refreshVersionTotals(tx, v.id);

          const ip = req.ip;
          const userAgent = req.headers['user-agent'] ?? null;
          const selection = Object.fromEntries(loaded.content.sections.map((s) => [s.id, s.selected]));
          const pdf = await renderVersionPdf(tx, deps.integrations, q.id, v.id, {
            selection,
            date: v.sentAt ?? now,
            signature: { signerName: b.signerName, signedAt: now, ip },
            certificate: needsCertificate ? { signedAt: now } : null,
          });
          const pdfHash = sha256(pdf);
          const pdfKey = `t/${t.tenantId}/quotes/${q.id}/signed-v${v.version}-${uuidv7()}.pdf`;
          await deps.integrations.storage.put({
            bucket: 'legal',
            key: pdfKey,
            body: pdf,
            contentType: 'application/pdf',
            metadata: { sha256: pdfHash },
          });
          const signature = await tx.signature.create({
            data: {
              tenantId: t.tenantId,
              subjectType: 'quote_version',
              subjectId: v.id,
              signerName: b.signerName,
              signerEmail: q.customer?.email ?? t.email,
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
          if (needsCertificate && b.certificate && q.customer) {
            const declarations = {
              textVersion: CERTIFICATE_TEXT_VERSION,
              privateDwelling: b.certificate.privateDwelling,
              overTenYears: b.certificate.overTenYears,
              finalConsumer: b.certificate.finalConsumer,
              firstOccupancyYear: b.certificate.firstOccupancyYear,
              siteAddress: q.site ? `${q.site.street}, ${q.site.postalCode} ${q.site.city}` : null,
            };
            const certHash = sha256(
              Buffer.from(JSON.stringify({ declarations, quotePdf: pdfHash, signer: b.signerName })),
            );
            const certSig = await tx.signature.create({
              data: {
                tenantId: t.tenantId,
                subjectType: 'vat_certificate',
                subjectId: q.id,
                signerName: b.signerName,
                signerEmail: q.customer.email,
                signatureImage: b.signaturePath ?? null,
                acceptedTerms: true,
                ip,
                userAgent,
                documentSha256: certHash,
                portalTokenId: t.id,
                signedAt: now,
              },
            });
            await tx.vatCertificate.upsert({
              where: { quoteId: q.id },
              update: {
                status: 'signed',
                declarations,
                signatureId: certSig.id,
                signedAt: now,
                firstOccupancyYear: b.certificate.firstOccupancyYear,
              },
              create: {
                tenantId: t.tenantId,
                quoteId: q.id,
                customerId: q.customer.id,
                siteId: q.siteId,
                status: 'signed',
                firstOccupancyYear: b.certificate.firstOccupancyYear,
                declarations,
                signatureId: certSig.id,
                signedAt: now,
              },
            });
            if (q.site && !q.site.firstOccupancyYear)
              await tx.site.update({
                where: { id: q.site.id },
                data: { firstOccupancyYear: b.certificate.firstOccupancyYear },
              });
          }
          await tx.quoteVersion.update({
            where: { id: v.id },
            data: { status: 'signed', pdfKey, pdfSha256: pdfHash },
          });
          // Une version en préparation après l'envoi est abandonnée : le contrat est la version signée.
          await tx.quoteVersion.updateMany({
            where: { quoteId: q.id, id: { not: v.id }, status: { notIn: ['superseded'] } },
            data: { status: 'superseded' },
          });
          await tx.quote.update({
            where: { id: q.id },
            data: { status: 'signed', signedAt: now, currentVersionId: v.id },
          });
          await tx.portalToken.update({ where: { id: t.id }, data: { lastUsedAt: now } });
          const actor: EventActor = { type: 'portal', id: t.id, label: b.signerName };
          await writeAudit(tx, {
            tenantId: t.tenantId,
            actor,
            action: 'quote.signed',
            entityType: 'quote',
            entityId: q.id,
            changes: {
              version: v.version,
              documentSha256: pdfHash,
              options: b.options,
              certificate: needsCertificate,
            },
            ip,
            userAgent,
            requestId: req.id,
          });
          await emitEvent(tx, {
            tenantId: t.tenantId,
            type: 'quote.signed.v1',
            aggregateType: 'quote',
            aggregateId: q.id,
            payload: {
              quoteId: q.id,
              versionId: v.id,
              signatureId: signature.id,
              certificateSigned: needsCertificate,
            },
            actor,
          });
          return portalDto(tx, q.id);
        },
        { timeoutMs: 30_000 },
      );
    },
  );
};
