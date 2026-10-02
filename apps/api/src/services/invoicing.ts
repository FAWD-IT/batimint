/**
 * Facturation (03 §10, 05 §2, 02 P7) : lecture des factures, freins à l'émission, émission
 * (numéro définitif, parties figées, PDF + UBL rangés avec empreinte), paiements.
 */
import type { InvoiceDto, InvoiceSummaryDto, ProgressStatementDto } from '@batimint/contracts';
import { parseTenantSettings } from '@batimint/contracts';
import { emitEvent, type EventActor, nextSequenceValue, type Tx } from '@batimint/db';
import { buildInvoiceUbl, type InvoiceDocumentInput, renderInvoicePdf, sha256 } from '@batimint/documents';
import {
  addDays,
  brusselsDate,
  buildInvoiceStructuredCommunication,
  computeDocumentTotals,
  daysBetween,
  dec,
  formatEuros,
  formatDocumentNumber,
  invoiceBalance,
  paymentState,
  retentionOf,
  validatePayment,
  VAT_REGIMES,
  vatIssuanceBlockers,
  type VatRegime,
} from '@batimint/domain';
import type { Integrations } from '@batimint/integrations';
import { badRequest, conflict, notFound } from '../lib/errors';
import { iso, isoDate } from '../lib/tenant';

export const INVOICE_INCLUDE = {
  lines: { orderBy: { position: 'asc' as const } },
  payments: { orderBy: { receivedOn: 'asc' as const } },
  dunning: { orderBy: { step: 'asc' as const } },
  customer: { select: { id: true, displayName: true, kind: true } },
  project: { select: { id: true, number: true, name: true } },
  links: { where: { status: 'open' }, orderBy: { createdAt: 'desc' as const }, take: 1 },
};

type InvoiceRow = Awaited<ReturnType<Tx['invoice']['findUniqueOrThrow']>> & {
  lines: Awaited<ReturnType<Tx['invoiceLine']['findUniqueOrThrow']>>[];
  payments: Awaited<ReturnType<Tx['payment']['findUniqueOrThrow']>>[];
  dunning: Awaited<ReturnType<Tx['dunningStep']['findUniqueOrThrow']>>[];
  customer: { id: string; displayName: string; kind: 'individual' | 'company' };
  project: { id: string; number: string; name: string } | null;
  links: Awaited<ReturnType<Tx['paymentLink']['findUniqueOrThrow']>>[];
};

export const ISSUED_STATUSES = ['issued', 'sent', 'delivered', 'partially_paid', 'paid'] as const;
export const OPEN_STATUSES = ['issued', 'sent', 'delivered', 'partially_paid'] as const;

export function today(): string {
  return brusselsDate(new Date());
}

/** Reste à encaisser ; une note de crédit ou un brouillon n'ont pas de solde. */
export function balanceOf(i: {
  type: string;
  status: string;
  totalGross: bigint;
  retentionAmount: bigint;
  amountPaid: bigint;
  amountCredited: bigint;
}): bigint {
  if (i.type === 'credit_note' || i.status === 'draft' || i.status === 'cancelled') return 0n;
  return invoiceBalance({
    totalGross: i.totalGross,
    retentionAmount: i.retentionAmount,
    paid: i.amountPaid,
    credited: i.amountCredited,
  });
}

export function summaryDto(i: InvoiceRow, day = today()): InvoiceSummaryDto {
  const balance = balanceOf(i);
  const due = isoDate(i.dueDate);
  const late = due && balance > 0n ? Math.max(0, daysBetween(due, day)) : 0;
  return {
    id: i.id,
    type: i.type,
    status: i.status,
    number: i.number,
    title: i.title,
    customer: i.customer,
    project: i.project,
    issueDate: isoDate(i.issueDate),
    dueDate: due,
    totalNet: Number(i.totalNet),
    totalVat: Number(i.totalVat),
    totalGross: Number(i.totalGross),
    retentionAmount: Number(i.retentionAmount),
    amountPaid: Number(i.amountPaid),
    amountCredited: Number(i.amountCredited),
    balance: Number(balance),
    overdue: late > 0,
    daysLate: late,
    deliveryChannel: (i.deliveryChannel as 'peppol' | 'email' | null) ?? null,
    deliveryStatus: i.deliveryStatus,
    remindersSent: i.dunning.length,
    createdAt: i.createdAt.toISOString(),
  };
}

