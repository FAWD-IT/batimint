/**
 * Exports CSV et Excel de chaque liste (03 §12) : clients, devis, chantiers, factures, paiements,
 * factures fournisseurs, bons de commande, stock, matériel, pointages. Chaque export respecte la
 * permission de la liste ; les montants n'apparaissent que pour les rôles qui les voient.
 */
import { ExportFormatSchema, ExportListSchema } from '@batimint/contracts';
import { type Action, brusselsDate, can, dec, formatQuantity, multiplyCents } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { forbidden } from '../lib/errors';
import { type Column, sendTable, type Table } from '../lib/export';
import { inTenant } from '../lib/tenant';
import { balanceOf } from '../services/invoicing';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const PERMISSION: Record<z.infer<typeof ExportListSchema>, Action> = {
  customers: 'customers.read',
  quotes: 'quotes.read',
  projects: 'projects.read',
  invoices: 'invoices.read',
  payments: 'payments.read',
  'supplier-invoices': 'supplier_invoices.read',
  'purchase-orders': 'purchases.read',
  stock: 'stock.read',
  equipment: 'equipment.read',
  'time-entries': 'time.validate',
};

const STATUS_FR: Record<string, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  viewed: 'Consulté',
  signed: 'Signé',
  refused: 'Refusé',
  expired: 'Expiré',
  superseded: 'Remplacé',
  issued: 'Émise',
  delivered: 'Délivrée',
  partially_paid: 'Partiellement payée',
  paid: 'Payée',
  cancelled: 'Annulée',
  preparation: 'En préparation',
  in_progress: 'En cours',
  suspended: 'Suspendu',
  provisional_acceptance: 'Réception provisoire',
  final_acceptance: 'Réception définitive',
  closed: 'Clôturé',
  received: 'Reçue',
  to_allocate: 'À imputer',
  allocated: 'Imputée',
  validated: 'Validée',
  to_pay: 'À payer',
  blocked: 'Bloquée',
  partially_received: 'Partiellement réceptionné',
  in: 'Arrivée',
  out: 'Départ',
};
const fr = (s: string) => STATUS_FR[s] ?? s;

