/**
 * Chantier (03 §5) : chiffres du cockpit calculés à la demande depuis les données (postes,
 * tâches, grand livre des coûts, factures), avec les fonctions pures de `packages/domain`.
 * Aucun chiffre n'est stocké en double : la marge affichée est toujours recalculée.
 */
import { parseTenantSettings } from '@batimint/contracts';
import {
  BILLED_STATUSES,
  loadProjectNumbers,
  OPEN_INVOICE_STATUSES,
  type Tx,
  UNALLOCATED,
} from '@batimint/db';
import {
  brusselsDate,
  type Cents,
  can,
  currentProjectStep,
  dec,
  nextStates,
  ProjectStatus,
  projectSchedule,
  projectTodos,
  type ProjectFinancials,
  type Role,
  type VatRegime,
} from '@batimint/domain';
import { notFound } from '../lib/errors';
import { iso, isoDate } from '../lib/tenant';
import { suggestVat } from './quotes';

export async function driftThresholdOf(tx: Tx, tenantId: string): Promise<string> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return dec(parseTenantSettings(t.settings).driftThresholdPercent).dividedBy(100).toString();
}

export function invoiceBalance(inv: { status: string; totalGross: bigint }): Cents {
  // Les paiements partiels arrivent au M8 ; d'ici là, une facture non payée reste due en entier.
  return inv.status === 'paid' || inv.status === 'cancelled' || inv.status === 'draft' ? 0n : inv.totalGross;
}

export async function overdueInvoices(tx: Tx, projectIds: string[], today: string) {
  if (!projectIds.length) return [];
  return tx.invoice.findMany({
    where: {
      projectId: { in: projectIds },
      status: { in: [...OPEN_INVOICE_STATUSES] },
      dueDate: { lt: new Date(`${today}T00:00:00Z`) },
    },
    select: { id: true, projectId: true, number: true, status: true, dueDate: true, totalGross: true },
  });
}

export type Health = 'ok' | 'warn' | 'crit';

/**
 * Pastille d'état (barre latérale, liste) : rouge si le chantier est en retard ou à marge
 * négative ; orange si un poste dérive, si la marge glisse de plus de 5 points ou si une facture
 * est échue ; vert sinon.
 */
export function healthOf(input: { fin: ProjectFinancials; lateDays: number; overdue: boolean }): Health {
  const { fin } = input;
  if (input.lateDays > 0 || fin.estimatedMargin?.isNegative()) return 'crit';
  const marginSlip =
    fin.plannedMargin && fin.estimatedMargin
      ? fin.plannedMargin.minus(fin.estimatedMargin).greaterThan('0.05')
      : false;
  if (input.overdue || fin.driftingLineIds.length || marginSlip) return 'warn';
  return 'ok';
}

export const PROJECT_SUMMARY_INCLUDE = {
  customer: { select: { id: true, displayName: true, lastName: true, kind: true } },
} as const;

type SummaryRow = Awaited<ReturnType<Tx['project']['findMany']>>[number] & {
  customer: { id: string; displayName: string; lastName: string | null; kind: string };
};

/** « Dupont · Jumet » : nom de famille (ou raison sociale) et commune. */
export function shortLabel(customer: { displayName: string; lastName: string | null }, city: string | null) {
  const who = customer.lastName?.trim() || customer.displayName;
  return city ? `${who} · ${city}` : who;
}