const lineNet = (l: { quantity: { toString(): string }; unitPrice: bigint }) =>
  computeDocumentTotals([{ quantity: l.quantity.toString(), unitPrice: l.unitPrice, vatRegime: 'zero' }])
    .totalNet;

type Party = {
  name: string;
  vatNumber: string | null;
  enterpriseNumber: string | null;
  address: string | null;
  email: string | null;
};

export async function invoiceDto(tx: Tx, i: InvoiceRow): Promise<InvoiceDto> {
  const credited = i.creditedInvoiceId
    ? await tx.invoice.findUnique({ where: { id: i.creditedInvoiceId }, select: { id: true, number: true } })
    : null;
  const creditNotes = await tx.invoice.findMany({
    where: { creditedInvoiceId: i.id },
    select: { id: true, number: true, status: true, totalGross: true },
    orderBy: { createdAt: 'asc' },
  });
  const statement = i.progressStatementId
    ? await tx.progressStatement.findUnique({
        where: { id: i.progressStatementId },
        select: { id: true, ordinal: true },
      })
    : null;
  const live = i.status === 'draft' ? computeDocumentTotals(i.lines.map(toTaxable)) : null;
  const breakdown = live
    ? live.vatBreakdown.map((v) => ({
        category: v.category,
        ratePercent: v.ratePercent,
        taxableAmount: Number(v.taxableAmount),
        taxAmount: Number(v.taxAmount),
      }))
    : ((i.vatBreakdown as {
        category: string;
        ratePercent: string;
        taxableAmount: number;
        taxAmount: number;
      }[]) ?? []);
  const link = i.links[0];
  return {
    ...summaryDto(i),
    ...(live
      ? {
          totalNet: Number(live.totalNet),
          totalVat: Number(live.totalVat),
          totalGross: Number(live.totalGross),
        }
      : {}),
    intro: i.intro,
    notes: i.notes,
    paymentTermsDays: i.paymentTermsDays,
    servicePeriodStart: isoDate(i.servicePeriodStart),
    servicePeriodEnd: isoDate(i.servicePeriodEnd),
    structuredCommunication: i.structuredCommunication,
    retentionPercent: i.retentionPercent.toString(),
    vatBreakdown: breakdown,
    vatMentions: (i.vatMentions as string[]) ?? [],
    seller: (i.seller as Party | null) ?? null,
    buyer: (i.buyer as Party | null) ?? null,
    lines: i.lines.map((l) => ({
      id: l.id,
      kind: l.kind === 'deduction' ? 'deduction' : 'item',
      description: l.description,
      unit: l.unit,
      quantity: l.quantity.toString(),
      unitPrice: Number(l.unitPrice),
      vatRegime: l.vatRegime,
      budgetLineId: l.budgetLineId,
      netAmount: Number(lineNet(l)),
    })),
    payments: i.payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      receivedOn: isoDate(p.receivedOn)!,
      method: p.method,
      source: p.source,
      reference: p.reference,
      createdAt: p.createdAt.toISOString(),
    })),
    dunning: i.dunning.map((d) => ({
      step: d.step,
      kind: d.kind === 'formal_notice' ? 'formal_notice' : 'reminder',
      daysLate: d.daysLate,
      fee: Number(d.fee),
      interest: Number(d.interest),
      sentTo: d.sentTo,
      sentAt: d.sentAt.toISOString(),
    })),
    remindersPaused: i.remindersPaused,
    creditedInvoice: credited,
    creditNotes: creditNotes.map((c) => ({ ...c, totalGross: Number(c.totalGross) })),
    progressStatement: statement,
    sentTo: i.sentTo,
    sentAt: iso(i.sentAt),
    deliveredAt: iso(i.deliveredAt),
    deliveryMessage: i.deliveryMessage,
    issuedAt: iso(i.issuedAt),
    issueBlockers: i.status === 'draft' ? await issueBlockers(tx, i) : [],
    pdfUrl: i.status === 'draft' ? null : `/api/v1/invoices/${i.id}/pdf`,
    ublUrl: i.status === 'draft' ? null : `/api/v1/invoices/${i.id}/ubl`,
    openPaymentLink: link ? { url: link.url, amount: Number(link.amount) } : null,
  };
}

