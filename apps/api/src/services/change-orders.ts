/**
 * Avenants (03 §5, 02 P5) : lignes propres, calcul identique au devis (`computeChangeOrder`),
 * PDF et signature. Un avenant envoyé ne se modifie plus : on le retire (retour en brouillon)
 * ou on en crée un autre ; signé, il est immuable.
 */
import type { ChangeOrderUpdateSchema } from '@batimint/contracts';
import type { Tx } from '@batimint/db';
import { renderChangeOrderPdf } from '@batimint/documents';
import {
  can,
  type ChangeOrderLineInput,
  changeOrderTargetKey,
  computeChangeOrder,
  type Role,
  shiftEndDate,
  type VatRegime,
} from '@batimint/domain';
import type { Integrations } from '@batimint/integrations';
import { v7 as uuidv7 } from 'uuid';
import type { z } from 'zod';
import { badRequest, conflict, notFound } from '../lib/errors';
import { iso, isoDate } from '../lib/tenant';
import { projectVatRegime } from './projects';
import { addressLines } from './quotes';

export function loadChangeOrder(tx: Tx, id: string) {
  return tx.changeOrder.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: 'asc' } }, project: { include: { customer: true } } },
  });
}
type CoRow = NonNullable<Awaited<ReturnType<typeof loadChangeOrder>>>;

export function coLineInputs(lines: CoRow['lines']): ChangeOrderLineInput[] {
  return lines.map((l) => ({
    id: l.id,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity.toString(),
    unitPrice: l.unitPrice,
    unitCost: l.unitCost,
    laborHours: l.laborHours.toString(),
    vatRegime: l.vatRegime as VatRegime,
    discountPercent: l.discountPercent?.toString() ?? '0',
    budgetLineId: l.budgetLineId,
    newPostLabel: l.newPostLabel,
  }));
}

export async function changeOrderDto(tx: Tx, id: string, role: Role) {
  const co = await loadChangeOrder(tx, id);
  if (!co) throw notFound('Cet avenant');
  const totals = computeChangeOrder(coLineInputs(co.lines));
  const net = new Map(totals.lines.map((l) => [l.id, l.netAmount]));
  const withCosts = can(role, 'pricing.read');
  const signature = co.signatureId ? await tx.signature.findUnique({ where: { id: co.signatureId } }) : null;
  const openQuestions = await tx.comment.count({
    where: {
      subjectType: 'change_order',
      subjectId: co.id,
      authorPortalToken: { not: null },
      resolvedAt: null,
      deletedAt: null,
    },
  });
  return {
    ...summaryOf(co, openQuestions),
    description: co.description,
    revision: co.revision,
    totalVat: Number(co.totalVat),
    ...(withCosts
      ? {
          totalCost: Number(totals.totalCost),
          marginRate: totals.marginRate?.toDecimalPlaces(4).toString() ?? null,
        }
      : {}),
    laborHours: totals.laborHours.toDecimalPlaces(2).toString(),
    vatBreakdown: totals.document.vatBreakdown.map((v) => ({
      category: v.category,
      ratePercent: v.ratePercent,
      regimes: v.regimes,
      taxableAmount: Number(v.taxableAmount),
      taxAmount: Number(v.taxAmount),
    })),
    sentTo: co.sentTo,
    refusalReason: co.refusalReason,
    signature: signature
      ? { signerName: signature.signerName, signedAt: signature.signedAt.toISOString() }
      : null,
    lines: co.lines.map((l) => ({
      id: l.id,
      budgetLineId: l.budgetLineId,
      newPostLabel: l.newPostLabel,
      itemId: l.itemId,
      code: l.code,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity.toString(),
      unitPrice: Number(l.unitPrice),
      ...(withCosts ? { unitCost: Number(l.unitCost) } : {}),
      laborHours: l.laborHours.toString(),
      discountPercent: l.discountPercent?.toString() ?? '0',
      vatRegime: l.vatRegime as VatRegime,
      netAmount: Number(net.get(l.id) ?? 0n),
    })),
    project: {
      id: co.project.id,
      number: co.project.number,
      name: co.project.name,
      customerEmail: co.project.customer.email,
      endDate: isoDate(co.project.endDate),
      defaultVatRegime: await projectVatRegime(tx, co.project),
    },
  };
}

