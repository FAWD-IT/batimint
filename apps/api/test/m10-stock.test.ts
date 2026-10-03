/**
 * M10 — Stock et matériel (03 §11, 02 P13) contre un vrai Postgres : emplacements, entrées au
 * coût moyen pondéré, transfert vers une camionnette, sortie imputée au poste d'un chantier
 * (idempotente), seuil d'alerte, réapprovisionnement en bon de commande dont la réception entre en
 * stock, matériel affecté (chevauchement refusé), retour, entretien périodique, isolation.
 */
import type { EquipmentDto, StockItemDto, StockLocationDto, StockMovementDto } from '@batimint/contracts';
import { withSystem } from '@batimint/db';
import { brusselsDate } from '@batimint/domain';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
let depot: StockLocationDto;
let van: StockLocationDto;
let itemId: string;
let supplierId: string;
const projectId = uuidv7();
const closedProjectId = uuidv7();
const postId = uuidv7();
const equipmentId = uuidv7();
const assignmentId = uuidv7();
const outId = uuidv7();
const today = brusselsDate(new Date());

const inject = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
  s: { cookie: string } = owner,
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie: s.cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const outbox = (type: string) =>
  withSystem(t.prisma, (tx) => tx.outboxEvent.findMany({ where: { tenantId, type } }));
const stockOf = async () =>
  ((await inject('GET', '/v1/stock')).json().items as StockItemDto[]).find((i) => i.item.id === itemId)!;
const move = (body: Record<string, unknown>) =>
  inject('POST', '/v1/stock/movements', { id: uuidv7(), itemId, ...body });

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Stock');
  tenantId = (await inject('GET', '/v1/me')).json().tenant.id;
  const customer = (
    await inject('POST', '/v1/customers', {
      kind: 'individual',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont.stock@example.be',
    })
  ).json();
  await withSystem(t.prisma, async (tx) => {
    const supplier = await tx.supplier.create({
      data: { tenantId, name: 'Brico Pro Charleroi', email: 'commandes@bricopro.example.be' },
    });
    supplierId = supplier.id;
    const item = await tx.item.create({
      data: {
        tenantId,
        code: 'COLFLEX',
        kind: 'material',
        name: 'Colle flex C2TE 25 kg',
        unit: 'sac',
        purchasePrice: 1_800n,
        supplierId: supplier.id,
      },
    });
    itemId = item.id;
    for (const [id, number, status] of [
      [projectId, 'CH2026-070', 'in_progress'],
      [closedProjectId, 'CH2026-071', 'closed'],
    ] as const)
      await tx.project.create({
        data: {
          id,
          tenantId,
          number,
          name: id === projectId ? 'Salle de bain Dupont' : 'Chantier clos',
          customerId: customer.id,
          status,
          contractAmount: 1_000_000n,
        },
      });
    await tx.budgetLine.create({
      data: {
        id: postId,
        tenantId,
        projectId,
        position: 0,
        label: 'Carrelage',
        budgetedCost: 100_000n,
        saleAmount: 150_000n,
      },
    });
  });
});

afterAll(async () => {
  await t?.close();
});

