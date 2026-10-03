/**
 * Synchronisation comptable (03 §13, 07 « Chift ») — effets idempotents :
 *  - facture émise, facture fournisseur imputée, paiement reçu, facture fournisseur payée :
 *    l'écriture est construite (domaine) puis poussée ; un statut par document ;
 *  - comptabilité non connectée : le document attend (« en attente »), envoyé à la connexion ;
 *  - erreur du logiciel : message lisible conservé, bureau et comptable prévenus, reprise à la main.
 */
import { parseEventPayload, tenantChannel } from '@batimint/contracts';
import {
  accountingMapping,
  type AccountingDocumentType,
  emitEvent,
  loadAccountingDocument,
  serializeEntry,
} from '@batimint/db';
import type { Consumer, ConsumerContext } from '../consumer';
import { notify, office } from './shared';

const SYSTEM = { type: 'system' as const, label: 'Comptabilité' };

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Erreur inattendue du logiciel comptable.';

export async function syncAccountingDocument(
  ctx: ConsumerContext,
  type: AccountingDocumentType,
  documentId: string,
): Promise<void> {
  const { tx, event, deps } = ctx;
  const tenantId = event.tenantId;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`accounting:${type}:${documentId}`}))`;
  const key = { tenantId_documentType_documentId: { tenantId, documentType: type, documentId } };
  const existing = await tx.accountingSync.findUnique({ where: key });
  if (existing?.status === 'synced') return;
  const mapping = await accountingMapping(tx, tenantId);
  let doc: Awaited<ReturnType<typeof loadAccountingDocument>>;
  let buildError: string | null = null;
  try {
    doc = await loadAccountingDocument(tx, type, documentId, mapping);
  } catch (err) {
    doc = null;
    buildError = errorMessage(err);
  }
  if (!doc && !buildError) return;
  const connection = await tx.integrationConnection.findUnique({
    where: { tenantId_kind: { tenantId, kind: 'accounting' } },
  });
  const base = doc
    ? {
        number: doc.number,
        documentDate: new Date(`${doc.date}T00:00:00Z`),
        partnerName: doc.partnerName,
        amount: doc.amount,
        entry: serializeEntry(doc.entry) as object,
      }
    : null;
  if (!connection || connection.status !== 'active' || !connection.externalId) {
    if (base)
      await tx.accountingSync.upsert({
        where: key,
        create: { tenantId, documentType: type, documentId, ...base, status: 'waiting' },
        update: { ...base, status: 'waiting', lastError: null },
      });
    return;
  }
  let status: 'synced' | 'error';
  let externalId: string | null = null;
  let lastError: string | null = buildError;
  if (doc) {
    try {
      const push =
        type === 'invoice'
          ? deps.integrations.accounting.pushSale
          : type === 'supplier_invoice'
            ? deps.integrations.accounting.pushPurchase
            : deps.integrations.accounting.pushPayment;
      externalId = (await push.call(deps.integrations.accounting, connection.externalId, doc.entry))
        .externalId;
      status = 'synced';
    } catch (err) {
      status = 'error';
      lastError = errorMessage(err);
    }
  } else status = 'error';
  if (!existing && !base) return;
  const now = new Date();
  const row = await tx.accountingSync.upsert({
    where: key,
    create: {
      tenantId,
      documentType: type,
      documentId,
      ...base!,
      status,
      externalId,
      lastError: status === 'error' ? lastError : null,
      attempts: 1,
      lastAttemptAt: now,
      syncedAt: status === 'synced' ? now : null,
    },
    update: {
      ...(base ?? {}),
      status,
      externalId,
      lastError: status === 'error' ? lastError : null,
      attempts: { increment: 1 },
      lastAttemptAt: now,
      syncedAt: status === 'synced' ? now : null,
    },
  });
  if (status === 'error' && (existing?.status !== 'error' || existing.lastError !== lastError))
    await emitEvent(tx, {
      tenantId,
      type: 'accounting.sync_failed.v1',
      aggregateType: 'accounting_sync',
      aggregateId: row.id,
      payload: { syncId: row.id, message: lastError ?? '' },
      actor: SYSTEM,
    });
  await ctx.publish({ channel: tenantChannel(tenantId), topic: 'accounting', ref: row.id });
}

export const accountingSync: Consumer = {
  name: 'accounting-sync',
  events: [
    'invoice.issued.v1',
    'supplier_invoice.allocated.v1',
    'payment.received.v1',
    'supplier_invoice.paid.v1',
    'accounting.sync_requested.v1',
  ],
  async handle(ctx) {
    const { event, tx } = ctx;
    switch (event.type) {
      case 'invoice.issued.v1':
        return syncAccountingDocument(
          ctx,
          'invoice',
          parseEventPayload('invoice.issued.v1', event.payload).invoiceId,
        );
      case 'supplier_invoice.allocated.v1':
        return syncAccountingDocument(
          ctx,
          'supplier_invoice',
          parseEventPayload('supplier_invoice.allocated.v1', event.payload).invoiceId,
        );
      case 'payment.received.v1':
        return syncAccountingDocument(
          ctx,
          'payment',
          parseEventPayload('payment.received.v1', event.payload).paymentId,
        );
      case 'supplier_invoice.paid.v1': {
        const id = parseEventPayload('supplier_invoice.paid.v1', event.payload).invoiceId;
        // Une facture payée sans passer par l'imputation est d'abord comptabilisée.
        await syncAccountingDocument(ctx, 'supplier_invoice', id);
        return syncAccountingDocument(ctx, 'supplier_payment', id);
      }
      case 'accounting.sync_requested.v1': {
        const p = parseEventPayload('accounting.sync_requested.v1', event.payload);
        const rows = await tx.accountingSync.findMany({
          where: { id: { in: p.syncIds } },
          orderBy: [{ documentDate: 'asc' }, { createdAt: 'asc' }],
        });
        // Les achats et ventes avant leurs paiements, pour lettrer dans le bon ordre.
        const order: Record<string, number> = {
          invoice: 0,
          supplier_invoice: 0,
          payment: 1,
          supplier_payment: 1,
        };
        rows.sort((a, b) => order[a.documentType]! - order[b.documentType]!);
        for (const r of rows) await syncAccountingDocument(ctx, r.documentType, r.documentId);
        return;
      }
    }
  },
};

export const accountingSyncFailed: Consumer = {
  name: 'accounting-sync-failed',
  events: ['accounting.sync_failed.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('accounting.sync_failed.v1', event.payload);
    const row = await tx.accountingSync.findUnique({ where: { id: p.syncId } });
    if (!row || row.status !== 'error') return;
    const recipients = (await office(tx, event.tenantId, ['owner', 'admin', 'office', 'accountant'])).map(
      (m) => m.userId,
    );
    await notify(ctx, recipients, {
      type: 'accounting.sync_failed',
      title: `Synchro comptable en erreur : ${row.number}`,
      body: p.message,
      link: `/comptabilite?statut=error`,
    });
  },
};

export const accountingConsumers: readonly Consumer[] = [accountingSync, accountingSyncFailed];