function toTaxable(l: { quantity: { toString(): string }; unitPrice: bigint; vatRegime: string }) {
  return { quantity: l.quantity.toString(), unitPrice: l.unitPrice, vatRegime: l.vatRegime as VatRegime };
}

/** Raisons pour lesquelles le brouillon ne peut pas encore être émis (messages clairs, avec la solution). */
export async function issueBlockers(
  tx: Tx,
  i: {
    tenantId: string;
    type: string;
    projectId: string | null;
    customerId: string;
    lines: { quantity: { toString(): string }; unitPrice: bigint; vatRegime: string }[];
  },
): Promise<string[]> {
  const out: string[] = [];
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: i.tenantId } });
  if (!tenant.enterpriseNumber && !tenant.vatNumber)
    out.push(
      'Complétez le numéro d’entreprise dans Paramètres → Entreprise : il doit figurer sur la facture.',
    );
  if (!tenant.iban && i.type !== 'credit_note')
    out.push('Ajoutez l’IBAN de l’entreprise dans Paramètres → Entreprise : il figure sur chaque facture.');
  if (!i.lines.length) out.push('Ajoutez au moins une ligne.');
  const totals = computeDocumentTotals(i.lines.map(toTaxable));
  if (i.lines.length && totals.totalNet <= 0n && i.type !== 'credit_note')
    out.push('Le total doit être positif. Pour diminuer une facture émise, faites une note de crédit.');
  const project = i.projectId
    ? await tx.project.findUnique({ where: { id: i.projectId }, select: { quoteId: true } })
    : null;
  const certificate = await tx.vatCertificate.findFirst({
    where: {
      status: 'signed',
      OR: [
        ...(i.projectId ? [{ projectId: i.projectId }] : []),
        ...(project?.quoteId ? [{ quoteId: project.quoteId }] : []),
      ],
    },
  });
  if (
    i.type !== 'credit_note' &&
    vatIssuanceBlockers(i.lines.map(toTaxable), { reducedRateCertificateSigned: Boolean(certificate) }).length
  )
    out.push(
      'TVA à 6 % sans attestation signée : faites signer l’attestation au client sur son portail, ou passez les lignes à 21 %.',
    );
  const customer = await tx.customer.findUniqueOrThrow({ where: { id: i.customerId } });
  if (
    customer.kind === 'company' &&
    !customer.vatNumber &&
    i.lines.some((l) => VAT_REGIMES[l.vatRegime as VatRegime]?.category === 'AE')
  )
    out.push('Autoliquidation : le numéro de TVA du client est obligatoire. Complétez la fiche client.');
  return out;
}

