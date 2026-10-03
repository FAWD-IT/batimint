/**
 * Stock, matériel et réceptions du seed (M10, 02 P10 et P13).
 *  - Dépôt de Gosselies et camionnette de Karim : articles au coût moyen pondéré (deux entrées à
 *    des prix différents), transferts, sorties imputées aux chantiers en cours, deux articles sous
 *    le seuil (proposés au réapprovisionnement).
 *  - Matériel : mini-pelle et échafaudage affectés (coût d'usage imputé par le worker), contrôle
 *    SECT bientôt dû, contrôle d'échafaudage en retard, bétonnière disponible.
 *  - Réceptions : PV provisoire signé de la « Rénovation complète maison 1960 » avec une réserve
 *    (devenue tâche), PV provisoire sans réserve de la « Toiture de la salle communale ». Les PDF
 *    sont rendus au premier téléchargement.
 */
import {
  addDays,
  formatDocumentNumber,
  isBelowThreshold,
  type IsoDate,
  plannedFinalReception,
} from '@batimint/domain';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../src/client';
import { emitEvent, type EventActor } from '../src/outbox';
import { nextSequenceValue } from '../src/sequences';
import { recordStockMovement } from '../src/stock';

const day = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const at = (d: IsoDate, hhmm: string) => new Date(`${d}T${hhmm}:00+02:00`);