describe('M10 — stock', () => {
  it('emplacements : dépôt et camionnette', async () => {
    const d = await inject('POST', '/v1/stock/locations', {
      name: 'Dépôt de Gosselies',
      kind: 'depot',
      address: 'Rue de la Station 4, 6041 Gosselies',
    });
    expect(d.statusCode).toBe(201);
    depot = d.json();
    van = (await inject('POST', '/v1/stock/locations', { name: 'Camionnette de Karim', kind: 'van' })).json();
    const list = (await inject('GET', '/v1/stock/locations')).json().items as StockLocationDto[];
    expect(list.map((l) => l.name)).toEqual(['Dépôt de Gosselies', 'Camionnette de Karim']);
    expect(list[0]).toMatchObject({ itemCount: 0, value: 0, lowCount: 0 });
  });

  it('entrées : le coût moyen pondéré est recalculé', async () => {
    expect(
      (await move({ kind: 'in', locationId: depot.id, quantity: '10', unitCost: 1_800 })).statusCode,
    ).toBe(201);
    const second = await move({ kind: 'in', locationId: depot.id, quantity: '30', unitCost: 2_000 });
    expect(second.json()).toMatchObject({ kind: 'in', unitCost: 2_000, totalCost: 60_000 });
    const s = await stockOf();
    // (10 × 18 + 30 × 20) / 40 = 19,50 €
    expect(s).toMatchObject({ averageCost: 1_950, quantity: '40', value: 78_000 });
  });

  it('seuil d’alerte et transfert vers la camionnette', async () => {
    const put = await inject('PUT', '/v1/stock/levels', {
      locationId: depot.id,
      itemId,
      minQuantity: '20',
      reorderQuantity: '40',
    });
    expect(put.statusCode).toBe(200);
    const tr = await move({ kind: 'transfer', locationId: depot.id, toLocationId: van.id, quantity: '15' });
    expect(tr.statusCode).toBe(201);
    expect((tr.json() as StockMovementDto).toLocation?.name).toBe('Camionnette de Karim');
    const s = await stockOf();
    expect(s.quantity).toBe('40');
    expect(s.levels.find((l) => l.locationId === depot.id)).toMatchObject({ quantity: '25', below: false });
    expect(s.levels.find((l) => l.locationId === van.id)).toMatchObject({ quantity: '15' });
    expect(
      (await move({ kind: 'transfer', locationId: depot.id, toLocationId: depot.id, quantity: '1' }))
        .statusCode,
    ).toBe(400);
  });

  it('sortie vers un chantier : coût au CMP imputé au poste, renvoi sans doublon', async () => {
    const body = {
      id: outId,
      itemId,
      kind: 'out',
      locationId: depot.id,
      quantity: '8',
      projectId,
      budgetLineId: postId,
    };
    const res = await inject('POST', '/v1/stock/movements', body);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ totalCost: 15_600, project: { number: 'CH2026-070' } });
    expect((await inject('POST', '/v1/stock/movements', body)).json().id).toBe(outId);
    expect((await outbox('stock.moved_to_project.v1')).length).toBe(1);
    // 25 − 8 = 17 < 20 : une alerte, pas deux.
    expect((await outbox('stock.level_low.v1')).length).toBe(1);
    await move({ kind: 'out', locationId: depot.id, quantity: '1', projectId });
    expect((await outbox('stock.level_low.v1')).length).toBe(1);
    const low = (await inject('GET', '/v1/stock?low=true')).json().items as StockItemDto[];
    expect(low.map((i) => i.item.id)).toEqual([itemId]);
    const hist = (await inject('GET', `/v1/stock/movements?projectId=${projectId}`)).json().items;
    expect(hist).toHaveLength(2);
  });

  it('refus : stock insuffisant, sortie sans chantier, chantier clôturé', async () => {
    const short = await move({ kind: 'out', locationId: van.id, quantity: '99', projectId });
    expect(short.statusCode).toBe(422);
    expect((await move({ kind: 'out', locationId: depot.id, quantity: '1' })).statusCode).toBe(400);
    const closed = await move({
      kind: 'out',
      locationId: depot.id,
      quantity: '1',
      projectId: closedProjectId,
    });
    expect(closed.statusCode).toBe(409);
  });

  it('inventaire : la quantité comptée remplace la quantité, l’écart est tracé', async () => {
    const res = await move({ kind: 'adjustment', locationId: van.id, quantity: '14' });
    expect(res.statusCode).toBe(201);
    expect(res.json().quantity).toBe('-1');
    const s = await stockOf();
    expect(s.levels.find((l) => l.locationId === van.id)?.quantity).toBe('14');
  });

  it('réapprovisionnement : proposition par fournisseur, BC brouillon, réception en stock', async () => {
    const proposal = (await inject('GET', '/v1/stock/reorder')).json();
    expect(proposal.groups).toHaveLength(1);
    const g = proposal.groups[0];
    expect(g).toMatchObject({ supplier: { id: supplierId }, location: { id: depot.id } });
    expect(g.lines[0]).toMatchObject({
      itemId,
      quantity: '40',
      stock: '16',
      minQuantity: '20',
      unitPrice: 1_800,
    });
    const poId = uuidv7();
    const created = await inject('POST', '/v1/stock/reorder', {
      id: poId,
      supplierId,
      locationId: depot.id,
      lines: [{ itemId, quantity: '40', unitPrice: 1_700 }],
    });
    expect(created.statusCode).toBe(201);
    const po = (await inject('GET', `/v1/purchase-orders/${poId}`)).json();
    expect(po).toMatchObject({ status: 'draft', project: null, totalNet: 68_000 });
    const sent = await inject('POST', `/v1/purchase-orders/${poId}/send`, {});
    expect(sent.statusCode).toBe(200);
    const received = await inject('POST', `/v1/purchase-orders/${poId}/receipts`, {
      lines: [{ lineId: sent.json().lines[0].id, quantity: '40' }],
    });
    expect(received.json()).toMatchObject({ status: 'received' });
    const s = await stockOf();
    expect(s.levels.find((l) => l.locationId === depot.id)).toMatchObject({ quantity: '56', below: false });
    // CMP : (30 × 19,50 + 40 × 17) / 70 = 18,07 €
    expect(s.averageCost).toBe(1_807);
    const level = await withSystem(t.prisma, (tx) =>
      tx.stockLevel.findFirstOrThrow({ where: { itemId, locationId: depot.id } }),
    );
    expect(level.alertedAt).toBeNull();
    const ins = (await inject('GET', `/v1/stock/movements?itemId=${itemId}`)).json()
      .items as StockMovementDto[];
    expect(ins[0]).toMatchObject({ kind: 'in', quantity: '40', unitCost: 1_700 });
  });
});

