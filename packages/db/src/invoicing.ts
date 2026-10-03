/**
 * Facturation partagée par l'API, le worker et le seed (03 §10, 02 P7) : contexte d'avancement
 * des postes, acompte à déduire, génération du brouillon de facture d'un état approuvé.
 */
import {
  type Cents,
  computeDocumentTotals,
  dec,
  depositDeduction,
  progressInvoiceLines,
  type RegimeAmount,
  roundHalfAwayFromZero,
  summarizeStatement,
  type VatRegime,
} from '@batimint/domain';
import { randomUUID } from 'node:crypto';
import type { Tx } from './client';
import { loadProjectNumbers } from './projects';

export interface PostContext {
  budgetLineId: string;
  position: number;
  label: string;
  contractAmount: Cents;
  /** Cumul facturé par le dernier état approuvé ou facturé. */
  previousAmount: Cents;
  /** Avancement des tâches du poste (0 → 1). */
  taskProgress: string;
  regimes: RegimeAmount[];
  unit: string | null;
  totalQuantity: string | null;
}

const lineNet = (
  quantity: { toString(): string },
  unitPrice: bigint,
  discount?: { toString(): string } | null,
) => {
  const gross = roundHalfAwayFromZero(dec(quantity.toString()).times(unitPrice.toString()));
  const d = discount ? dec(discount.toString()) : dec(0);
  return d.isZero() ? gross : gross - roundHalfAwayFromZero(dec(gross.toString()).times(d).dividedBy(100));
};

/** Postes du chantier avec contrat, déjà facturé, avancement des tâches, TVA et mesurabilité. */
export async function projectPostContext(
  tx: Tx,
  projectId: string,
  driftThreshold = '10',
): Promise<PostContext[]> {
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, contractAmount: true, quoteId: true },
  });
  const posts = await tx.budgetLine.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
  const numbers = (await loadProjectNumbers(tx, [project], driftThreshold)).get(projectId);
  const progressOf = new Map((numbers?.fin.lines ?? []).map((l) => [l.id, l.progress]));

  // TVA par poste : lignes du devis (sections retenues) et des avenants signés.
  const quote = project.quoteId
    ? await tx.quote.findUnique({ where: { id: project.quoteId }, select: { currentVersionId: true } })
    : null;
  const sections = quote?.currentVersionId
    ? await tx.quoteSection.findMany({
        where: { versionId: quote.currentVersionId, OR: [{ optional: false }, { selected: true }] },
        include: { lines: { where: { kind: 'item' } } },
      })
    : [];
  const sectionByKey = new Map(sections.map((s) => [s.key, s]));
  const coLines = await tx.changeOrderLine.findMany({
    where: { changeOrder: { projectId, status: 'signed' }, budgetLineId: { not: null } },
  });

  const last = await tx.progressStatement.findFirst({
    where: { projectId, status: { in: ['approved', 'invoiced'] } },
    orderBy: { ordinal: 'desc' },
    include: { lines: true },
  });
  const previousOf = new Map((last?.lines ?? []).map((l) => [l.budgetLineId, l.cumulativeAmount]));

  return posts.map((p) => {
    const section = p.quoteSectionKey ? sectionByKey.get(p.quoteSectionKey) : undefined;
    const regimeMap = new Map<VatRegime, Cents>();
    const add = (regime: string, net: Cents) =>
      regimeMap.set(regime as VatRegime, (regimeMap.get(regime as VatRegime) ?? 0n) + net);
    for (const l of section?.lines ?? [])
      add(l.vatRegime, lineNet(l.quantity, l.unitPrice, l.discountPercent));
    const cos = coLines.filter((c) => c.budgetLineId === p.id);
    for (const l of cos) add(l.vatRegime, lineNet(l.quantity, l.unitPrice, l.discountPercent));
    const units = new Set((section?.lines ?? []).map((l) => l.unit));
    const measurable = section && section.lines.length > 0 && units.size === 1 && cos.length === 0;
    return {
      budgetLineId: p.id,
      position: p.position,
      label: p.label,
      contractAmount: p.saleAmount,
      previousAmount: previousOf.get(p.id) ?? 0n,
      taskProgress: (progressOf.get(p.id) ?? dec(0)).toString(),
      regimes: [...regimeMap.entries()].map(([vatRegime, net]) => ({ vatRegime, net })),
      unit: measurable ? [...units][0]! : null,
      totalQuantity: measurable
        ? section.lines.reduce((s, l) => s.plus(dec(l.quantity.toString())), dec(0)).toString()
        : null,
    };
  });
}