export async function seedStock(
  tx: Tx,
  tenantId: string,
  users: Map<string, string>,
  today: IsoDate,
): Promise<void> {
  if ((await tx.stockLocation.count({ where: { tenantId } })) > 0) return;
  const sophie = users.get('sophie@renov-habitat.be') ?? null;
  const karimUser = users.get('karim@renov-habitat.be') ?? null;
  const actor: EventActor = { type: 'user', id: sophie, label: 'Sophie Martin' };
  const karim = await tx.employee.findFirst({ where: { tenantId, firstName: 'Karim' } });
  const depot = await tx.stockLocation.create({
    data: {
      tenantId,
      name: 'Dépôt de Gosselies',
      kind: 'depot',
      address: 'Rue de la Station 4, 6041 Gosselies',
    },
  });
  const van = await tx.stockLocation.create({
    data: { tenantId, name: 'Camionnette de Karim', kind: 'van', employeeId: karim?.id ?? null },
  });
  const items = new Map(
    (await tx.item.findMany({ where: { tenantId, kind: 'material' } })).map((i) => [i.code, i]),
  );
  const projects = await tx.project.findMany({
    where: {
      tenantId,
      name: { in: ['Extension arrière 20 m²', 'Remplacement de la toiture', 'Ravalement de façade'] },
    },
    include: { budgetLines: { orderBy: { position: 'asc' } } },
  });
  const project = (name: string) => projects.find((p) => p.name === name);
  const move = async (
    kind: 'in' | 'out' | 'transfer',
    code: string,
    quantity: string,
    when: IsoDate,
    extra: { unitCost?: bigint; to?: string; project?: string; from?: string; userId?: string | null } = {},
  ) => {
    const item = items.get(code);
    if (!item) return;
    const p = extra.project ? project(extra.project) : undefined;
    if (extra.project && !p) return;
    await recordStockMovement(tx, {
      id: randomUUID(),
      tenantId,
      kind,
      itemId: item.id,
      locationId: extra.from ?? depot.id,
      quantity,
      unitCost: extra.unitCost ?? null,
      toLocationId: extra.to ?? null,
      projectId: p?.id ?? null,
      budgetLineId: p?.budgetLines[0]?.id ?? null,
      note: kind === 'in' ? 'Réception fournisseur' : null,
      occurredAt: at(when, '07:30'),
      userId: extra.userId ?? sophie,
      actor,
    });
  };

  // Entrées (deux prix différents : coût moyen pondéré visible).
  const d30 = addDays(today, -30);
  const d12 = addDays(today, -12);
  const entries: [string, string, bigint, string, bigint][] = [
    ['GEN-COLLE-C2', '30', 1_790n, '20', 1_890n],
    ['GEN-MORT-25', '60', 620n, '40', 640n],
    ['GEN-SILICONE', '24', 760n, '12', 790n],
    ['SAN-RACC-16', '80', 440n, '40', 460n],
    ['SAN-MULTI-16', '100', 205n, '50', 210n],
    ['GEN-JOINT-5', '12', 1_250n, '0', 0n],
    ['GEN-PLINTHE', '60', 320n, '0', 0n],
    ['SAN-VANNE', '10', 1_250n, '0', 0n],
    ['GEN-BLOC-14', '200', 190n, '120', 195n],
  ];
  for (const [code, q1, c1, q2, c2] of entries) {
    await move('in', code, q1, d30, { unitCost: c1 });
    if (q2 !== '0') await move('in', code, q2, d12, { unitCost: c2 });
  }
  // La camionnette de Karim : ce qu'il emporte chaque semaine.
  for (const [code, q] of [
    ['GEN-SILICONE', '8'],
    ['SAN-RACC-16', '30'],
    ['SAN-VANNE', '6'],
    ['GEN-COLLE-C2', '6'],
  ] as const)
    await move('transfer', code, q, addDays(today, -10), { to: van.id });
  // Sorties vers les chantiers en cours (coût imputé au poste par le worker).
  await move('out', 'GEN-BLOC-14', '180', addDays(today, -9), { project: 'Extension arrière 20 m²' });
  await move('out', 'GEN-MORT-25', '40', addDays(today, -9), { project: 'Extension arrière 20 m²' });
  await move('out', 'SAN-VANNE', '3', addDays(today, -4), {
    project: 'Extension arrière 20 m²',
    from: van.id,
    userId: karimUser,
  });
  await move('out', 'GEN-SILICONE', '4', addDays(today, -2), {
    project: 'Ravalement de façade',
    from: van.id,
    userId: karimUser,
  });
  await move('out', 'GEN-JOINT-5', '6', addDays(today, -3), { project: 'Extension arrière 20 m²' });

  // Seuils : le joint (dépôt) et les vannes (camionnette) passent sous le seuil.
  const thresholds: [string, string, string, string | null][] = [
    [depot.id, 'GEN-COLLE-C2', '20', '40'],
    [depot.id, 'GEN-MORT-25', '30', '60'],
    [depot.id, 'GEN-JOINT-5', '10', '20'],
    [depot.id, 'SAN-RACC-16', '40', null],
    [van.id, 'SAN-VANNE', '5', '10'],
    [van.id, 'GEN-SILICONE', '4', '12'],
  ];
  for (const [locationId, code, min, reorder] of thresholds) {
    const item = items.get(code);
    if (!item) continue;
    const level = await tx.stockLevel.upsert({
      where: { locationId_itemId: { locationId, itemId: item.id } },
      create: { tenantId, locationId, itemId: item.id, minQuantity: min, reorderQuantity: reorder },
      update: { minQuantity: min, reorderQuantity: reorder },
    });
    if (isBelowThreshold(level.quantity.toString(), min)) {
      await tx.stockLevel.update({ where: { id: level.id }, data: { alertedAt: new Date() } });
      await emitEvent(tx, {
        tenantId,
        type: 'stock.level_low.v1',
        aggregateType: 'stock_level',
        aggregateId: level.id,
        payload: { levelId: level.id, itemId: item.id, locationId },
        actor,
      });
    }
  }

  // Matériel.
  const equipment = [
    {
      code: 'MP-01',
      name: 'Mini-pelle Kubota U17',
      category: 'Terrassement',
      serial: 'KBU17-58213',
      daily: 9_500n,
    },
    {
      code: 'ECH-02',
      name: 'Échafaudage roulant Altrex 8 m',
      category: 'Accès',
      serial: 'ALX-RS5-8841',
      daily: 2_500n,
    },
    { code: 'BET-03', name: 'Bétonnière Altrad 160 l', category: 'Maçonnerie', serial: null, daily: 1_500n },
    {
      code: 'MAR-04',
      name: 'Marteau-piqueur Hilti TE 1000',
      category: 'Démolition',
      serial: 'HIL-TE1000-3321',
      daily: 2_000n,
    },
  ];
  const eq = new Map<string, string>();
  for (const e of equipment) {
    const row = await tx.equipment.create({
      data: {
        id: randomUUID(),
        tenantId,
        code: e.code,
        name: e.name,
        category: e.category,
        serialNumber: e.serial,
        dailyCost: e.daily,
        purchasedOn: day(addDays(today, -700)),
        createdBy: sophie,
      },
    });
    eq.set(e.code, row.id);
  }
  const assign = async (code: string, projectName: string, start: IsoDate, end: IsoDate | null) => {
    const p = project(projectName);
    const equipmentId = eq.get(code)!;
    if (!p) return;
    const a = await tx.equipmentAssignment.create({
      data: {
        id: randomUUID(),
        tenantId,
        equipmentId,
        projectId: p.id,
        budgetLineId: p.budgetLines[0]?.id ?? null,
        startDate: day(start),
        endDate: end ? day(end) : null,
        dailyCost: equipment.find((x) => x.code === code)!.daily,
        createdBy: sophie,
      },
    });
    await emitEvent(tx, {
      tenantId,
      type: 'equipment.assignment_changed.v1',
      aggregateType: 'project',
      aggregateId: p.id,
      payload: { assignmentId: a.id, projectId: p.id, action: end ? 'returned' : 'assigned' },
      actor,
    });
  };
  await assign('MAR-04', 'Extension arrière 20 m²', addDays(today, -20), addDays(today, -15));
  await assign('MP-01', 'Extension arrière 20 m²', addDays(today, -14), null);
  await assign('ECH-02', 'Ravalement de façade', addDays(today, -18), null);

  const maintenance: [
    string,
    'maintenance' | 'inspection',
    string,
    IsoDate,
    number | null,
    IsoDate | null,
  ][] = [
    ['MP-01', 'inspection', 'Contrôle périodique (SECT)', addDays(today, 9), 12, null],
    ['MP-01', 'maintenance', 'Vidange et filtres (500 h)', addDays(today, 60), 6, null],
    ['ECH-02', 'inspection', 'Contrôle de l’échafaudage', addDays(today, -3), 6, null],
    ['BET-03', 'maintenance', 'Graissage et courroie', addDays(today, -60), 6, addDays(today, -58)],
    ['BET-03', 'maintenance', 'Graissage et courroie', addDays(today, 120), 6, null],
    ['MAR-04', 'maintenance', 'Révision Hilti', addDays(today, 200), 12, null],
  ];
  for (const [code, kind, label, dueOn, interval, doneOn] of maintenance)
    await tx.maintenanceEvent.create({
      data: {
        id: randomUUID(),
        tenantId,
        equipmentId: eq.get(code)!,
        kind,
        label,
        dueOn: day(dueOn),
        doneOn: doneOn ? day(doneOn) : null,
        intervalMonths: interval,
        cost: doneOn ? 8_500n : null,
        createdBy: sophie,
      },
    });
}

