/**
 * Portail sous-traitant (03 §9, 02 P9) : lien invité révocable, sans compte. Le sous-traitant
 * voit ses missions (chantier, dates, montant, échéancier, contrat), les documents à fournir avec
 * leur échéance, dépose ses documents et ses factures (PDF ou UBL) et suit leur paiement.
 */
import { PortalSubcontractorSchema, SubcontractorDocumentKindSchema } from '@batimint/contracts';
import { emitEvent, hashPortalToken, type Tx, withSystem, withTenant } from '@batimint/db';
import { parseUbl, sha256, UblError } from '@batimint/documents';
import { brusselsDate, portalAccent } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { AppError, badRequest } from '../lib/errors';
import { iso, isoDate } from '../lib/tenant';
import { ingestSupplierInvoice } from '../services/purchasing';
import { complianceOf, documentDto, thirtyBisPolicyOf } from '../services/subcontracting';
import { storeSubcontractPdf } from './subcontracting';

const MAX_UPLOAD = 15 * 1024 * 1024;

const portalNotFound = () =>
  new AppError(
    404,
    'portal_link_invalid',
    'Ce lien n’est plus valable. Demandez un nouveau lien à l’entreprise qui vous a confié la mission.',
  );

async function resolveToken(deps: AppDeps, token: string) {
  const row = await withSystem(deps.prisma, (tx) =>
    tx.portalToken.findUnique({ where: { tokenHash: hashPortalToken(token) } }),
  );
  if (!row || row.kind !== 'subcontractor' || !row.supplierId || row.revokedAt || row.expiresAt < new Date())
    throw portalNotFound();
  return row as typeof row & { supplierId: string };
}

const PORTAL_STATE = {
  received: 'received',
  to_allocate: 'received',
  allocated: 'processing',
  blocked: 'processing',
  validated: 'approved',
  to_pay: 'approved',
  paid: 'paid',
} as const;

async function portalDto(tx: Tx, supplierId: string, token: string) {
  const s = await tx.supplier.findUnique({ where: { id: supplierId }, include: { tenant: true } });
  if (!s) throw portalNotFound();
  const t = s.tenant;
  const base = `/api/v1/portal/subcontractors/${encodeURIComponent(token)}`;
  const today = brusselsDate(new Date());
  const { required } = thirtyBisPolicyOf(t.settings);
  const [contracts, documents, invoices] = await Promise.all([
    tx.subcontract.findMany({
      where: { supplierId, status: { not: 'cancelled' } },
      include: { project: { include: { site: true } } },
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
    }),
    tx.subcontractorDocument.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' } }),
    tx.supplierInvoice.findMany({
      where: { supplierId, source: { in: ['upload', 'peppol'] } },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    }),
  ]);
  const managerIds = contracts.flatMap((c) => (c.project.managerUserId ? [c.project.managerUserId] : []));
  const phones = new Map(
    (
      await tx.employee.findMany({
        where: { userId: { in: managerIds } },
        select: { userId: true, phone: true },
      })
    ).map((e) => [e.userId, e.phone]),
  );
  const managers = new Map(
    (await tx.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, name: true } })).map(
      (u) => [u.id, { name: u.name, phone: phones.get(u.id) ?? null }],
    ),
  );
  const invoicedBy = new Map<string, bigint>();
  for (const i of invoices)
    if (i.subcontractId && i.status !== 'received' && i.status !== 'to_allocate')
      invoicedBy.set(i.subcontractId, (invoicedBy.get(i.subcontractId) ?? 0n) + i.totalNet);
  const numbers = new Map(contracts.map((c) => [c.id, c.number]));
  return {
    tenant: {
      name: t.legalName ?? t.name,
      accent: portalAccent(t.brandColor),
      logoUrl: t.logoKey ? `/api/v1/public/tenants/${t.slug}/logo` : null,
      email: t.email,
      phone: t.phone,
    },
    subcontractor: { name: s.name, enterpriseNumber: s.enterpriseNumber },
    missions: contracts.map((c) => {
      const m = c.project.managerUserId ? managers.get(c.project.managerUserId) : null;
      return {
        id: c.id,
        number: c.number,
        status: c.status,
        title: c.title,
        scope: c.scope,
        amount: Number(c.amount),
        invoiced: Number(invoicedBy.get(c.id) ?? 0n),
        startDate: isoDate(c.startDate),
        endDate: isoDate(c.endDate),
        project: {
          name: c.project.name,
          address: c.project.site
            ? `${c.project.site.street}, ${c.project.site.postalCode} ${c.project.site.city}`
            : null,
        },
        contact: m ? { name: m.name, phone: m.phone } : null,
        installments: (c.installments as never[]) ?? [],
        pdfUrl: `${base}/missions/${c.id}/pdf`,
      };
    }),
    compliance: complianceOf(documents, today, required),
    documents: documents.map((d) => ({
      ...documentDto(d, today),
      url: `${base}/documents/${d.id}/file`,
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      missionNumber: i.subcontractId ? (numbers.get(i.subcontractId) ?? null) : null,
      totalGross: Number(i.totalGross),
      state: PORTAL_STATE[i.status],
      withholding: Number(i.withholdingAppliedAt ? i.withholdingSocial + i.withholdingTax : 0n),
      receivedAt: i.receivedAt.toISOString(),
      paidAt: iso(i.paidAt),
    })),
  };
}