function partyAddress(o: {
  street: string | null;
  postalCode: string | null;
  city: string | null;
}): string | null {
  const a = [o.street, [o.postalCode, o.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return a || null;
}

/** Documents (PDF + UBL) d'une facture émise, construits depuis les données figées. */
export async function invoiceDocuments(
  tx: Tx,
  integrations: Integrations,
  invoiceId: string,
): Promise<{ pdf: Buffer; ubl: string; input: InvoiceDocumentInput }> {
  const i = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      lines: { orderBy: { position: 'asc' } },
      customer: true,
      project: { include: { site: true } },
      tenant: true,
    },
  });
  const t = i.tenant;
  const original = i.creditedInvoiceId
    ? await tx.invoice.findUnique({
        where: { id: i.creditedInvoiceId },
        select: { number: true, issueDate: true },
      })
    : null;
  const site = i.project?.site;
  const input: InvoiceDocumentInput = {
    kind: i.type === 'credit_note' ? 'credit_note' : 'invoice',
    number: i.number ?? 'BROUILLON',
    issueDate: isoDate(i.issueDate) ?? today(),
    dueDate: isoDate(i.dueDate),
    servicePeriod: { start: isoDate(i.servicePeriodStart), end: isoDate(i.servicePeriodEnd) },
    buyerReference: i.project?.number ?? i.customer.displayName.slice(0, 60),
    billingReference: original?.number
      ? { number: original.number, issueDate: isoDate(original.issueDate) }
      : null,
    title: i.title,
    notes: [...((i.vatMentions as string[]) ?? []), ...(i.notes ? [i.notes] : [])],
    seller: {
      name: t.legalName ?? t.name,
      vatNumber: t.vatNumber,
      enterpriseNumber: t.enterpriseNumber,
      street: t.street,
      postalCode: t.postalCode,
      city: t.city,
      country: t.country,
      email: t.email,
      iban: t.iban,
      bic: t.bic,
    },
    buyer: {
      name: i.customer.displayName,
      vatNumber: i.customer.vatNumber,
      enterpriseNumber: i.customer.enterpriseNumber,
      street: i.customer.street,
      postalCode: i.customer.postalCode,
      city: i.customer.city,
      country: i.customer.country,
      email: i.customer.email,
    },
    deliveryAddress: site
      ? { street: site.street, postalCode: site.postalCode, city: site.city, country: 'BE' }
      : null,
    lines: i.lines.map((l) => ({
      description: l.description,
      unit: l.unit,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice,
      vatRegime: l.vatRegime as VatRegime,
    })),
    paymentReference: i.structuredCommunication,
    paymentTerms:
      i.type === 'credit_note'
        ? null
        : `Paiement à ${i.paymentTermsDays} jours${
            i.structuredCommunication ? ' avec la communication structurée' : ''
          }. En cas de retard, des rappels sont envoyés selon nos conditions générales.`,
  };
  let logo: Uint8Array | null = null;
  if (t.logoKey && !t.logoKey.endsWith('.svg'))
    logo = await integrations.storage.get('uploads', t.logoKey).catch(() => null);
  const pdf = await renderInvoicePdf({
    ...input,
    documentLabel: DOCUMENT_LABEL[i.type] ?? 'Facture',
    brandColor: t.brandColor,
    logo,
    retention:
      i.retentionAmount > 0n ? { percent: i.retentionPercent.toString(), amount: i.retentionAmount } : null,
    sellerFooter: [
      t.legalName ?? t.name,
      ...(partyAddress(t) ? [partyAddress(t)!] : []),
      ...(t.vatNumber ? [`TVA ${t.vatNumber}`] : []),
      ...(t.iban ? [`IBAN ${t.iban}`] : []),
      ...(t.legalMentions ? [t.legalMentions] : []),
    ],
  });
  return { pdf, ubl: buildInvoiceUbl(input), input };
}

export const DOCUMENT_LABEL: Record<string, string> = {
  deposit: 'Facture d’acompte',
  progress: 'Facture',
  work_order: 'Facture',
  final: 'Facture finale',
  retention_release: 'Facture',
  free: 'Facture',
  credit_note: 'Note de crédit',
};

function vatMentionsFor(
  lines: { vatRegime: string }[],
  certificateSignedAt: Date | null,
  retention: { percent: string; amount: bigint } | null,
): string[] {
  const out: string[] = [];
  const cats = new Set(lines.map((l) => VAT_REGIMES[l.vatRegime as VatRegime]?.category));
  if (cats.has('AE'))
    out.push(
      'Autoliquidation — TVA due par le cocontractant (article 20, § 1er, de l’arrêté royal n° 1 relatif à la TVA).',
    );
  if (lines.some((l) => l.vatRegime === 'reduced_6'))
    out.push(
      `Taux réduit de 6 % : logement privé de plus de 10 ans, attestation du client${
        certificateSignedAt
          ? ` signée le ${certificateSignedAt.toISOString().slice(0, 10).split('-').reverse().join('/')}`
          : ''
      }.`,
    );
  if (retention && retention.amount > 0n)
    out.push(
      `Retenue de garantie de ${retention.percent.replace('.', ',')} % (${formatEuros(retention.amount)}) payable à la réception définitive.`,
    );
  return out;
}

