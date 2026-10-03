/**
 * Réceptions et clôture (03 §5, 02 P10) : DTO, situation des réceptions du chantier, PDF du PV,
 * rapport de rentabilité et suggestions de prix de la bibliothèque.
 */
import type { ProfitabilityDto, ProjectReceptionDto, ReceptionDto } from '@batimint/contracts';
import { loadProjectNumbers, type Tx } from '@batimint/db';
import { renderReceptionPdf, sha256 } from '@batimint/documents';
import type { ObjectStorage } from '@batimint/integrations';
import {
  type Cents,
  dec,
  heldRetention,
  priceSuggestions,
  profitabilityReport,
  receptionBlockers,
  type ratio,
} from '@batimint/domain';
import { iso, isoDate } from '../lib/tenant';
import { addressLines } from './quotes';
import { driftThresholdOf } from './projects';

type ReceptionRow = Awaited<ReturnType<Tx['reception']['findUniqueOrThrow']>> & {
  reserves: Awaited<ReturnType<Tx['reserve']['findUniqueOrThrow']>>[];
  project: { id: string; number: string; name: string; status: string };
};

export const RECEPTION_INCLUDE = {
  reserves: { orderBy: { position: 'asc' as const } },
  project: { select: { id: true, number: true, name: true, status: true } },
};

export async function receptionDto(tx: Tx, r: ReceptionRow, urlBase = '/api/v1'): Promise<ReceptionDto> {
  const posts = new Map(
    (
      await tx.budgetLine.findMany({
        where: { id: { in: r.reserves.flatMap((x) => (x.budgetLineId ? [x.budgetLineId] : [])) } },
        select: { id: true, label: true },
      })
    ).map((b) => [b.id, b.label]),
  );
  const openReserves =
    r.kind === 'final' ? await tx.reserve.count({ where: { projectId: r.projectId, liftedAt: null } }) : 0;
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    number: r.number,
    receptionDate: isoDate(r.receptionDate)!,
    attendees: r.attendees,
    notes: r.notes,
    plannedFinalDate: isoDate(r.plannedFinalDate),
    signerName: r.signerName,
    signedAt: iso(r.signedAt),
    pdfUrl: r.pdfKey ? `${urlBase}/receptions/${r.id}/pdf` : null,
    reserves: r.reserves.map((x) => ({
      id: x.id,
      position: x.position,
      description: x.description,
      location: x.location,
      budgetLine: x.budgetLineId ? { id: x.budgetLineId, label: posts.get(x.budgetLineId) ?? '—' } : null,
      photos: x.photoIds.map((id) => ({
        id,
        url: `${urlBase}/attachments/${id}/file`,
        thumbUrl: `${urlBase}/attachments/${id}/file`,
      })),
      taskId: x.taskId,
      liftedAt: iso(x.liftedAt),
    })),
    project: { id: r.project.id, number: r.project.number, name: r.project.name },
    blockers:
      r.status === 'signed'
        ? []
        : receptionBlockers({ kind: r.kind, projectStatus: r.project.status, openReserves }),
  };
}