export const exportRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/exports/:list',
    {
      schema: {
        tags: ['exports'],
        summary: 'Exporter une liste en CSV ou Excel',
        params: z.object({ list: ExportListSchema }),
        querystring: z.object({
          format: ExportFormatSchema.default('xlsx'),
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
        }),
      },
    },
    async (req, reply) => {
      const list = req.params.list;
      const { from, to } = req.query;
      const range = (field: string) =>
        from || to
          ? { [field]: { ...(from ? { gte: day(from) } : {}), ...(to ? { lte: day(to) } : {}) } }
          : {};
      const suffix = brusselsDate(new Date());
      const table = await inTenant(
        deps,
        req,
        PERMISSION[list],
        async ({ tx, auth }): Promise<Table<never>> => {
          const money = can(auth.role, 'pricing.read') || can(auth.role, 'invoices.read');
          const t = <R>(filename: string, sheet: string, columns: Column<R>[], rows: R[]) =>
            ({
              filename: `${filename}-${suffix}`,
              sheet,
              columns: columns.filter(Boolean),
              rows,
            }) as unknown as Table<never>;
          switch (list) {
            case 'customers': {
              const rows = await tx.customer.findMany({ orderBy: { displayName: 'asc' } });
              return t(
                'clients',
                'Clients',
                [
                  { label: 'Nom', value: (c) => c.displayName },
                  { label: 'Type', value: (c) => (c.kind === 'company' ? 'Entreprise' : 'Particulier') },
                  { label: 'E-mail', value: (c) => c.email },
                  { label: 'Téléphone', value: (c) => c.phone },
                  { label: 'N° d’entreprise', value: (c) => c.enterpriseNumber },
                  { label: 'N° TVA', value: (c) => c.vatNumber },
                  { label: 'Créé le', type: 'date', value: (c) => iso(c.createdAt) },
                ],
                rows,
              );
            }
            case 'quotes': {
              const rows = await tx.quote.findMany({
                where: { isTemplate: false, ...range('createdAt') },
                include: { customer: { select: { displayName: true } } },
                orderBy: { createdAt: 'desc' },
              });
              const totals = new Map(
                (
                  await tx.quoteVersion.findMany({
                    where: {
                      id: { in: rows.flatMap((q) => (q.currentVersionId ? [q.currentVersionId] : [])) },
                    },
                    select: { id: true, totalNet: true },
                  })
                ).map((v) => [v.id, v.totalNet]),
              );
              return t(
                'devis',
                'Devis',
                [
                  { label: 'Numéro', value: (q) => q.number },
                  { label: 'Objet', value: (q) => q.title },
                  { label: 'Client', value: (q) => q.customer?.displayName },
                  { label: 'Statut', value: (q) => fr(q.status) },
                  { label: 'Envoyé le', type: 'date', value: (q) => iso(q.sentAt) },
                  { label: 'Signé le', type: 'date', value: (q) => iso(q.signedAt) },
                  ...(money
                    ? [
                        {
                          label: 'Montant HTVA',
                          type: 'money' as const,
                          value: (q: (typeof rows)[number]) =>
                            q.currentVersionId ? totals.get(q.currentVersionId) : null,
                        },
                      ]
                    : []),
                ],
                rows,
              );
            }
            case 'projects': {
              const rows = await tx.project.findMany({
                include: { customer: { select: { displayName: true } }, site: { select: { city: true } } },
                orderBy: { number: 'desc' },
              });
              const finance = can(auth.role, 'projects.finance.read');
              return t(
                'chantiers',
                'Chantiers',
                [
                  { label: 'Numéro', value: (p) => p.number },
                  { label: 'Chantier', value: (p) => p.name },
                  { label: 'Client', value: (p) => p.customer.displayName },
                  { label: 'Localité', value: (p) => p.site?.city },
                  { label: 'Statut', value: (p) => fr(p.status) },
                  { label: 'Début', type: 'date', value: (p) => iso(p.startDate) },
                  { label: 'Fin prévue', type: 'date', value: (p) => iso(p.endDate) },
                  ...(finance
                    ? [
                        {
                          label: 'Contrat HTVA',
                          type: 'money' as const,
                          value: (p: (typeof rows)[number]) => p.contractAmount,
                        },
                      ]
                    : []),
                ],
                rows,
              );
            }
            case 'invoices': {
              const rows = await tx.invoice.findMany({
                where: { status: { not: 'draft' }, ...range('issueDate') },
                include: {
                  customer: { select: { displayName: true } },
                  project: { select: { number: true } },
                },
                orderBy: { issueDate: 'desc' },
              });
              return t(
                'factures',
                'Factures',
                [
                  { label: 'Numéro', value: (i) => i.number },
                  { label: 'Type', value: (i) => (i.type === 'credit_note' ? 'Note de crédit' : 'Facture') },
                  { label: 'Date', type: 'date', value: (i) => iso(i.issueDate) },
                  { label: 'Échéance', type: 'date', value: (i) => iso(i.dueDate) },
                  { label: 'Client', value: (i) => i.customer.displayName },
                  { label: 'Chantier', value: (i) => i.project?.number },
                  {
                    label: 'HTVA',
                    type: 'money',
                    value: (i) => (i.type === 'credit_note' ? -i.totalNet : i.totalNet),
                  },
                  {
                    label: 'TVA',
                    type: 'money',
                    value: (i) => (i.type === 'credit_note' ? -i.totalVat : i.totalVat),
                  },
                  {
                    label: 'TVAC',
                    type: 'money',
                    value: (i) => (i.type === 'credit_note' ? -i.totalGross : i.totalGross),
                  },
                  { label: 'Retenue', type: 'money', value: (i) => i.retentionAmount },
                  { label: 'Payé', type: 'money', value: (i) => i.amountPaid },
                  { label: 'Solde', type: 'money', value: (i) => balanceOf(i) },
                  { label: 'Statut', value: (i) => fr(i.status) },
                  { label: 'Communication', value: (i) => i.structuredCommunication },
                ],
                rows,
              );
            }
            case 'payments': {
              const rows = await tx.payment.findMany({
                where: range('receivedOn'),
                include: {
                  invoice: { select: { number: true, customer: { select: { displayName: true } } } },
                },
                orderBy: { receivedOn: 'desc' },
              });
              return t(
                'paiements',
                'Paiements',
                [
                  { label: 'Reçu le', type: 'date', value: (p) => iso(p.receivedOn) },
                  { label: 'Facture', value: (p) => p.invoice.number },
                  { label: 'Client', value: (p) => p.invoice.customer.displayName },
                  { label: 'Montant', type: 'money', value: (p) => p.amount },
                  { label: 'Moyen', value: (p) => p.method },
                  { label: 'Référence', value: (p) => p.reference },
                ],
                rows,
              );
            }
            case 'supplier-invoices': {
              const rows = await tx.supplierInvoice.findMany({
                where: range('issueDate'),
                orderBy: { receivedAt: 'desc' },
              });
              const projects = new Map(
                (await tx.project.findMany({ select: { id: true, number: true } })).map((p) => [
                  p.id,
                  p.number,
                ]),
              );
              return t(
                'factures-fournisseurs',
                'Achats',
                [
                  { label: 'Fournisseur', value: (s) => s.supplierName },
                  { label: 'N° TVA', value: (s) => s.supplierVat },
                  { label: 'Numéro', value: (s) => s.number },
                  { label: 'Date', type: 'date', value: (s) => iso(s.issueDate) },
                  { label: 'Échéance', type: 'date', value: (s) => iso(s.dueDate) },
                  { label: 'Chantier', value: (s) => (s.projectId ? projects.get(s.projectId) : null) },
                  { label: 'HTVA', type: 'money', value: (s) => s.totalNet },
                  { label: 'TVA', type: 'money', value: (s) => s.totalVat },
                  { label: 'TVAC', type: 'money', value: (s) => s.totalGross },
                  {
                    label: 'Retenue 30bis',
                    type: 'money',
                    value: (s) => (s.withholdingAppliedAt ? s.withholdingSocial + s.withholdingTax : null),
                  },
                  { label: 'Statut', value: (s) => fr(s.status) },
                  { label: 'Source', value: (s) => s.source },
                ],
                rows,
              );
            }
            case 'purchase-orders': {
              const rows = await tx.purchaseOrder.findMany({
                where: range('createdAt'),
                include: {
                  supplier: { select: { name: true } },
                  project: { select: { number: true } },
                  stockLocation: { select: { name: true } },
                },
                orderBy: { createdAt: 'desc' },
              });
              return t(
                'bons-de-commande',
                'Bons de commande',
                [
                  { label: 'Numéro', value: (p) => p.number },
                  { label: 'Fournisseur', value: (p) => p.supplier.name },
                  { label: 'Destination', value: (p) => p.project?.number ?? p.stockLocation?.name },
                  { label: 'Statut', value: (p) => fr(p.status) },
                  { label: 'Créé le', type: 'date', value: (p) => iso(p.createdAt) },
                  { label: 'Envoyé le', type: 'date', value: (p) => iso(p.sentAt) },
                  { label: 'Total HTVA', type: 'money', value: (p) => p.totalNet },
                ],
                rows,
              );
            }
            case 'stock': {
              const levels = await tx.stockLevel.findMany();
              const items = new Map(
                (await tx.item.findMany({ where: { id: { in: levels.map((l) => l.itemId) } } })).map((i) => [
                  i.id,
                  i,
                ]),
              );
              const locations = new Map((await tx.stockLocation.findMany()).map((l) => [l.id, l.name]));
              const rows = levels
                .map((l) => ({ l, item: items.get(l.itemId)! }))
                .filter((r) => r.item)
                .sort((a, b) => a.item.name.localeCompare(b.item.name));
              return t(
                'stock',
                'Stock',
                [
                  { label: 'Code', value: (r) => r.item.code },
                  { label: 'Article', value: (r) => r.item.name },
                  { label: 'Emplacement', value: (r) => locations.get(r.l.locationId) },
                  { label: 'Quantité', value: (r) => formatQuantity(r.l.quantity.toString()) },
                  { label: 'Unité', value: (r) => r.item.unit },
                  {
                    label: 'Seuil',
                    value: (r) => (r.l.minQuantity ? formatQuantity(r.l.minQuantity.toString()) : null),
                  },
                  ...(money
                    ? [
                        {
                          label: 'Coût moyen',
                          type: 'money' as const,
                          value: (r: (typeof rows)[number]) => r.item.stockAverageCost,
                        },
                        {
                          label: 'Valeur',
                          type: 'money' as const,
                          value: (r: (typeof rows)[number]) =>
                            multiplyCents(r.item.stockAverageCost, dec(r.l.quantity.toString())),
                        },
                      ]
                    : []),
                ],
                rows,
              );
            }
            case 'equipment': {
              const rows = await tx.equipment.findMany({
                where: { archivedAt: null },
                include: {
                  assignments: {
                    where: { endDate: null },
                    include: { project: { select: { number: true, name: true } } },
                  },
                  maintenance: { where: { doneOn: null }, orderBy: { dueOn: 'asc' }, take: 1 },
                },
                orderBy: { name: 'asc' },
              });
              return t(
                'materiel',
                'Matériel',
                [
                  { label: 'Code', value: (e) => e.code },
                  { label: 'Matériel', value: (e) => e.name },
                  { label: 'Catégorie', value: (e) => e.category },
                  { label: 'N° de série', value: (e) => e.serialNumber },
                  {
                    label: 'Affecté à',
                    value: (e) =>
                      e.assignments[0]
                        ? `${e.assignments[0].project.number} · ${e.assignments[0].project.name}`
                        : null,
                  },
                  { label: 'Prochain entretien', value: (e) => e.maintenance[0]?.label },
                  { label: 'Échéance', type: 'date', value: (e) => iso(e.maintenance[0]?.dueOn) },
                  ...(money
                    ? [
                        {
                          label: 'Coût / jour',
                          type: 'money' as const,
                          value: (e: (typeof rows)[number]) => e.dailyCost,
                        },
                      ]
                    : []),
                ],
                rows,
              );
            }
            case 'time-entries': {
              const rows = await tx.timeEntry.findMany({
                where: range('day'),
                orderBy: [{ day: 'desc' }, { at: 'asc' }],
                take: 20_000,
              });
              const employees = new Map(
                (await tx.employee.findMany({ select: { id: true, firstName: true, lastName: true } })).map(
                  (e) => [e.id, `${e.firstName} ${e.lastName}`],
                ),
              );
              const projects = new Map(
                (await tx.project.findMany({ select: { id: true, number: true, name: true } })).map((p) => [
                  p.id,
                  `${p.number} · ${p.name}`,
                ]),
              );
              return t(
                'pointages',
                'Pointages',
                [
                  { label: 'Jour', type: 'date', value: (e) => iso(e.day) },
                  {
                    label: 'Heure',
                    value: (e) =>
                      e.at.toLocaleTimeString('fr-BE', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Europe/Brussels',
                      }),
                  },
                  { label: 'Personne', value: (e) => employees.get(e.employeeId) },
                  { label: 'Chantier', value: (e) => projects.get(e.projectId) },
                  { label: 'Type', value: (e) => fr(e.kind) },
                  { label: 'Statut', value: (e) => e.status },
                ],
                rows,
              );
            }
          }
          throw forbidden();
        },
      );
      return sendTable(reply, table, req.query.format);
    },
  );
};
