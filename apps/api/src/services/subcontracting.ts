/**
 * Sous-traitance (03 §9, 05 §7, 02 P9) : DTO, conformité documentaire, consultation 30bis et
 * contrôle avant paiement des factures de sous-traitants.
 */
import {
  parseTenantSettings,
  type SubcontractDto,
  type SubcontractorDocumentDto,
  type SubcontractSummaryDto,
  type ThirtyBisCheckDto,
} from '@batimint/contracts';
import {
  recordThirtyBisCheck,
  subcontractTotals,
  THIRTY_BIS_CONTEXT_LABEL,
  type ThirtyBisContext,
  type ThirtyBisPorts,
  type Tx,
} from '@batimint/db';
import { renderThirtyBisProofPdf, renderThirtyBisTransferPdf, sha256 } from '@batimint/documents';
import {
  brusselsDate,
  documentCompliance,
  documentValidity,
  hasThirtyBisDebt,
  type IsoDate,
  isThirtyBisCheckFresh,
  type SubcontractorDocumentKind,
  thirtyBisWithholding,
} from '@batimint/domain';
import type { AppDeps } from '../context';
import { iso, isoDate } from '../lib/tenant';

type CheckRow = Awaited<ReturnType<Tx['thirtyBisCheck']['findUniqueOrThrow']>>;
type DocRow = Awaited<ReturnType<Tx['subcontractorDocument']['findUniqueOrThrow']>>;

export function thirtyBisPorts(deps: AppDeps): ThirtyBisPorts {
  return {
    provider: deps.integrations.thirtyBis.provider,
    check: (n) => deps.integrations.thirtyBis.check(n),
    saveProof: async (key, pdf) => {
      await deps.integrations.storage.put({
        bucket: 'legal',
        key,
        body: pdf,
        contentType: 'application/pdf',
      });
    },
    renderProof: (input) => renderThirtyBisProofPdf(input),
  };
}

export function thirtyBisPolicyOf(settings: unknown) {
  const s = parseTenantSettings(settings);
  return {
    policy: { socialPercent: s.thirtyBisSocialPercent, taxPercent: s.thirtyBisTaxPercent },
    required: s.requiredSubcontractorDocuments as SubcontractorDocumentKind[],
  };
}

export function checkDto(
  c: CheckRow,
  refs: { subcontractNumber?: string | null; supplierInvoiceNumber?: string | null } = {},
): ThirtyBisCheckDto {
  return {
    id: c.id,
    context: c.context as ThirtyBisCheckDto['context'],
    enterpriseNumber: c.enterpriseNumber,
    hasSocialDebt: c.hasSocialDebt,
    hasTaxDebt: c.hasTaxDebt,
    socialDebtAmount: c.socialDebtAmount === null ? null : Number(c.socialDebtAmount),
    taxDebtAmount: c.taxDebtAmount === null ? null : Number(c.taxDebtAmount),
    provider: c.provider,
    reference: c.reference,
    checkedAt: c.checkedAt.toISOString(),
    proofUrl: `/api/v1/thirty-bis-checks/${c.id}/proof`,
    subcontractNumber: refs.subcontractNumber ?? null,
    supplierInvoiceNumber: refs.supplierInvoiceNumber ?? null,
  };
}

export function documentDto(d: DocRow, today: IsoDate, urlBase = '/api/v1'): SubcontractorDocumentDto {
  const expiresOn = isoDate(d.expiresOn);
  return {
    id: d.id,
    kind: d.kind as SubcontractorDocumentKind,
    label: d.label,
    expiresOn,
    status: documentValidity(expiresOn, today),
    fileName: d.fileName,
    contentType: d.contentType,
    size: d.size,
    source: d.source as 'office' | 'portal',
    url: `${urlBase}/subcontractor-documents/${d.id}/file`,
    createdAt: d.createdAt.toISOString(),
  };
}

export function complianceOf(docs: DocRow[], today: IsoDate, required: SubcontractorDocumentKind[]) {
  return documentCompliance(
    docs.map((d) => ({
      id: d.id,
      kind: d.kind as SubcontractorDocumentKind,
      expiresOn: isoDate(d.expiresOn),
    })),
    today,
    required,
  );
}

