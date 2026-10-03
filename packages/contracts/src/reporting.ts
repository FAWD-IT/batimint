/**
 * Pilotage (03 §12, 02 P11) : « Aujourd'hui » (qui est où, ce qui a bougé, alertes), tableau de
 * bord filtrable, rapports exportables, trésorerie à 90 jours. Montants en centimes ; un rôle sans
 * accès aux finances reçoit `null` à la place.
 */
import { z } from 'zod';
import { CentsSchema, Uuid } from './common';

const IsoDay = z.iso.date();
const ProjectRef = z.object({ id: Uuid, number: z.string(), name: z.string() });

export const TodayPersonSchema = z.object({
  employeeId: Uuid,
  name: z.string(),
  /** Sur place, attendu (planning) mais pas encore pointé, ou parti. */
  status: z.enum(['on_site', 'expected', 'left']),
  since: z.string().nullable(),
});

export const TodaySiteSchema = z.object({
  project: ProjectRef,
  address: z.string().nullable(),
  people: z.array(TodayPersonSchema),
  present: z.number().int(),
  expected: z.number().int(),
});

export const TodayChangeSchema = z.object({
  id: Uuid,
  at: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  amount: CentsSchema.nullable(),
  project: ProjectRef.nullable(),
});

export const AlertKindSchema = z.enum([
  'budget_drift',
  'project_late',
  'invoice_overdue',
  'subcontractor_document',
  'thirty_bis_blocked',
  'supplier_invoice_to_allocate',
  'stock_low',
  'maintenance_due',
  'urgent_issue',
  'accounting_error',
]);
export type AlertKind = z.infer<typeof AlertKindSchema>;

export const AlertSchema = z.object({
  id: z.string(),
  kind: AlertKindSchema,
  severity: z.enum(['crit', 'warn', 'info']),
  title: z.string(),
  detail: z.string().nullable(),
  link: z.string(),
  amount: CentsSchema.nullable(),
});
export type AlertDto = z.infer<typeof AlertSchema>;

export const TodaySchema = z.object({
  date: IsoDay,
  since: z.string(),
  sites: z.array(TodaySiteSchema),
  changes: z.array(TodayChangeSchema),
  alerts: z.array(AlertSchema),
  /** Chiffres du mois (accès finances seulement). */
  figures: z
    .object({
      invoicedThisMonth: CentsSchema,
      collectedThisMonth: CentsSchema,
      overdue: CentsSchema,
      orderBook: CentsSchema,
    })
    .nullable(),
});
export type TodayDto = z.infer<typeof TodaySchema>;

export const QuoteConversionSchema = z.object({
  sent: z.number().int(),
  signed: z.number().int(),
  refused: z.number().int(),
  expired: z.number().int(),
  open: z.number().int(),
  rate: z.string().nullable(),
  amountSent: CentsSchema,
  amountSigned: CentsSchema,
});

export const CashWeekSchema = z.object({
  start: IsoDay,
  end: IsoDay,
  inflow: CentsSchema,
  outflow: CentsSchema,
  net: CentsSchema,
  balance: CentsSchema,
});

export const CashItemSchema = z.object({
  date: IsoDay,
  expectedOn: IsoDay,
  amount: CentsSchema,
  direction: z.enum(['in', 'out']),
  kind: z.enum(['receivable', 'retention', 'planned_billing', 'payable', 'subcontract', 'payroll']),
  label: z.string(),
  overdue: z.boolean(),
  link: z.string().nullable(),
});

export const CashForecastSchema = z.object({
  from: IsoDay,
  to: IsoDay,
  openingBalance: CentsSchema.nullable(),
  openingBalanceOn: IsoDay.nullable(),
  weeks: z.array(CashWeekSchema),
  totals: z.object({ inflow: CentsSchema, outflow: CentsSchema, net: CentsSchema }),
  overdue: z.object({ inflow: CentsSchema, outflow: CentsSchema }),
  lowest: z.object({ date: IsoDay, balance: CentsSchema }).nullable(),
  monthlyPayroll: CentsSchema,
  items: z.array(CashItemSchema),
});
export type CashForecastDto = z.infer<typeof CashForecastSchema>;

export const ProjectMarginSchema = z.object({
  project: ProjectRef,
  customer: z.string(),
  status: z.string(),
  manager: z.string().nullable(),
  team: z.string().nullable(),
  sold: CentsSchema,
  cost: CentsSchema,
  projectedCost: CentsSchema,
  margin: CentsSchema,
  marginRate: z.string().nullable(),
  progress: z.string(),
  invoiced: CentsSchema,
  drifting: z.boolean(),
});
export type ProjectMarginDto = z.infer<typeof ProjectMarginSchema>;

