/**
 * Comptabilité (03 §13) : documents à synchroniser traduits en écritures (domaine), lignes de
 * synchronisation par document, paramétrage du tenant (comptes, journaux, codes TVA) et rattrapage
 * des documents existants à la connexion. Partagé par l'API (aperçu, reprise) et le worker (envoi).
 */
import {
  type AccountingEntry,
  type AccountingMapping,
  type EntryPartner,
  paymentEntry,
  purchaseEntry,
  resolveAccountingMapping,
  saleEntry,
  VAT_REGIMES,
  type VatRegime,
} from '@batimint/domain';
import type { Tx } from './client';

export type AccountingDocumentType = 'invoice' | 'supplier_invoice' | 'payment' | 'supplier_payment';

export interface AccountingDocument {
  type: AccountingDocumentType;
  id: string;
  number: string;
  date: string;
  partnerName: string;
  amount: bigint;
  /** Écran du document dans l'application. */
  link: string;
  entry: AccountingEntry;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Régime d'une entrée de ventilation figée (catégorie UBL + taux). */
export function regimeOf(category: string, ratePercent: string): VatRegime {
  const r = (
    Object.values(VAT_REGIMES) as { regime: VatRegime; category: string; ratePercent: string }[]
  ).find((x) => x.category === category && Number(x.ratePercent) === Number(ratePercent));
  return r?.regime ?? 'standard_21';
}

/** Paramétrage comptable du tenant (connexion « accounting »), complété par les valeurs par défaut. */
export async function accountingMapping(tx: Tx, tenantId: string): Promise<AccountingMapping> {
  const c = await tx.integrationConnection.findUnique({
    where: { tenantId_kind: { tenantId, kind: 'accounting' } },
    select: { config: true },
  });
  return resolveAccountingMapping((c?.config as { mapping?: unknown } | null)?.mapping);
}

type Party = { name?: string; vatNumber?: string | null; enterpriseNumber?: string | null } | null;

function partnerFrom(
  snapshot: Party,
  fallback: { displayName: string; vatNumber: string | null; enterpriseNumber: string | null },
): EntryPartner {
  return {
    name: snapshot?.name ?? fallback.displayName,
    vatNumber: snapshot?.vatNumber ?? fallback.vatNumber,
    enterpriseNumber: snapshot?.enterpriseNumber ?? fallback.enterpriseNumber,
  };
}

/**
 * Document prêt à synchroniser, ou null s'il n'est pas (ou plus) synchronisable : brouillon,
 * facture fournisseur pas encore imputée, paiement introuvable.
 */
export async function loadAccountingDocument(
  tx: Tx,
  type: AccountingDocumentType,
  id: string,
  mapping: AccountingMapping,
): Promise<AccountingDocument | null> {
  switch (type) {
    case 'invoice': {
      const i = await tx.invoice.findUnique({ where: { id }, include: { customer: true } });
      if (!i?.number || !i.issueDate || i.status === 'draft') return null;
      const breakdown = (
        i.vatBreakdown as {
          category: string;
          ratePercent: string;
          taxableAmount: number | string;
          taxAmount: number | string;
        }[]
      ).map((v) => ({
        regimes: [regimeOf(v.category, v.ratePercent)],
        ratePercent: v.ratePercent,
        taxableAmount: BigInt(v.taxableAmount),
        taxAmount: BigInt(v.taxAmount),
      }));
      const entry = saleEntry(
        {
          type: i.type === 'credit_note' ? 'credit_note' : 'invoice',
          number: i.number,
          issueDate: iso(i.issueDate)!,
          dueDate: iso(i.dueDate),
          partner: partnerFrom(i.buyer as Party, i.customer),
          structuredCommunication: i.structuredCommunication,
          vatBreakdown: breakdown,
          totalNet: i.totalNet,
          totalVat: i.totalVat,
          totalGross: i.totalGross,
        },
        mapping,
      );
      return {
        type,
        id,
        number: i.number,
        date: iso(i.issueDate)!,
        partnerName: entry.partner.name,
        amount: i.type === 'credit_note' ? -i.totalGross : i.totalGross,
        link: `/facturation/${i.id}`,
        entry,
      };
    }
    case 'supplier_invoice':
    case 'supplier_payment': {
      const s = await tx.supplierInvoice.findUnique({ where: { id }, include: { lines: true } });
      if (!s) return null;
      const supplier = s.supplierId ? await tx.supplier.findUnique({ where: { id: s.supplierId } }) : null;
      if (type === 'supplier_invoice' && ['received', 'to_allocate'].includes(s.status)) return null;
      if (type === 'supplier_payment' && s.status !== 'paid') return null;
      const number = s.number ?? `ACH-${s.id.slice(0, 8)}`;
      const date = iso(s.issueDate) ?? iso(s.receivedAt)!;
      const partner: EntryPartner = {
        name: supplier?.name ?? s.supplierName,
        vatNumber: supplier?.vatNumber ?? s.supplierVat,
        enterpriseNumber: supplier?.enterpriseNumber ?? null,
      };
      if (type === 'supplier_invoice') {
        const entry = purchaseEntry(
          {
            number,
            issueDate: date,
            dueDate: iso(s.dueDate),
            partner,
            subcontracting: Boolean(supplier?.isSubcontractor),
            lines: s.lines.map((l) => ({ net: l.net, vatRate: l.vatRate?.toString() ?? null })),
            totalNet: s.totalNet,
            totalVat: s.totalVat,
            totalGross: s.totalGross,
          },
          mapping,
        );
        return {
          type,
          id,
          number,
          date,
          partnerName: partner.name,
          amount: s.totalGross,
          link: `/achats/factures?facture=${s.id}`,
          entry,
        };
      }
      const withholding = s.withholdingAppliedAt ? s.withholdingSocial + s.withholdingTax : 0n;
      const paidOn = iso(s.paidAt) ?? date;
      const entry = paymentEntry(
        {
          direction: 'sent',
          number: `PAY-${number}`,
          date: paidOn,
          amount: s.totalGross - withholding,
          withholding,
          partner,
          documentNumber: number,
        },
        mapping,
      );
      return {
        type,
        id,
        number: `PAY-${number}`,
        date: paidOn,
        partnerName: partner.name,
        amount: s.totalGross - withholding,
        link: `/achats/factures?facture=${s.id}`,
        entry,
      };
    }
    case 'payment': {
      const p = await tx.payment.findUnique({
        where: { id },
        include: { invoice: { include: { customer: true } } },
      });
      if (!p?.invoice.number) return null;
      const number = `ENC-${p.invoice.number}-${p.id.slice(-4)}`;
      const entry = paymentEntry(
        {
          direction: 'received',
          number,
          date: iso(p.receivedOn)!,
          amount: p.amount,
          partner: partnerFrom(p.invoice.buyer as Party, p.invoice.customer),
          documentNumber: p.invoice.number,
        },
        mapping,
      );
      return {
        type,
        id,
        number,
        date: iso(p.receivedOn)!,
        partnerName: entry.partner.name,
        amount: p.amount,
        link: `/facturation/${p.invoiceId}`,
        entry,
      };
    }
  }
}

/** Écriture sérialisable (montants en chaînes) pour la colonne `entry`. */
export function serializeEntry(entry: AccountingEntry): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(entry, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Record<string, unknown>;
}

/**
 * Lignes de synchronisation pour les documents déjà existants (rattrapage à la connexion) : les
 * documents de l'exercice depuis `since` qui n'en ont pas encore sont mis « en attente ».
 */
export async function queueAccountingBackfill(tx: Tx, tenantId: string, since: Date): Promise<number> {
  const existing = new Set(
    (
      await tx.accountingSync.findMany({
        where: { tenantId },
        select: { documentType: true, documentId: true },
      })
    ).map((r) => `${r.documentType}:${r.documentId}`),
  );
  const candidates: { type: AccountingDocumentType; id: string }[] = [
    ...(
      await tx.invoice.findMany({
        where: { tenantId, status: { notIn: ['draft'] }, number: { not: null }, issueDate: { gte: since } },
        select: { id: true },
      })
    ).map((r) => ({ type: 'invoice' as const, id: r.id })),
    ...(
      await tx.supplierInvoice.findMany({
        where: { tenantId, status: { notIn: ['received', 'to_allocate'] }, receivedAt: { gte: since } },
        select: { id: true, status: true },
      })
    ).flatMap((r) => [
      { type: 'supplier_invoice' as const, id: r.id },
      ...(r.status === 'paid' ? [{ type: 'supplier_payment' as const, id: r.id }] : []),
    ]),
    ...(
      await tx.payment.findMany({ where: { tenantId, receivedOn: { gte: since } }, select: { id: true } })
    ).map((r) => ({ type: 'payment' as const, id: r.id })),
  ];
  const mapping = await accountingMapping(tx, tenantId);
  let created = 0;
  for (const c of candidates) {
    if (existing.has(`${c.type}:${c.id}`)) continue;
    const doc = await loadAccountingDocument(tx, c.type, c.id, mapping).catch(() => null);
    if (!doc) continue;
    await tx.accountingSync.create({
      data: {
        tenantId,
        documentType: c.type,
        documentId: c.id,
        number: doc.number,
        documentDate: new Date(`${doc.date}T00:00:00Z`),
        partnerName: doc.partnerName,
        amount: doc.amount,
        status: 'waiting',
      },
    });
    created++;
  }
  return created;
}