export const SUBCONTRACT_INCLUDE = {
  project: { select: { id: true, number: true, name: true } },
  supplier: { select: { id: true, name: true, enterpriseNumber: true, email: true } },
};

type SubcontractRow = Awaited<ReturnType<Tx['subcontract']['findUniqueOrThrow']>> & {
  project: { id: string; number: string; name: string };
  supplier: { id: string; name: string; enterpriseNumber: string | null; email: string | null };
};

/** DTO des contrats, en lot (postes, totaux, consultations, conformité du sous-traitant). */
export async function subcontractSummaries(tx: Tx, rows: SubcontractRow[]): Promise<SubcontractSummaryDto[]> {
  if (!rows.length) return [];
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: rows[0]!.tenantId } });
  const { required } = thirtyBisPolicyOf(tenant.settings);
  const today = brusselsDate(new Date());
  const ids = rows.map((r) => r.id);
  const supplierIds = [...new Set(rows.map((r) => r.supplierId))];
  const [posts, totals, checks, docs] = await Promise.all([
    tx.budgetLine.findMany({
      where: { id: { in: rows.flatMap((r) => (r.budgetLineId ? [r.budgetLineId] : [])) } },
      select: { id: true, label: true },
    }),
    subcontractTotals(tx, ids),
    tx.thirtyBisCheck.findMany({
      where: { supplierId: { in: supplierIds } },
      orderBy: { checkedAt: 'desc' },
    }),
    tx.subcontractorDocument.findMany({ where: { supplierId: { in: supplierIds } } }),
  ]);
  const postLabel = new Map(posts.map((p) => [p.id, p.label]));
  return rows.map((r) => {
    const creation = checks.find((c) => c.id === r.creationCheckId) ?? null;
    const last = checks.find((c) => c.supplierId === r.supplierId) ?? null;
    const t = totals.get(r.id) ?? { invoiced: 0n, withheld: 0n };
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      title: r.title,
      scope: r.scope,
      amount: Number(r.amount),
      startDate: isoDate(r.startDate),
      endDate: isoDate(r.endDate),
      project: r.project,
      budgetLine: r.budgetLineId ? { id: r.budgetLineId, label: postLabel.get(r.budgetLineId) ?? '—' } : null,
      supplier: r.supplier,
      invoiced: Number(t.invoiced),
      withheld: Number(t.withheld),
      creationCheck: creation ? checkDto(creation, { subcontractNumber: r.number }) : null,
      lastCheck: last ? checkDto(last) : null,
      compliance: complianceOf(
        docs.filter((d) => d.supplierId === r.supplierId),
        today,
        required,
      ),
      pdfUrl: `/api/v1/subcontracts/${r.id}/pdf`,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function subcontractDto(tx: Tx, row: SubcontractRow): Promise<SubcontractDto> {
  const [summary] = await subcontractSummaries(tx, [row]);
  const invoices = await tx.supplierInvoice.findMany({
    where: { subcontractId: row.id },
    orderBy: { receivedAt: 'desc' },
  });
  return {
    ...summary!,
    installments: (row.installments as SubcontractDto['installments']) ?? [],
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      totalNet: Number(i.totalNet),
      totalGross: Number(i.totalGross),
      withholding: Number(i.withholdingAppliedAt ? i.withholdingSocial + i.withholdingTax : 0n),
      receivedAt: i.receivedAt.toISOString(),
    })),
  };
}