/**
 * Émission : numéro définitif sans trou (verrou sur la séquence), parties et TVA figées,
 * PDF + UBL rangés dans le compartiment légal avec leur empreinte, événement `invoice.issued`.
 */
export async function issueInvoice(
  tx: Tx,
  integrations: Integrations,
  input: { tenantId: string; invoiceId: string; userId: string | null; actor: EventActor },
): Promise<void> {
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM invoices WHERE id = ${input.invoiceId}::uuid FOR UPDATE`;
  if (!locked[0]) throw notFound('Cette facture');
  const i = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    include: { lines: { orderBy: { position: 'asc' } }, tenant: true, customer: true, project: true },
  });
  if (i.status !== 'draft')
    throw conflict('invoice_issued', 'Cette facture est déjà émise : elle ne se modifie plus.');
  const blockers = await issueBlockers(tx, i);
  if (blockers.length) throw badRequest('invoice_not_ready', blockers[0]!, { blockers });
  const day = today();
  const year = Number(day.slice(0, 4));
  const settings = parseTenantSettings(i.tenant.settings);
  const credit = i.type === 'credit_note';
  const docType = credit ? 'credit_note' : 'invoice';
  const sequence = await nextSequenceValue(tx, i.tenantId, docType, year);
  const number = formatDocumentNumber(settings.numbering[docType], { year, sequence });
  const comm = credit
    ? null
    : buildInvoiceStructuredCommunication({
        tenantPrefix: i.tenant.structuredCommPrefix,
        year,
        sequence: sequence % 100_000,
      }).digits;
  const totals = computeDocumentTotals(i.lines.map(toTaxable));
  const retentionPct =
    !credit && (i.type === 'progress' || i.type === 'final') ? dec(i.retentionPercent.toString()) : dec(0);
  const retention = retentionOf(totals.totalGross, retentionPct);
  const certificate = await tx.vatCertificate.findFirst({
    where: {
      status: 'signed',
      OR: [
        ...(i.projectId ? [{ projectId: i.projectId }] : []),
        ...(i.project?.quoteId ? [{ quoteId: i.project.quoteId }] : []),
      ],
    },
  });
  const t = i.tenant;
  await tx.invoice.update({
    where: { id: i.id },
    data: {
      status: 'issued',
      number,
      issueDate: new Date(`${day}T00:00:00Z`),
      dueDate: credit ? null : new Date(`${addDays(day, i.paymentTermsDays)}T00:00:00Z`),
      structuredCommunication: comm,
      totalNet: totals.totalNet,
      totalVat: totals.totalVat,
      totalGross: totals.totalGross,
      retentionPercent: retentionPct.toString(),
      retentionAmount: retention,
      vatBreakdown: totals.vatBreakdown.map((v) => ({
        category: v.category,
        ratePercent: v.ratePercent,
        taxableAmount: Number(v.taxableAmount),
        taxAmount: Number(v.taxAmount),
      })),
      vatMentions: vatMentionsFor(
        i.lines,
        certificate?.signedAt ?? null,
        retention > 0n ? { percent: retentionPct.toString(), amount: retention } : null,
      ),
      seller: {
        name: t.legalName ?? t.name,
        vatNumber: t.vatNumber,
        enterpriseNumber: t.enterpriseNumber,
        address: partyAddress(t),
        email: t.email,
      },
      buyer: {
        name: i.customer.displayName,
        vatNumber: i.customer.vatNumber,
        enterpriseNumber: i.customer.enterpriseNumber,
        address: partyAddress(i.customer),
        email: i.customer.email,
      },
      issuedAt: new Date(),
      issuedBy: input.userId,
    },
  });
  // Documents légaux immuables (bucket « legal », empreinte en base).
  const docs = await invoiceDocuments(tx, integrations, i.id);
  const base = `t/${i.tenantId}/invoices/${year}/${number.replace(/[^\w.-]/g, '_')}`;
  await integrations.storage.put({
    bucket: 'legal',
    key: `${base}.pdf`,
    body: docs.pdf,
    contentType: 'application/pdf',
  });
  await integrations.storage.put({
    bucket: 'legal',
    key: `${base}.xml`,
    body: Buffer.from(docs.ubl),
    contentType: 'application/xml',
  });
  await tx.invoice.update({
    where: { id: i.id },
    data: {
      pdfKey: `${base}.pdf`,
      pdfSha256: sha256(docs.pdf),
      ublKey: `${base}.xml`,
      ublSha256: sha256(Buffer.from(docs.ubl)),
    },
  });

  if (credit && i.creditedInvoiceId) {
    const o = await tx.invoice.findUniqueOrThrow({ where: { id: i.creditedInvoiceId } });
    const credited = o.amountCredited + totals.totalGross;
    const fully = credited >= o.totalGross - o.retentionAmount;
    await tx.invoice.update({
      where: { id: o.id },
      data: {
        amountCredited: credited,
        ...(fully && o.amountPaid === 0n
          ? { status: 'cancelled' }
          : balanceOf({ ...o, amountCredited: credited }) === 0n
            ? { status: 'paid', paidAt: o.paidAt ?? new Date() }
            : {}),
      },
    });
  }
  if (i.progressStatementId)
    await tx.progressStatement.update({ where: { id: i.progressStatementId }, data: { status: 'invoiced' } });

  await emitEvent(tx, {
    tenantId: i.tenantId,
    type: 'invoice.issued.v1',
    aggregateType: 'invoice',
    aggregateId: i.id,
    payload: { invoiceId: i.id, projectId: i.projectId, type: i.type, number },
    actor: input.actor,
  });
}

/** Paiement enregistré (saisi, ou confirmé par le lien de paiement) : idempotent par identifiant. */
export async function recordPayment(
  tx: Tx,
  input: {
    tenantId: string;
    invoiceId: string;
    id: string;
    amount: bigint;
    receivedOn: string;
    method: 'transfer' | 'bancontact' | 'card' | 'cash' | 'online' | 'other';
    source: 'manual' | 'payment_link';
    reference: string | null;
    externalId?: string | null;
    userId: string | null;
    actor: EventActor;
  },
): Promise<{ created: boolean }> {
  if (await tx.payment.findUnique({ where: { id: input.id } })) return { created: false };
  if (input.externalId && (await tx.payment.findFirst({ where: { externalId: input.externalId } })))
    return { created: false };
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${input.invoiceId}::uuid FOR UPDATE`;
  const i = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!i) throw notFound('Cette facture');
  if (i.type === 'credit_note' || !(OPEN_STATUSES as readonly string[]).includes(i.status))
    throw conflict('invoice_not_open', 'Cette facture n’attend pas de paiement.');
  try {
    validatePayment(input.amount, balanceOf(i));
  } catch (err) {
    throw badRequest('invalid_payment', `${(err as Error).message} Solde : ${formatEuros(balanceOf(i))}.`);
  }
  await tx.payment.create({
    data: {
      id: input.id,
      tenantId: input.tenantId,
      invoiceId: i.id,
      amount: input.amount,
      receivedOn: new Date(`${input.receivedOn}T00:00:00Z`),
      method: input.method,
      source: input.source,
      reference: input.reference,
      externalId: input.externalId ?? null,
      createdBy: input.userId,
    },
  });
  const paid = i.amountPaid + input.amount;
  const state = paymentState({
    totalGross: i.totalGross,
    retentionAmount: i.retentionAmount,
    paid,
    credited: i.amountCredited,
  });
  await tx.invoice.update({
    where: { id: i.id },
    data: {
      amountPaid: paid,
      status: state === 'paid' ? 'paid' : 'partially_paid',
      ...(state === 'paid' ? { paidAt: new Date() } : {}),
    },
  });
  await emitEvent(tx, {
    tenantId: input.tenantId,
    type: 'payment.received.v1',
    aggregateType: 'invoice',
    aggregateId: i.id,
    payload: { paymentId: input.id, invoiceId: i.id, amount: input.amount.toString(), source: input.source },
    actor: input.actor,
  });
  return { created: true };
}