export async function projectReception(tx: Tx, projectId: string): Promise<ProjectReceptionDto> {
  const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
  const receptions = await tx.reception.findMany({
    where: { projectId },
    include: RECEPTION_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
  const openReserves = await tx.reserve.count({
    where: { projectId, liftedAt: null, reception: { status: 'signed' } },
  });
  const finalInvoice = await tx.invoice.findFirst({
    where: { projectId, type: 'final', status: { not: 'cancelled' } },
    select: { id: true, number: true, status: true },
  });
  const invoices = await tx.invoice.findMany({
    where: { projectId, status: { notIn: ['draft', 'cancelled'] }, retentionAmount: { gt: 0 } },
    select: { retentionAmount: true, retentionReleasedAt: true },
  });
  const held = invoices.reduce((s, i) => s + heldRetention(i), 0n);
  const released = invoices.reduce((s, i) => s + (i.retentionReleasedAt ? i.retentionAmount : 0n), 0n);
  const releasedAt = invoices.find((i) => i.retentionReleasedAt)?.retentionReleasedAt ?? null;
  const hasDraft = (kind: 'provisional' | 'final') =>
    receptions.some((r) => r.kind === kind && r.status === 'signed');
  return {
    projectStatus: p.status,
    provisionalAcceptedOn: isoDate(p.provisionalAcceptedOn),
    finalAcceptancePlannedOn: isoDate(p.finalAcceptancePlannedOn),
    finalAcceptedOn: isoDate(p.finalAcceptedOn),
    closedAt: iso(p.closedAt),
    openReserves,
    receptions: await Promise.all(receptions.map((r) => receptionDto(tx, r))),
    finalInvoice,
    retention: { held: Number(held), released: Number(released), releasedAt: iso(releasedAt) },
    can: {
      provisional: ['in_progress', 'suspended'].includes(p.status) && !hasDraft('provisional'),
      final: p.status === 'provisional_acceptance' && openReserves === 0,
      finalInvoice: p.status === 'provisional_acceptance' && openReserves === 0 && !finalInvoice,
      close: p.status === 'final_acceptance',
    },
  };
}

/** PDF du PV (signé ou non), à partir des données enregistrées. */
export async function renderReceptionFor(
  tx: Tx,
  receptionId: string,
  signature: { signerName: string; signedAt: Date; ip: string | null } | null,
  number: string,
): Promise<Buffer> {
  const r = await tx.reception.findUniqueOrThrow({
    where: { id: receptionId },
    include: {
      reserves: { orderBy: { position: 'asc' } },
      project: { include: { customer: true, site: true, tenant: true } },
    },
  });
  const t = r.project.tenant;
  const c = r.project.customer;
  const posts = new Map(
    (
      await tx.budgetLine.findMany({ where: { projectId: r.projectId }, select: { id: true, label: true } })
    ).map((b) => [b.id, b.label]),
  );
  const retention = await tx.invoice.findMany({
    where: { projectId: r.projectId, status: { notIn: ['draft', 'cancelled'] } },
    select: { retentionAmount: true, retentionReleasedAt: true },
  });
  const retained = retention.reduce((s, i) => s + i.retentionAmount, 0n);
  return renderReceptionPdf({
    tenant: {
      name: t.legalName ?? t.name,
      lines: [...addressLines(t), ...(t.enterpriseNumber ? [`BCE ${t.enterpriseNumber}`] : [])],
      brandColor: t.brandColor,
    },
    customer: { name: c.displayName, lines: addressLines(c) },
    kind: r.kind,
    number,
    receptionDate: r.receptionDate,
    project: {
      number: r.project.number,
      name: r.project.name,
      address: r.project.site
        ? `${r.project.site.street}, ${r.project.site.postalCode} ${r.project.site.city}`
        : null,
    },
    attendees: r.attendees,
    notes: r.notes,
    reserves: r.reserves.map((x) => ({
      description: x.description,
      location: x.location,
      post: x.budgetLineId ? (posts.get(x.budgetLineId) ?? null) : null,
    })),
    plannedFinalDate: r.plannedFinalDate,
    retentionAmount: retained > 0n ? retained : null,
    signature,
  });
}

const CATEGORY = {
  supplier_invoice: 'supplier_invoice',
  purchase_order: 'purchase_order',
  labour: 'labour',
  stock: 'stock',
  equipment: 'equipment',
  subcontract: 'subcontract',
  other: 'other',
} as const;

/** Rapport de rentabilité : prévu vs réel par poste, heures, achats ; suggestions de prix. */
export async function profitability(tx: Tx, projectId: string, tenantId: string): Promise<ProfitabilityDto> {
  const p = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, number: true, name: true, status: true, contractAmount: true, quoteId: true },
  });
  const posts = await tx.budgetLine.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
  const costs = await tx.projectCost.findMany({ where: { projectId } });
  // Heures réelles : coût main-d'œuvre ÷ coût horaire de la personne (clé « employé:jour:poste »).
  const employeeIds = [
    ...new Set(costs.filter((c) => c.category === 'labour').map((c) => c.sourceId.split(':')[0]!)),
  ];
  const rates = new Map(
    (
      await tx.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true, hourlyCost: true },
      })
    ).map((e) => [e.id, e.hourlyCost]),
  );
  const byPost = new Map<string, { categories: Record<string, Cents>; hours: ReturnType<typeof dec> }>();
  for (const b of posts) byPost.set(b.id, { categories: {}, hours: dec(0) });
  const none = { categories: {} as Record<string, Cents>, hours: dec(0) };
  for (const c of costs) {
    const slot = (c.budgetLineId && byPost.get(c.budgetLineId)) || none;
    const k = CATEGORY[c.category as keyof typeof CATEGORY] ?? 'other';
    slot.categories[k] = (slot.categories[k] ?? 0n) + c.amount;
    if (c.category === 'labour') {
      const rate = rates.get(c.sourceId.split(':')[0]!);
      if (rate && rate > 0n)
        slot.hours = slot.hours.plus(dec(c.amount.toString()).dividedBy(rate.toString()));
    }
  }
  const report = profitabilityReport(
    posts.map((b) => ({
      id: b.id,
      label: b.label,
      revenue: b.saleAmount,
      budgetedCost: b.budgetedCost,
      actualByCategory: byPost.get(b.id)!.categories,
      plannedHours: b.laborHours.toString(),
      actualHours: byPost.get(b.id)!.hours.toDecimalPlaces(2),
    })),
  );
  // Articles du devis signé, rattachés à leur poste par la section.
  const quote = p.quoteId
    ? await tx.quote.findUnique({ where: { id: p.quoteId }, select: { currentVersionId: true } })
    : null;
  const sections = quote?.currentVersionId
    ? await tx.quoteSection.findMany({
        where: { versionId: quote.currentVersionId, OR: [{ optional: false }, { selected: true }] },
        include: { lines: { where: { kind: 'item', itemId: { not: null } } } },
      })
    : [];
  const postBySection = new Map(posts.map((b) => [b.quoteSectionKey, b.id]));
  const itemIds = [...new Set(sections.flatMap((s) => s.lines.map((l) => l.itemId!)))];
  const items = new Map(
    (
      await tx.item.findMany({
        where: { id: { in: itemIds }, archivedAt: null },
        select: { id: true, name: true, code: true, purchasePrice: true, laborHours: true, kind: true },
      })
    ).map((i) => [i.id, i]),
  );
  const suggestions = priceSuggestions(
    report,
    sections.flatMap((s) =>
      s.lines.flatMap((l) => {
        const item = items.get(l.itemId!);
        const postId = postBySection.get(s.key);
        if (!item || !postId) return [];
        return [
          {
            itemId: item.id,
            itemName: item.name,
            postId,
            unitCost: item.kind === 'labour' ? 0n : item.purchasePrice,
            laborHours: item.laborHours.toString(),
          },
        ];
      }),
    ),
  );
  const numbers = (await loadProjectNumbers(tx, [p], await driftThresholdOf(tx, tenantId))).get(p.id)!;
  const pct = (d: ReturnType<typeof ratio>) => (d ? d.toString() : null);
  return {
    project: { id: p.id, number: p.number, name: p.name, status: p.status },
    revenue: Number(report.revenue),
    budgetedCost: Number(report.budgetedCost),
    actualCost: Number(report.actualCost),
    plannedMargin: pct(report.plannedMargin),
    actualMargin: pct(report.actualMargin),
    plannedHours: report.plannedHours.toString(),
    actualHours: report.actualHours.toDecimalPlaces(2).toString(),
    invoiced: Number(numbers.fin.invoiced),
    collected: Number(numbers.fin.collected),
    posts: report.posts.map((x) => ({
      id: x.id,
      label: x.label,
      revenue: Number(x.revenue),
      budgetedCost: Number(x.budgetedCost),
      actualCost: Number(x.actualCost),
      costVariance: Number(x.costVariance),
      costVarianceRatio: pct(x.costVarianceRatio),
      plannedMargin: pct(x.plannedMargin),
      actualMargin: pct(x.actualMargin),
      plannedHours: x.plannedHours.toString(),
      actualHours: x.actualHours.toDecimalPlaces(2).toString(),
      actualByCategory: Object.fromEntries(
        Object.entries(x.actualByCategory).map(([k, v]) => [k, Number(v)]),
      ),
    })),
    suggestions: suggestions.map((s) => ({
      itemId: s.itemId,
      itemName: s.itemName,
      itemCode: items.get(s.itemId)?.code ?? '',
      field: s.field,
      current: s.current,
      suggested: s.suggested,
      variance: s.variance.toString(),
    })),
  };
}

