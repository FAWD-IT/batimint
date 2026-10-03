/**
 * Comptabilité (03 §13, 02 P12) : connexion au logiciel du comptable via Chift, paramétrage des
 * comptes, journaux et codes TVA, statut de synchronisation par document avec l'écriture envoyée,
 * reprise sur erreur, exports par période (CSV/Excel, UBL des ventes, documents d'achat).
 */
import {
  AccountingExportSchema,
  AccountingMappingSchema,
  AccountingOverviewSchema,
  AccountingSyncQuerySchema,
  AccountingSyncSchema,
  type AccountingSyncDto,
  ExportFormatSchema,
} from '@batimint/contracts';
import { accountingMapping, emitEvent, queueAccountingBackfill, type Tx } from '@batimint/db';
import { brusselsDate } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, notFound } from '../lib/errors';
import { type Column, sendTable } from '../lib/export';
import { inTenant } from '../lib/tenant';
import { zip } from '../lib/zip';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

type SyncRow = Awaited<ReturnType<Tx['accountingSync']['findUniqueOrThrow']>>;

const LINKS: Record<string, (id: string) => string> = {
  invoice: (id) => `/facturation/${id}`,
  payment: () => '/facturation',
  supplier_invoice: (id) => `/achats/factures?facture=${id}`,
  supplier_payment: (id) => `/achats/factures?facture=${id}`,
};

export function syncDto(r: SyncRow, invoiceOfPayment?: Map<string, string>): AccountingSyncDto {
  const entry = r.entry as {
    journal?: string;
    lines?: {
      account: string;
      label: string;
      amount: string;
      vatCode: string | null;
      vatGrid: string | null;
    }[];
  } | null;
  return {
    id: r.id,
    documentType: r.documentType,
    documentId: r.documentId,
    number: r.number,
    date: iso(r.documentDate)!,
    partner: r.partnerName,
    amount: Number(r.amount),
    status: r.status as AccountingSyncDto['status'],
    externalId: r.externalId,
    attempts: r.attempts,
    lastError: r.lastError,
    lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
    syncedAt: r.syncedAt?.toISOString() ?? null,
    journal: entry?.journal ?? null,
    lines: (entry?.lines ?? []).map((l) => {
      const a = BigInt(l.amount);
      return {
        account: l.account,
        label: l.label,
        debit: a > 0n ? Number(a) : 0,
        credit: a < 0n ? Number(-a) : 0,
        vatCode: l.vatCode,
        vatGrid: l.vatGrid,
      };
    }),
    link:
      r.documentType === 'payment' && invoiceOfPayment?.get(r.documentId)
        ? `/facturation/${invoiceOfPayment.get(r.documentId)}`
        : LINKS[r.documentType]!(r.documentId),
  };
}

async function requestSync(
  tx: Tx,
  tenantId: string,
  ids: string[],
  actor: { type: 'user'; id: string; label: string | null },
) {
  for (let i = 0; i < ids.length; i += 500)
    await emitEvent(tx, {
      tenantId,
      type: 'accounting.sync_requested.v1',
      aggregateType: 'tenant',
      aggregateId: tenantId,
      payload: { syncIds: ids.slice(i, i + 500) },
      actor,
    });
}

