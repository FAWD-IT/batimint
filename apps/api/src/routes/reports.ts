/**
 * Pilotage (03 §12, 02 P11) : « Aujourd'hui », tableau de bord filtrable (période, équipe,
 * responsable), rapports (rentabilité par chantier, client, type de travaux ; heures ; devis ;
 * carnet de commandes ; trésorerie à 90 jours), chacun exportable en CSV et Excel.
 */
import {
  CashBalanceInputSchema,
  CashForecastSchema,
  DashboardSchema,
  ExportFormatSchema,
  HoursReportSchema,
  OrderBookReportSchema,
  parseTenantSettings,
  ProfitabilityReportSchema,
  QuotesReportSchema,
  ReportFiltersSchema,
  TodaySchema,
} from '@batimint/contracts';
import { brusselsDate, can, type Period, periodBounds, ReportingError } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest } from '../lib/errors';
import { type Column, sendTable } from '../lib/export';
import { inTenant } from '../lib/tenant';
import {
  buildCashForecast,
  buildDashboard,
  buildToday,
  hoursReport,
  orderBookReport,
  profitabilityRows,
  quotesReport,
} from '../services/reporting';

function periodOf(q: z.infer<typeof ReportFiltersSchema>, today: string): Period {
  try {
    return periodBounds(q.period, today, { from: q.from, to: q.to });
  } catch (err) {
    if (err instanceof ReportingError) throw badRequest(err.code, err.message);
    throw err;
  }
}

const GROUP_LABELS = { project: 'Chantier', customer: 'Client', trade: 'Type de travaux' } as const;
const STATUS_FR: Record<string, string> = {
  sent: 'Envoyé',
  signed: 'Signé',
  refused: 'Refusé',
  expired: 'Expiré',
  draft: 'Brouillon',
};
const KIND_FR: Record<string, string> = {
  receivable: 'Facture client',
  retention: 'Retenue de garantie',
  planned_billing: 'Facturation prévue',
  payable: 'Facture fournisseur',
  subcontract: 'Sous-traitance',
  payroll: 'Salaires',
};