/** Bloc 30bis d'une facture fournisseur (null si ce n'est pas un sous-traitant). */
export async function invoiceThirtyBis(
  tx: Tx,
  i: {
    id: string;
    supplierId: string | null;
    subcontractId: string | null;
    thirtyBisCheckId: string | null;
    totalGross: bigint;
    withholdingSocial: bigint;
    withholdingTax: bigint;
    withholdingAppliedAt: Date | null;
    transferDocKey: string | null;
    blockedReason: string | null;
  },
) {
  const supplier = i.supplierId
    ? await tx.supplier.findUnique({ where: { id: i.supplierId }, select: { isSubcontractor: true } })
    : null;
  const isSubcontractor = Boolean(i.subcontractId || supplier?.isSubcontractor);
  const subcontract = i.subcontractId
    ? await tx.subcontract.findUnique({ where: { id: i.subcontractId }, select: { id: true, number: true } })
    : null;
  if (!isSubcontractor) return { isSubcontractor, subcontract, thirtyBis: null };
  const check = i.thirtyBisCheckId
    ? await tx.thirtyBisCheck.findUnique({ where: { id: i.thirtyBisCheckId } })
    : null;
  const total = i.withholdingSocial + i.withholdingTax;
  return {
    isSubcontractor,
    subcontract,
    thirtyBis: {
      check: check ? checkDto(check) : null,
      social: Number(i.withholdingSocial),
      tax: Number(i.withholdingTax),
      payableToSubcontractor: Number(i.totalGross - total),
      appliedAt: iso(i.withholdingAppliedAt),
      transferDocumentUrl: i.transferDocKey ? `/api/v1/supplier-invoices/${i.id}/transfer-document` : null,
      blockedReason: i.blockedReason,
    },
  };
}

export type PaymentGate =
  | { ok: true; checkId: string; social: bigint; tax: bigint }
  | { ok: false; checkId: string; social: bigint; tax: bigint; reason: string };

/**
 * Contrôle 30bis avant paiement (05 §7) : une consultation du jour (sinon une nouvelle).
 * Sans dette : le paiement suit son cours (une retenue antérieure est levée). Avec dette : la
 * retenue est calculée ; tant qu'elle n'est pas appliquée, le paiement normal est bloqué.
 */
export async function thirtyBisPaymentGate(
  deps: AppDeps,
  tx: Tx,
  invoiceId: string,
  user: { userId: string | null; label: string | null },
): Promise<PaymentGate | null> {
  const i = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const supplier = i.supplierId ? await tx.supplier.findUnique({ where: { id: i.supplierId } }) : null;
  if (!supplier || !(i.subcontractId || supplier.isSubcontractor)) return null;
  const today = brusselsDate(new Date());
  let check = await tx.thirtyBisCheck.findFirst({
    where: { supplierInvoiceId: i.id, context: 'payment' },
    orderBy: { checkedAt: 'desc' },
  });
  if (!check || !isThirtyBisCheckFresh(brusselsDate(check.checkedAt), today))
    check = await recordThirtyBisCheck(tx, thirtyBisPorts(deps), {
      tenantId: i.tenantId,
      supplierId: supplier.id,
      context: 'payment',
      subcontractId: i.subcontractId,
      supplierInvoiceId: i.id,
      userId: user.userId,
      actorLabel: user.label,
    });
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: i.tenantId } });
  const w = thirtyBisWithholding(
    { net: i.totalNet > 0n ? i.totalNet : 0n, gross: i.totalGross > 0n ? i.totalGross : 0n, check },
    thirtyBisPolicyOf(tenant.settings).policy,
  );
  if (!hasThirtyBisDebt(check)) {
    await tx.supplierInvoice.update({
      where: { id: i.id },
      data: {
        thirtyBisCheckId: check.id,
        withholdingSocial: 0n,
        withholdingTax: 0n,
        withholdingAppliedAt: null,
        blockedReason: null,
      },
    });
    return { ok: true, checkId: check.id, social: 0n, tax: 0n };
  }
  const applied =
    i.withholdingAppliedAt !== null && i.withholdingSocial === w.social && i.withholdingTax === w.tax;
  await tx.supplierInvoice.update({
    where: { id: i.id },
    data: {
      thirtyBisCheckId: check.id,
      withholdingSocial: w.social,
      withholdingTax: w.tax,
      ...(applied ? { blockedReason: null } : { withholdingAppliedAt: null }),
    },
  });
  if (applied) return { ok: true, checkId: check.id, social: w.social, tax: w.tax };
  const kinds = [check.hasSocialDebt && 'sociales', check.hasTaxDebt && 'fiscales']
    .filter(Boolean)
    .join(' et ');
  return {
    ok: false,
    checkId: check.id,
    social: w.social,
    tax: w.tax,
    reason: `${supplier.name} a des dettes ${kinds} : retenue 30bis à verser aux administrations avant de payer le solde.`,
  };
}