/**
 * PDF d'un PV signé : celui qui a été figé à la signature ; s'il manque (PV du seed de démo), il
 * est rendu une seule fois depuis les données signées, puis son empreinte ne change plus.
 */
export async function signedReceptionPdf(
  tx: Tx,
  storage: ObjectStorage,
  receptionId: string,
): Promise<{ pdf: Buffer; number: string } | null> {
  const r = await tx.reception.findUnique({ where: { id: receptionId } });
  if (!r || r.status !== 'signed' || !r.number) return null;
  if (r.pdfKey) return { pdf: Buffer.from(await storage.get('legal', r.pdfKey)), number: r.number };
  const pdf = await renderReceptionFor(
    tx,
    r.id,
    r.signerName && r.signedAt ? { signerName: r.signerName, signedAt: r.signedAt, ip: null } : null,
    r.number,
  );
  const hash = sha256(pdf);
  const key = `t/${r.tenantId}/receptions/${r.id}/${r.number}-signe-${hash.slice(0, 12)}.pdf`;
  await storage.put({
    bucket: 'legal',
    key,
    body: pdf,
    contentType: 'application/pdf',
    metadata: { sha256: hash },
  });
  await tx.reception.update({ where: { id: r.id }, data: { pdfKey: key, pdfSha256: hash } });
  return { pdf, number: r.number };
}