export const portalSubcontractorRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.addContentTypeParser(
    /^(application\/(pdf|xml|octet-stream)|text\/xml|image\/(jpeg|png|webp))$/,
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD },
    (_r, body, done) => done(null, body),
  );
  const tokenParams = z.object({ token: z.string().min(20).max(200) });

  app.get(
    '/portal/subcontractors/:token',
    {
      schema: {
        tags: ['portail'],
        summary: 'Portail sous-traitant : missions, documents, factures',
        params: tokenParams,
        response: { 200: PortalSubcontractorSchema },
      },
    },
    async (req) => {
      const t = await resolveToken(deps, req.params.token);
      return withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 5 * 60_000)
          await tx.portalToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date() } });
        return portalDto(tx, t.supplierId, req.params.token);
      });
    },
  );

  app.post(
    '/portal/subcontractors/:token/documents',
    {
      schema: {
        tags: ['portail'],
        summary: 'Déposer un document (assurance, attestation) avec sa date d’échéance',
        params: tokenParams,
        querystring: z.object({
          id: z.uuid().optional(),
          kind: SubcontractorDocumentKindSchema,
          expiresOn: z.iso.date().optional(),
        }),
        response: { 201: PortalSubcontractorSchema },
      },
    },
    async (req, reply) => {
      const t = await resolveToken(deps, req.params.token);
      const body = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(body) || !body.length) throw badRequest('empty_file', 'Le fichier est vide.');
      const contentType = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim();
      const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'document'))
        .replace(/[^\w.\-() ]+/g, '_')
        .slice(0, 120);
      const dto = await withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        const id = req.query.id ?? uuidv7();
        if (!(await tx.subcontractorDocument.findUnique({ where: { id } }))) {
          const key = `t/${t.tenantId}/subcontractors/${t.supplierId}/${id}/${fileName}`;
          await deps.integrations.storage.put({ bucket: 'legal', key, body, contentType });
          await tx.subcontractorDocument.create({
            data: {
              id,
              tenantId: t.tenantId,
              supplierId: t.supplierId,
              kind: req.query.kind,
              expiresOn: req.query.expiresOn ? new Date(`${req.query.expiresOn}T00:00:00Z`) : null,
              fileKey: key,
              fileName,
              contentType,
              size: body.length,
              sha256: sha256(body),
              source: 'portal',
            },
          });
          await emitEvent(tx, {
            tenantId: t.tenantId,
            type: 'subcontractor.document_uploaded.v1',
            aggregateType: 'supplier',
            aggregateId: t.supplierId,
            payload: { supplierId: t.supplierId, documentId: id, kind: req.query.kind },
            actor: { type: 'portal', label: 'Portail sous-traitant' },
          });
        }
        return portalDto(tx, t.supplierId, req.params.token);
      });
      return reply.status(201).send(dto);
    },
  );

  app.get(
    '/portal/subcontractors/:token/documents/:id/file',
    {
      schema: {
        tags: ['portail'],
        summary: 'Document déposé',
        params: tokenParams.extend({ id: z.uuid() }),
        hide: true,
      },
    },
    async (req, reply) => {
      const t = await resolveToken(deps, req.params.token);
      const d = await withTenant(deps.prisma, t.tenantId, null, (tx) =>
        tx.subcontractorDocument.findFirst({ where: { id: req.params.id, supplierId: t.supplierId } }),
      );
      if (!d) throw portalNotFound();
      const file = await deps.integrations.storage.get('legal', d.fileKey);
      return reply
        .header('content-type', d.contentType)
        .header('content-disposition', `inline; filename="${encodeURIComponent(d.fileName)}"`)
        .send(file);
    },
  );

  app.get(
    '/portal/subcontractors/:token/missions/:id/pdf',
    {
      schema: {
        tags: ['portail'],
        summary: 'Contrat de sous-traitance (PDF)',
        params: tokenParams.extend({ id: z.uuid() }),
        hide: true,
      },
    },
    async (req, reply) => {
      const t = await resolveToken(deps, req.params.token);
      const { key, number } = await withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        const s = await tx.subcontract.findFirst({
          where: { id: req.params.id, supplierId: t.supplierId, status: { not: 'cancelled' } },
        });
        if (!s) throw portalNotFound();
        return { key: s.pdfKey ?? (await storeSubcontractPdf(deps, tx, s.id)), number: s.number };
      });
      const file = await deps.integrations.storage.get('legal', key);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${number}.pdf"`)
        .send(file);
    },
  );

  app.post(
    '/portal/subcontractors/:token/invoices',
    {
      schema: {
        tags: ['portail'],
        summary: 'Déposer une facture (PDF ou UBL) pour une mission',
        params: tokenParams,
        querystring: z.object({ id: z.uuid().optional(), subcontractId: z.uuid() }),
        response: { 201: PortalSubcontractorSchema },
      },
    },
    async (req, reply) => {
      const t = await resolveToken(deps, req.params.token);
      const body = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(body) || !body.length) throw badRequest('empty_file', 'Le fichier est vide.');
      const contentType = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim();
      const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'facture'))
        .replace(/[^\w.\-() ]+/g, '_')
        .slice(0, 120);
      const isXml =
        /xml/.test(contentType) ||
        /^\s*<\?xml|^\s*<(Invoice|CreditNote)\b/.test(body.subarray(0, 200).toString());
      let ubl = null;
      if (isXml)
        try {
          ubl = parseUbl(body.toString('utf8'));
        } catch (err) {
          if (err instanceof UblError)
            throw badRequest('invalid_ubl', `Votre fichier UBL est illisible : ${err.message}`);
          throw err;
        }
      const dto = await withTenant(deps.prisma, t.tenantId, null, async (tx) => {
        const mission = await tx.subcontract.findFirst({
          where: { id: req.query.subcontractId, supplierId: t.supplierId, status: { not: 'cancelled' } },
        });
        if (!mission) throw portalNotFound();
        const id = req.query.id ?? uuidv7();
        if (!(await tx.supplierInvoice.findUnique({ where: { id } }))) {
          const key = `t/${t.tenantId}/supplier-invoices/${id}/${fileName}`;
          await deps.integrations.storage.put({ bucket: 'legal', key, body, contentType });
          await ingestSupplierInvoice(tx, {
            tenantId: t.tenantId,
            id,
            source: 'upload',
            externalId: null,
            ubl,
            document: { key, contentType },
            fallbackName: fileName.replace(/\.[a-z0-9]+$/i, ''),
            actor: { type: 'portal', label: 'Portail sous-traitant' },
            supplierId: t.supplierId,
            subcontractId: mission.id,
          });
        }
        return portalDto(tx, t.supplierId, req.params.token);
      });
      return reply.status(201).send(dto);
    },
  );
};