export const ReportFiltersSchema = z.object({
  period: z.enum(['month', 'quarter', 'year', 'custom']).default('month'),
  from: IsoDay.optional(),
  to: IsoDay.optional(),
  teamId: Uuid.optional(),
  managerId: Uuid.optional(),
});
export type ReportFilters = z.input<typeof ReportFiltersSchema>;

export const DashboardSchema = z.object({
  period: z.object({ from: IsoDay, to: IsoDay }),
  kpis: z.object({
    invoiced: CentsSchema,
    collected: CentsSchema,
    outstanding: CentsSchema,
    overdue: CentsSchema,
    orderBook: CentsSchema,
    marginRate: z.string().nullable(),
    quotes: QuoteConversionSchema,
  }),
  months: z.array(z.object({ month: z.string(), invoiced: CentsSchema, collected: CentsSchema })),
  projects: z.array(ProjectMarginSchema),
  cash: CashForecastSchema.omit({ items: true }),
  options: z.object({
    teams: z.array(z.object({ id: Uuid, name: z.string() })),
    managers: z.array(z.object({ id: Uuid, name: z.string() })),
  }),
});
export type DashboardDto = z.infer<typeof DashboardSchema>;

export const MarginGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int(),
  sold: CentsSchema,
  cost: CentsSchema,
  margin: CentsSchema,
  marginRate: z.string().nullable(),
});

export const ProfitabilityReportSchema = z.object({
  groupBy: z.enum(['project', 'customer', 'trade']),
  period: z.object({ from: IsoDay, to: IsoDay }),
  rows: z.array(MarginGroupSchema),
  totals: MarginGroupSchema,
});
export type ProfitabilityReportDto = z.infer<typeof ProfitabilityReportSchema>;

export const HoursReportSchema = z.object({
  groupBy: z.enum(['person', 'project']),
  period: z.object({ from: IsoDay, to: IsoDay }),
  rows: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      actualMinutes: z.number().int(),
      plannedMinutes: z.number().int(),
      varianceMinutes: z.number().int(),
      ratio: z.string().nullable(),
    }),
  ),
});
export type HoursReportDto = z.infer<typeof HoursReportSchema>;

export const QuotesReportSchema = z.object({
  period: z.object({ from: IsoDay, to: IsoDay }),
  conversion: QuoteConversionSchema,
  rows: z.array(
    z.object({
      id: Uuid,
      number: z.string().nullable(),
      title: z.string(),
      customer: z.string(),
      status: z.string(),
      sentAt: z.string().nullable(),
      amount: CentsSchema,
    }),
  ),
});
export type QuotesReportDto = z.infer<typeof QuotesReportSchema>;

export const OrderBookReportSchema = z.object({
  total: CentsSchema,
  rows: z.array(
    z.object({
      project: ProjectRef,
      customer: z.string(),
      status: z.string(),
      contract: CentsSchema,
      invoiced: CentsSchema,
      remaining: CentsSchema,
      endDate: IsoDay.nullable(),
    }),
  ),
});
export type OrderBookReportDto = z.infer<typeof OrderBookReportSchema>;

export const CashBalanceInputSchema = z.object({
  amount: CentsSchema,
  on: IsoDay,
});

/** Listes exportables en CSV et Excel (03 §12 « Exports CSV et Excel de chaque liste »). */
export const EXPORT_LISTS = [
  'customers',
  'quotes',
  'projects',
  'invoices',
  'payments',
  'supplier-invoices',
  'purchase-orders',
  'stock',
  'equipment',
  'time-entries',
] as const;
export const ExportListSchema = z.enum(EXPORT_LISTS);
export type ExportList = z.infer<typeof ExportListSchema>;
export const ExportFormatSchema = z.enum(['csv', 'xlsx']);

/** Vue carte des chantiers actifs (03 §5) : position du site, précise ou approximative. */
export const ProjectMapSchema = z.object({
  items: z.array(
    z.object({
      project: ProjectRef,
      status: z.string(),
      customer: z.string(),
      address: z.string().nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      /** Position déduite du code postal (non utilisée pour le contrôle de présence). */
      approximate: z.boolean(),
      present: z.number().int(),
    }),
  ),
  /** Villes de repère pour s'orienter sans fond de carte. */
  references: z.array(z.object({ name: z.string(), latitude: z.number(), longitude: z.number() })),
});
export type ProjectMapDto = z.infer<typeof ProjectMapSchema>;