export interface DepositContext {
  deposit: RegimeAmount[];
  alreadyDeducted: RegimeAmount[];
  numbers: string[];
}

/** Acompte(s) émis du chantier et ce qui en a déjà été déduit (lignes « deduction »). */
export async function projectDepositContext(tx: Tx, projectId: string): Promise<DepositContext> {
  const issued = ['issued', 'sent', 'delivered', 'partially_paid', 'paid'] as const;
  const deposits = await tx.invoice.findMany({
    where: { projectId, type: 'deposit', status: { in: [...issued] } },
    include: { lines: true },
    orderBy: { issueDate: 'asc' },
  });
  const deducted = await tx.invoiceLine.findMany({
    where: {
      kind: 'deduction',
      invoice: { projectId, type: { in: ['progress', 'final'] }, status: { in: [...issued, 'cancelled'] } },
    },
  });
  const sum = (rows: { vatRegime: string; net: Cents }[]) => {
    const m = new Map<VatRegime, Cents>();
    for (const r of rows) m.set(r.vatRegime as VatRegime, (m.get(r.vatRegime as VatRegime) ?? 0n) + r.net);
    return [...m.entries()].map(([vatRegime, net]) => ({ vatRegime, net }));
  };
  return {
    deposit: sum(
      deposits.flatMap((d) =>
        d.lines.map((l) => ({ vatRegime: l.vatRegime, net: lineNet(l.quantity, l.unitPrice) })),
      ),
    ),
    alreadyDeducted: sum(deducted.map((l) => ({ vatRegime: l.vatRegime, net: l.unitPrice }))),
    numbers: deposits.flatMap((d) => (d.number ? [d.number] : [])),
  };
}

const percentLabel = (amount: Cents, contract: Cents) =>
  contract === 0n
    ? '0 %'
    : `${dec(amount.toString()).dividedBy(contract.toString()).times(100).toDecimalPlaces(1).toString().replace('.', ',')} %`;

/**
 * Brouillon de facture d'un état d'avancement approuvé (idempotent : une facture par état).
 * La facture déduit l'acompte au prorata (ou son solde si l'état atteint 100 %).
 */