export const reportRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/today',
    {
      schema: {
        tags: ['pilotage'],
        summary: 'Aujourd’hui : qui est où, ce qui a bougé depuis hier, alertes',
        response: { 200: TodaySchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'projects.read', ({ tx, auth }) =>
        buildToday(tx, auth.tenantId, new Date(), {
          finance: can(auth.role, 'projects.finance.read') && can(auth.role, 'invoices.read'),
          can: (a) => can(auth.role, a as Parameters<typeof can>[1]),
        }),
      ),
  );

  app.get(
    '/dashboard',
    {
      schema: {
        tags: ['pilotage'],
        summary: 'Tableau de bord : CA facturé et encaissé, encours, marges, carnet, devis, trésorerie',
        querystring: ReportFiltersSchema,
        response: { 200: DashboardSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'reports.read', ({ tx, auth }) => {
        const today = brusselsDate(new Date());
        return buildDashboard(tx, auth.tenantId, periodOf(req.query, today), req.query, today);
      }),
  );

  app.put(
    '/dashboard/cash-balance',
    {
      schema: {
        tags: ['pilotage'],
        summary: 'Solde bancaire connu, point de départ de la trésorerie prévisionnelle',
        body: CashBalanceInputSchema.nullable(),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'settings.update', async ({ tx, auth, audit }) => {
        const t = await tx.tenant.findUniqueOrThrow({
          where: { id: auth.tenantId },
          select: { settings: true },
        });
        const settings = { ...parseTenantSettings(t.settings), cashBalance: req.body };
        await tx.tenant.update({ where: { id: auth.tenantId }, data: { settings } });
        await audit('settings.cash_balance', 'tenant', auth.tenantId, req.body);
        return { ok: true as const };
      }),
  );

  app.get(
    '/reports/cash-forecast',
    {
      schema: {
        tags: ['pilotage'],
        summary: 'Trésorerie prévisionnelle à 90 jours (factures, échéanciers, achats, salaires)',
        response: { 200: CashForecastSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'reports.read', ({ tx, auth }) =>
        buildCashForecast(tx, auth.tenantId, brusselsDate(new Date())),
      ),
  );

  const ProfitabilityQuery = ReportFiltersSchema.extend({
    groupBy: z.enum(['project', 'customer', 'trade']).default('project'),
  });
  app.get(
    '/reports/profitability',
    {
      schema: {
        tags: ['pilotage'],
        summary: 'Rentabilité par chantier, client ou type de travaux',
        querystring: ProfitabilityQuery,
        response: { 200: ProfitabilityReportSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'reports.read', ({ tx, auth }) =>
        profitabilityRows(
          tx,
          auth.tenantId,
          periodOf(req.query, brusselsDate(new Date())),
          req.query,
          req.query.groupBy,
        ),
      ),
  );

  const HoursQuery = ReportFiltersSchema.extend({ groupBy: z.enum(['person', 'project']).default('person') });
  app.get(
    '/reports/hours',
    {
      schema: {
        tags: ['pilotage'],
        summary: 'Heures par personne ou par chantier, comparées au planning',
        querystring: HoursQuery,
        response: { 200: HoursReportSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'reports.read', ({ tx, auth }) =>
        hoursReport(tx, auth.tenantId, periodOf(req.query, brusselsDate(new Date())), req.query.groupBy),
      ),
  );

  app.get(
    '/reports/quotes',
    {
      schema: {
        tags: ['pilotage'],
        summary: 'Transformation des devis envoyés sur la période',
        querystring: ReportFiltersSchema,
        response: { 200: QuotesReportSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'reports.read', ({ tx }) =>
        quotesReport(tx, periodOf(req.query, brusselsDate(new Date()))),
      ),
  );

  app.get(
    '/reports/order-book',
    {
      schema: {
        tags: ['pilotage'],
        summary: 'Carnet de commandes : contrats signés restant à facturer',
        querystring: ReportFiltersSchema.pick({ teamId: true, managerId: true }),
        response: { 200: OrderBookReportSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'reports.read', ({ tx, auth }) => orderBookReport(tx, auth.tenantId, req.query)),
  );

  // -------------------------------------------------------------------------
  // Exports des rapports (CSV et Excel)
  // -------------------------------------------------------------------------
  app.get(
    '/reports/:report/export',
    {
      schema: {
        tags: ['pilotage'],
        summary: 'Exporter un rapport en CSV ou Excel',
        params: z.object({
          report: z.enum(['profitability', 'hours', 'quotes', 'order-book', 'cash-forecast']),
        }),
        querystring: ReportFiltersSchema.extend({
          format: ExportFormatSchema.default('xlsx'),
          groupBy: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const q = req.query;
      const today = brusselsDate(new Date());
      const suffix = today;
      const table = await inTenant(deps, req, 'exports.read', async ({ tx, auth }) => {
        switch (req.params.report) {
          case 'profitability': {
            const groupBy =
              (['project', 'customer', 'trade'] as const).find((g) => g === q.groupBy) ?? 'project';
            const r = await profitabilityRows(tx, auth.tenantId, periodOf(q, today), q, groupBy);
            type Row = (typeof r.rows)[number];
            const columns: Column<Row>[] = [
              { label: GROUP_LABELS[groupBy], value: (x) => x.label },
              { label: 'Chantiers', type: 'number', value: (x) => x.count },
              { label: 'Vendu HTVA', type: 'money', value: (x) => x.sold },
              { label: 'Coût projeté', type: 'money', value: (x) => x.cost },
              { label: 'Marge', type: 'money', value: (x) => x.margin },
              { label: 'Marge %', type: 'percent', value: (x) => x.marginRate },
            ];
            return {
              filename: `rentabilite-${groupBy}-${suffix}`,
              sheet: 'Rentabilité',
              columns,
              rows: [...r.rows, r.totals],
            };
          }
          case 'hours': {
            const groupBy = q.groupBy === 'project' ? 'project' : 'person';
            const r = await hoursReport(tx, auth.tenantId, periodOf(q, today), groupBy);
            type Row = (typeof r.rows)[number];
            const columns: Column<Row>[] = [
              { label: groupBy === 'person' ? 'Personne' : 'Chantier', value: (x) => x.label },
              { label: 'Heures réelles', type: 'hours', value: (x) => x.actualMinutes },
              { label: 'Heures prévues', type: 'hours', value: (x) => x.plannedMinutes },
              { label: 'Écart (h)', type: 'hours', value: (x) => x.varianceMinutes },
              { label: 'Réel / prévu', type: 'percent', value: (x) => x.ratio },
            ];
            return { filename: `heures-${groupBy}-${suffix}`, sheet: 'Heures', columns, rows: r.rows };
          }
          case 'quotes': {
            const r = await quotesReport(tx, periodOf(q, today));
            type Row = (typeof r.rows)[number];
            const columns: Column<Row>[] = [
              { label: 'Numéro', value: (x) => x.number },
              { label: 'Objet', value: (x) => x.title },
              { label: 'Client', value: (x) => x.customer },
              { label: 'Envoyé le', type: 'date', value: (x) => x.sentAt },
              { label: 'Statut', value: (x) => STATUS_FR[x.status] ?? x.status },
              { label: 'Montant HTVA', type: 'money', value: (x) => x.amount },
            ];
            return { filename: `devis-${suffix}`, sheet: 'Devis', columns, rows: r.rows };
          }
          case 'order-book': {
            const r = await orderBookReport(tx, auth.tenantId, q);
            type Row = (typeof r.rows)[number];
            const columns: Column<Row>[] = [
              { label: 'Chantier', value: (x) => `${x.project.number} · ${x.project.name}` },
              { label: 'Client', value: (x) => x.customer },
              { label: 'Contrat HTVA', type: 'money', value: (x) => x.contract },
              { label: 'Facturé HTVA', type: 'money', value: (x) => x.invoiced },
              { label: 'Reste à facturer', type: 'money', value: (x) => x.remaining },
              { label: 'Fin prévue', type: 'date', value: (x) => x.endDate },
            ];
            return {
              filename: `carnet-commandes-${suffix}`,
              sheet: 'Carnet de commandes',
              columns,
              rows: r.rows,
            };
          }
          case 'cash-forecast': {
            const r = await buildCashForecast(tx, auth.tenantId, today);
            type Row = (typeof r.items)[number];
            const columns: Column<Row>[] = [
              { label: 'Date prévue', type: 'date', value: (x) => x.expectedOn },
              { label: 'Échéance', type: 'date', value: (x) => x.date },
              { label: 'Type', value: (x) => KIND_FR[x.kind] ?? x.kind },
              { label: 'Libellé', value: (x) => x.label },
              { label: 'Entrée', type: 'money', value: (x) => (x.direction === 'in' ? x.amount : null) },
              { label: 'Sortie', type: 'money', value: (x) => (x.direction === 'out' ? x.amount : null) },
              { label: 'En retard', value: (x) => (x.overdue ? 'oui' : '') },
            ];
            return { filename: `tresorerie-90-jours-${suffix}`, sheet: 'Trésorerie', columns, rows: r.items };
          }
        }
      });
      return sendTable(reply, table as Parameters<typeof sendTable>[1], q.format);
    },
  );
};