export const accountingRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const sync = deps.integrations.accounting;

  async function overview(tx: Tx, tenantId: string) {
    const c = await tx.integrationConnection.findUnique({
      where: { tenantId_kind: { tenantId, kind: 'accounting' } },
    });
    const counts = await tx.accountingSync.groupBy({ by: ['status'], _count: { _all: true } });
    const count = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;
    const connected = c?.status === 'active' && c.externalId;
    const config = (c?.config ?? {}) as { software?: string; connectedAt?: string };
    return {
      connection: {
        status: (connected
          ? 'active'
          : c?.status === 'error'
            ? 'error'
            : c?.status === 'pending'
              ? 'pending'
              : 'not_connected') as 'active' | 'error' | 'pending' | 'not_connected',
        provider: sync.provider,
        software: config.software ?? null,
        connectedAt: config.connectedAt ?? null,
        lastError: c?.lastError ?? null,
      },
      counts: {
        waiting: count('waiting'),
        pending: count('pending'),
        synced: count('synced'),
        error: count('error'),
      },
      mapping: await accountingMapping(tx, tenantId),
      ledger: connected
        ? {
            accounts: await sync.listChartOfAccounts(c.externalId!),
            journals: await sync.listJournals(c.externalId!),
            vatCodes: await sync.mapVatCodes(c.externalId!),
          }
        : { accounts: [], journals: [], vatCodes: [] },
    };
  }

  app.get(
    '/accounting',
    {
      schema: {
        tags: ['comptabilité'],
        summary: 'Connexion comptable, compteurs de synchronisation et paramétrage',
        response: { 200: AccountingOverviewSchema },
      },
    },
    (req) => inTenant(deps, req, 'accounting.read', ({ tx, auth }) => overview(tx, auth.tenantId)),
  );

  app.post(
    '/accounting/connect',
    {
      schema: {
        tags: ['comptabilité'],
        summary: 'Connecter le logiciel comptable (Chift) et envoyer les documents de l’exercice',
        response: { 200: AccountingOverviewSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'integrations.manage', async ({ tx, auth, actor, audit }) => {
        const t = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
        const prev = await tx.integrationConnection.findUnique({
          where: { tenantId_kind: { tenantId: auth.tenantId, kind: 'accounting' } },
        });
        let conn: Awaited<ReturnType<typeof sync.connect>>;
        try {
          conn = await sync.connect({
            tenantId: t.id,
            name: t.legalName ?? t.name,
            enterpriseNumber: t.enterpriseNumber,
          });
        } catch (err) {
          throw badRequest(
            'accounting_connect_failed',
            err instanceof Error ? err.message : 'La connexion comptable a échoué.',
          );
        }
        const config = {
          ...((prev?.config as Record<string, unknown> | undefined) ?? {}),
          software: conn.software,
          authorizationUrl: conn.authorizationUrl,
          connectedAt: new Date().toISOString(),
        };
        const row = await tx.integrationConnection.upsert({
          where: { tenantId_kind: { tenantId: auth.tenantId, kind: 'accounting' } },
          create: {
            tenantId: auth.tenantId,
            kind: 'accounting',
            provider: sync.provider,
            status: conn.status,
            externalId: conn.connectionId,
            config,
            lastCheckedAt: new Date(),
          },
          update: {
            provider: sync.provider,
            status: conn.status,
            externalId: conn.connectionId,
            config,
            lastError: null,
            lastCheckedAt: new Date(),
          },
        });
        await audit('accounting.connected', 'integration', row.id, { software: conn.software });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'integration.updated.v1',
          aggregateType: 'integration',
          aggregateId: row.id,
          payload: { kind: 'accounting', status: conn.status, provider: row.provider },
          actor,
        });
        if (conn.status === 'active') {
          // Rattrapage : les documents de l'exercice en cours partent dans l'ordre.
          await queueAccountingBackfill(
            tx,
            auth.tenantId,
            day(`${brusselsDate(new Date()).slice(0, 4)}-01-01`),
          );
          const waiting = await tx.accountingSync.findMany({
            where: { status: { in: ['waiting', 'error'] } },
            select: { id: true },
          });
          await requestSync(
            tx,
            auth.tenantId,
            waiting.map((w) => w.id),
            { type: 'user', id: auth.userId, label: actor.label ?? null },
          );
        }
        return overview(tx, auth.tenantId);
      }),
  );

  app.put(
    '/accounting/mapping',
    {
      schema: {
        tags: ['comptabilité'],
        summary: 'Paramétrage : comptes, journaux et codes TVA du logiciel comptable',
        body: AccountingMappingSchema,
        response: { 200: AccountingOverviewSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'accounting.manage', async ({ tx, auth, audit }) => {
        const prev = await tx.integrationConnection.findUnique({
          where: { tenantId_kind: { tenantId: auth.tenantId, kind: 'accounting' } },
        });
        const config = {
          ...((prev?.config as Record<string, unknown> | undefined) ?? {}),
          mapping: req.body,
        };
        await tx.integrationConnection.upsert({
          where: { tenantId_kind: { tenantId: auth.tenantId, kind: 'accounting' } },
          create: { tenantId: auth.tenantId, kind: 'accounting', provider: sync.provider, config },
          update: { config },
        });
        await audit('accounting.mapping_updated', 'integration', prev?.id ?? null, req.body);
        return overview(tx, auth.tenantId);
      }),
  );

  app.get(
    '/accounting/documents',
    {
      schema: {
        tags: ['comptabilité'],
        summary: 'Statut de synchronisation par document, avec l’écriture envoyée',
        querystring: AccountingSyncQuerySchema,
        response: { 200: z.object({ items: z.array(AccountingSyncSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'accounting.read', async ({ tx }) => {
        const q = req.query;
        const rows = await tx.accountingSync.findMany({
          where: {
            ...(q.status ? { status: q.status } : {}),
            ...(q.type ? { documentType: q.type } : {}),
            ...(q.from || q.to
              ? {
                  documentDate: {
                    ...(q.from ? { gte: day(q.from) } : {}),
                    ...(q.to ? { lte: day(q.to) } : {}),
                  },
                }
              : {}),
          },
          orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
          take: 500,
        });
        const payments = new Map(
          (
            await tx.payment.findMany({
              where: {
                id: { in: rows.filter((r) => r.documentType === 'payment').map((r) => r.documentId) },
              },
              select: { id: true, invoiceId: true },
            })
          ).map((p) => [p.id, p.invoiceId]),
        );
        return { items: rows.map((r) => syncDto(r, payments)) };
      }),
  );

  app.post(
    '/accounting/documents/:id/retry',
    {
      schema: {
        tags: ['comptabilité'],
        summary: 'Relancer la synchronisation d’un document',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ queued: z.number().int() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'accounting.read', async ({ tx, auth, actor, audit }) => {
        const r = await tx.accountingSync.findUnique({ where: { id: req.params.id } });
        if (!r) throw notFound('Ce document');
        if (r.status === 'synced') return { queued: 0 };
        await tx.accountingSync.update({ where: { id: r.id }, data: { status: 'pending' } });
        await audit('accounting.retry', 'accounting_sync', r.id, { number: r.number });
        await requestSync(tx, auth.tenantId, [r.id], {
          type: 'user',
          id: auth.userId,
          label: actor.label ?? null,
        });
        return { queued: 1 };
      }),
  );

  app.post(
    '/accounting/retry',
    {
      schema: {
        tags: ['comptabilité'],
        summary: 'Relancer tous les documents en erreur ou en attente',
        response: { 200: z.object({ queued: z.number().int() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'accounting.read', async ({ tx, auth, actor, audit }) => {
        const rows = await tx.accountingSync.findMany({
          where: { status: { in: ['error', 'waiting'] } },
          select: { id: true },
        });
        if (!rows.length) return { queued: 0 };
        await tx.accountingSync.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: { status: 'pending' },
        });
        await audit('accounting.retry_all', 'tenant', auth.tenantId, { count: rows.length });
        await requestSync(
          tx,
          auth.tenantId,
          rows.map((r) => r.id),
          { type: 'user', id: auth.userId, label: actor.label ?? null },
        );
        return { queued: rows.length };
      }),
  );

  // -------------------------------------------------------------------------
  // Exports du comptable par période (P12)
  // -------------------------------------------------------------------------
  app.get(
    '/accounting/exports/:kind',
    {
      schema: {
        tags: ['comptabilité'],
        summary:
          'Exports par période : ventes, achats, paiements (CSV/Excel), UBL des ventes, documents d’achat (ZIP)',
        params: z.object({ kind: AccountingExportSchema }),
        querystring: z.object({
          from: z.iso.date(),
          to: z.iso.date(),
          format: ExportFormatSchema.default('csv'),
        }),
      },
    },
    async (req, reply) => {
      const { from, to, format } = req.query;
      if (to < from) throw badRequest('invalid_period', 'La date de fin précède la date de début.');
      const between = { gte: day(from), lte: day(to) };
      const kind = req.params.kind;
      const name = `${kind}-${from}-${to}`;
      if (kind === 'sales-ubl' || kind === 'purchases-documents') {
        const files = await inTenant(deps, req, 'exports.read', async ({ tx }) => {
          if (kind === 'sales-ubl') {
            const rows = await tx.invoice.findMany({
              where: { issueDate: between, ublKey: { not: null }, number: { not: null } },
              select: { number: true, ublKey: true, issueDate: true },
              orderBy: { number: 'asc' },
            });
            return rows.map((r) => ({
              name: `${r.number}.xml`,
              key: r.ublKey!,
              bucket: 'legal' as const,
              date: r.issueDate!,
            }));
          }
          const rows = await tx.supplierInvoice.findMany({
            where: { issueDate: between, documentKey: { not: null } },
            select: {
              id: true,
              number: true,
              supplierName: true,
              documentKey: true,
              documentType: true,
              issueDate: true,
            },
            orderBy: { issueDate: 'asc' },
          });
          return rows.map((r) => {
            const ext = r.documentType?.includes('xml')
              ? 'xml'
              : r.documentType?.includes('pdf')
                ? 'pdf'
                : (r.documentKey!.split('.').pop() ?? 'bin');
            const safe = `${r.supplierName}-${r.number ?? r.id.slice(0, 8)}`.replace(
              /[^\p{L}\p{N}._-]+/gu,
              '_',
            );
            return {
              name: `${safe}.${ext}`,
              key: r.documentKey!,
              bucket: 'legal' as const,
              date: r.issueDate!,
            };
          });
        });
        const entries = [];
        for (const f of files) {
          const data = await deps.integrations.storage.get(f.bucket, f.key).catch(() => null);
          if (data) entries.push({ name: f.name, data: Buffer.from(data), date: f.date });
        }
        if (!entries.length)
          throw notFound(
            kind === 'sales-ubl'
              ? 'Aucune facture UBL sur cette période'
              : 'Aucun document d’achat sur cette période',
          );
        return reply
          .header('content-type', 'application/zip')
          .header('content-disposition', `attachment; filename="${name}.zip"`)
          .send(zip(entries));
      }
      const table = await inTenant(deps, req, 'exports.read', async ({ tx }) => {
        if (kind === 'sales') {
          const rows = await tx.invoice.findMany({
            where: { issueDate: between, status: { not: 'draft' }, number: { not: null } },
            include: { customer: true },
            orderBy: { number: 'asc' },
          });
          type Row = (typeof rows)[number] & {
            b: { category: string; ratePercent: string; taxableAmount: number; taxAmount: number };
          };
          const flat: Row[] = rows.flatMap((r) => (r.vatBreakdown as Row['b'][]).map((b) => ({ ...r, b })));
          const sign = (r: Row) => (r.type === 'credit_note' ? -1 : 1);
          const columns: Column<Row>[] = [
            { label: 'Journal', value: (r) => (r.type === 'credit_note' ? 'NCV' : 'VEN') },
            { label: 'Numéro', value: (r) => r.number },
            { label: 'Date', type: 'date', value: (r) => iso(r.issueDate) },
            { label: 'Échéance', type: 'date', value: (r) => iso(r.dueDate) },
            {
              label: 'Client',
              value: (r) => (r.buyer as { name?: string } | null)?.name ?? r.customer.displayName,
            },
            {
              label: 'N° TVA client',
              value: (r) => (r.buyer as { vatNumber?: string } | null)?.vatNumber ?? r.customer.vatNumber,
            },
            { label: 'Catégorie TVA', value: (r) => r.b.category },
            { label: 'Taux TVA', value: (r) => `${r.b.ratePercent} %` },
            { label: 'Base HTVA', type: 'money', value: (r) => sign(r) * Number(r.b.taxableAmount) },
            { label: 'TVA', type: 'money', value: (r) => sign(r) * Number(r.b.taxAmount) },
            { label: 'Total TVAC (pièce)', type: 'money', value: (r) => sign(r) * Number(r.totalGross) },
            { label: 'Communication', value: (r) => r.structuredCommunication },
          ];
          return { filename: name, sheet: 'Ventes', columns, rows: flat };
        }
        if (kind === 'purchases') {
          const rows = await tx.supplierInvoice.findMany({
            where: { issueDate: between, status: { notIn: ['received', 'to_allocate'] } },
            orderBy: { issueDate: 'asc' },
          });
          const columns: Column<(typeof rows)[number]>[] = [
            { label: 'Journal', value: () => 'ACH' },
            { label: 'Fournisseur', value: (r) => r.supplierName },
            { label: 'N° TVA', value: (r) => r.supplierVat },
            { label: 'Numéro', value: (r) => r.number },
            { label: 'Date', type: 'date', value: (r) => iso(r.issueDate) },
            { label: 'Échéance', type: 'date', value: (r) => iso(r.dueDate) },
            { label: 'HTVA', type: 'money', value: (r) => r.totalNet },
            { label: 'TVA', type: 'money', value: (r) => r.totalVat },
            { label: 'TVAC', type: 'money', value: (r) => r.totalGross },
            {
              label: 'Retenue 30bis',
              type: 'money',
              value: (r) => (r.withholdingAppliedAt ? r.withholdingSocial + r.withholdingTax : null),
            },
            { label: 'Payée le', type: 'date', value: (r) => iso(r.paidAt) },
          ];
          return { filename: name, sheet: 'Achats', columns, rows };
        }
        const received = await tx.payment.findMany({
          where: { receivedOn: between },
          include: { invoice: { select: { number: true, customer: { select: { displayName: true } } } } },
        });
        const sent = await tx.supplierInvoice.findMany({
          where: { status: 'paid', paidAt: { gte: day(from), lt: new Date(day(to).getTime() + 86_400_000) } },
        });
        type Row = {
          date: string;
          direction: string;
          partner: string;
          document: string | null;
          amount: bigint;
          withholding: bigint | null;
        };
        const rows: Row[] = [
          ...received.map((p) => ({
            date: iso(p.receivedOn)!,
            direction: 'Encaissement',
            partner: p.invoice.customer.displayName,
            document: p.invoice.number,
            amount: p.amount,
            withholding: null,
          })),
          ...sent.map((s) => {
            const w = s.withholdingAppliedAt ? s.withholdingSocial + s.withholdingTax : 0n;
            return {
              date: iso(s.paidAt)!,
              direction: 'Décaissement',
              partner: s.supplierName,
              document: s.number,
              amount: -(s.totalGross - w),
              withholding: w || null,
            };
          }),
        ].sort((a, b) => a.date.localeCompare(b.date));
        const columns: Column<Row>[] = [
          { label: 'Date', type: 'date', value: (r) => r.date },
          { label: 'Sens', value: (r) => r.direction },
          { label: 'Partenaire', value: (r) => r.partner },
          { label: 'Document', value: (r) => r.document },
          { label: 'Montant', type: 'money', value: (r) => r.amount },
          { label: 'Retenue 30bis', type: 'money', value: (r) => r.withholding },
        ];
        return { filename: name, sheet: 'Paiements', columns, rows };
      });
      return sendTable(reply, table as Parameters<typeof sendTable>[1], format);
    },
  );
};
