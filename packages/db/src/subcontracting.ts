/**
 * Sous-traitance partagée par l'API, le worker et le seed (03 §9, 05 §7) : consultation 30bis
 * avec preuve conservée, montant facturé par contrat.
 */
import { createHash } from 'node:crypto';
import type { Tx } from './client';

export const THIRTY_BIS_CONTEXT_LABEL = {
  contract: 'Conclusion du contrat',
  invoice_received: 'Réception de la facture',
  payment: 'Avant paiement',
  manual: 'Consultation manuelle',
} as const;
export type ThirtyBisContext = keyof typeof THIRTY_BIS_CONTEXT_LABEL;

export interface ThirtyBisOutcome {
  enterpriseNumber: string;
  hasSocialDebt: boolean;
  hasTaxDebt: boolean;
  socialDebtAmount: bigint | null;
  taxDebtAmount: bigint | null;
  checkedAt: Date;
  proof: { reference: string; service: string; response: Record<string, unknown> };
}

/** Dépendances injectées (adaptateur 30bis, stockage légal, rendu PDF de la preuve). */
export interface ThirtyBisPorts {
  provider: string;
  check(enterpriseNumber: string): Promise<ThirtyBisOutcome>;
  saveProof(key: string, pdf: Buffer): Promise<void>;
  renderProof(input: {
    tenant: { name: string; lines: string[]; brandColor: string | null };
    subcontractor: { name: string; enterpriseNumber: string };
    checkedAt: Date;
    reference: string;
    service: string;
    context: string;
    hasSocialDebt: boolean;
    hasTaxDebt: boolean;
    socialDebtAmount: bigint | null;
    taxDebtAmount: bigint | null;
    checkedBy: string | null;
  }): Promise<Buffer>;
}

export class ThirtyBisUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThirtyBisUnavailableError';
  }
}

/**
 * Consulte les dettes du sous-traitant et conserve la preuve (PDF dans le compartiment légal,
 * empreinte SHA-256, ligne immuable). Sans numéro d'entreprise, la consultation est impossible.
 */
export async function recordThirtyBisCheck(
  tx: Tx,
  ports: ThirtyBisPorts,
  input: {
    tenantId: string;
    supplierId: string;
    context: ThirtyBisContext;
    subcontractId?: string | null;
    supplierInvoiceId?: string | null;
    userId?: string | null;
    actorLabel?: string | null;
  },
) {
  const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: input.supplierId } });
  if (!supplier.enterpriseNumber)
    throw new ThirtyBisUnavailableError(
      `Ajoutez le numéro d’entreprise de ${supplier.name} pour consulter ses dettes sociales et fiscales.`,
    );
  const r = await ports.check(supplier.enterpriseNumber);
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });
  const row = await tx.thirtyBisCheck.create({
    data: {
      tenantId: input.tenantId,
      supplierId: supplier.id,
      subcontractId: input.subcontractId ?? null,
      supplierInvoiceId: input.supplierInvoiceId ?? null,
      context: input.context,
      enterpriseNumber: r.enterpriseNumber,
      hasSocialDebt: r.hasSocialDebt,
      hasTaxDebt: r.hasTaxDebt,
      socialDebtAmount: r.socialDebtAmount,
      taxDebtAmount: r.taxDebtAmount,
      provider: ports.provider,
      reference: r.proof.reference,
      response: JSON.parse(JSON.stringify(r.proof.response)),
      checkedAt: r.checkedAt,
      createdBy: input.userId ?? null,
    },
  });
  const pdf = await ports.renderProof({
    tenant: {
      name: tenant.legalName ?? tenant.name,
      lines: [
        tenant.enterpriseNumber ? `BCE ${tenant.enterpriseNumber}` : null,
        [tenant.street, [tenant.postalCode, tenant.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ') || null,
      ].filter((x): x is string => Boolean(x)),
      brandColor: tenant.brandColor,
    },
    subcontractor: { name: supplier.name, enterpriseNumber: r.enterpriseNumber },
    checkedAt: r.checkedAt,
    reference: r.proof.reference,
    service: r.proof.service,
    context: THIRTY_BIS_CONTEXT_LABEL[input.context],
    hasSocialDebt: r.hasSocialDebt,
    hasTaxDebt: r.hasTaxDebt,
    socialDebtAmount: r.socialDebtAmount,
    taxDebtAmount: r.taxDebtAmount,
    checkedBy: input.actorLabel ?? null,
  });
  const key = `t/${input.tenantId}/thirty-bis/${row.id}.pdf`;
  await ports.saveProof(key, pdf);
  return tx.thirtyBisCheck.update({
    where: { id: row.id },
    data: { proofKey: key, proofSha256: createHash('sha256').update(pdf).digest('hex') },
  });
}

/** Statuts d'une facture fournisseur qui compte comme « facturée » sur le contrat. */
export const SUBCONTRACT_INVOICED_STATUSES = ['allocated', 'validated', 'to_pay', 'blocked', 'paid'] as const;

/** Montant HTVA facturé et retenues appliquées, par contrat. */
export async function subcontractTotals(
  tx: Tx,
  subcontractIds: string[],
): Promise<Map<string, { invoiced: bigint; withheld: bigint }>> {
  const map = new Map<string, { invoiced: bigint; withheld: bigint }>();
  if (!subcontractIds.length) return map;
  const rows = await tx.supplierInvoice.findMany({
    where: { subcontractId: { in: subcontractIds }, status: { in: [...SUBCONTRACT_INVOICED_STATUSES] } },
    select: {
      subcontractId: true,
      totalNet: true,
      withholdingSocial: true,
      withholdingTax: true,
      withholdingAppliedAt: true,
    },
  });
  for (const r of rows) {
    const cur = map.get(r.subcontractId!) ?? { invoiced: 0n, withheld: 0n };
    cur.invoiced += r.totalNet;
    if (r.withholdingAppliedAt) cur.withheld += r.withholdingSocial + r.withholdingTax;
    map.set(r.subcontractId!, cur);
  }
  return map;
}