/** Annuler un paiement saisi par erreur (seulement manuel). */
export async function removePayment(tx: Tx, invoiceId: string, paymentId: string): Promise<void> {
  const p = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!p || p.invoiceId !== invoiceId) throw notFound('Ce paiement');
  if (p.source !== 'manual')
    throw conflict(
      'payment_locked',
      'Un paiement en ligne confirmé ne s’annule pas ici : remboursez-le chez le prestataire.',
    );
  const i = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  await tx.payment.delete({ where: { id: p.id } });
  const paid = i.amountPaid - p.amount;
  await tx.invoice.update({
    where: { id: i.id },
    data: {
      amountPaid: paid,
      paidAt: null,
      status: paid > 0n ? 'partially_paid' : i.deliveredAt ? 'delivered' : i.sentAt ? 'sent' : 'issued',
    },
  });
}

// ---------------------------------------------------------------------------
// États d'avancement
// ---------------------------------------------------------------------------

export function approvalRequired(customerKind: string, settingsRaw: unknown): boolean {
  const s = parseTenantSettings(settingsRaw);
  return customerKind === 'company' ? s.progressApprovalB2B : s.progressApprovalB2C;
}

type StatementRow = Awaited<ReturnType<Tx['progressStatement']['findUniqueOrThrow']>> & {
  lines: Awaited<ReturnType<Tx['progressStatementLine']['findUniqueOrThrow']>>[];
};

