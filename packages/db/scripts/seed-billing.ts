/**
 * Facturation du seed (M8) : émission « comme l'application » (numéro de la séquence, parties et
 * TVA figées, communication structurée, mentions) sans passer par l'API, et la facturation du
 * chantier Dupont par états d'avancement approuvés par le client.
 */
import {
  addDays,
  buildInvoiceStructuredCommunication,
  computeDocumentTotals,
  dec,
  formatDocumentNumber,
  formatEuros,
  type IsoDate,
  progressFromInput,
  retentionOf,
  summarizeStatement,
  VAT_REGIMES,
  type VatRegime,
} from '@batimint/domain';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../src/client';
import { createProgressInvoiceDraft, projectPostContext } from '../src/invoicing';
import { nextSequenceValue } from '../src/sequences';

const day = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const at = (d: IsoDate, hhmm: string) => new Date(`${d}T${hhmm}:00+02:00`);
const address = (o: { street: string | null; postalCode: string | null; city: string | null }) =>
  [o.street, [o.postalCode, o.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;

/**
 * Émet un brouillon : numéro suivant de la séquence, données figées, envoi par e-mail ; payé si
 * demandé (paiement par virement enregistré). Même résultat que `issueInvoice` de l'API, sans
 * stocker le PDF (régénéré à l'identique au premier téléchargement).
 */
export async function issueSeedInvoice(
  tx: Tx,
  invoiceId: string,
  opts: { issueDate: IsoDate; paymentTermsDays: number; status: 'sent' | 'paid'; paidOn?: IsoDate },
): Promise<{ number: string; dueDate: IsoDate; gross: bigint; retention: bigint }> {
  const i = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: true, customer: true, tenant: true, project: true },
  });
  const year = Number(opts.issueDate.slice(0, 4));
  const sequence = await nextSequenceValue(tx, i.tenantId, 'invoice', year);
  const number = formatDocumentNumber('{YYYY}-{SEQ:3}', { year, sequence });
  const comm = buildInvoiceStructuredCommunication({
    tenantPrefix: i.tenant.structuredCommPrefix,
    year,
    sequence,
  }).digits;
  const totals = computeDocumentTotals(
    i.lines.map((l) => ({
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice,
      vatRegime: l.vatRegime as VatRegime,
    })),
  );
  const pct =
    i.type === 'progress' || i.type === 'final' ? dec(i.project?.retentionPercent.toString() ?? '0') : dec(0);
  const retention = retentionOf(totals.totalGross, pct);
  const dueDate = addDays(opts.issueDate, opts.paymentTermsDays);
  const certificate = i.projectId
    ? await tx.vatCertificate.findFirst({ where: { projectId: i.projectId, status: 'signed' } })
    : null;
  const mentions: string[] = [];
  if (i.lines.some((l) => VAT_REGIMES[l.vatRegime as VatRegime]?.category === 'AE'))
    mentions.push(
      'Autoliquidation — TVA due par le cocontractant (article 20, § 1er, de l’arrêté royal n° 1 relatif à la TVA).',
    );
  if (i.lines.some((l) => l.vatRegime === 'reduced_6'))
    mentions.push(
      `Taux réduit de 6 % : logement privé de plus de 10 ans, attestation du client${
        certificate?.signedAt
          ? ` signée le ${certificate.signedAt.toISOString().slice(0, 10).split('-').reverse().join('/')}`
          : ''
      }.`,
    );
  if (retention > 0n)
    mentions.push(
      `Retenue de garantie de ${pct.toString().replace('.', ',')} % (${formatEuros(retention)}) payable à la réception définitive.`,
    );
  const t = i.tenant;
  const sentAt = at(opts.issueDate, '16:48');
  await tx.invoice.update({
    where: { id: i.id },
    data: {
      status: 'sent',
      number,
      issueDate: day(opts.issueDate),
      dueDate: day(dueDate),
      paymentTermsDays: opts.paymentTermsDays,
      structuredCommunication: comm,
      totalNet: totals.totalNet,
      totalVat: totals.totalVat,
      totalGross: totals.totalGross,
      retentionPercent: pct.toString(),
      retentionAmount: retention,
      vatBreakdown: totals.vatBreakdown.map((v) => ({
        category: v.category,
        ratePercent: v.ratePercent,
        taxableAmount: Number(v.taxableAmount),
        taxAmount: Number(v.taxAmount),
      })),
      vatMentions: mentions,
      seller: {
        name: t.legalName ?? t.name,
        vatNumber: t.vatNumber,
        enterpriseNumber: t.enterpriseNumber,
        address: address(t),
        email: t.email,
      },
      buyer: {
        name: i.customer.displayName,
        vatNumber: i.customer.vatNumber,
        enterpriseNumber: i.customer.enterpriseNumber,
        address: address(i.customer),
        email: i.customer.email,
      },
      issuedAt: at(opts.issueDate, '16:45'),
      deliveryChannel: 'email',
      deliveryStatus: i.customer.email ? 'sent' : 'failed',
      deliveryMessage: i.customer.email
        ? null
        : 'Le client n’a pas d’adresse e-mail : téléchargez le PDF et envoyez-le vous-même.',
      sentTo: i.customer.email,
      sentAt: i.customer.email ? sentAt : null,
    },
  });
  if (opts.status === 'paid') {
    const due = totals.totalGross - retention;
    const paidOn = opts.paidOn ?? addDays(opts.issueDate, Math.max(1, Math.min(opts.paymentTermsDays, 20)));
    await tx.payment.create({
      data: {
        id: randomUUID(),
        tenantId: i.tenantId,
        invoiceId: i.id,
        amount: due,
        receivedOn: day(paidOn),
        method: 'transfer',
        source: 'manual',
        reference: `+++${comm.slice(0, 3)}/${comm.slice(3, 7)}/${comm.slice(7)}+++`,
      },
    });
    await tx.invoice.update({
      where: { id: i.id },
      data: { status: 'paid', amountPaid: due, paidAt: at(paidOn, '10:30') },
    });
  }
  return { number, dueDate, gross: totals.totalGross, retention };
}

