/**
 * Stock et matériel (03 §11, 02 P13) — effets idempotents :
 *  - sortie de stock vers un chantier : coût au coût moyen pondéré imputé au poste (« Engagé ») ;
 *  - stock sous le seuil : notification au bureau (une par passage sous le seuil) ;
 *  - matériel affecté, rendu ou recalculé : coût d'usage (jours ouvrés × coût journalier) imputé
 *    au poste, entrée du fil à l'affectation et au retour ;
 *  - entretien ou contrôle bientôt dû ou en retard : notification au bureau.
 */
import { parseEventPayload, projectChannel, tenantChannel } from '@batimint/contracts';
import { brusselsDate, equipmentUsageCost, equipmentUsageDays } from '@batimint/domain';
import type { Consumer, ConsumerContext } from '../consumer';
import { upsertCost } from './purchasing';
import { dateFr, notify, office } from './shared';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function publishStock(ctx: ConsumerContext, topic: 'stock' | 'equipment', ref: string) {
  await ctx.publish({ channel: tenantChannel(ctx.event.tenantId), topic, ref });
}

export const stockToProject: Consumer = {
  name: 'stock-to-project',
  events: ['stock.moved_to_project.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('stock.moved_to_project.v1', event.payload);
    const m = await tx.stockMovement.findUnique({ where: { id: p.movementId } });
    if (!m?.projectId) return;
    const item = await tx.item.findUniqueOrThrow({ where: { id: m.itemId } });
    const location = await tx.stockLocation.findUniqueOrThrow({ where: { id: m.locationId } });
    await upsertCost(ctx, {
      projectId: m.projectId,
      budgetLineId: m.budgetLineId,
      category: 'stock',
      sourceType: 'stock_movement',
      sourceId: m.id,
      label: `${item.name} · ${m.quantity.toString()} ${item.unit} (${location.name})`,
      amount: m.totalCost,
    });
    await publishStock(ctx, 'stock', m.itemId);
  },
};

export const stockLevelLow: Consumer = {
  name: 'stock-level-low',
  events: ['stock.level_low.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('stock.level_low.v1', event.payload);
    const level = await tx.stockLevel.findUnique({ where: { id: p.levelId } });
    if (!level) return;
    const item = await tx.item.findUniqueOrThrow({ where: { id: level.itemId } });
    const location = await tx.stockLocation.findUniqueOrThrow({ where: { id: level.locationId } });
    await notify(
      ctx,
      (await office(tx, event.tenantId)).map((m) => m.userId),
      {
        type: 'stock.level_low',
        title: `Stock bas : ${item.name}`,
        body: `${location.name} : ${level.quantity.toString()} ${item.unit} (seuil ${level.minQuantity?.toString() ?? '—'})`,
        link: '/stock?onglet=reappro',
      },
    );
    await publishStock(ctx, 'stock', item.id);
  },
};

export const equipmentCosts: Consumer = {
  name: 'equipment-costs',
  events: ['equipment.assignment_changed.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('equipment.assignment_changed.v1', event.payload);
    const a = await tx.equipmentAssignment.findUnique({
      where: { id: p.assignmentId },
      include: { equipment: true, project: { select: { id: true, customerId: true } } },
    });
    if (!a) return;
    const today = p.asOf ?? brusselsDate(event.occurredAt);
    const start = isoDay(a.startDate);
    const end = a.endDate ? isoDay(a.endDate) : null;
    const days = equipmentUsageDays(start, end, today);
    await upsertCost(ctx, {
      projectId: a.projectId,
      budgetLineId: a.budgetLineId,
      category: 'equipment',
      sourceType: 'equipment_assignment',
      sourceId: a.id,
      label: `${a.equipment.name} · ${days} jour${days > 1 ? 's' : ''}`,
      amount: equipmentUsageCost(a.dailyCost, days),
    });
    if (p.action !== 'recomputed') {
      const assigned = p.action === 'assigned';
      await tx.timelineEntry.create({
        data: {
          tenantId: event.tenantId,
          eventId: event.id,
          projectId: a.projectId,
          customerId: a.project.customerId,
          type: assigned ? 'equipment.assigned' : 'equipment.returned',
          title: assigned ? `Matériel affecté : ${a.equipment.name}` : `Matériel rendu : ${a.equipment.name}`,
          body: assigned
            ? `À partir du ${dateFr(a.startDate)}${a.endDate ? ` jusqu’au ${dateFr(a.endDate)}` : ''}`
            : `${days} jour${days > 1 ? 's' : ''} d’usage`,
          visibleToClient: false,
          occurredAt: event.occurredAt,
          data: { equipmentId: a.equipmentId, assignmentId: a.id },
        },
      });
      await ctx.publish({ channel: projectChannel(a.projectId), topic: 'timeline', ref: a.projectId });
    }
    await publishStock(ctx, 'equipment', a.equipmentId);
  },
};

export const maintenanceDue: Consumer = {
  name: 'equipment-maintenance-due',
  events: ['equipment.maintenance_due.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('equipment.maintenance_due.v1', event.payload);
    const m = await tx.maintenanceEvent.findUnique({
      where: { id: p.maintenanceId },
      include: { equipment: true },
    });
    if (!m || m.doneOn) return;
    const what = m.kind === 'inspection' ? 'Contrôle' : 'Entretien';
    await notify(
      ctx,
      (await office(tx, event.tenantId)).map((x) => x.userId),
      {
        type: 'equipment.maintenance_due',
        title:
          p.state === 'overdue'
            ? `${what} en retard : ${m.equipment.name}`
            : `${what} à prévoir : ${m.equipment.name}`,
        body: `${m.label} · échéance le ${dateFr(m.dueOn)}`,
        link: `/materiel/${m.equipmentId}`,
      },
    );
    await publishStock(ctx, 'equipment', m.equipmentId);
  },
};

export const stockConsumers: readonly Consumer[] = [
  stockToProject,
  stockLevelLow,
  equipmentCosts,
  maintenanceDue,
];
