/**
 * Sous-traitance et conformité (03 §9, 05 §7, 02 P9) : sous-traitants et documents obligatoires,
 * contrats par poste avec contrôle 30bis à la création, consultations manuelles, invitation au
 * portail, déclaration de travaux.
 */
import {
  parseTenantSettings,
  SubcontractInputSchema,
  SubcontractorDetailSchema,
  SubcontractorDocumentKindSchema,
  SubcontractorDocumentSchema,
  SubcontractorSummarySchema,
  SubcontractSchema,
  SubcontractSummarySchema,
  SubcontractUpdateSchema,
  ThirtyBisCheckSchema,
  WorksDeclarationInputSchema,
  WorksDeclarationSchema,
  type WorksDeclarationDto,
} from '@batimint/contracts';
import {
  emitEvent,
  type EventActor,
  nextSequenceValue,
  recordThirtyBisCheck,
  ThirtyBisUnavailableError,
  type Tx,
} from '@batimint/db';
import { renderSubcontractPdf, sha256 } from '@batimint/documents';
import {
  assertTransition,
  brusselsDate,
  buildInstallments,
  formatDocumentNumber,
  hasThirtyBisDebt,
  SubcontractingError,
  SubcontractStatus,
  worksDeclarationRequirement,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { inTenant, iso, isoDate } from '../lib/tenant';
import { addressLines } from '../services/quotes';
import {
  checkDto,
  complianceOf,
  documentDto,
  ensureThirtyBisProof,
  SUBCONTRACT_INCLUDE,
  subcontractDto,
  subcontractSummaries,
  thirtyBisPolicyOf,
  thirtyBisPorts,
} from '../services/subcontracting';

const MAX_UPLOAD = 15 * 1024 * 1024;
const day = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`) : null);

function domainError(err: unknown): never {
  if (err instanceof SubcontractingError) throw unprocessable(err.code, err.message);
  if (err instanceof ThirtyBisUnavailableError) throw unprocessable('enterprise_number_missing', err.message);
  throw err;
}

/** Contrat de sous-traitance (PDF) régénéré à chaque modification ; empreinte conservée. */
export async function storeSubcontractPdf(deps: AppDeps, tx: Tx, id: string) {
  const s = await tx.subcontract.findUniqueOrThrow({
    where: { id },
    include: { project: { include: { site: true } }, supplier: true, tenant: true },
  });
  const t = s.tenant;
  const post = s.budgetLineId
    ? await tx.budgetLine.findUnique({ where: { id: s.budgetLineId }, select: { label: true } })
    : null;
  const check = s.creationCheckId
    ? await tx.thirtyBisCheck.findUnique({ where: { id: s.creationCheckId } })
    : null;
  const { policy } = thirtyBisPolicyOf(t.settings);
  const pdf = await renderSubcontractPdf({
    tenant: {
      name: t.legalName ?? t.name,
      lines: [...addressLines(t), ...(t.enterpriseNumber ? [`BCE ${t.enterpriseNumber}`] : [])],
      brandColor: t.brandColor,
      enterpriseNumber: t.enterpriseNumber,
    },
    subcontractor: {
      name: s.supplier.name,
      lines: [
        ...addressLines(s.supplier),
        ...(s.supplier.enterpriseNumber ? [`BCE ${s.supplier.enterpriseNumber}`] : []),
      ],
      enterpriseNumber: s.supplier.enterpriseNumber,
    },
    number: s.number,
    date: s.createdAt,
    project: {
      number: s.project.number,
      name: s.project.name,
      address: s.project.site
        ? `${s.project.site.street}, ${s.project.site.postalCode} ${s.project.site.city}`
        : null,
    },
    post: post?.label ?? null,
    title: s.title,
    scope: s.scope,
    amount: s.amount,
    startDate: s.startDate,
    endDate: s.endDate,
    installments: (
      (s.installments as { label: string; percent: string; amount: number; dueOn: string | null }[]) ?? []
    ).map((i) => ({ label: i.label, percent: i.percent, amount: BigInt(i.amount), dueOn: day(i.dueOn) })),
    check: check
      ? {
          checkedAt: check.checkedAt,
          reference: check.reference,
          hasSocialDebt: check.hasSocialDebt,
          hasTaxDebt: check.hasTaxDebt,
        }
      : null,
    socialPercent: policy.socialPercent,
    taxPercent: policy.taxPercent,
  });
  // Compartiment légal : jamais écrasé ; chaque version du contrat a sa clé (empreinte).
  const hash = sha256(pdf);
  if (s.pdfKey && s.pdfSha256 === hash) return s.pdfKey;
  const key = `t/${s.tenantId}/subcontracts/${s.id}/${s.number}-${hash.slice(0, 12)}.pdf`;
  await deps.integrations.storage.put({ bucket: 'legal', key, body: pdf, contentType: 'application/pdf' });
  await tx.subcontract.update({ where: { id: s.id }, data: { pdfKey: key, pdfSha256: hash } });
  return key;
}

async function emitCheck(
  tx: Tx,
  tenantId: string,
  check: {
    id: string;
    supplierId: string | null;
    hasSocialDebt: boolean;
    hasTaxDebt: boolean;
    context: string;
  },
  actor: EventActor,
) {
  await emitEvent(tx, {
    tenantId,
    type: 'thirty_bis.checked.v1',
    aggregateType: 'supplier',
    aggregateId: check.supplierId!,
    payload: {
      checkId: check.id,
      supplierId: check.supplierId!,
      hasDebt: hasThirtyBisDebt(check),
      context: check.context as 'contract',
    },
    actor,
  });
}

async function subcontractorSummaries(tx: Tx, tenantId: string, where: { id?: string }) {
  const tenantSettings = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });
  const { required } = thirtyBisPolicyOf(tenantSettings.settings);
  const today = brusselsDate(new Date());
  const suppliers = await tx.supplier.findMany({
    where: {
      ...where,
      archivedAt: null,
      OR: [{ isSubcontractor: true }, { subcontracts: { some: {} } }],
    },
    orderBy: { name: 'asc' },
    include: {
      documents: { orderBy: { createdAt: 'desc' } },
      subcontracts: { where: { status: 'active' }, select: { amount: true } },
      checks: { orderBy: { checkedAt: 'desc' }, take: 1 },
    },
  });
  const invites = await tx.portalToken.findMany({
    where: { kind: 'subcontractor', supplierId: { in: suppliers.map((s) => s.id) }, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  return suppliers.map((s) => ({
    row: s,
    summary: {
      id: s.id,
      name: s.name,
      enterpriseNumber: s.enterpriseNumber,
      email: s.email,
      phone: s.phone,
      compliance: complianceOf(s.documents, today, required),
      lastCheck: s.checks[0] ? checkDto(s.checks[0]) : null,
      activeContracts: s.subcontracts.length,
      contractedAmount: Number(s.subcontracts.reduce((a, c) => a + c.amount, 0n)),
      portalInvitedAt: iso(invites.find((i) => i.supplierId === s.id)?.createdAt),
    },
  }));
}

export const subcontractingRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.addContentTypeParser(
    /^(application\/(pdf|octet-stream)|image\/(jpeg|png|webp))$/,
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD },
    (_r, body, done) => done(null, body),
  );

  // -------------------------------------------------------------------------
  // Sous-traitants
  // -------------------------------------------------------------------------
  app.get(
    '/subcontractors',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Sous-traitants : conformité des documents, dernière consultation 30bis, contrats',
        response: { 200: z.object({ items: z.array(SubcontractorSummarySchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.read', async ({ tx, auth }) => ({
        items: (await subcontractorSummaries(tx, auth.tenantId, {})).map((s) => s.summary),
      })),
  );

  app.get(
    '/subcontractors/:id',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Fiche sous-traitant : documents, contrats, historique 30bis',
        params: z.object({ id: z.uuid() }),
        response: { 200: SubcontractorDetailSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.read', async ({ tx, auth }) => {
        const [found] = await subcontractorSummaries(tx, auth.tenantId, { id: req.params.id });
        if (!found) {
          // Un fournisseur pas encore marqué sous-traitant : fiche vide mais consultable.
          const s = await tx.supplier.findUnique({ where: { id: req.params.id } });
          if (!s) throw notFound('Ce sous-traitant');
        }
        const s =
          found?.row ??
          (await tx.supplier.findUniqueOrThrow({
            where: { id: req.params.id },
            include: { documents: true },
          }));
        const today = brusselsDate(new Date());
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: auth.tenantId },
          select: { settings: true },
        });
        const { required } = thirtyBisPolicyOf(tenant.settings);
        const documents = await tx.subcontractorDocument.findMany({
          where: { supplierId: s.id },
          orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
        });
        const contracts = await tx.subcontract.findMany({
          where: { supplierId: s.id },
          include: SUBCONTRACT_INCLUDE,
          orderBy: { createdAt: 'desc' },
        });
        const checks = await tx.thirtyBisCheck.findMany({
          where: { supplierId: s.id },
          orderBy: { checkedAt: 'desc' },
          take: 50,
        });
        const invoiceNumbers = new Map(
          (
            await tx.supplierInvoice.findMany({
              where: {
                id: { in: checks.flatMap((c) => (c.supplierInvoiceId ? [c.supplierInvoiceId] : [])) },
              },
              select: { id: true, number: true },
            })
          ).map((i) => [i.id, i.number]),
        );
        const contractNumbers = new Map(contracts.map((c) => [c.id, c.number]));
        const summary = found?.summary ?? {
          id: s.id,
          name: s.name,
          enterpriseNumber: s.enterpriseNumber,
          email: s.email,
          phone: s.phone,
          compliance: complianceOf(documents, today, required),
          lastCheck: checks[0] ? checkDto(checks[0]) : null,
          activeContracts: 0,
          contractedAmount: 0,
          portalInvitedAt: null,
        };
        return {
          ...summary,
          street: s.street,
          postalCode: s.postalCode,
          city: s.city,
          iban: s.iban,
          documents: documents.map((d) => documentDto(d, today)),
          contracts: await subcontractSummaries(tx, contracts),
          checks: checks.map((c) =>
            checkDto(c, {
              subcontractNumber: c.subcontractId ? (contractNumbers.get(c.subcontractId) ?? null) : null,
              supplierInvoiceNumber: c.supplierInvoiceId
                ? (invoiceNumbers.get(c.supplierInvoiceId) ?? null)
                : null,
            }),
          ),
        };
      }),
  );

  app.post(
    '/subcontractors/:id/thirty-bis-check',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Consulter maintenant les dettes sociales et fiscales (preuve conservée)',
        params: z.object({ id: z.uuid() }),
        response: { 200: ThirtyBisCheckSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.write', async ({ tx, auth, actor, audit }) => {
        if (!(await tx.supplier.findUnique({ where: { id: req.params.id } })))
          throw notFound('Ce sous-traitant');
        const check = await recordThirtyBisCheck(tx, thirtyBisPorts(deps), {
          tenantId: auth.tenantId,
          supplierId: req.params.id,
          context: 'manual',
          userId: auth.userId,
          actorLabel: actor.label ?? null,
        }).catch(domainError);
        await audit('thirty_bis.checked', 'supplier', req.params.id, {
          checkId: check.id,
          hasSocialDebt: check.hasSocialDebt,
          hasTaxDebt: check.hasTaxDebt,
        });
        await emitCheck(tx, auth.tenantId, check, actor);
        return checkDto(check);
      }),
  );

  app.get(
    '/thirty-bis-checks/:id/proof',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Preuve de consultation 30bis (PDF)',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (req, reply) => {
      const key = await inTenant(deps, req, 'subcontracting.read', async ({ tx }) => {
        const k = await ensureThirtyBisProof(deps, tx, req.params.id);
        if (!k) throw notFound('Cette preuve');
        return k;
      });
      const file = await deps.integrations.storage.get('legal', key);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', 'inline; filename="preuve-30bis.pdf"')
        .send(file);
    },
  );

  app.post(
    '/subcontractors/:id/documents',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Déposer un document du sous-traitant (assurance, attestation) avec son échéance',
        params: z.object({ id: z.uuid() }),
        querystring: z.object({
          id: z.uuid().optional(),
          kind: SubcontractorDocumentKindSchema,
          expiresOn: z.iso.date().optional(),
          label: z.string().trim().max(120).optional(),
        }),
        response: { 201: SubcontractorDocumentSchema },
      },
    },
    async (req, reply) => {
      const body = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(body) || !body.length) throw badRequest('empty_file', 'Le fichier est vide.');
      const contentType = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim();
      const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'document'))
        .replace(/[^\w.\-() ]+/g, '_')
        .slice(0, 120);
      const dto = await inTenant(deps, req, 'subcontracting.write', async ({ tx, auth, audit }) => {
        const s = await tx.supplier.findUnique({ where: { id: req.params.id } });
        if (!s) throw notFound('Ce sous-traitant');
        const id = req.query.id ?? uuidv7();
        const existing = await tx.subcontractorDocument.findUnique({ where: { id } });
        if (existing) return documentDto(existing, brusselsDate(new Date()));
        const key = `t/${auth.tenantId}/subcontractors/${s.id}/${id}/${fileName}`;
        await deps.integrations.storage.put({ bucket: 'legal', key, body, contentType });
        const d = await tx.subcontractorDocument.create({
          data: {
            id,
            tenantId: auth.tenantId,
            supplierId: s.id,
            kind: req.query.kind,
            label: req.query.label || null,
            expiresOn: day(req.query.expiresOn),
            fileKey: key,
            fileName,
            contentType,
            size: body.length,
            sha256: sha256(body),
            source: 'office',
            createdBy: auth.userId,
          },
        });
        if (!s.isSubcontractor)
          await tx.supplier.update({ where: { id: s.id }, data: { isSubcontractor: true } });
        await audit('subcontractor_document.created', 'supplier', s.id, {
          documentId: d.id,
          kind: d.kind,
          expiresOn: req.query.expiresOn ?? null,
        });
        return documentDto(d, brusselsDate(new Date()));
      });
      return reply.status(201).send(dto);
    },
  );

  app.delete(
    '/subcontractor-documents/:id',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Retirer un document (remplacé ou déposé par erreur)',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.write', async ({ tx, audit }) => {
        const d = await tx.subcontractorDocument.findUnique({ where: { id: req.params.id } });
        if (!d) throw notFound('Ce document');
        await tx.subcontractorDocument.delete({ where: { id: d.id } });
        await audit('subcontractor_document.deleted', 'supplier', d.supplierId, {
          documentId: d.id,
          kind: d.kind,
          sha256: d.sha256,
        });
        return { ok: true as const };
      }),
  );

  app.get(
    '/subcontractor-documents/:id/file',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Télécharger un document du sous-traitant',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (req, reply) => {
      const d = await inTenant(deps, req, 'subcontracting.read', async ({ tx }) => {
        const doc = await tx.subcontractorDocument.findUnique({ where: { id: req.params.id } });
        if (!doc) throw notFound('Ce document');
        return doc;
      });
      if (!(await deps.integrations.storage.exists('legal', d.fileKey)))
        throw new AppError(404, 'file_unavailable', 'Le fichier de ce document n’est pas disponible.');
      const file = await deps.integrations.storage.get('legal', d.fileKey);
      return reply
        .header('content-type', d.contentType)
        .header('content-disposition', `inline; filename="${encodeURIComponent(d.fileName)}"`)
        .send(file);
    },
  );

  app.post(
    '/subcontractors/:id/invite',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Envoyer au sous-traitant son lien d’accès au portail',
        params: z.object({ id: z.uuid() }),
        body: z.object({ subcontractId: z.uuid().nullable().optional() }).default({}),
        response: { 200: z.object({ email: z.string() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.write', async ({ tx, auth, actor, audit }) => {
        const s = await tx.supplier.findUnique({ where: { id: req.params.id } });
        if (!s) throw notFound('Ce sous-traitant');
        const email = s.email ?? s.orderEmail;
        if (!email)
          throw unprocessable(
            'email_missing',
            `Ajoutez l’adresse e-mail de ${s.name} pour lui envoyer son accès au portail.`,
          );
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'subcontractor.invited.v1',
          aggregateType: 'supplier',
          aggregateId: s.id,
          payload: { supplierId: s.id, email, subcontractId: req.body?.subcontractId ?? null },
          actor,
        });
        await audit('subcontractor.invited', 'supplier', s.id, { email });
        return { email };
      }),
  );

  // -------------------------------------------------------------------------
  // Contrats de sous-traitance
  // -------------------------------------------------------------------------
  app.get(
    '/subcontracts',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Contrats de sous-traitance (par chantier ou sous-traitant)',
        querystring: z.object({
          projectId: z.uuid().optional(),
          supplierId: z.uuid().optional(),
          status: z.enum(['active', 'completed', 'cancelled']).optional(),
        }),
        response: { 200: z.object({ items: z.array(SubcontractSummarySchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.read', async ({ tx }) => {
        const rows = await tx.subcontract.findMany({
          where: {
            ...(req.query.projectId ? { projectId: req.query.projectId } : {}),
            ...(req.query.supplierId ? { supplierId: req.query.supplierId } : {}),
            ...(req.query.status ? { status: req.query.status } : {}),
          },
          include: SUBCONTRACT_INCLUDE,
          orderBy: { createdAt: 'desc' },
          take: 500,
        });
        return { items: await subcontractSummaries(tx, rows) };
      }),
  );

  app.get(
    '/subcontracts/:id',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Contrat de sous-traitance : échéancier, factures, 30bis',
        params: z.object({ id: z.uuid() }),
        response: { 200: SubcontractSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.read', async ({ tx }) => {
        const s = await tx.subcontract.findUnique({
          where: { id: req.params.id },
          include: SUBCONTRACT_INCLUDE,
        });
        if (!s) throw notFound('Ce contrat');
        return subcontractDto(tx, s);
      }),
  );

  app.post(
    '/subcontracts',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Conclure un contrat de sous-traitance sur un poste (contrôle 30bis à la création)',
        body: SubcontractInputSchema,
        response: { 201: SubcontractSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'subcontracting.write', async ({ tx, auth, actor, audit }) => {
        const b = req.body;
        const existing = await tx.subcontract.findUnique({
          where: { id: b.id },
          include: SUBCONTRACT_INCLUDE,
        });
        if (existing) return subcontractDto(tx, existing);
        const project = await tx.project.findUnique({ where: { id: b.projectId } });
        if (!project) throw notFound('Ce chantier');
        if (['closed', 'cancelled'].includes(project.status))
          throw conflict('project_closed', 'Ce chantier est clôturé : on n’y ajoute plus de contrat.');
        if (
          b.budgetLineId &&
          !(await tx.budgetLine.findFirst({ where: { id: b.budgetLineId, projectId: project.id } }))
        )
          throw badRequest('invalid_budget_line', 'Ce poste ne fait pas partie du chantier.');
        const supplier = await tx.supplier.findFirst({ where: { id: b.supplierId, archivedAt: null } });
        if (!supplier) throw notFound('Ce sous-traitant');
        if (b.startDate && b.endDate && b.endDate < b.startDate)
          throw badRequest('invalid_dates', 'La fin des travaux précède leur début.');
        let installments;
        try {
          installments = buildInstallments(BigInt(b.amount), b.installments ?? []);
        } catch (err) {
          domainError(err);
        }
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
        const now = new Date();
        const year = Number(brusselsDate(now).slice(0, 4));
        // 30bis avant de conclure (05 §7) : sans numéro d'entreprise, pas de contrat.
        if (!supplier.enterpriseNumber)
          throw unprocessable(
            'enterprise_number_missing',
            `Ajoutez le numéro d’entreprise de ${supplier.name} : il faut consulter ses dettes avant de conclure.`,
          );
        const sequence = await nextSequenceValue(tx, auth.tenantId, 'subcontract', year);
        const number = formatDocumentNumber(parseTenantSettings(tenant.settings).numbering.subcontract, {
          year,
          sequence,
        });
        await tx.subcontract.create({
          data: {
            id: b.id,
            tenantId: auth.tenantId,
            number,
            projectId: project.id,
            budgetLineId: b.budgetLineId ?? null,
            supplierId: supplier.id,
            title: b.title,
            scope: b.scope ?? null,
            amount: BigInt(b.amount),
            startDate: day(b.startDate),
            endDate: day(b.endDate),
            installments: installments!.map((i) => ({ ...i, amount: Number(i.amount) })),
            createdBy: auth.userId,
          },
        });
        const check = await recordThirtyBisCheck(tx, thirtyBisPorts(deps), {
          tenantId: auth.tenantId,
          supplierId: supplier.id,
          context: 'contract',
          subcontractId: b.id,
          userId: auth.userId,
          actorLabel: actor.label ?? null,
        }).catch(domainError);
        await tx.subcontract.update({ where: { id: b.id }, data: { creationCheckId: check.id } });
        if (!supplier.isSubcontractor)
          await tx.supplier.update({ where: { id: supplier.id }, data: { isSubcontractor: true } });
        await storeSubcontractPdf(deps, tx, b.id);
        await audit('subcontract.created', 'subcontract', b.id, {
          number,
          amount: String(b.amount),
          supplierId: supplier.id,
          thirtyBisCheckId: check.id,
          hasDebt: hasThirtyBisDebt(check),
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'subcontract.created.v1',
          aggregateType: 'subcontract',
          aggregateId: b.id,
          payload: { subcontractId: b.id, projectId: project.id, checkId: check.id },
          actor,
        });
        await emitCheck(tx, auth.tenantId, check, actor);
        return subcontractDto(
          tx,
          await tx.subcontract.findUniqueOrThrow({ where: { id: b.id }, include: SUBCONTRACT_INCLUDE }),
        );
      });
      return reply.status(201).send(dto);
    },
  );

  app.patch(
    '/subcontracts/:id',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Modifier un contrat en cours (objet, montant, dates, échéancier)',
        params: z.object({ id: z.uuid() }),
        body: SubcontractUpdateSchema,
        response: { 200: SubcontractSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.write', async ({ tx, auth, actor, audit }) => {
        const s = await tx.subcontract.findUnique({ where: { id: req.params.id } });
        if (!s) throw notFound('Ce contrat');
        if (s.status !== 'active')
          throw conflict('subcontract_closed', 'Ce contrat est clôturé ou annulé : il ne se modifie plus.');
        const b = req.body;
        if (
          b.budgetLineId &&
          !(await tx.budgetLine.findFirst({ where: { id: b.budgetLineId, projectId: s.projectId } }))
        )
          throw badRequest('invalid_budget_line', 'Ce poste ne fait pas partie du chantier.');
        const amount = b.amount !== undefined ? BigInt(b.amount) : s.amount;
        const startDate = b.startDate !== undefined ? b.startDate : isoDate(s.startDate);
        const endDate = b.endDate !== undefined ? b.endDate : isoDate(s.endDate);
        if (startDate && endDate && endDate < startDate)
          throw badRequest('invalid_dates', 'La fin des travaux précède leur début.');
        let installments = s.installments;
        if (b.installments !== undefined || b.amount !== undefined) {
          const current =
            (s.installments as { label: string; percent: string; dueOn: string | null }[]) ?? [];
          try {
            installments = buildInstallments(amount, b.installments ?? current).map((i) => ({
              ...i,
              amount: Number(i.amount),
            }));
          } catch (err) {
            domainError(err);
          }
        }
        await tx.subcontract.update({
          where: { id: s.id },
          data: {
            ...(b.title !== undefined ? { title: b.title } : {}),
            ...(b.scope !== undefined ? { scope: b.scope ?? null } : {}),
            ...(b.budgetLineId !== undefined ? { budgetLineId: b.budgetLineId ?? null } : {}),
            amount,
            startDate: day(startDate),
            endDate: day(endDate),
            installments: installments as object,
          },
        });
        await storeSubcontractPdf(deps, tx, s.id);
        await audit('subcontract.updated', 'subcontract', s.id, {
          before: { amount: s.amount.toString(), title: s.title },
          after: { amount: amount.toString(), title: b.title ?? s.title },
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'subcontract.updated.v1',
          aggregateType: 'subcontract',
          aggregateId: s.id,
          payload: { subcontractId: s.id, projectId: s.projectId, status: s.status },
          actor,
        });
        return subcontractDto(
          tx,
          await tx.subcontract.findUniqueOrThrow({ where: { id: s.id }, include: SUBCONTRACT_INCLUDE }),
        );
      }),
  );

  app.post(
    '/subcontracts/:id/status',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Clôturer, rouvrir ou annuler un contrat',
        params: z.object({ id: z.uuid() }),
        body: z.object({ to: z.enum(['active', 'completed', 'cancelled']) }),
        response: { 200: SubcontractSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.write', async ({ tx, auth, actor, audit }) => {
        const s = await tx.subcontract.findUnique({ where: { id: req.params.id } });
        if (!s) throw notFound('Ce contrat');
        try {
          assertTransition(SubcontractStatus, s.status, req.body.to);
        } catch {
          throw conflict('invalid_transition', 'Ce changement de statut n’est pas possible pour ce contrat.');
        }
        if (
          req.body.to === 'cancelled' &&
          (await tx.supplierInvoice.count({ where: { subcontractId: s.id } })) > 0
        )
          throw conflict(
            'subcontract_invoiced',
            'Des factures sont rattachées à ce contrat : clôturez-le plutôt que de l’annuler.',
          );
        await tx.subcontract.update({
          where: { id: s.id },
          data: { status: req.body.to, completedAt: req.body.to === 'completed' ? new Date() : null },
        });
        await audit(`subcontract.${req.body.to}`, 'subcontract', s.id, { from: s.status });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'subcontract.updated.v1',
          aggregateType: 'subcontract',
          aggregateId: s.id,
          payload: { subcontractId: s.id, projectId: s.projectId, status: req.body.to },
          actor,
        });
        return subcontractDto(
          tx,
          await tx.subcontract.findUniqueOrThrow({ where: { id: s.id }, include: SUBCONTRACT_INCLUDE }),
        );
      }),
  );

  app.get(
    '/subcontracts/:id/pdf',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Contrat de sous-traitance (PDF)',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (req, reply) => {
      const { key, number } = await inTenant(deps, req, 'subcontracting.read', async ({ tx }) => {
        const s = await tx.subcontract.findUnique({ where: { id: req.params.id } });
        if (!s) throw notFound('Ce contrat');
        return { key: s.pdfKey ?? (await storeSubcontractPdf(deps, tx, s.id)), number: s.number };
      });
      const file = await deps.integrations.storage.get('legal', key);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${number}.pdf"`)
        .send(file);
    },
  );

  // -------------------------------------------------------------------------
  // Déclaration de travaux (art. 30bis §7)
  // -------------------------------------------------------------------------
  async function worksDeclaration(tx: Tx, projectId: string): Promise<WorksDeclarationDto> {
    const p = await tx.project.findUnique({
      where: { id: projectId },
      include: { site: true, customer: true, tenant: true },
    });
    if (!p) throw notFound('Ce chantier');
    const subs = await tx.subcontract.findMany({
      where: { projectId, status: { not: 'cancelled' } },
      include: { supplier: true },
      orderBy: { createdAt: 'asc' },
    });
    const req = worksDeclarationRequirement({
      contractAmount: p.contractAmount,
      workplaceTotalAmount: p.workplaceTotalAmount,
      subcontractorCount: new Set(subs.map((s) => s.supplierId)).size,
    });
    return {
      required: req.required,
      reasons: req.reasons,
      declaredAt: iso(p.worksDeclaredAt),
      reference: p.worksDeclarationRef,
      data: {
        projectNumber: p.number,
        projectName: p.name,
        address: p.site ? `${p.site.street}, ${p.site.postalCode} ${p.site.city}` : null,
        startDate: isoDate(p.startDate),
        endDate: isoDate(p.endDate),
        contractAmount: Number(p.contractAmount),
        workplaceTotalAmount: p.workplaceTotalAmount === null ? null : Number(p.workplaceTotalAmount),
        principal: { name: p.customer.displayName, enterpriseNumber: p.customer.enterpriseNumber },
        contractor: {
          name: p.tenant.legalName ?? p.tenant.name,
          enterpriseNumber: p.tenant.enterpriseNumber,
        },
        subcontractors: subs.map((s) => ({
          name: s.supplier.name,
          enterpriseNumber: s.supplier.enterpriseNumber,
          title: s.title,
          amount: Number(s.amount),
          startDate: isoDate(s.startDate),
        })),
      },
    };
  }

  app.get(
    '/projects/:id/works-declaration',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Déclaration de travaux : probablement requise ? Données pré-remplies',
        params: z.object({ id: z.uuid() }),
        response: { 200: WorksDeclarationSchema },
      },
    },
    (req) => inTenant(deps, req, 'subcontracting.read', ({ tx }) => worksDeclaration(tx, req.params.id)),
  );

  app.post(
    '/projects/:id/works-declaration',
    {
      schema: {
        tags: ['sous-traitance'],
        summary: 'Enregistrer la déclaration de travaux faite à l’ONSS (référence)',
        params: z.object({ id: z.uuid() }),
        body: WorksDeclarationInputSchema,
        response: { 200: WorksDeclarationSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'subcontracting.write', async ({ tx, auth, actor, audit }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id } });
        if (!p) throw notFound('Ce chantier');
        await tx.project.update({
          where: { id: p.id },
          data: {
            worksDeclaredAt: new Date(`${req.body.declaredOn}T12:00:00Z`),
            worksDeclarationRef: req.body.reference,
          },
        });
        await audit('project.works_declared', 'project', p.id, req.body);
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.updated.v1',
          aggregateType: 'project',
          aggregateId: p.id,
          payload: { projectId: p.id, fields: ['works_declaration'] },
          actor,
        });
        return worksDeclaration(tx, p.id);
      }),
  );
};
