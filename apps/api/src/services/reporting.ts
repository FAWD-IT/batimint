/**
 * Pilotage (03 §12, 02 P11) : tout se recalcule depuis les données (09) — chiffres des chantiers
 * (`loadProjectNumbers`), factures, paiements, achats, planning et pointages. Les règles de calcul
 * vivent dans le domaine (`reporting.ts`) ; ici, on rassemble les données.
 */
import type {
  AlertDto,
  CashForecastDto,
  DashboardDto,
  HoursReportDto,
  OrderBookReportDto,
  ProjectMarginDto,
  QuotesReportDto,
  TodayDto,
} from '@batimint/contracts';
import { parseTenantSettings } from '@batimint/contracts';
import { loadProjectNumbers, type Tx } from '@batimint/db';
import {
  addDays,
  brusselsDate,
  brusselsMidnight,
  type CashFlowItem,
  cashForecast,
  computeWorkedTime,
  dec,
  DEFAULT_WEEKLY_HOURS,
  groupMargins,
  heldRetention,
  hoursVsPlanned,
  invoiceBalance,
  type IsoDate,
  isWorkingDay,
  maintenanceStatus,
  monthlyPayroll,
  orderBook,
  payrollOutflows,
  type Period,
  quoteConversion,
  slotHalfDays,
  sumCents,
} from '@batimint/domain';
import { balanceOf } from './invoicing';
import { driftThresholdOf } from './projects';

const day = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const ACTIVE = ['preparation', 'in_progress', 'suspended', 'provisional_acceptance'] as const;
const OPEN_INVOICE = ['issued', 'sent', 'delivered', 'partially_paid'] as const;
const BILLED = ['issued', 'sent', 'delivered', 'partially_paid', 'paid'] as const;
const UNPAID_SUPPLIER = ['received', 'to_allocate', 'allocated', 'validated', 'to_pay', 'blocked'] as const;

export interface ProjectScope {
  teamId?: string | undefined;
  managerId?: string | undefined;
}

const scopeWhere = (s: ProjectScope) => ({
  ...(s.teamId ? { teamId: s.teamId } : {}),
  ...(s.managerId ? { managerUserId: s.managerId } : {}),
});

const name = (u: { name: string } | null | undefined) => u?.name ?? null;