export async function statementDto(
  tx: Tx,
  st: StatementRow,
  context: { approvalRequired: boolean; taskPercent: Map<string, string> },
): Promise<ProgressStatementDto> {
  const invoice = await tx.invoice.findUnique({
    where: { progressStatementId: st.id },
    select: { id: true, number: true, status: true },
  });
  const pct = (a: bigint, c: bigint) =>
    c === 0n ? '0' : dec(a.toString()).dividedBy(c.toString()).times(100).toDecimalPlaces(2).toString();
  return {
    id: st.id,
    projectId: st.projectId,
    ordinal: st.ordinal,
    status: st.status,
    periodEnd: isoDate(st.periodEnd)!,
    note: st.note,
    contractAmount: Number(st.contractAmount),
    previousAmount: Number(st.previousAmount),
    cumulativeAmount: Number(st.cumulativeAmount),
    periodAmount: Number(st.cumulativeAmount - st.previousAmount),
    cumulativePercent: pct(st.cumulativeAmount, st.contractAmount),
    submittedAt: iso(st.submittedAt),
    approvedAt: iso(st.approvedAt),
    approvedByName: st.approvedByName,
    disputeReason: st.disputeReason,
    invoice,
    approvalRequired: context.approvalRequired,
    lines: st.lines
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        budgetLineId: l.budgetLineId,
        label: l.label,
        contractAmount: Number(l.contractAmount),
        previousAmount: Number(l.previousAmount),
        previousPercent: pct(l.previousAmount, l.contractAmount),
        cumulativeAmount: Number(l.cumulativeAmount),
        cumulativePercent: dec(l.cumulativePercent.toString()).toDecimalPlaces(2).toString(),
        periodAmount: Number(l.cumulativeAmount - l.previousAmount),
        unit: l.unit,
        totalQuantity: l.totalQuantity?.toString() ?? null,
        cumulativeQuantity: l.cumulativeQuantity?.toString() ?? null,
        taskPercent: context.taskPercent.get(l.budgetLineId) ?? '0',
      })),
  };
}
