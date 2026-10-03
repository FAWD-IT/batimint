/**
 * Comptabilité et pilotage du seed (M11, 02 P11–P12) :
 *  - comptabilité connectée depuis deux mois (« WinBooks (simulation) ») ; les ventes, achats et
 *    paiements de l'exercice ont été envoyés (écriture conservée par document) ;
 *  - une facture de la Quincaillerie Delvaux est refusée par le logiciel : son numéro de TVA est
 *    invalide (erreur lisible, à corriger dans la fiche fournisseur puis relancer) ;
 *  - solde bancaire connu pour la trésorerie prévisionnelle.
 */
import { addDays, type IsoDate, isValidEnterpriseNumber } from '@batimint/domain';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../src/client';
import {
  accountingMapping,
  loadAccountingDocument,
  queueAccountingBackfill,
  serializeEntry,
} from '../src/accounting';

const day = (d: IsoDate) => new Date(`${d}T00:00:00Z`);

export async function seedAccounting(
  tx: Tx,
  tenantId: string,
  users: Map<string, string>,
  today: IsoDate,
): Promise<void> {
  if ((await tx.accountingSync.count({ where: { tenantId } })) > 0) return;
  const sophie = users.get('sophie@renov-habitat.be') ?? null;
  const connectedAt = addDays(today, -60);

  // Fournisseur au numéro de TVA erroné (faute de frappe) et sa facture imputée.
  const project = await tx.project.findFirst({ where: { tenantId, name: 'Extension arrière 20 m²' } });
  const delvaux = await tx.supplier.create({
    data: {
      tenantId,
      name: 'Quincaillerie Delvaux',
      vatNumber: 'BE0477123450',
      email: 'compta@delvaux.example.be',
      city: 'Fleurus',
      createdBy: sophie,
    },
  });
  const issued = addDays(today, -6);
  await tx.supplierInvoice.create({
    data: {
      id: randomUUID(),
      tenantId,
      source: 'upload',
      supplierId: delvaux.id,
      supplierName: delvaux.name,
      supplierVat: delvaux.vatNumber,
      number: 'QD-2026-0412',
      issueDate: day(issued),
      dueDate: day(addDays(issued, 30)),
      totalNet: 18_640n,
      totalVat: 3_914n,
      totalGross: 22_554n,
      status: 'allocated',
      projectId: project?.id ?? null,
      matchMethod: 'manual',
      allocatedAt: new Date(`${issued}T10:00:00+02:00`),
      receivedAt: new Date(`${issued}T09:00:00+02:00`),
      lines: {
        create: [
          {
            tenantId,
            position: 0,
            description: 'Chevilles et vis inox (lot)',
            quantity: '1',
            unitPrice: 12_640n,
            net: 12_640n,
            vatRate: '21',
          },
          {
            tenantId,
            position: 1,
            description: 'Disques à tronçonner',
            quantity: '4',
            unitPrice: 1_500n,
            net: 6_000n,
            vatRate: '21',
          },
        ],
      },
    },
  });

  await tx.integrationConnection.upsert({
    where: { tenantId_kind: { tenantId, kind: 'accounting' } },
    create: {
      tenantId,
      kind: 'accounting',
      provider: 'mock',
      status: 'active',
      externalId: `mock-${tenantId.replace(/-/g, '').slice(0, 12)}`,
      config: { software: 'WinBooks (simulation)', connectedAt: `${connectedAt}T09:30:00.000Z` },
      lastCheckedAt: new Date(),
    },
    update: {},
  });

  // Les documents de l'exercice, envoyés comme le ferait le worker.
  await queueAccountingBackfill(tx, tenantId, day(`${today.slice(0, 4)}-01-01`));
  const mapping = await accountingMapping(tx, tenantId);
  const rows = await tx.accountingSync.findMany({ where: { tenantId } });
  for (const r of rows) {
    const doc = await loadAccountingDocument(tx, r.documentType, r.documentId, mapping).catch(() => null);
    if (!doc) {
      await tx.accountingSync.delete({ where: { id: r.id } });
      continue;
    }
    const vat = doc.entry.partner.vatNumber?.replace(/\s|\./g, '').toUpperCase() ?? null;
    const invalid = vat?.startsWith('BE') && !isValidEnterpriseNumber(vat.slice(2));
    const at = new Date(`${doc.date}T18:00:00+02:00`);
    await tx.accountingSync.update({
      where: { id: r.id },
      data: invalid
        ? {
            status: 'error',
            attempts: 2,
            lastAttemptAt: new Date(Date.now() - 3_600_000),
            lastError: `WinBooks (simulation) refuse la pièce ${doc.number} : le numéro de TVA ${doc.entry.partner.vatNumber} de « ${doc.entry.partner.name} » est invalide. Corrigez-le dans sa fiche puis relancez.`,
            entry: serializeEntry(doc.entry) as object,
          }
        : {
            status: 'synced',
            attempts: 1,
            externalId: `${doc.entry.journal}-${doc.number}`.replace(/\s/g, ''),
            lastAttemptAt: at,
            syncedAt: at,
            entry: serializeEntry(doc.entry) as object,
          },
    });
  }

  // Solde bancaire relevé avant-hier : point de départ de la trésorerie à 90 jours.
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  await tx.tenant.update({
    where: { id: tenantId },
    data: {
      settings: {
        ...((tenant.settings as Record<string, unknown> | null) ?? {}),
        cashBalance: { amount: 4_850_000, on: addDays(today, -2) },
      },
    },
  });
}