/** Marges des chantiers (vendu, coût projeté à terminaison, facturé, dérive). */
export async function projectMargins(
  tx: Tx,
  tenantId: string,
  where: Record<string, unknown>,
): Promise<ProjectMarginDto[]> {
  const projects = await tx.project.findMany({
    where,
    include: { customer: { select: { displayName: true } } },
    orderBy: { number: 'desc' },
  });
  const numbers = await loadProjectNumbers(tx, projects, await driftThresholdOf(tx, tenantId));
  const teams = new Map(
    (await tx.team.findMany({ select: { id: true, name: true } })).map((t) => [t.id, t.name]),
  );
  const users = new Map(
    (
      await tx.user.findMany({
        where: { id: { in: projects.flatMap((p) => (p.managerUserId ? [p.managerUserId] : [])) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u]),
  );
  return projects.map((p) => {
    const n = numbers.get(p.id)!;
    const sold = n.fin.contractAmount;
    const cost = n.fin.committed;
    const projected = n.fin.projectedCost;
    const margin = sold - projected;
    return {
      project: { id: p.id, number: p.number, name: p.name },
      customer: p.customer.displayName,
      status: p.status,
      manager: name(p.managerUserId ? users.get(p.managerUserId) : null),
      team: p.teamId ? (teams.get(p.teamId) ?? null) : null,
      sold: Number(sold),
      cost: Number(cost),
      projectedCost: Number(projected),
      margin: Number(margin),
      marginRate: sold
        ? dec(margin.toString()).dividedBy(sold.toString()).toDecimalPlaces(4).toString()
        : null,
      progress: n.fin.progress.toDecimalPlaces(4).toString(),
      invoiced: Number(n.fin.invoiced),
      drifting: n.fin.driftingLineIds.length > 0,
    };
  });
}

/** Factures émises dans la période (HTVA, notes de crédit déduites) et encaissements. */
async function invoicedAndCollected(tx: Tx, period: Period, scope: ProjectScope) {
  const scoped = scope.teamId || scope.managerId;
  const invoices = await tx.invoice.findMany({
    where: {
      status: { in: [...BILLED, 'cancelled'] },
      issueDate: { gte: day(period.from), lte: day(period.to) },
      ...(scoped ? { project: scopeWhere(scope) } : {}),
    },
    select: { totalNet: true, type: true, issueDate: true },
  });
  const payments = await tx.payment.findMany({
    where: {
      receivedOn: { gte: day(period.from), lte: day(period.to) },
      ...(scoped ? { invoice: { project: scopeWhere(scope) } } : {}),
    },
    select: { amount: true, receivedOn: true },
  });
  return { invoices, payments };
}

async function openInvoices(tx: Tx, scope: ProjectScope = {}) {
  const scoped = scope.teamId || scope.managerId;
  return tx.invoice.findMany({
    where: {
      status: { in: [...OPEN_INVOICE] },
      type: { not: 'credit_note' },
      ...(scoped ? { project: scopeWhere(scope) } : {}),
    },
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      totalGross: true,
      retentionAmount: true,
      retentionReleasedAt: true,
      retentionDueDate: true,
      amountPaid: true,
      amountCredited: true,
      dueDate: true,
      projectId: true,
      customer: { select: { displayName: true } },
    },
  });
}

/** Trésorerie prévisionnelle à 90 jours (03 §12). */
export async function buildCashForecast(tx: Tx, tenantId: string, today: IsoDate): Promise<CashForecastDto> {
  const horizonEnd = addDays(today, 90);
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const settings = parseTenantSettings(tenant.settings);
  const inflows: (CashFlowItem & { link: string | null })[] = [];
  const outflows: (CashFlowItem & { link: string | null })[] = [];

  for (const i of await openInvoices(tx)) {
    const balance = balanceOf(i);
    if (balance <= 0n) continue;
    // La retenue libérée a sa propre échéance ; le reste suit l'échéance de la facture.
    const withoutRetention = invoiceBalance({
      totalGross: i.totalGross,
      retentionAmount: i.retentionAmount,
      paid: i.amountPaid,
      credited: i.amountCredited,
    });
    const retentionPart = balance - withoutRetention;
    const link = `/facturation/${i.id}`;
    if (withoutRetention > 0n)
      inflows.push({
        date: iso(i.dueDate) ?? today,
        amount: withoutRetention,
        kind: 'receivable',
        label: `${i.number ?? 'Facture'} · ${i.customer.displayName}`,
        ref: { type: 'invoice', id: i.id },
        link,
      });
    if (retentionPart > 0n)
      inflows.push({
        date: iso(i.retentionDueDate) ?? iso(i.dueDate) ?? today,
        amount: retentionPart,
        kind: 'retention',
        label: `Retenue libérée · ${i.number ?? ''} · ${i.customer.displayName}`,
        ref: { type: 'invoice', id: i.id },
        link,
      });
  }

  // Retenues encore tenues : attendues à la réception définitive prévue (+ délai de paiement).
  const held = await tx.invoice.findMany({
    where: {
      status: { in: [...OPEN_INVOICE, 'paid'] },
      retentionAmount: { gt: 0 },
      retentionReleasedAt: null,
      project: { finalAcceptancePlannedOn: { not: null, lte: day(horizonEnd) } },
    },
    select: {
      id: true,
      number: true,
      retentionAmount: true,
      retentionReleasedAt: true,
      project: { select: { finalAcceptancePlannedOn: true, name: true } },
    },
  });
  for (const h of held)
    inflows.push({
      date: addDays(iso(h.project!.finalAcceptancePlannedOn)!, settings.paymentTermsDays),
      amount: heldRetention(h),
      kind: 'retention',
      label: `Retenue de garantie · ${h.number ?? ''} · ${h.project!.name}`,
      ref: { type: 'invoice', id: h.id },
      link: `/facturation/${h.id}`,
    });

  // Brouillons de chantiers en cours : facturation prévue, payée au délai habituel.
  const drafts = await tx.invoice.findMany({
    where: { status: 'draft', type: { not: 'credit_note' }, project: { status: { in: [...ACTIVE] } } },
    select: { id: true, title: true, totalGross: true, retentionAmount: true, paymentTermsDays: true },
  });
  for (const d of drafts)
    inflows.push({
      date: addDays(today, d.paymentTermsDays),
      amount: d.totalGross - d.retentionAmount,
      kind: 'planned_billing',
      label: `À émettre · ${d.title}`,
      ref: { type: 'invoice', id: d.id },
      link: `/facturation/${d.id}`,
    });

  // Achats à payer (retenue 30bis déduite si appliquée).
  const payables = await tx.supplierInvoice.findMany({
    where: { status: { in: [...UNPAID_SUPPLIER] } },
    select: {
      id: true,
      number: true,
      supplierName: true,
      totalGross: true,
      dueDate: true,
      issueDate: true,
      receivedAt: true,
      withholdingSocial: true,
      withholdingTax: true,
      withholdingAppliedAt: true,
    },
  });
  for (const s of payables) {
    const withheld = s.withholdingAppliedAt ? s.withholdingSocial + s.withholdingTax : 0n;
    outflows.push({
      date: iso(s.dueDate) ?? addDays(iso(s.issueDate) ?? iso(s.receivedAt)!, 30),
      amount: s.totalGross - withheld,
      kind: 'payable',
      label: `${s.supplierName}${s.number ? ` · ${s.number}` : ''}`,
      ref: { type: 'supplier_invoice', id: s.id },
      link: `/achats/factures?facture=${s.id}`,
    });
  }

  // Échéanciers des contrats de sous-traitance pas encore facturés (payés à 30 jours).
  const subcontracts = await tx.subcontract.findMany({
    where: { status: 'active' },
    select: { id: true, number: true, title: true, installments: true, supplierId: true },
  });
  const invoicedBySub = new Map<string, bigint>();
  for (const r of await tx.supplierInvoice.groupBy({
    by: ['subcontractId'],
    where: { subcontractId: { in: subcontracts.map((s) => s.id) } },
    _sum: { totalNet: true },
  }))
    if (r.subcontractId) invoicedBySub.set(r.subcontractId, r._sum.totalNet ?? 0n);
  for (const sc of subcontracts) {
    let covered = invoicedBySub.get(sc.id) ?? 0n;
    for (const inst of (sc.installments as {
      label: string;
      amount: number | string;
      dueOn: string | null;
    }[]) ?? []) {
      const amount = BigInt(inst.amount);
      const left = amount > covered ? amount - covered : 0n;
      covered = covered > amount ? covered - amount : 0n;
      if (!left || !inst.dueOn) continue;
      outflows.push({
        date: addDays(inst.dueOn, 30),
        amount: left,
        kind: 'subcontract',
        label: `${sc.number ?? 'Sous-traitance'} · ${inst.label}`,
        ref: { type: 'subcontract', id: sc.id },
        link: `/sous-traitance?contrat=${sc.id}`,
      });
    }
  }

  const employees = await tx.employee.findMany({ where: { active: true }, select: { hourlyCost: true } });
  const payroll = monthlyPayroll(employees);
  for (const p of payrollOutflows(payroll, today)) outflows.push({ ...p, link: '/equipes' });

  const opening = settings.cashBalance;
  const f = cashForecast({
    today,
    openingBalance: opening ? BigInt(opening.amount) : null,
    inflows,
    outflows,
  });
  const links = new Map([...inflows, ...outflows].map((x) => [`${x.kind}|${x.label}|${x.date}`, x.link]));
  return {
    from: f.from,
    to: f.to,
    openingBalance: f.openingBalance === null ? null : Number(f.openingBalance),
    openingBalanceOn: opening?.on ?? null,
    weeks: f.weeks.map((w) => ({
      ...w,
      inflow: Number(w.inflow),
      outflow: Number(w.outflow),
      net: Number(w.net),
      balance: Number(w.balance),
    })),
    totals: { inflow: Number(f.totals.inflow), outflow: Number(f.totals.outflow), net: Number(f.totals.net) },
    overdue: { inflow: Number(f.overdue.inflow), outflow: Number(f.overdue.outflow) },
    lowest: f.lowest ? { date: f.lowest.date, balance: Number(f.lowest.balance) } : null,
    monthlyPayroll: Number(payroll),
    items: f.items.map((i) => ({
      date: i.date,
      expectedOn: i.expectedOn,
      amount: Number(i.amount),
      direction: i.direction,
      kind: i.kind,
      label: i.label,
      overdue: i.overdue,
      link: links.get(`${i.kind}|${i.label}|${i.date}`) ?? null,
    })),
  };
}

async function quoteRows(tx: Tx, period: Period) {
  const quotes = await tx.quote.findMany({
    where: {
      isTemplate: false,
      sentAt: { gte: brusselsMidnight(period.from), lt: brusselsMidnight(addDays(period.to, 1)) },
    },
    include: { customer: { select: { displayName: true } } },
    orderBy: { sentAt: 'desc' },
  });
  const versions = new Map(
    (
      await tx.quoteVersion.findMany({
        where: { id: { in: quotes.flatMap((q) => (q.currentVersionId ? [q.currentVersionId] : [])) } },
        select: { id: true, totalNet: true },
      })
    ).map((v) => [v.id, v.totalNet]),
  );
  return quotes.map((q) => ({
    id: q.id,
    number: q.number,
    title: q.title,
    customer: q.customer?.displayName ?? '—',
    status: q.status === 'viewed' ? 'sent' : q.status === 'superseded' ? 'sent' : q.status,
    sentAt: q.sentAt?.toISOString() ?? null,
    amount: (q.currentVersionId ? versions.get(q.currentVersionId) : null) ?? 0n,
  }));
}

export async function quotesReport(tx: Tx, period: Period): Promise<QuotesReportDto> {
  const rows = await quoteRows(tx, period);
  const c = quoteConversion(rows);
  return {
    period,
    conversion: { ...c, amountSent: Number(c.amountSent), amountSigned: Number(c.amountSigned) },
    rows: rows.map((r) => ({ ...r, amount: Number(r.amount) })),
  };
}

export async function orderBookReport(
  tx: Tx,
  tenantId: string,
  scope: ProjectScope,
): Promise<OrderBookReportDto> {
  const margins = await projectMargins(tx, tenantId, { status: { in: [...ACTIVE] }, ...scopeWhere(scope) });
  const ends = new Map(
    (
      await tx.project.findMany({
        where: { id: { in: margins.map((m) => m.project.id) } },
        select: { id: true, endDate: true },
      })
    ).map((p) => [p.id, iso(p.endDate)]),
  );
  const rows = margins
    .map((m) => ({
      project: m.project,
      customer: m.customer,
      status: m.status,
      contract: m.sold,
      invoiced: m.invoiced,
      remaining: Math.max(m.sold - m.invoiced, 0),
      endDate: ends.get(m.project.id) ?? null,
    }))
    .filter((r) => r.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining);
  return { total: rows.reduce((s, r) => s + r.remaining, 0), rows };
}

export async function buildDashboard(
  tx: Tx,
  tenantId: string,
  period: Period,
  scope: ProjectScope,
  today: IsoDate,
): Promise<DashboardDto> {
  const { invoices, payments } = await invoicedAndCollected(tx, period, scope);
  const signed = (t: string, v: bigint) => (t === 'credit_note' ? -v : v);
  const open = await openInvoices(tx, scope);
  const balances = open.map((i) => ({ balance: balanceOf(i), due: iso(i.dueDate) }));
  const projects = await projectMargins(tx, tenantId, {
    status: { in: [...ACTIVE, 'final_acceptance'] },
    ...scopeWhere(scope),
  });
  const active = projects.filter((p) => (ACTIVE as readonly string[]).includes(p.status));
  const soldActive = active.reduce((s, p) => s + p.sold, 0);
  const marginActive = active.reduce((s, p) => s + p.margin, 0);
  const quotes = quoteConversion(await quoteRows(tx, period));
  // Mois de la période (au plus 12, les plus récents).
  const months: string[] = [];
  for (let m = period.from.slice(0, 7); m <= period.to.slice(0, 7) && months.length < 24;) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number) as [number, number];
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  const cash = await buildCashForecast(tx, tenantId, today);
  const { items: _items, ...cashSummary } = cash;
  const users = await tx.membership.findMany({
    where: { status: 'active', role: { in: ['owner', 'admin', 'office', 'site_manager'] } },
    include: { user: { select: { id: true, name: true } } },
  });
  return {
    period,
    kpis: {
      invoiced: Number(sumCents(invoices.map((i) => signed(i.type, i.totalNet)))),
      collected: Number(sumCents(payments.map((p) => p.amount))),
      outstanding: Number(sumCents(balances.map((b) => b.balance))),
      overdue: Number(sumCents(balances.filter((b) => b.due && b.due < today).map((b) => b.balance))),
      orderBook: Number(
        orderBook(active.map((p) => ({ contractAmount: BigInt(p.sold), invoicedNet: BigInt(p.invoiced) }))),
      ),
      marginRate: soldActive ? dec(marginActive).dividedBy(soldActive).toDecimalPlaces(4).toString() : null,
      quotes: { ...quotes, amountSent: Number(quotes.amountSent), amountSigned: Number(quotes.amountSigned) },
    },
    months: months.slice(-12).map((m) => ({
      month: m,
      invoiced: Number(
        sumCents(
          invoices.filter((i) => iso(i.issueDate)!.startsWith(m)).map((i) => signed(i.type, i.totalNet)),
        ),
      ),
      collected: Number(
        sumCents(payments.filter((p) => iso(p.receivedOn)!.startsWith(m)).map((p) => p.amount)),
      ),
    })),
    projects: active.sort((a, b) => b.sold - a.sold),
    cash: cashSummary,
    options: {
      teams: (await tx.team.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })).map(
        (t) => t,
      ),
      managers: users
        .map((u) => ({ id: u.user.id, name: u.user.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/** Heures réelles (pointages) et prévues (planning) sur la période. */
export async function hoursReport(
  tx: Tx,
  tenantId: string,
  period: Period,
  groupBy: 'person' | 'project',
): Promise<HoursReportDto> {
  const settings = parseTenantSettings(
    (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })).settings,
  );
  const entries = await tx.timeEntry.findMany({
    where: { day: { gte: day(period.from), lte: day(period.to) } },
    select: { id: true, kind: true, at: true, day: true, employeeId: true, projectId: true },
  });
  const employees = new Map(
    (
      await tx.employee.findMany({
        select: { id: true, firstName: true, lastName: true, teamId: true, active: true },
      })
    ).map((e) => [e.id, e]),
  );
  const projects = new Map(
    (await tx.project.findMany({ select: { id: true, number: true, name: true } })).map((p) => [p.id, p]),
  );
  const label = (key: string) =>
    groupBy === 'person'
      ? (() => {
          const e = employees.get(key);
          return e ? `${e.firstName} ${e.lastName}` : '—';
        })()
      : (() => {
          const p = projects.get(key);
          return p ? `${p.number} · ${p.name}` : '—';
        })();
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = `${e.employeeId}|${e.projectId}|${iso(e.day)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const rows: { key: string; label: string; actualMinutes: number; plannedMinutes: number }[] = [];
  for (const [k, list] of groups) {
    const [employeeId, projectId] = k.split('|') as [string, string];
    const w = computeWorkedTime(
      list.map((e) => ({ id: e.id, kind: e.kind, at: e.at })),
      { breakMinutes: settings.breakMinutes, breakAfterMinutes: settings.breakAfterMinutes },
    );
    const key = groupBy === 'person' ? employeeId : projectId;
    rows.push({ key, label: label(key), actualMinutes: w.netMinutes, plannedMinutes: 0 });
  }
  // Planning : demi-journées ouvrées de la période × (heures hebdomadaires / 10).
  const halfDayMinutes = dec(DEFAULT_WEEKLY_HOURS).times(60).dividedBy(10).toNumber();
  const slots = await tx.scheduleSlot.findMany({
    where: { startDay: { lte: day(period.to) }, endDay: { gte: day(period.from) } },
  });
  const members = (teamId: string) => [...employees.values()].filter((e) => e.teamId === teamId && e.active);
  for (const s of slots) {
    const halves = slotHalfDays({
      startDay: iso(s.startDay)!,
      startHalf: s.startHalf as 'am' | 'pm',
      endDay: iso(s.endDay)!,
      endHalf: s.endHalf as 'am' | 'pm',
    }).filter((h) => h.day >= period.from && h.day <= period.to && isWorkingDay(h.day));
    const people = s.employeeId ? [s.employeeId] : s.teamId ? members(s.teamId).map((e) => e.id) : [];
    for (const employeeId of people) {
      const key = groupBy === 'person' ? employeeId : s.projectId;
      rows.push({ key, label: label(key), actualMinutes: 0, plannedMinutes: halves.length * halfDayMinutes });
    }
  }
  return { groupBy, period, rows: hoursVsPlanned(rows) };
}

export async function profitabilityRows(
  tx: Tx,
  tenantId: string,
  period: Period,
  scope: ProjectScope,
  groupBy: 'project' | 'customer' | 'trade',
) {
  // Chantiers actifs pendant la période : commencés avant sa fin et non clôturés avant son début.
  const projects = await tx.project.findMany({
    where: {
      ...scopeWhere(scope),
      OR: [{ startDate: null }, { startDate: { lte: day(period.to) } }],
      AND: [{ OR: [{ closedAt: null }, { closedAt: { gte: brusselsMidnight(period.from) } }] }],
    },
    select: { id: true, customerId: true, opportunityId: true, quoteId: true },
  });
  const margins = await projectMargins(tx, tenantId, { id: { in: projects.map((p) => p.id) } });
  const opportunities = new Map(
    (
      await tx.opportunity.findMany({
        where: { id: { in: projects.flatMap((p) => (p.opportunityId ? [p.opportunityId] : [])) } },
        select: { id: true, trade: true },
      })
    ).map((o) => [o.id, o.trade]),
  );
  const byId = new Map(projects.map((p) => [p.id, p]));
  const rows = margins.map((m) => {
    const p = byId.get(m.project.id)!;
    const trade = p.opportunityId ? (opportunities.get(p.opportunityId) ?? null) : null;
    const key =
      groupBy === 'project' ? m.project.id : groupBy === 'customer' ? p.customerId : (trade ?? 'none');
    const label =
      groupBy === 'project'
        ? `${m.project.number} · ${m.project.name}`
        : groupBy === 'customer'
          ? m.customer
          : (trade ?? 'Non précisé');
    return { key, label, sold: BigInt(m.sold), cost: BigInt(m.projectedCost) };
  });
  const groups = groupMargins(rows);
  const all = groupMargins(rows.map((r) => ({ ...r, key: 'all', label: 'Total' })))[0] ?? {
    key: 'all',
    label: 'Total',
    count: 0,
    sold: 0n,
    cost: 0n,
    margin: 0n,
    marginRate: null,
  };
  const out = (g: (typeof groups)[number]) => ({
    key: g.key,
    label: g.label,
    count: g.count,
    sold: Number(g.sold),
    cost: Number(g.cost),
    margin: Number(g.margin),
    marginRate: g.marginRate,
  });
  return { groupBy, period, rows: groups.map(out), totals: out(all) };
}

/** Aujourd'hui (P11) : qui est où, ce qui a bougé depuis hier, alertes. */
export async function buildToday(
  tx: Tx,
  tenantId: string,
  now: Date,
  opts: { finance: boolean; can: (action: string) => boolean },
): Promise<TodayDto> {
  const today = brusselsDate(now);
  const since = brusselsMidnight(addDays(today, -1));

  // Qui est où : planning du jour + pointages du jour.
  const slots = await tx.scheduleSlot.findMany({
    where: { startDay: { lte: day(today) }, endDay: { gte: day(today) } },
  });
  const entries = await tx.timeEntry.findMany({
    where: { day: day(today) },
    orderBy: { at: 'asc' },
    select: { employeeId: true, projectId: true, kind: true, at: true },
  });
  const employees = new Map(
    (
      await tx.employee.findMany({
        where: { active: true },
        select: { id: true, firstName: true, lastName: true, teamId: true },
      })
    ).map((e) => [e.id, e]),
  );
  const expected = new Map<string, Set<string>>();
  for (const s of slots) {
    const halves = slotHalfDays({
      startDay: iso(s.startDay)!,
      startHalf: s.startHalf as 'am' | 'pm',
      endDay: iso(s.endDay)!,
      endHalf: s.endHalf as 'am' | 'pm',
    }).filter((h) => h.day === today);
    if (!halves.length) continue;
    const people = s.employeeId
      ? [s.employeeId]
      : [...employees.values()].filter((e) => s.teamId && e.teamId === s.teamId).map((e) => e.id);
    const set = expected.get(s.projectId) ?? new Set<string>();
    for (const p of people) set.add(p);
    expected.set(s.projectId, set);
  }
  const last = new Map<string, { kind: string; at: Date; first: Date }>();
  for (const e of entries) {
    const k = `${e.projectId}|${e.employeeId}`;
    const prev = last.get(k);
    last.set(k, { kind: e.kind, at: e.at, first: prev?.first ?? e.at });
  }
  const projectIds = new Set([...expected.keys(), ...entries.map((e) => e.projectId)]);
  const projects = await tx.project.findMany({
    where: { id: { in: [...projectIds] } },
    include: { site: { select: { street: true, postalCode: true, city: true } } },
  });
  const sites = projects
    .map((p) => {
      const people = new Map<string, TodayDto['sites'][number]['people'][number]>();
      for (const [k, v] of last) {
        const [projectId, employeeId] = k.split('|') as [string, string];
        if (projectId !== p.id) continue;
        const e = employees.get(employeeId);
        people.set(employeeId, {
          employeeId,
          name: e ? `${e.firstName} ${e.lastName}` : '—',
          status: v.kind === 'in' ? 'on_site' : 'left',
          since: (v.kind === 'in' ? v.at : v.first).toISOString(),
        });
      }
      for (const employeeId of expected.get(p.id) ?? []) {
        if (people.has(employeeId)) continue;
        const e = employees.get(employeeId);
        people.set(employeeId, {
          employeeId,
          name: e ? `${e.firstName} ${e.lastName}` : '—',
          status: 'expected',
          since: null,
        });
      }
      const list = [...people.values()].sort(
        (a, b) =>
          ['on_site', 'expected', 'left'].indexOf(a.status) -
            ['on_site', 'expected', 'left'].indexOf(b.status) || a.name.localeCompare(b.name),
      );
      return {
        project: { id: p.id, number: p.number, name: p.name },
        address: p.site ? `${p.site.street}, ${p.site.postalCode} ${p.site.city}` : null,
        people: list,
        present: list.filter((x) => x.status === 'on_site').length,
        expected: list.length,
      };
    })
    .sort((a, b) => b.present - a.present || a.project.name.localeCompare(b.project.name));

  // Ce qui a bougé depuis hier : le fil de tous les chantiers.
  const timeline = await tx.timelineEntry.findMany({
    where: { occurredAt: { gte: since }, projectId: { not: null } },
    orderBy: { occurredAt: 'desc' },
    take: 40,
  });
  const changedProjects = new Map(
    (
      await tx.project.findMany({
        where: { id: { in: [...new Set(timeline.flatMap((t) => (t.projectId ? [t.projectId] : [])))] } },
        select: { id: true, number: true, name: true },
      })
    ).map((p) => [p.id, p]),
  );
  const changes = timeline.map((t) => ({
    id: t.id,
    at: t.occurredAt.toISOString(),
    type: t.type,
    title: t.title,
    body: t.body,
    amount: opts.finance && t.amount !== null ? Number(t.amount) : null,
    project: t.projectId ? (changedProjects.get(t.projectId) ?? null) : null,
  }));

  const alerts: AlertDto[] = [];
  const push = (a: AlertDto) => alerts.push(a);
  const threshold = await driftThresholdOf(tx, tenantId);
  const active = await tx.project.findMany({
    where: { status: { in: ['preparation', 'in_progress', 'suspended'] } },
    select: { id: true, number: true, name: true, contractAmount: true, endDate: true, status: true },
  });
  if (opts.finance) {
    const numbers = await loadProjectNumbers(tx, active, threshold);
    for (const p of active) {
      const n = numbers.get(p.id);
      if (!n?.fin.driftingLineIds.length) continue;
      const posts = n.fin.lines.filter((l) => n.fin.driftingLineIds.includes(l.id));
      const labels = n.lines.filter((l) => n.fin.driftingLineIds.includes(l.id)).map((l) => l.label);
      push({
        id: `drift:${p.id}`,
        kind: 'budget_drift',
        severity: 'crit',
        title: `Dérive de marge : ${p.name}`,
        detail: labels.join(', ') || null,
        link: `/chantiers/${p.id}?onglet=budget`,
        amount: Number(sumCents(posts.map((l) => l.projectedCost - l.budgetedCost))),
      });
    }
  }
  for (const p of active)
    if (p.status === 'in_progress' && p.endDate && iso(p.endDate)! < today)
      push({
        id: `late:${p.id}`,
        kind: 'project_late',
        severity: 'warn',
        title: `En retard : ${p.name}`,
        detail: `Fin prévue le ${iso(p.endDate)}`,
        link: `/chantiers/${p.id}`,
        amount: null,
      });
  if (opts.finance) {
    const overdue = (await openInvoices(tx)).filter(
      (i) => iso(i.dueDate) && iso(i.dueDate)! < today && balanceOf(i) > 0n,
    );
    if (overdue.length)
      push({
        id: 'invoices:overdue',
        kind: 'invoice_overdue',
        severity: 'crit',
        title:
          overdue.length > 1 ? `${overdue.length} factures échues` : `Facture échue : ${overdue[0]!.number}`,
        detail: overdue
          .slice(0, 3)
          .map((i) => `${i.number} · ${i.customer.displayName}`)
          .join(' ; '),
        link: '/facturation?vue=echues',
        amount: Number(sumCents(overdue.map((i) => balanceOf(i)))),
      });
  }
  if (opts.can('subcontracting.read')) {
    const docs = await tx.subcontractorDocument.findMany({
      where: { alertState: { in: ['expiring', 'expired'] }, supplier: { archivedAt: null } },
      include: { supplier: { select: { id: true, name: true } } },
    });
    for (const d of docs)
      push({
        id: `doc:${d.id}`,
        kind: 'subcontractor_document',
        severity: d.alertState === 'expired' ? 'crit' : 'warn',
        title: `${d.alertState === 'expired' ? 'Document expiré' : 'Document à renouveler'} : ${d.supplier.name}`,
        detail: d.expiresOn ? `Échéance ${iso(d.expiresOn)}` : null,
        link: `/sous-traitance/${d.supplier.id}`,
        amount: null,
      });
  }
  if (opts.can('supplier_invoices.read')) {
    const blocked = await tx.supplierInvoice.findMany({
      where: { status: 'blocked' },
      select: { id: true, supplierName: true, number: true },
    });
    for (const b of blocked)
      push({
        id: `30bis:${b.id}`,
        kind: 'thirty_bis_blocked',
        severity: 'crit',
        title: `Paiement bloqué (30bis) : ${b.supplierName}`,
        detail: b.number,
        link: `/achats/factures?facture=${b.id}`,
        amount: null,
      });
    const toAllocate = await tx.supplierInvoice.count({
      where: { status: { in: ['received', 'to_allocate'] } },
    });
    if (toAllocate)
      push({
        id: 'supplier:to_allocate',
        kind: 'supplier_invoice_to_allocate',
        severity: 'info',
        title: `${toAllocate} facture${toAllocate > 1 ? 's' : ''} fournisseur à imputer`,
        detail: null,
        link: '/achats/factures',
        amount: null,
      });
  }
  if (opts.can('stock.read')) {
    const low = await tx.stockLevel.findMany({ where: { alertedAt: { not: null } } });
    if (low.length)
      push({
        id: 'stock:low',
        kind: 'stock_low',
        severity: 'warn',
        title: `${low.length} article${low.length > 1 ? 's' : ''} sous le seuil`,
        detail: null,
        link: '/stock?onglet=reappro',
        amount: null,
      });
  }
  if (opts.can('equipment.read')) {
    const due = await tx.maintenanceEvent.findMany({
      where: { doneOn: null, dueOn: { lte: day(addDays(today, 14)) }, equipment: { archivedAt: null } },
      include: { equipment: { select: { id: true, name: true } } },
    });
    for (const m of due) {
      const s = maintenanceStatus(iso(m.dueOn)!, today);
      push({
        id: `maint:${m.id}`,
        kind: 'maintenance_due',
        severity: s === 'overdue' ? 'crit' : 'warn',
        title: `${s === 'overdue' ? 'Entretien en retard' : 'Entretien à prévoir'} : ${m.equipment.name}`,
        detail: `${m.label} · ${iso(m.dueOn)}`,
        link: `/materiel/${m.equipment.id}`,
        amount: null,
      });
    }
  }
  const urgent = await tx.issue.findMany({
    where: { urgent: true, status: 'open' },
    include: { project: { select: { id: true, name: true } } },
    take: 10,
  });
  for (const i of urgent)
    push({
      id: `issue:${i.id}`,
      kind: 'urgent_issue',
      severity: 'crit',
      title: `Signalement urgent : ${i.title}`,
      detail: i.project.name,
      link: `/chantiers/${i.project.id}?signalement=${i.id}`,
      amount: null,
    });
  if (opts.can('accounting.read')) {
    const errors = await tx.accountingSync.count({ where: { status: 'error' } });
    if (errors)
      push({
        id: 'accounting:error',
        kind: 'accounting_error',
        severity: 'warn',
        title: `${errors} document${errors > 1 ? 's' : ''} en erreur de synchro comptable`,
        detail: null,
        link: '/comptabilite?statut=error',
        amount: null,
      });
  }
  const rank = { crit: 0, warn: 1, info: 2 } as const;
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);

  let figures: TodayDto['figures'] = null;
  if (opts.finance) {
    const month = { from: `${today.slice(0, 7)}-01`, to: today };
    const { invoices, payments } = await invoicedAndCollected(tx, month, {});
    const open = await openInvoices(tx);
    const ob = await orderBookReport(tx, tenantId, {});
    figures = {
      invoicedThisMonth: Number(
        sumCents(invoices.map((i) => (i.type === 'credit_note' ? -i.totalNet : i.totalNet))),
      ),
      collectedThisMonth: Number(sumCents(payments.map((p) => p.amount))),
      overdue: Number(
        sumCents(open.filter((i) => iso(i.dueDate) && iso(i.dueDate)! < today).map((i) => balanceOf(i))),
      ),
      orderBook: ob.total,
    };
  }
  return { date: today, since: since.toISOString(), sites, changes, alerts, figures };
}