/**
 * Dupont : trois états d'avancement approuvés par M. Dupont sur son portail, facturés « payable à
 * réception » ; le n°3 (40 %) est la facture 2026-118, échue depuis 3 jours, rappel n°1 envoyé ce matin.
 */
export async function seedDupontBilling(
  tx: Tx,
  input: {
    tenantId: string;
    projectId: string;
    customerName: string;
    userId: string | null;
    dates: [IsoDate, IsoDate, IsoDate];
    today: IsoDate;
  },
): Promise<{ number: string; issued: IsoDate; statementOrdinal: number; gross: bigint }> {
  // Cumul par poste à chaque état (Démolition, Plomberie, Carrelage, Électricité, Finitions).
  const plan: { mode: 'percent' | 'amount'; value: string }[][] = [
    [{ mode: 'percent', value: '100' }],
    [
      { mode: 'percent', value: '100' },
      { mode: 'percent', value: '25' },
    ],
    [
      { mode: 'percent', value: '100' },
      { mode: 'amount', value: '1027000' },
      { mode: 'percent', value: '30' },
      { mode: 'percent', value: '20' },
    ],
  ];
  let last = { number: '', issued: input.dates[2], gross: 0n };
  for (const [k, steps] of plan.entries()) {
    const posts = await projectPostContext(tx, input.projectId);
    const lines = posts.map((p, i) => {
      const s = steps[i];
      const v = s
        ? progressFromInput(p, s.mode, s.value)
        : progressFromInput(p, 'amount', p.previousAmount.toString());
      return { p, v };
    });
    const summary = summarizeStatement(
      lines.map(({ p, v }) => ({
        contractAmount: p.contractAmount,
        previousAmount: p.previousAmount,
        cumulativeAmount: v.cumulativeAmount,
      })),
    );
    const issued = input.dates[k]!;
    const id = randomUUID();
    await tx.progressStatement.create({
      data: {
        id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        ordinal: k + 1,
        status: 'approved',
        periodEnd: day(issued),
        contractAmount: summary.contractAmount,
        previousAmount: summary.previousAmount,
        cumulativeAmount: summary.cumulativeAmount,
        submittedAt: at(addDays(issued, -1), '17:30'),
        approvedAt: at(issued, '08:12'),
        approvedByName: input.customerName,
        createdBy: input.userId,
        lines: {
          create: lines.map(({ p, v }, position) => ({
            tenantId: input.tenantId,
            budgetLineId: p.budgetLineId,
            position,
            label: p.label,
            contractAmount: p.contractAmount,
            previousAmount: p.previousAmount,
            cumulativeAmount: v.cumulativeAmount,
            cumulativePercent: v.cumulativeRatio.times(100).toDecimalPlaces(4).toString(),
            unit: p.unit,
            totalQuantity: p.totalQuantity,
            cumulativeQuantity: v.cumulativeQuantity?.toDecimalPlaces(4).toString() ?? null,
          })),
        },
      },
    });
    const draft = await createProgressInvoiceDraft(tx, id, input.userId);
    const r = await issueSeedInvoice(tx, draft.id, {
      issueDate: issued,
      paymentTermsDays: 0,
      status: k < 2 ? 'paid' : 'sent',
      paidOn: addDays(issued, 2),
    });
    await tx.progressStatement.update({ where: { id }, data: { status: 'invoiced' } });
    last = { number: r.number, issued, gross: r.gross - r.retention };
    if (k === 2) {
      const daysLate = Math.round((day(input.today).getTime() - day(r.dueDate).getTime()) / 86_400_000);
      await tx.dunningStep.create({
        data: {
          tenantId: input.tenantId,
          invoiceId: draft.id,
          step: 1,
          kind: 'reminder',
          daysLate,
          balance: r.gross - r.retention,
          sentTo: (await tx.invoice.findUniqueOrThrow({ where: { id: draft.id } })).sentTo,
          sentAt: at(input.today, '09:00'),
        },
      });
    }
  }
  return { number: last.number, issued: last.issued, statementOrdinal: plan.length, gross: last.gross };
}
