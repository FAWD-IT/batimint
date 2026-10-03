/**
 * Sous-traitance du seed (M9, 02 P9) : Électro Pirson (sans dette, attestation ONSS bientôt
 * échue) et Façades Lemaire (dette sociale, assurance expirée) sous contrat sur la « Rénovation de
 * 4 appartements ». La facture d'acompte de Pirson est payée ; celle de Lemaire est bloquée par le
 * 30bis, retenue calculée. La déclaration de travaux du chantier reste à faire.
 * Les preuves 30bis et les contrats PDF sont rendus au premier téléchargement.
 */
import {
  addDays,
  buildInstallments,
  formatDocumentNumber,
  formatEuros,
  type IsoDate,
  thirtyBisWithholding,
} from '@batimint/domain';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../src/client';
import { nextSequenceValue } from '../src/sequences';

const day = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const at = (d: IsoDate, hhmm: string) => new Date(`${d}T${hhmm}:00+02:00`);
const ref = () => `30BIS-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

export async function seedSubcontracting(
  tx: Tx,
  tenantId: string,
  users: Map<string, string>,
  today: IsoDate,
): Promise<void> {
  if ((await tx.subcontract.count({ where: { tenantId } })) > 0) return;
  const sophie = users.get('sophie@renov-habitat.be') ?? null;
  const project = await tx.project.findFirst({
    where: { tenantId, name: 'Rénovation de 4 appartements' },
    include: { budgetLines: true },
  });
  if (!project) return;
  const post = (label: string) => project.budgetLines.find((b) => b.label === label)?.id ?? null;
  const year = Number(today.slice(0, 4));

  const pirson = await tx.supplier.create({
    data: {
      tenantId,
      name: 'Électro Pirson SPRL',
      enterpriseNumber: '0456789034',
      vatNumber: 'BE0456789034',
      peppolId: '0208:0456789034',
      email: 'contact@electro-pirson.example',
      phone: '+32 71 38 12 40',
      street: 'Rue du Pont 8',
      postalCode: '6200',
      city: 'Châtelet',
      iban: 'BE68 5390 0754 7034',
      isSubcontractor: true,
      createdBy: sophie,
    },
  });
  const lemaire = await tx.supplier.create({
    data: {
      tenantId,
      name: 'Façades Lemaire SRL',
      enterpriseNumber: '0899123286',
      vatNumber: 'BE0899123286',
      email: 'compta@facades-lemaire.example',
      phone: '+32 65 84 22 10',
      street: 'Rue de la Station 3',
      postalCode: '7100',
      city: 'La Louvière',
      iban: 'BE43 0682 4385 7101',
      isSubcontractor: true,
      createdBy: sophie,
    },
  });

  // Documents : Pirson presque en règle (attestation ONSS à renouveler), Lemaire en défaut.
  const doc = (supplierId: string, kind: string, expiresOn: IsoDate | null, source = 'office') =>
    tx.subcontractorDocument.create({
      data: {
        id: randomUUID(),
        tenantId,
        supplierId,
        kind,
        expiresOn: expiresOn ? day(expiresOn) : null,
        fileKey: `t/${tenantId}/subcontractors/${supplierId}/seed/${kind}.pdf`,
        fileName: `${kind.replace(/_/g, '-')}.pdf`,
        contentType: 'application/pdf',
        size: 182_400,
        sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        source,
        createdBy: source === 'office' ? sophie : null,
        createdAt: at(addDays(today, -40), '10:15'),
      },
    });
  await doc(pirson.id, 'rc_insurance', addDays(today, 210));
  await doc(pirson.id, 'social_certificate', addDays(today, 12), 'portal');
  await doc(pirson.id, 'tax_certificate', addDays(today, 150), 'portal');
  await doc(lemaire.id, 'rc_insurance', addDays(today, -18));
  await doc(lemaire.id, 'tax_certificate', addDays(today, 95));

  const check = (
    supplierId: string,
    enterpriseNumber: string,
    context: string,
    when: Date,
    debt: bigint | null,
    links: { subcontractId?: string; supplierInvoiceId?: string } = {},
  ) =>
    tx.thirtyBisCheck.create({
      data: {
        tenantId,
        supplierId,
        subcontractId: links.subcontractId ?? null,
        supplierInvoiceId: links.supplierInvoiceId ?? null,
        context,
        enterpriseNumber,
        hasSocialDebt: debt !== null,
        hasTaxDebt: false,
        socialDebtAmount: debt,
        provider: 'mock',
        reference: ref(),
        response: { enterpriseNumber, socialDebt: debt ? 'oui' : 'non', taxDebt: 'non' },
        checkedAt: when,
        createdBy: sophie,
      },
    });

  const contracts = [
    {
      supplier: pirson,
      post: 'Électricité',
      title: 'Électricité complète des 4 appartements',
      scope: 'Tableaux divisionnaires, circuits, prises et éclairage, mise en conformité RGIE et contrôle.',
      amount: 5_200_000n,
      start: addDays(today, 30),
      end: addDays(today, 75),
      debt: null,
    },
    {
      supplier: lemaire,
      post: 'Gros œuvre',
      title: 'Rejointoyage et réparation des façades',
      scope: 'Échafaudage, nettoyage basse pression, rejointoyage et hydrofuge des façades avant et arrière.',
      amount: 1_840_000n,
      start: addDays(today, 14),
      end: addDays(today, 32),
      debt: 1_845_000n,
    },
  ];
  const created: { id: string; amount: bigint; supplierId: string; budgetLineId: string | null }[] = [];
  for (const c of contracts) {
    const sequence = await nextSequenceValue(tx, tenantId, 'subcontract', year);
    const id = randomUUID();
    const createdOn = addDays(today, -9);
    await tx.subcontract.create({
      data: {
        id,
        tenantId,
        number: formatDocumentNumber('ST{YYYY}-{SEQ:3}', { year, sequence }),
        projectId: project.id,
        budgetLineId: post(c.post),
        supplierId: c.supplier.id,
        title: c.title,
        scope: c.scope,
        amount: c.amount,
        startDate: day(c.start),
        endDate: day(c.end),
        installments: buildInstallments(c.amount, [
          { label: 'À la commande', percent: '30' },
          { label: 'À mi-parcours', percent: '40', dueOn: addDays(c.start, 15) },
          { label: 'À la réception', percent: '30', dueOn: c.end },
        ]).map((i) => ({ ...i, amount: Number(i.amount) })),
        createdBy: sophie,
        createdAt: at(createdOn, '11:20'),
      },
    });
    const k = await check(
      c.supplier.id,
      c.supplier.enterpriseNumber!,
      'contract',
      at(createdOn, '11:20'),
      c.debt,
      {
        subcontractId: id,
      },
    );
    await tx.subcontract.update({ where: { id }, data: { creationCheckId: k.id } });
    await tx.timelineEntry.create({
      data: {
        tenantId,
        projectId: project.id,
        customerId: project.customerId,
        type: 'subcontract.created',
        title: `Contrat de sous-traitance avec ${c.supplier.name}`,
        body: `${c.title} · poste ${c.post} · ${
          c.debt
            ? '30bis : dette sociale — retenue à chaque paiement'
            : '30bis : aucune dette sociale ni fiscale'
        }`,
        amount: -c.amount,
        actorLabel: 'Sophie Martin',
        occurredAt: at(createdOn, '11:20'),
        data: { subcontractId: id },
      },
    });
    created.push({ id, amount: c.amount, supplierId: c.supplier.id, budgetLineId: post(c.post) });
  }

  // Factures d'acompte (30 %) en autoliquidation : Pirson payée, Lemaire bloquée par le 30bis.
  for (const [n, c] of created.entries()) {
    const supplier = n === 0 ? pirson : lemaire;
    const net = (c.amount * 30n) / 100n;
    const id = randomUUID();
    const receivedOn = addDays(today, n === 0 ? -8 : -2);
    await tx.supplierInvoice.create({
      data: {
        id,
        tenantId,
        source: n === 0 ? 'peppol' : 'upload',
        externalId: n === 0 ? `seed-${id}` : null,
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierVat: supplier.vatNumber,
        number: n === 0 ? `F${year}-1042` : `${year}/087`,
        issueDate: day(receivedOn),
        dueDate: day(addDays(receivedOn, 30)),
        totalNet: net,
        totalVat: 0n,
        totalGross: net,
        notes: 'Autoliquidation — TVA due par le cocontractant. Acompte de 30 % à la commande.',
        status: n === 0 ? 'paid' : 'blocked',
        matchMethod: 'subcontract',
        matchConfidence: '1.000',
        projectId: project.id,
        subcontractId: c.id,
        receivedAt: at(receivedOn, '08:40'),
        allocatedAt: at(receivedOn, '08:41'),
        validatedAt: at(receivedOn, '14:05'),
        validatedBy: sophie,
        paidAt: n === 0 ? at(addDays(today, -3), '10:30') : null,
        lines: {
          create: [
            {
              tenantId,
              position: 0,
              description: 'Acompte de 30 % à la commande',
              quantity: '1',
              unitPrice: net,
              net,
              vatRate: '0',
            },
          ],
        },
      },
    });
    const allocation = await tx.costAllocation.create({
      data: { tenantId, invoiceId: id, projectId: project.id, budgetLineId: c.budgetLineId, amount: net },
    });
    await tx.projectCost.create({
      data: {
        tenantId,
        projectId: project.id,
        budgetLineId: c.budgetLineId,
        category: 'supplier_invoice',
        sourceType: 'supplier_invoice',
        sourceId: `${id}:${allocation.id}`,
        label: `Facture ${supplier.name}`,
        amount: net,
        occurredAt: at(receivedOn, '08:41'),
      },
    });
    await tx.projectCost.create({
      data: {
        tenantId,
        projectId: project.id,
        budgetLineId: c.budgetLineId,
        category: 'subcontract',
        sourceType: 'subcontract',
        sourceId: c.id,
        label: `Contrat — ${supplier.name} (non facturé)`,
        amount: c.amount - net,
      },
    });
    const debt = n === 0 ? null : 1_845_000n;
    await check(supplier.id, supplier.enterpriseNumber!, 'invoice_received', at(receivedOn, '08:41'), debt, {
      subcontractId: c.id,
      supplierInvoiceId: id,
    });
    const payment = await check(
      supplier.id,
      supplier.enterpriseNumber!,
      'payment',
      n === 0 ? at(addDays(today, -3), '10:28') : at(today, '09:12'),
      debt,
      { subcontractId: c.id, supplierInvoiceId: id },
    );
    if (debt) {
      const w = thirtyBisWithholding({
        net,
        gross: net,
        check: { hasSocialDebt: true, hasTaxDebt: false, socialDebtAmount: debt },
      });
      await tx.supplierInvoice.update({
        where: { id },
        data: {
          thirtyBisCheckId: payment.id,
          withholdingSocial: w.social,
          blockedReason:
            'Façades Lemaire SRL a des dettes sociales : retenue 30bis à verser aux administrations avant de payer le solde.',
        },
      });
      await tx.timelineEntry.create({
        data: {
          tenantId,
          projectId: project.id,
          customerId: project.customerId,
          type: 'supplier_invoice.blocked_thirty_bis',
          title: 'Paiement de Façades Lemaire SRL bloqué : dette sociale',
          body: `Retenue de ${formatEuros(w.social)} à verser aux administrations avant de payer le solde`,
          actorLabel: 'Sophie Martin',
          occurredAt: at(today, '09:12'),
          data: { invoiceId: id, checkId: payment.id },
        },
      });
    } else {
      await tx.supplierInvoice.update({ where: { id }, data: { thirtyBisCheckId: payment.id } });
    }
  }
}