describe('M10 — matériel', () => {
  it('fiche matériel, affectation au chantier, chevauchement refusé, retour', async () => {
    const created = await inject('PUT', `/v1/equipment/${equipmentId}`, {
      id: equipmentId,
      code: 'MIN-01',
      name: 'Mini-pelle Kubota U17',
      category: 'Terrassement',
      dailyCost: 9_500,
    });
    expect(created.statusCode).toBe(200);
    const start = '2026-09-28';
    const res = await inject('POST', `/v1/equipment/${equipmentId}/assignments`, {
      id: assignmentId,
      projectId,
      budgetLineId: postId,
      startDate: start,
    });
    expect(res.statusCode).toBe(200);
    const e = res.json() as EquipmentDto;
    expect(e.current).toMatchObject({ project: { id: projectId }, budgetLine: { label: 'Carrelage' } });
    expect(e.current!.days).toBeGreaterThan(0);
    expect(e.current!.cost).toBe(e.current!.days * 9_500);
    const busy = await inject('POST', `/v1/equipment/${equipmentId}/assignments`, {
      id: uuidv7(),
      projectId,
      startDate: today,
    });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.message).toContain('Salle de bain Dupont');
    const back = await inject('POST', `/v1/equipment-assignments/${assignmentId}/return`, {
      endDate: '2026-09-30',
    });
    expect(back.statusCode).toBe(200);
    expect((back.json() as EquipmentDto).assignments[0]).toMatchObject({
      endDate: '2026-09-30',
      days: 3,
      cost: 28_500,
    });
    const events = await outbox('equipment.assignment_changed.v1');
    expect(events.map((x) => (x.payload as { action: string }).action).sort()).toEqual([
      'assigned',
      'returned',
    ]);
    const list = (await inject('GET', '/v1/equipment')).json().items;
    expect(list[0]).toMatchObject({ name: 'Mini-pelle Kubota U17', current: null });
  });

  it('entretien périodique : fait, le suivant est planifié', async () => {
    const mId = uuidv7();
    const planned = await inject('POST', `/v1/equipment/${equipmentId}/maintenance`, {
      id: mId,
      kind: 'inspection',
      label: 'Contrôle périodique (SECT)',
      dueOn: '2026-09-15',
      intervalMonths: 12,
    });
    expect((planned.json() as EquipmentDto).nextMaintenance).toMatchObject({ id: mId, status: 'overdue' });
    const done = await inject('POST', `/v1/maintenance/${mId}/done`, { doneOn: '2026-10-01', cost: 18_000 });
    const e = done.json() as EquipmentDto;
    expect(e.nextMaintenance).toMatchObject({ dueOn: '2027-10-01', status: 'ok', intervalMonths: 12 });
    expect(e.maintenance.find((m) => m.id === mId)).toMatchObject({ doneOn: '2026-10-01', cost: 18_000 });
  });

  it('isolation : un autre tenant ne voit ni stock ni matériel', async () => {
    const other = await signupCompany(t.app, 'Autre Stock');
    expect((await inject('GET', `/v1/equipment/${equipmentId}`, undefined, other)).statusCode).toBe(404);
    expect((await inject('GET', '/v1/stock/locations', undefined, other)).json().items).toEqual([]);
    expect((await inject('GET', '/v1/stock', undefined, other)).json().items).toEqual([]);
    const stolen = await inject(
      'POST',
      '/v1/stock/movements',
      { id: uuidv7(), itemId, kind: 'in', locationId: depot.id, quantity: '1' },
      other,
    );
    expect(stolen.statusCode).toBe(404);
  });
});