export async function createProgressInvoiceDraft(
  tx: Tx,
  statementId: string,
  createdBy: string | null,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.invoice.findUnique({ where: { progressStatementId: statementId } });
  if (existing) return { id: existing.id, created: false };
  const st = await tx.progressStatement.findUniqueOrThrow({
    where: { id: statementId },
    include: { lines: { orderBy: { position: 'asc' } }, project: { include: { customer: true } } },
  });
  const summary = summarizeStatement(st.lines);
  const posts = await projectPostContext(tx, st.projectId);
  const regimesOf = new Map(posts.map((p) => [p.budgetLineId, p.regimes]));
  const deposit = await projectDepositContext(tx, st.projectId);
  const final = summary.contractAmount > 0n && summary.cumulativeAmount >= summary.contractAmount;
  const deduction = depositDeduction({
    deposit: deposit.deposit,
    alreadyDeducted: deposit.alreadyDeducted,
    periodAmount: summary.periodAmount,
    contractAmount: summary.contractAmount,
    final,
  });
  const lines = progressInvoiceLines({
    posts: st.lines.map((l) => ({
      budgetLineId: l.budgetLineId,
      label: l.label,
      periodAmount: l.cumulativeAmount - l.previousAmount,
      cumulativeRatio: dec(l.cumulativePercent.toString()).dividedBy(100),
      regimes: regimesOf.get(l.budgetLineId) ?? [],
    })),
    deduction,
    depositLabel: `Déduction de l’acompte${deposit.numbers.length ? ` (facture ${deposit.numbers.join(', ')})` : ''}`,
  });
  const totals = computeDocumentTotals(lines);
  const previous = await tx.progressStatement.findFirst({
    where: { projectId: st.projectId, ordinal: { lt: st.ordinal } },
    orderBy: { ordinal: 'desc' },
  });
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: st.tenantId },
    select: { settings: true },
  });
  const terms = Number((tenant.settings as { paymentTermsDays?: number } | null)?.paymentTermsDays ?? 30);
  const start = previous
    ? new Date(previous.periodEnd.getTime() + 86_400_000)
    : (st.project.startDate ?? null);
  const invoice = await tx.invoice.create({
    data: {
      tenantId: st.tenantId,
      projectId: st.projectId,
      customerId: st.project.customerId,
      // L'état qui atteint 100 % du contrat produit la facture finale (solde, acompte entièrement déduit).
      type: final ? 'final' : 'progress',
      status: 'draft',
      title: final
        ? `Facture finale — ${st.project.name}`
        : `État d’avancement n°${st.ordinal} — ${percentLabel(summary.cumulativeAmount, summary.contractAmount)}`,
      progressStatementId: st.id,
      servicePeriodStart: start,
      servicePeriodEnd: st.periodEnd,
      paymentTermsDays: Number.isFinite(terms) ? terms : 30,
      retentionPercent: st.project.retentionPercent,
      totalNet: totals.totalNet,
      totalVat: totals.totalVat,
      totalGross: totals.totalGross,
      createdBy,
      lines: {
        create: lines.map((l, position) => ({
          tenantId: st.tenantId,
          position,
          kind: l.kind,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRegime: l.vatRegime,
          budgetLineId: l.budgetLineId,
        })),
      },
    },
  });
  return { id: invoice.id, created: true };
}

/**
 * Facture finale (P10.2) : un état de clôture porte chaque poste à 100 % du contrat (devis +
 * avenants) ; la facture facture le solde, déduit ce qui reste de l'acompte. Idempotent : une
 * facture finale existante (non annulée) est renvoyée telle quelle.
 */
export async function createFinalInvoiceDraft(
  tx: Tx,
  projectId: string,
  createdBy: string | null,
): Promise<{ id: string; created: boolean } | null> {
  const existing = await tx.invoice.findFirst({
    where: { projectId, type: 'final', status: { not: 'cancelled' } },
  });
  if (existing) return { id: existing.id, created: false };
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  const posts = await projectPostContext(tx, projectId);
  const remaining = posts.reduce((s, p) => s + (p.contractAmount - p.previousAmount), 0n);
  if (remaining <= 0n) return null;
  const last = await tx.progressStatement.findFirst({ where: { projectId }, orderBy: { ordinal: 'desc' } });
  // Un état en cours (brouillon, soumis) est remplacé par l'état de clôture.
  if (last && ['draft', 'submitted', 'disputed'].includes(last.status))
    await tx.progressStatement.delete({ where: { id: last.id } });
  const ordinal =
    ((await tx.progressStatement.findFirst({ where: { projectId }, orderBy: { ordinal: 'desc' } }))
      ?.ordinal ?? 0) + 1;
  const contract = posts.reduce((s, p) => s + p.contractAmount, 0n);
  const previous = posts.reduce((s, p) => s + p.previousAmount, 0n);
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const st = await tx.progressStatement.create({
    data: {
      id: randomUUID(),
      tenantId: project.tenantId,
      projectId,
      ordinal,
      status: 'approved',
      periodEnd: today,
      contractAmount: contract,
      previousAmount: previous,
      cumulativeAmount: contract,
      approvedAt: new Date(),
      approvedByName: 'Réception des travaux',
      createdBy,
      lines: {
        create: posts.map((p, position) => ({
          tenantId: project.tenantId,
          budgetLineId: p.budgetLineId,
          position,
          label: p.label,
          contractAmount: p.contractAmount,
          previousAmount: p.previousAmount,
          cumulativeAmount: p.contractAmount,
          cumulativePercent: '100',
          unit: p.unit,
          totalQuantity: p.totalQuantity,
          cumulativeQuantity: p.totalQuantity,
        })),
      },
    },
  });
  return createProgressInvoiceDraft(tx, st.id, createdBy);
}