/** Document de versement de la retenue (compartiment légal, empreinte). */
export async function storeTransferDocument(deps: AppDeps, tx: Tx, invoiceId: string) {
  const i = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const [tenant, supplier, check, subcontract] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: i.tenantId } }),
    tx.supplier.findUniqueOrThrow({ where: { id: i.supplierId! } }),
    tx.thirtyBisCheck.findUniqueOrThrow({ where: { id: i.thirtyBisCheckId! } }),
    i.subcontractId
      ? tx.subcontract.findUnique({ where: { id: i.subcontractId }, include: { project: true } })
      : null,
  ]);
  const { policy } = thirtyBisPolicyOf(tenant.settings);
  const pdf = await renderThirtyBisTransferPdf({
    tenant: {
      name: tenant.legalName ?? tenant.name,
      lines: [tenant.enterpriseNumber ? `BCE ${tenant.enterpriseNumber}` : null].filter((x): x is string =>
        Boolean(x),
      ),
      brandColor: tenant.brandColor,
      enterpriseNumber: tenant.enterpriseNumber,
    },
    subcontractor: { name: supplier.name, enterpriseNumber: check.enterpriseNumber, iban: supplier.iban },
    invoice: {
      number: i.number,
      issueDate: i.issueDate,
      net: i.totalNet,
      vat: i.totalVat,
      gross: i.totalGross,
    },
    subcontractNumber: subcontract?.number ?? null,
    projectLabel: subcontract ? `${subcontract.project.number} — ${subcontract.project.name}` : null,
    date: new Date(),
    check: { reference: check.reference, checkedAt: check.checkedAt },
    social: i.withholdingSocial,
    tax: i.withholdingTax,
    socialPercent: policy.socialPercent,
    taxPercent: policy.taxPercent,
    payableToSubcontractor: i.totalGross - i.withholdingSocial - i.withholdingTax,
  });
  const key = `t/${i.tenantId}/supplier-invoices/${i.id}/retenue-30bis-${check.id}.pdf`;
  await deps.integrations.storage.put({ bucket: 'legal', key, body: pdf, contentType: 'application/pdf' });
  return { key, sha256: sha256(pdf) };
}

/**
 * Preuve d'une consultation : le PDF archivé, ou (consultation importée sans document) rendu à
 * partir du résultat enregistré, puis archivé avec son empreinte.
 */
export async function ensureThirtyBisProof(deps: AppDeps, tx: Tx, checkId: string): Promise<string | null> {
  const c = await tx.thirtyBisCheck.findUnique({ where: { id: checkId } });
  if (!c) return null;
  if (c.proofKey) return c.proofKey;
  const [tenant, supplier, user] = await Promise.all([
    tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
    c.supplierId ? tx.supplier.findUnique({ where: { id: c.supplierId } }) : null,
    c.createdBy ? tx.user.findUnique({ where: { id: c.createdBy }, select: { name: true } }) : null,
  ]);
  const pdf = await renderThirtyBisProofPdf({
    tenant: {
      name: tenant.legalName ?? tenant.name,
      lines: tenant.enterpriseNumber ? [`BCE ${tenant.enterpriseNumber}`] : [],
      brandColor: tenant.brandColor,
    },
    subcontractor: { name: supplier?.name ?? '—', enterpriseNumber: c.enterpriseNumber },
    checkedAt: c.checkedAt,
    reference: c.reference,
    service: c.provider === 'mock' ? 'Simulation ONSS / SPF Finances (mock)' : c.provider,
    context: THIRTY_BIS_CONTEXT_LABEL[c.context as ThirtyBisContext] ?? c.context,
    hasSocialDebt: c.hasSocialDebt,
    hasTaxDebt: c.hasTaxDebt,
    socialDebtAmount: c.socialDebtAmount,
    taxDebtAmount: c.taxDebtAmount,
    checkedBy: user?.name ?? null,
  });
  const key = `t/${c.tenantId}/thirty-bis/${c.id}.pdf`;
  await deps.integrations.storage.put({ bucket: 'legal', key, body: pdf, contentType: 'application/pdf' });
  await tx.thirtyBisCheck.update({ where: { id: c.id }, data: { proofKey: key, proofSha256: sha256(pdf) } });
  return key;
}