export function summaryOf(
  co: Pick<
    CoRow,
    | 'id'
    | 'projectId'
    | 'ordinal'
    | 'number'
    | 'title'
    | 'status'
    | 'delayDays'
    | 'totalNet'
    | 'totalGross'
    | 'sentAt'
    | 'signedAt'
    | 'refusedAt'
    | 'createdAt'
  >,
  openQuestions = 0,
) {
  return {
    id: co.id,
    projectId: co.projectId,
    ordinal: co.ordinal,
    number: co.number,
    title: co.title,
    status: co.status,
    delayDays: co.delayDays,
    totalNet: Number(co.totalNet),
    totalGross: Number(co.totalGross),
    sentAt: iso(co.sentAt),
    signedAt: iso(co.signedAt),
    refusedAt: iso(co.refusedAt),
    openQuestions,
    createdAt: co.createdAt.toISOString(),
  };
}

type LinesInput = z.infer<typeof ChangeOrderUpdateSchema>['lines'];

/** Remplace les lignes d'un avenant en brouillon et recalcule ses totaux. */
export async function writeChangeOrderLines(
  tx: Tx,
  co: { id: string; tenantId: string; projectId: string },
  lines: LinesInput,
  role: Role,
): Promise<void> {
  const postIds = [...new Set(lines.map((l) => l.budgetLineId).filter((x): x is string => Boolean(x)))];
  if (postIds.length) {
    const found = await tx.budgetLine.count({ where: { id: { in: postIds }, projectId: co.projectId } });
    if (found !== postIds.length) throw badRequest('invalid_post', 'Un poste de cet avenant n’existe plus.');
  }
  for (const l of lines)
    if (!l.budgetLineId && !l.newPostLabel)
      throw badRequest('post_required', 'Choisissez le poste concerné ou nommez le nouveau poste.');
  // Sans accès aux prix de revient, on conserve ceux déjà saisis (ligne par ligne).
  const previous = can(role, 'pricing.read')
    ? new Map<string, bigint>()
    : new Map(
        (await tx.changeOrderLine.findMany({ where: { changeOrderId: co.id } })).map((l) => [
          l.id,
          l.unitCost,
        ]),
      );
  await tx.changeOrderLine.deleteMany({ where: { changeOrderId: co.id } });
  const rows = lines.map((l, position) => {
    const id = l.id ?? uuidv7();
    return {
      id,
      tenantId: co.tenantId,
      changeOrderId: co.id,
      position,
      budgetLineId: l.budgetLineId,
      newPostLabel: l.budgetLineId ? null : (l.newPostLabel ?? null),
      itemId: l.itemId ?? null,
      code: l.code ?? null,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: BigInt(l.unitPrice),
      unitCost: BigInt(l.unitCost ?? Number(previous.get(id) ?? 0n)),
      laborHours: l.laborHours,
      discountPercent: l.discountPercent,
      vatRegime: l.vatRegime,
    };
  });
  if (rows.length) await tx.changeOrderLine.createMany({ data: rows });
  const totals = computeChangeOrder(
    rows.map((r) => ({
      id: r.id,
      description: r.description,
      unit: r.unit,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      unitCost: r.unitCost,
      laborHours: r.laborHours,
      vatRegime: r.vatRegime as VatRegime,
      discountPercent: r.discountPercent,
      budgetLineId: r.budgetLineId,
      newPostLabel: r.newPostLabel,
    })),
  );
  await tx.changeOrder.update({
    where: { id: co.id },
    data: {
      totalNet: totals.document.totalNet,
      totalVat: totals.document.totalVat,
      totalGross: totals.document.totalGross,
      totalCost: totals.totalCost,
      laborHours: totals.laborHours.toString(),
    },
  });
}