export async function projectSummaries(tx: Tx, rows: SummaryRow[], tenantId: string, role: Role) {
  const today = brusselsDate(new Date());
  const threshold = await driftThresholdOf(tx, tenantId);
  const numbers = await loadProjectNumbers(tx, rows, threshold);
  const siteIds = rows.map((r) => r.siteId).filter((x): x is string => Boolean(x));
  const sites = siteIds.length ? await tx.site.findMany({ where: { id: { in: siteIds } } }) : [];
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const managerIds = rows.map((r) => r.managerUserId).filter((x): x is string => Boolean(x));
  const managers = managerIds.length
    ? await tx.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, name: true } })
    : [];
  const managerById = new Map(managers.map((m) => [m.id, m]));
  const overdue = new Set(
    (
      await overdueInvoices(
        tx,
        rows.map((r) => r.id),
        today,
      )
    ).map((i) => i.projectId),
  );
  const prices = can(role, 'pricing.read');
  const finance = can(role, 'projects.finance.read');
  return rows.map((r) => {
    const n = numbers.get(r.id)!;
    const site = r.siteId ? siteById.get(r.siteId) : undefined;
    const schedule = projectSchedule({ startDate: isoDate(r.startDate), endDate: isoDate(r.endDate), today });
    const late = ['in_progress', 'suspended'].includes(r.status) ? schedule.lateDays : 0;
    const manager = r.managerUserId ? managerById.get(r.managerUserId) : undefined;
    return {
      id: r.id,
      number: r.number,
      name: r.name,
      status: r.status,
      customer: { id: r.customer.id, displayName: r.customer.displayName },
      site: site ? { city: site.city, address: `${site.street}, ${site.postalCode} ${site.city}` } : null,
      shortLabel: shortLabel(r.customer, site?.city ?? null),
      progress: n.fin.progress.toDecimalPlaces(4).toString(),
      ...(prices ? { contractAmount: Number(r.contractAmount) } : {}),
      ...(finance
        ? {
            plannedMargin: n.fin.plannedMargin?.toDecimalPlaces(4).toString() ?? null,
            estimatedMargin: n.fin.estimatedMargin?.toDecimalPlaces(4).toString() ?? null,
          }
        : {}),
      health: healthOf({ fin: n.fin, lateDays: late, overdue: overdue.has(r.id) }),
      startDate: isoDate(r.startDate),
      endDate: isoDate(r.endDate),
      manager: manager ? { userId: manager.id, name: manager.name } : null,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/** Régime TVA dominant du contrat (version signée du devis), ou proposé pour le client. */
export async function projectVatRegime(
  tx: Tx,
  project: { quoteId: string | null; customerId: string; siteId: string | null },
) {
  if (project.quoteId) {
    const v = await tx.quoteVersion.findFirst({
      where: { quoteId: project.quoteId, status: 'signed' },
      orderBy: { version: 'desc' },
      select: { id: true },
    });
    if (v) {
      const lines = await tx.quoteLine.findMany({
        where: { versionId: v.id, kind: 'item', section: { OR: [{ optional: false }, { selected: true }] } },
        select: { vatRegime: true, quantity: true, unitPrice: true },
      });
      const weight = new Map<string, number>();
      for (const l of lines)
        weight.set(
          l.vatRegime,
          (weight.get(l.vatRegime) ?? 0) + Number(l.quantity.toString()) * Number(l.unitPrice),
        );
      const top = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (top) return top as VatRegime;
    }
  }
  const customer = await tx.customer.findUnique({ where: { id: project.customerId } });
  const site = project.siteId ? await tx.site.findUnique({ where: { id: project.siteId } }) : null;
  return suggestVat(customer, site).regime;
}

/** Cockpit du chantier (maquette cockpit-chantier). */
export async function projectDetail(tx: Tx, id: string, tenantId: string, role: Role) {
  const p = await tx.project.findUnique({
    where: { id },
    include: {
      customer: true,
      quote: { select: { id: true, number: true, title: true } },
    },
  });
  if (!p) throw notFound('Ce chantier');
  const [summary] = await projectSummaries(tx, [p], tenantId, role);
  const today = brusselsDate(new Date());
  const threshold = await driftThresholdOf(tx, tenantId);
  const n = (await loadProjectNumbers(tx, [p], threshold)).get(p.id)!;
  const site = p.siteId ? await tx.site.findUnique({ where: { id: p.siteId } }) : null;
  const certificate = p.quoteId
    ? await tx.vatCertificate.findFirst({ where: { quoteId: p.quoteId, status: 'signed' } })
    : null;
  const team = p.teamId ? await tx.team.findUnique({ where: { id: p.teamId } }) : null;
  const manager = p.managerUserId ? await tx.user.findUnique({ where: { id: p.managerUserId } }) : null;
  const managerEmployee = p.managerUserId
    ? await tx.employee.findFirst({ where: { userId: p.managerUserId } })
    : null;
  const changeOrders = await tx.changeOrder.findMany({
    where: { projectId: p.id },
    select: { id: true, ordinal: true, title: true, status: true, sentAt: true },
    orderBy: { ordinal: 'asc' },
  });
  const openQuestions = await tx.comment.findMany({
    where: { projectId: p.id, authorPortalToken: { not: null }, resolvedAt: null, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  const coTitle = new Map(changeOrders.map((c) => [c.id, c]));
  const invoices = await tx.invoice.findMany({
    where: { projectId: p.id, status: { in: [...OPEN_INVOICE_STATUSES] } },
    select: { id: true, number: true, status: true, dueDate: true, totalGross: true },
  });
  const finalInvoice = await tx.invoice.findFirst({
    where: { projectId: p.id, type: 'final', status: { in: [...BILLED_STATUSES] } },
  });
  const photos = await tx.attachment.count({ where: { ownerType: 'project', ownerId: p.id, kind: 'photo' } });
  const documents = await tx.attachment.count({
    where: { ownerType: 'project', ownerId: p.id, kind: 'document' },
  });
  const taskCounts = await tx.task.groupBy({ by: ['status'], where: { projectId: p.id }, _count: true });
  const tokens = await tx.portalToken.findMany({
    where: { projectId: p.id, kind: 'project', revokedAt: null, expiresAt: { gt: new Date() } },
    select: { lastUsedAt: true },
  });
  const schedule = projectSchedule({ startDate: isoDate(p.startDate), endDate: isoDate(p.endDate), today });
  const late = ['in_progress', 'suspended'].includes(p.status) ? schedule.lateDays : 0;
  const finance = can(role, 'projects.finance.read');
  const prices = can(role, 'pricing.read');
  const lineResult = new Map(n.fin.lines.map((l) => [l.id, l]));
  const fin = n.fin;

  const todos = projectTodos({
    today,
    projectId: p.id,
    lateDays: late,
    invoices: prices
      ? invoices.map((i) => ({
          id: i.id,
          number: i.number,
          status: i.status,
          dueDate: isoDate(i.dueDate),
          balance: invoiceBalance(i),
        }))
      : [],
    budgetLines: finance
      ? n.lines
          .filter((l) => l.id !== UNALLOCATED)
          .map((l) => {
            const r = lineResult.get(l.id)!;
            return {
              id: l.id,
              label: l.label,
              budgetedCost: r.budgetedCost,
              committed: r.committedTotal,
              drift: r.drift,
            };
          })
      : [],
    changeOrders: changeOrders.map((c) => ({
      id: c.id,
      ordinal: c.ordinal,
      title: c.title,
      status: c.status,
      sentAt: c.sentAt ? brusselsDate(c.sentAt) : null,
    })),
    openQuestions: openQuestions.map((q) => ({
      id: q.id,
      subject:
        q.subjectType === 'change_order' && coTitle.get(q.subjectId)
          ? `Avenant n°${coTitle.get(q.subjectId)!.ordinal}`
          : p.name,
      author: q.authorLabel,
      changeOrderId: q.subjectType === 'change_order' ? q.subjectId : null,
    })),
  });

  return {
    ...summary!,
    description: p.description,
    suspendedReason: p.suspendedReason,
    customer: {
      id: p.customer.id,
      displayName: p.customer.displayName,
      kind: p.customer.kind,
      email: p.customer.email,
      phone: p.customer.phone,
    },
    site: site
      ? {
          id: site.id,
          city: site.city,
          address: `${site.street}, ${site.postalCode} ${site.city}`,
          latitude: site.latitude ? Number(site.latitude) : null,
          longitude: site.longitude ? Number(site.longitude) : null,
        }
      : null,
    quote: p.quote,
    vat: { regime: await projectVatRegime(tx, p), certificateSigned: Boolean(certificate) },
    team: team ? { id: team.id, name: team.name } : null,
    manager: manager
      ? { userId: manager.id, name: manager.name, phone: managerEmployee?.phone ?? null }
      : null,
    schedule: { ...schedule, lateDays: late },
    step: currentProjectStep({
      status: p.status,
      progress: fin.progress,
      finalInvoiceIssued: Boolean(finalInvoice),
      fullyPaid: finalInvoice?.status === 'paid',
    }),
    allowedTransitions: [...nextStates(ProjectStatus, p.status)],
    ...(finance
      ? {
          financials: {
            contractAmount: Number(fin.contractAmount),
            quoteAmount: Number(n.quoteAmount),
            changeOrdersAmount: Number(n.changeOrdersAmount),
            budgetedCost: Number(fin.budgetedCost),
            committed: Number(fin.committed),
            projectedCost: Number(fin.projectedCost),
            invoiced: Number(fin.invoiced),
            collected: Number(fin.collected),
            plannedMargin: fin.plannedMargin?.toDecimalPlaces(4).toString() ?? null,
            estimatedMargin: fin.estimatedMargin?.toDecimalPlaces(4).toString() ?? null,
            plannedMarginAmount: Number(fin.plannedMarginAmount),
            estimatedMarginAmount: Number(fin.estimatedMarginAmount),
            driftThreshold: n.driftThreshold,
          },
        }
      : {}),
    budgetLines: n.lines
      .filter((l) => l.id !== UNALLOCATED)
      .map((l) => {
        const r = lineResult.get(l.id)!;
        return {
          id: l.id,
          position: l.position,
          label: l.label,
          ...(prices ? { saleAmount: Number(r.revenue), invoiced: Number(r.invoiced) } : {}),
          ...(finance
            ? {
                budgetedCost: Number(r.budgetedCost),
                committed: Number(r.committedTotal),
                committedByCategory: Object.fromEntries(
                  Object.entries(l.committedByCategory).map(([k, v]) => [k, Number(v)]),
                ),
                projectedCost: Number(r.projectedCost),
                consumption: r.consumption?.toDecimalPlaces(4).toString() ?? null,
              }
            : {}),
          progress: r.progress.toDecimalPlaces(4).toString(),
          drift: finance ? r.drift : false,
          taskCount: l.taskCount,
          doneCount: l.doneCount,
          fromChangeOrder: l.fromChangeOrder,
        };
      }),
    todos: todos.map((t) => (t.kind === 'invoice_overdue' ? { ...t, amount: Number(t.amount) } : t)),
    counts: {
      tasks: taskCounts.reduce((a, c) => a + c._count, 0),
      openTasks: taskCounts.filter((c) => c.status !== 'done').reduce((a, c) => a + c._count, 0),
      photos,
      documents,
      changeOrders: changeOrders.length,
      pendingChangeOrders: changeOrders.filter((c) => c.status === 'sent').length,
    },
    portal: {
      lastViewedAt: iso(
        tokens
          .map((t) => t.lastUsedAt)
          .filter((d): d is Date => Boolean(d))
          .sort((a, b) => b.getTime() - a.getTime())[0],
      ),
      activeLinks: tokens.length,
    },
  };
}