export async function seedReceptions(
  tx: Tx,
  tenantId: string,
  users: Map<string, string>,
  today: IsoDate,
): Promise<void> {
  if ((await tx.reception.count({ where: { tenantId } })) > 0) return;
  const karim = users.get('karim@renov-habitat.be') ?? null;
  const year = Number(today.slice(0, 4));
  const pvs: { project: string; signer: string; offset: number; reserves: [string, string][] }[] = [
    {
      project: 'Rénovation complète maison 1960',
      signer: 'Marc Henrard',
      offset: -9,
      reserves: [['Porte de la salle de bain à régler (frotte au sol)', 'Salle de bain, étage']],
    },
    {
      project: 'Toiture de la salle communale',
      signer: 'Annick Dethier, échevine des travaux',
      offset: -8,
      reserves: [],
    },
  ];
  for (const pv of pvs) {
    const p = await tx.project.findFirst({
      where: { tenantId, name: pv.project },
      include: { budgetLines: { orderBy: { position: 'asc' } } },
    });
    if (!p) continue;
    const on = addDays(today, pv.offset);
    const planned = plannedFinalReception(on, 12);
    const number = formatDocumentNumber('PV{YYYY}-{SEQ:3}', {
      year,
      sequence: await nextSequenceValue(tx, tenantId, 'reception', year),
    });
    const reception = await tx.reception.create({
      data: {
        id: randomUUID(),
        tenantId,
        projectId: p.id,
        kind: 'provisional',
        status: 'draft',
        receptionDate: day(on),
        attendees: `${pv.signer} ; Karim Benali (Rénov'Habitat)`,
        plannedFinalDate: day(planned),
        createdBy: karim,
      },
    });
    let position =
      ((await tx.task.findFirst({ where: { projectId: p.id }, orderBy: { position: 'desc' } }))?.position ??
        0) + 1;
    for (const [i, [description, location]] of pv.reserves.entries()) {
      const task = await tx.task.create({
        data: {
          tenantId,
          projectId: p.id,
          budgetLineId: p.budgetLines.at(-1)?.id ?? null,
          position: position++,
          title: `Réserve : ${description}`,
          description: `Emplacement : ${location}`,
          dueDate: day(planned),
        },
      });
      await tx.reserve.create({
        data: {
          id: randomUUID(),
          tenantId,
          receptionId: reception.id,
          projectId: p.id,
          position: i,
          description,
          location,
          budgetLineId: p.budgetLines.at(-1)?.id ?? null,
          taskId: task.id,
        },
      });
    }
    await tx.reception.update({
      where: { id: reception.id },
      data: { status: 'signed', number, signerName: pv.signer, signedAt: at(on, '16:10') },
    });
    await tx.project.update({
      where: { id: p.id },
      data: { provisionalAcceptedOn: day(on), finalAcceptancePlannedOn: day(planned) },
    });
    await tx.timelineEntry.create({
      data: {
        tenantId,
        projectId: p.id,
        customerId: p.customerId,
        type: 'reception.signed',
        title: `Réception provisoire signée par ${pv.signer}`,
        body: pv.reserves.length
          ? `${pv.reserves.length} réserve${pv.reserves.length > 1 ? 's' : ''} à lever`
          : 'Sans réserve',
        visibleToClient: true,
        actorLabel: pv.signer,
        occurredAt: at(on, '16:10'),
        data: { receptionId: reception.id },
      },
    });
  }
}
