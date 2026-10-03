/**
 * Réception et clôture (03 §5, 02 P10) : PV provisoire avec réserves photographiées, signé par le
 * client sur le téléphone ; réserves → tâches ; facture finale ; PV définitif (libération de la
 * retenue) ; clôture avec rapport de rentabilité et ajustement des prix de la bibliothèque.
 */
import {
  ApplySuggestionsSchema,
  parseTenantSettings,
  ProfitabilitySchema,
  ProjectReceptionSchema,
  ProjectSchema,
  ReceptionDraftInputSchema,
  ReceptionSchema,
  ReceptionSignSchema,
} from '@batimint/contracts';
import { createFinalInvoiceDraft, emitEvent, nextSequenceValue } from '@batimint/db';
import { sha256 } from '@batimint/documents';
import {
  brusselsDate,
  formatDocumentNumber,
  plannedFinalReception,
  receptionBlockers,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors';
import { inTenant } from '../lib/tenant';
import { projectDetail } from '../services/projects';
import {
  profitability,
  projectReception,
  RECEPTION_INCLUDE,
  receptionDto,
  renderReceptionFor,
} from '../services/receptions';

const day = (d: string) => new Date(`${d}T00:00:00Z`);

const BLOCKER_MESSAGE: Record<string, string> = {
  project_not_in_progress: 'La réception provisoire se fait sur un chantier en cours.',
  provisional_missing: 'La réception définitive suit la réception provisoire.',
  reserves_open: 'Des réserves ne sont pas encore levées.',
};

export const receptionRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/projects/:id/reception',
    {
      schema: {
        tags: ['réception'],
        summary: 'Réceptions du chantier : PV, réserves, facture finale, retenue, actions possibles',
        params: z.object({ id: z.uuid() }),
        response: { 200: ProjectReceptionSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', async ({ tx }) => {
        if (!(await tx.project.findUnique({ where: { id: req.params.id } }))) throw notFound('Ce chantier');
        return projectReception(tx, req.params.id);
      }),
  );

  app.put(
    '/projects/:id/receptions/:receptionId',
    {
      schema: {
        tags: ['réception'],
        summary: 'Préparer un PV de réception (brouillon, identifiant client) et ses réserves',
        params: z.object({ id: z.uuid(), receptionId: z.uuid() }),
        body: ReceptionDraftInputSchema,
        response: { 200: ReceptionSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'receptions.manage', async ({ tx, auth, audit }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id } });
        if (!p) throw notFound('Ce chantier');
        const b = req.body;
        const existing = await tx.reception.findUnique({ where: { id: req.params.receptionId } });
        if (existing && existing.projectId !== p.id) throw notFound('Ce PV');
        if (existing?.status === 'signed')
          throw conflict('reception_signed', 'Ce PV est signé : il ne se modifie plus.');
        if (b.kind === 'final' && b.reserves.length)
          throw badRequest('final_reserves', 'Les réserves se notent au PV provisoire.');
        const posts = new Set(
          (await tx.budgetLine.findMany({ where: { projectId: p.id }, select: { id: true } })).map(
            (x) => x.id,
          ),
        );
        if (b.reserves.some((r) => r.budgetLineId && !posts.has(r.budgetLineId)))
          throw badRequest('invalid_budget_line', 'Un poste ne fait pas partie de ce chantier.');
        const photoIds = b.reserves.flatMap((r) => r.photoIds);
        if (photoIds.length) {
          const found = await tx.attachment.count({
            where: { id: { in: photoIds }, ownerType: 'project', ownerId: p.id },
          });
          if (found !== new Set(photoIds).size)
            throw badRequest('invalid_photo', 'Une photo ne fait pas partie de ce chantier.');
        }
        const data = {
          kind: b.kind,
          receptionDate: day(b.receptionDate),
          attendees: b.attendees ?? null,
          notes: b.notes ?? null,
        };
        if (existing) await tx.reception.update({ where: { id: existing.id }, data });
        else
          await tx.reception.create({
            data: {
              id: req.params.receptionId,
              tenantId: auth.tenantId,
              projectId: p.id,
              createdBy: auth.userId,
              ...data,
            },
          });
        await tx.reserve.deleteMany({ where: { receptionId: req.params.receptionId } });
        if (b.reserves.length)
          await tx.reserve.createMany({
            data: b.reserves.map((r, position) => ({
              id: r.id,
              tenantId: auth.tenantId,
              receptionId: req.params.receptionId,
              projectId: p.id,
              position,
              description: r.description,
              location: r.location ?? null,
              budgetLineId: r.budgetLineId ?? null,
              photoIds: r.photoIds,
            })),
          });
        if (!existing)
          await audit('reception.drafted', 'project', p.id, {
            receptionId: req.params.receptionId,
            kind: b.kind,
          });
        return receptionDto(
          tx,
          await tx.reception.findUniqueOrThrow({
            where: { id: req.params.receptionId },
            include: RECEPTION_INCLUDE,
          }),
        );
      }),
  );

  app.delete(
    '/receptions/:id',
    {
      schema: {
        tags: ['réception'],
        summary: 'Abandonner un PV en brouillon',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'receptions.manage', async ({ tx, audit }) => {
        const r = await tx.reception.findUnique({ where: { id: req.params.id } });
        if (!r) throw notFound('Ce PV');
        if (r.status === 'signed') throw conflict('reception_signed', 'Un PV signé ne se supprime pas.');
        await tx.reception.delete({ where: { id: r.id } });
        await audit('reception.deleted', 'project', r.projectId, { receptionId: r.id });
        return { ok: true as const };
      }),
  );

  app.post(
    '/receptions/:id/sign',
    {
      schema: {
        tags: ['réception'],
        summary: 'Faire signer le PV au client (sur le téléphone ou l’écran)',
        params: z.object({ id: z.uuid() }),
        body: ReceptionSignSchema,
        response: { 200: ReceptionSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'receptions.manage', async ({ tx, auth, actor, audit }) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM receptions WHERE id = ${req.params.id}::uuid FOR UPDATE`;
        if (!locked[0]) throw notFound('Ce PV');
        const r = await tx.reception.findUniqueOrThrow({
          where: { id: req.params.id },
          include: { ...RECEPTION_INCLUDE, project: { include: { customer: true, tenant: true } } },
        });
        if (r.status === 'signed') throw conflict('reception_signed', 'Ce PV est déjà signé.');
        const openReserves =
          r.kind === 'final'
            ? await tx.reserve.count({ where: { projectId: r.projectId, liftedAt: null } })
            : 0;
        const blockers = receptionBlockers({ kind: r.kind, projectStatus: r.project.status, openReserves });
        if (blockers.length)
          throw unprocessable(
            blockers[0]!,
            BLOCKER_MESSAGE[blockers[0]!] ?? 'Ce PV ne peut pas encore être signé.',
          );
        const now = new Date();
        const year = Number(brusselsDate(now).slice(0, 4));
        const settings = parseTenantSettings(r.project.tenant.settings);
        const number = formatDocumentNumber(settings.numbering.reception, {
          year,
          sequence: await nextSequenceValue(tx, auth.tenantId, 'reception', year),
        });
        const receptionOn = brusselsDate(r.receptionDate);
        const plannedFinal =
          r.kind === 'provisional' ? plannedFinalReception(receptionOn, settings.retentionMonths) : null;
        if (plannedFinal)
          await tx.reception.update({ where: { id: r.id }, data: { plannedFinalDate: day(plannedFinal) } });
        const pdf = await renderReceptionFor(
          tx,
          r.id,
          { signerName: req.body.signerName, signedAt: now, ip: req.ip },
          number,
        );
        const hash = sha256(pdf);
        const key = `t/${auth.tenantId}/receptions/${r.id}/${number}-signe.pdf`;
        await deps.integrations.storage.put({
          bucket: 'legal',
          key,
          body: pdf,
          contentType: 'application/pdf',
          metadata: { sha256: hash },
        });
        const sig = await tx.signature.create({
          data: {
            tenantId: auth.tenantId,
            subjectType: 'reception',
            subjectId: r.id,
            signerName: req.body.signerName,
            signerEmail: r.project.customer.email,
            signatureImage: req.body.signaturePath ?? null,
            acceptedTerms: true,
            ip: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
            documentSha256: hash,
            documentKey: key,
            signedAt: now,
          },
        });
        await tx.reception.update({
          where: { id: r.id },
          data: {
            status: 'signed',
            number,
            signerName: req.body.signerName,
            signatureId: sig.id,
            signedAt: now,
            pdfKey: key,
            pdfSha256: hash,
          },
        });
        // Le PV signé fait avancer le chantier (03 §5) : provisoire → garantie, définitive.
        await tx.project.update({
          where: { id: r.projectId },
          data:
            r.kind === 'provisional'
              ? {
                  status: 'provisional_acceptance',
                  provisionalAcceptedOn: r.receptionDate,
                  finalAcceptancePlannedOn: plannedFinal ? day(plannedFinal) : null,
                }
              : { status: 'final_acceptance', finalAcceptedOn: r.receptionDate },
        });
        await audit('reception.signed', 'reception', r.id, {
          number,
          kind: r.kind,
          signerName: req.body.signerName,
          documentSha256: hash,
          reserves: r.reserves.length,
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'reception.signed.v1',
          aggregateType: 'project',
          aggregateId: r.projectId,
          payload: { receptionId: r.id, projectId: r.projectId, kind: r.kind },
          actor,
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.status_changed.v1',
          aggregateType: 'project',
          aggregateId: r.projectId,
          payload: {
            projectId: r.projectId,
            from: r.project.status,
            to: r.kind === 'provisional' ? 'provisional_acceptance' : 'final_acceptance',
            reason: null,
          },
          actor,
        });
        return receptionDto(
          tx,
          await tx.reception.findUniqueOrThrow({ where: { id: r.id }, include: RECEPTION_INCLUDE }),
        );
      }),
  );

  app.get(
    '/receptions/:id/pdf',
    {
      schema: {
        tags: ['réception'],
        summary: 'PV de réception signé (PDF)',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (req, reply) => {
      const r = await inTenant(deps, req, 'projects.read', async ({ tx }) => {
        const x = await tx.reception.findUnique({ where: { id: req.params.id } });
        if (!x?.pdfKey) throw notFound('Ce PV');
        return x;
      });
      const file = await deps.integrations.storage.get('legal', r.pdfKey!);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${r.number}.pdf"`)
        .send(file);
    },
  );

  app.post(
    '/reserves/:id/lift',
    {
      schema: {
        tags: ['réception'],
        summary: 'Lever une réserve (sa tâche est marquée faite)',
        params: z.object({ id: z.uuid() }),
        response: { 200: ProjectReceptionSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'receptions.manage', async ({ tx, auth, actor, audit }) => {
        const r = await tx.reserve.findUnique({ where: { id: req.params.id }, include: { reception: true } });
        if (!r || r.reception.status !== 'signed') throw notFound('Cette réserve');
        if (!r.liftedAt) {
          await tx.reserve.update({
            where: { id: r.id },
            data: { liftedAt: new Date(), liftedBy: auth.userId },
          });
          if (r.taskId)
            await tx.task.updateMany({
              where: { id: r.taskId, status: { not: 'done' } },
              data: { status: 'done', progress: '1', completedAt: new Date(), completedBy: auth.userId },
            });
          await audit('reserve.lifted', 'project', r.projectId, { reserveId: r.id });
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'reserve.lifted.v1',
            aggregateType: 'project',
            aggregateId: r.projectId,
            payload: { reserveId: r.id, projectId: r.projectId, receptionId: r.receptionId },
            actor,
          });
        }
        return projectReception(tx, r.projectId);
      }),
  );

  app.post(
    '/projects/:id/final-invoice',
    {
      schema: {
        tags: ['réception'],
        summary: 'Générer la facture finale (solde du contrat, acomptes et états déduits)',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ invoiceId: z.uuid() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.write', async ({ tx, auth, audit }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id } });
        if (!p) throw notFound('Ce chantier');
        if (!['provisional_acceptance', 'final_acceptance', 'closed'].includes(p.status))
          throw conflict('reception_required', 'La facture finale suit la réception provisoire.');
        const open = await tx.reserve.count({ where: { projectId: p.id, liftedAt: null } });
        if (open) throw conflict('reserves_open', 'Des réserves ne sont pas encore levées.');
        const r = await createFinalInvoiceDraft(tx, p.id, auth.userId);
        if (!r) throw conflict('nothing_to_invoice', 'Tout le contrat est déjà facturé.');
        if (r.created) await audit('invoice.final_drafted', 'invoice', r.id, { projectId: p.id });
        return { invoiceId: r.id };
      }),
  );

  app.post(
    '/projects/:id/close',
    {
      schema: {
        tags: ['réception'],
        summary: 'Clôturer le chantier (après la réception définitive)',
        params: z.object({ id: z.uuid() }),
        response: { 200: ProjectSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.write', async ({ tx, auth, actor, audit }) => {
        const p = await tx.project.findUnique({ where: { id: req.params.id } });
        if (!p) throw notFound('Ce chantier');
        if (p.status !== 'final_acceptance')
          throw conflict('final_reception_required', 'Le chantier se clôture après la réception définitive.');
        await tx.project.update({ where: { id: p.id }, data: { status: 'closed', closedAt: new Date() } });
        await audit('project.closed', 'project', p.id, {});
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.closed.v1',
          aggregateType: 'project',
          aggregateId: p.id,
          payload: { projectId: p.id },
          actor,
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.status_changed.v1',
          aggregateType: 'project',
          aggregateId: p.id,
          payload: { projectId: p.id, from: p.status, to: 'closed', reason: null },
          actor,
        });
        return projectDetail(tx, p.id, auth.tenantId, auth.role);
      }),
  );

  app.get(
    '/projects/:id/profitability',
    {
      schema: {
        tags: ['réception'],
        summary: 'Rapport de rentabilité : prévu vs réel par poste, heures, achats ; suggestions de prix',
        params: z.object({ id: z.uuid() }),
        response: { 200: ProfitabilitySchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.finance.read', async ({ tx, auth }) => {
        if (!(await tx.project.findUnique({ where: { id: req.params.id } }))) throw notFound('Ce chantier');
        return profitability(tx, req.params.id, auth.tenantId);
      }),
  );

  app.post(
    '/projects/:id/price-suggestions/apply',
    {
      schema: {
        tags: ['réception'],
        summary: 'Appliquer à la bibliothèque les ajustements de prix retenus',
        params: z.object({ id: z.uuid() }),
        body: ApplySuggestionsSchema,
        response: { 200: z.object({ updated: z.number().int() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'library.write', async ({ tx, auth, audit }) => {
        let updated = 0;
        for (const s of req.body.items) {
          const item = await tx.item.findUnique({ where: { id: s.itemId } });
          if (!item) throw notFound('Cet article');
          if (s.field === 'unitCost') {
            const price = BigInt(s.value.split('.')[0]!);
            await tx.item.update({ where: { id: item.id }, data: { purchasePrice: price } });
            await tx.priceHistory.create({
              data: {
                tenantId: auth.tenantId,
                itemId: item.id,
                purchasePrice: price,
                salePrice: item.salePrice,
                source: `profitability:${req.params.id}`,
                changedBy: auth.userId,
              },
            });
          } else {
            await tx.item.update({ where: { id: item.id }, data: { laborHours: s.value } });
          }
          await audit('item.price_adjusted', 'item', item.id, {
            field: s.field,
            before: s.field === 'unitCost' ? item.purchasePrice.toString() : item.laborHours.toString(),
            after: s.value,
            projectId: req.params.id,
          });
          updated++;
        }
        return { updated };
      }),
  );
};