export function assertEditable(co: { status: string }, revision?: number, current?: number): void {
  if (co.status !== 'draft')
    throw conflict(
      'change_order_locked',
      co.status === 'signed'
        ? 'Cet avenant est signé : il ne se modifie plus.'
        : 'Cet avenant a été envoyé : retirez-le avant de le modifier.',
    );
  if (revision !== undefined && current !== undefined && revision !== current)
    throw conflict(
      'stale_revision',
      'Cet avenant a été modifié entre-temps. Rechargez pour voir la dernière version.',
    );
}

/** PDF de l'avenant : sections = postes cibles, intitulés lisibles. */
export async function renderChangeOrderPdfFor(
  tx: Tx,
  integrations: Integrations,
  id: string,
  options: { signature?: { signerName: string; signedAt: Date; ip: string | null } | null; date?: Date } = {},
): Promise<Buffer> {
  const co = await loadChangeOrder(tx, id);
  if (!co) throw notFound('Cet avenant');
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: co.tenantId } });
  const site = co.project.siteId ? await tx.site.findUnique({ where: { id: co.project.siteId } }) : null;
  const posts = await tx.budgetLine.findMany({ where: { projectId: co.projectId } });
  const postLabel = new Map(posts.map((p) => [p.id, p.label]));
  const quote = co.project.quoteId
    ? await tx.quote.findUnique({ where: { id: co.project.quoteId }, select: { number: true } })
    : null;
  let logo: Uint8Array | null = null;
  if (t.logoKey && !t.logoKey.endsWith('.svg'))
    logo = await integrations.storage.get('uploads', t.logoKey).catch(() => null);
  const inputs = coLineInputs(co.lines);
  const groups = new Map<string, ChangeOrderLineInput[]>();
  for (const l of inputs)
    groups.set(changeOrderTargetKey(l), [...(groups.get(changeOrderTargetKey(l)) ?? []), l]);
  const customer = co.project.customer;
  return renderChangeOrderPdf({
    tenant: {
      name: t.legalName ?? t.name,
      lines: [
        ...addressLines(t),
        ...(t.vatNumber ? [`TVA ${t.vatNumber}`] : []),
        ...[t.email, t.phone].filter((x): x is string => Boolean(x)),
      ],
      brandColor: t.brandColor,
      logo,
      iban: t.iban,
      bic: t.bic,
      termsAndConditions: null,
      legalMentions: t.legalMentions,
    },
    customer: {
      name: customer.displayName,
      lines: [...addressLines(customer), ...(customer.vatNumber ? [`TVA ${customer.vatNumber}`] : [])],
    },
    siteAddress: site ? `${site.street}, ${site.postalCode} ${site.city}` : null,
    changeOrder: {
      ordinal: co.ordinal,
      number: co.number,
      title: co.title,
      description: co.description,
      date: options.date ?? co.sentAt ?? new Date(),
      delayDays: co.delayDays,
      newEndDate:
        co.delayDays > 0 && co.project.endDate
          ? new Date(`${shiftEndDate(isoDate(co.project.endDate), co.delayDays)}T00:00:00Z`)
          : null,
      projectRef: `${co.project.number}${quote?.number ? ` (devis ${quote.number})` : ''}`,
    },
    sections: [...groups.entries()].map(([key, lines]) => ({
      id: key,
      title: lines[0]!.budgetLineId
        ? (postLabel.get(lines[0]!.budgetLineId) ?? '—')
        : `Nouveau poste : ${lines[0]!.newPostLabel ?? ''}`.trim(),
      optional: false,
      selected: true,
      lines: lines.map((l) => ({ ...l, kind: 'item' as const })),
    })),
    signature: options.signature ?? null,
  });
}
