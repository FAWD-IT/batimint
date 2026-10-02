/**
 * M5 — Terrain (03 §7, 02 P4) contre un vrai Postgres : journée de l'ouvrier, pointage
 * géolocalisé idempotent, synchro hors ligne par lots, pointage d'équipe par le chef, heures et
 * validation, signalement → avenant, bon de régie signé, rapport journalier, Check In and Out.
 */
import { withSystem } from '@batimint/db';
import { brusselsDate, brusselsMidnight } from '@batimint/domain';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/crypto';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
let projectId: string;
let teamId: string;
const emp = { karim: uuidv7(), luca: uuidv7(), owner: uuidv7() };
const sessions: Record<'karim' | 'luca', { cookie: string }> = {
  karim: { cookie: '' },
  luca: { cookie: '' },
};
const SITE = { latitude: 50.4405, longitude: 4.4311 };
const taskId = uuidv7();

const inject = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
  withSystem(t.prisma, (tx) =>
    tx.outboxEvent.findMany({ where: { tenantId, type }, orderBy: { occurredAt: 'asc' } }),
  );

async function member(
  email: string,
  role: string,
  name: string,
): Promise<{ cookie: string; userId: string }> {
  const inv = await inject('POST', '/v1/invitations', { email, role });
  const token = `m5-${uuidv7()}`;
  await withSystem(t.prisma, (tx) =>
    tx.invitation.update({ where: { id: inv.json().id }, data: { tokenHash: sha256(token) } }),
  );
  const acc = await t.app.inject({
    method: 'POST',
    url: '/v1/invitations/accept',
    payload: { token, name, password: 'motdepasse-solide-42' },
  });
  const cookie = `bm_session=${acc.cookies.find((c) => c.name === 'bm_session')!.value}`;
  const me = (await t.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json();
  return { cookie, userId: me.user.id };
}

/**
 * Instant « il y a m minutes », ramené dans la journée en cours à Bruxelles (les heures se
 * regroupent par jour civil) : en début de nuit, l'échelle est comprimée mais l'ordre est gardé.
 */
const NOW = Date.now();
const ELAPSED_MIN = (NOW - brusselsMidnight(brusselsDate(new Date(NOW))).getTime()) / 60_000;
const SCALE = Math.min(1, (ELAPSED_MIN - 1) / 250);
const minutesAgo = (m: number) => new Date(NOW - m * SCALE * 60_000).toISOString();

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Terrain');
  const me = (await inject('GET', '/v1/me')).json();
  tenantId = me.tenant.id;
  const karim = await member('karim-m5@example.test', 'site_manager', 'Karim Benali');
  const luca = await member('luca-m5@example.test', 'worker', 'Luca Rossi');
  sessions.karim = karim;
  sessions.luca = luca;
  const customer = (
    await inject('POST', '/v1/customers', {
      kind: 'individual',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont.m5@example.be',
    })
  ).json();
  const site = (
    await inject('POST', `/v1/customers/${customer.id}/sites`, {
      street: 'Rue de la Station 42',
      postalCode: '6040',
      city: 'Jumet',
      isPrivateDwelling: true,
      firstOccupancyYear: 1975,
    })
  ).json();
  projectId = uuidv7();
  teamId = uuidv7();
  const budgetLineId = uuidv7();
  await withSystem(t.prisma, async (tx) => {
    await tx.site.update({ where: { id: site.id }, data: SITE });
    await tx.team.create({ data: { id: teamId, tenantId, name: 'Équipe Karim' } });
    await tx.employee.createMany({
      data: [
        {
          id: emp.karim,
          tenantId,
          userId: karim.userId,
          firstName: 'Karim',
          lastName: 'Benali',
          teamId,
          hourlyCost: 4800n,
        },
        {
          id: emp.luca,
          tenantId,
          userId: luca.userId,
          firstName: 'Luca',
          lastName: 'Rossi',
          teamId,
          hourlyCost: 4200n,
        },
        {
          id: emp.owner,
          tenantId,
          userId: me.user.id,
          firstName: 'Marc',
          lastName: 'Test',
          hourlyCost: 6000n,
        },
      ],
    });
    await tx.team.update({ where: { id: teamId }, data: { leaderEmployeeId: emp.karim } });
    await tx.project.create({
      data: {
        id: projectId,
        tenantId,
        number: 'CH2026-050',
        name: 'Rénovation salle de bain Dupont',
        customerId: customer.id,
        siteId: site.id,
        status: 'in_progress',
        contractAmount: 3_840_000n,
        teamId,
        managerUserId: me.user.id,
        checkInOutForced: true,
      },
    });
    await tx.budgetLine.create({
      data: {
        id: budgetLineId,
        tenantId,
        projectId,
        position: 0,
        label: 'Carrelage',
        saleAmount: 1_000_000n,
        budgetedCost: 700_000n,
        laborHours: '40',
      },
    });
    await tx.task.create({
      data: { id: taskId, tenantId, projectId, budgetLineId, position: 0, title: 'Pose faïence murale' },
    });
  });
});

afterAll(async () => {
  await t?.close();
});

describe('M5 — terrain', () => {
  it('la journée de l’ouvrier : chantier de l’équipe, adresse, tâches, sans aucun prix', async () => {
    const res = await inject('GET', '/v1/field/today', undefined, sessions.luca);
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.employee.firstName).toBe('Luca');
    expect(d.project.id).toBe(projectId);
    expect(d.project.address).toBe('Rue de la Station 42, 6040 Jumet');
    expect(d.project.checkInOut).toBe(true);
    expect(d.clock.status).toBe('out');
    expect(d.tasks.map((x: { title: string }) => x.title)).toEqual(['Pose faïence murale']);
    expect(d.team.map((p: { name: string }) => p.name).sort()).toEqual(['Karim Benali', 'Luca Rossi']);
    expect(d.can).toEqual({ clockTeam: false, validate: false, workOrders: false });
    expect(JSON.stringify(d)).not.toMatch(/amount|cost|price/i);
  });

  it('pointage géolocalisé : idempotent par identifiant, hors zone signalé mais accepté', async () => {
    const id = uuidv7();
    const body = {
      id,
      projectId,
      kind: 'in',
      at: minutesAgo(240),
      latitude: SITE.latitude + 0.0003,
      longitude: SITE.longitude,
      accuracy: 12,
    };
    const first = await inject('POST', '/v1/field/clock', body, sessions.luca);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ geofence: 'ok', source: 'self', onssStatus: 'pending' });
    expect(first.json().distanceMeters).toBeLessThan(50);
    const again = await inject('POST', '/v1/field/clock', body, sessions.luca);
    expect(again.json().id).toBe(id);
    const events = (await outbox('time_entry.recorded.v1')).filter(
      (e) => (e.payload as { timeEntryId: string }).timeEntryId === id,
    );
    expect(events).toHaveLength(1);

    const far = await inject(
      'POST',
      '/v1/field/clock',
      { id: uuidv7(), projectId, kind: 'in', at: minutesAgo(235), latitude: 50.5, longitude: 4.5 },
      sessions.karim,
    );
    expect(far.statusCode).toBe(200);
    expect(far.json().geofence).toBe('too_far');

    const future = await inject(
      'POST',
      '/v1/field/clock',
      { id: uuidv7(), projectId, kind: 'out', at: new Date(Date.now() + 3_600_000).toISOString() },
      sessions.luca,
    );
    expect(future.json().error.code).toBe('clock_in_future');

    const today = (await inject('GET', '/v1/field/today', undefined, sessions.luca)).json();
    expect(today.clock.status).toBe('in');
    expect(today.team.filter((p: { onSite: boolean }) => p.onSite)).toHaveLength(2);
  });

  it('l’ouvrier ne pointe que pour lui ; le chef pointe son équipe', async () => {
    const forKarim = await inject(
      'POST',
      '/v1/field/clock',
      { id: uuidv7(), projectId, employeeId: emp.karim, kind: 'out', at: minutesAgo(10) },
      sessions.luca,
    );
    expect(forKarim.statusCode).toBe(403);
    const forLuca = await inject(
      'POST',
      '/v1/field/clock',
      { id: uuidv7(), projectId, employeeId: emp.luca, kind: 'out', at: minutesAgo(120) },
      sessions.karim,
    );
    expect(forLuca.statusCode).toBe(200);
    expect(forLuca.json().source).toBe('team');
    const self = await inject(
      'POST',
      '/v1/field/clock',
      { id: uuidv7(), projectId, employeeId: emp.karim, kind: 'out', at: minutesAgo(5) },
      sessions.karim,
    );
    expect(self.json().source).toBe('self');
  });

  it('synchro hors ligne par lots : chaque action est traitée, rejouer le lot ne double rien', async () => {
    const inId = uuidv7();
    const outId = uuidv7();
    const issueId = uuidv7();
    const actions = [
      { type: 'clock', id: inId, data: { id: inId, projectId, kind: 'in', at: minutesAgo(90) } },
      {
        type: 'clock',
        id: outId,
        data: {
          id: outId,
          projectId,
          kind: 'out',
          at: minutesAgo(30),
          latitude: SITE.latitude,
          longitude: SITE.longitude,
        },
      },
      { type: 'task', id: uuidv7(), data: { projectId, taskId, progressPercent: 60 } },
      {
        type: 'issue',
        id: issueId,
        data: {
          id: issueId,
          projectId,
          taskId,
          title: 'Fuite sous l’évier',
          urgent: true,
          at: minutesAgo(45),
        },
      },
      {
        type: 'clock',
        id: uuidv7(),
        data: { id: uuidv7(), projectId: uuidv7(), kind: 'in', at: minutesAgo(20) },
      },
    ];
    const res = await inject('POST', '/v1/field/sync', { actions }, sessions.luca);
    expect(res.statusCode).toBe(200);
    const r = res.json().results;
    expect(r.map((x: { ok: boolean }) => x.ok)).toEqual([true, true, true, true, false]);
    expect(r[0].geofence).toBe('no_position');
    expect(r[1].geofence).toBe('ok');
    expect(r[4].error.code).toBe('not_found');
    const replay = await inject('POST', '/v1/field/sync', { actions: actions.slice(0, 4) }, sessions.luca);
    expect(replay.json().results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    const entry = await withSystem(t.prisma, (tx) =>
      tx.timeEntry.findUniqueOrThrow({ where: { id: outId } }),
    );
    expect(entry.offline).toBe(true);
    expect(await withSystem(t.prisma, (tx) => tx.issue.count({ where: { id: issueId } }))).toBe(1);
    const task = await withSystem(t.prisma, (tx) => tx.task.findUniqueOrThrow({ where: { id: taskId } }));
    expect(task.progress.toString()).toBe('0.6');
    expect((await outbox('issue.reported.v1')).length).toBe(1);
  });

  it('heures : l’ouvrier voit les siennes, le chef valide la journée, puis elle est verrouillée', async () => {
    const day = brusselsDate(new Date());
    const mine = (
      await inject('GET', `/v1/projects/${projectId}/timesheet`, undefined, sessions.luca)
    ).json();
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].name).toBe('Luca Rossi');
    expect(mine.rows[0].cost).toBeUndefined();
    expect(Math.abs(mine.rows[0].grossMinutes - 180 * SCALE)).toBeLessThanOrEqual(2);
    expect(mine.rows[0].entries).toHaveLength(4);
    expect(mine.rows[0].anomalies).toEqual(['no_position']); // pointage hors ligne sans GPS

    const all = (
      await inject('GET', `/v1/projects/${projectId}/timesheet`, undefined, sessions.karim)
    ).json();
    const karimRow = all.rows.find((x: { name: string }) => x.name === 'Karim Benali');
    expect(karimRow.anomalies).toContain('too_far');

    const forbidden = await inject(
      'POST',
      `/v1/projects/${projectId}/timesheet/validate`,
      { day, employeeIds: [emp.luca] },
      sessions.luca,
    );
    expect(forbidden.statusCode).toBe(403);
    const ok = await inject(
      'POST',
      `/v1/projects/${projectId}/timesheet/validate`,
      { day, employeeIds: [emp.luca, emp.karim] },
      sessions.karim,
    );
    expect(ok.statusCode).toBe(200);
    const late = await inject(
      'POST',
      '/v1/field/clock',
      { id: uuidv7(), projectId, kind: 'in', at: minutesAgo(2) },
      sessions.luca,
    );
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('day_validated');
    const office = (await inject('GET', `/v1/projects/${projectId}/timesheet`)).json();
    expect(office.rows.every((x: { validated: boolean }) => x.validated)).toBe(true);
    expect(office.rows.find((x: { name: string }) => x.name === 'Luca Rossi').cost).toBeGreaterThan(0);
  });

  it('signalement → avenant en un clic (bureau), photos jointes au signalement', async () => {
    const issueId = uuidv7();
    const created = await inject(
      'POST',
      '/v1/issues',
      { id: issueId, projectId, title: 'Mur humide derrière la baignoire', at: minutesAgo(15) },
      sessions.luca,
    );
    expect(created.statusCode).toBe(201);
    const photo = await t.app.inject({
      method: 'POST',
      url: `/v1/attachments?ownerType=issue&ownerId=${issueId}&kind=photo&id=${uuidv7()}`,
      headers: { cookie: sessions.luca.cookie, 'content-type': 'image/jpeg', 'x-file-name': 'mur.jpg' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    });
    expect(photo.statusCode).toBe(201);
    const list = (await inject('GET', `/v1/projects/${projectId}/issues`)).json();
    const issue = list.items.find((i: { id: string }) => i.id === issueId);
    expect(issue.photos).toHaveLength(1);
    expect(issue.reporterLabel).toBe('Luca Rossi');

    expect(
      (await inject('POST', `/v1/issues/${issueId}/change-order`, undefined, sessions.luca)).statusCode,
    ).toBe(403);
    const co = await inject('POST', `/v1/issues/${issueId}/change-order`);
    expect(co.statusCode).toBe(201);
    const again = await inject('POST', `/v1/issues/${issueId}/change-order`);
    expect(again.json().changeOrderId).toBe(co.json().changeOrderId);
    const draft = (await inject('GET', `/v1/change-orders/${co.json().changeOrderId}`)).json();
    expect(draft.title).toBe('Mur humide derrière la baignoire');
    const after = (await inject('GET', `/v1/projects/${projectId}/issues`)).json();
    expect(after.items.find((i: { id: string }) => i.id === issueId).status).toBe('change_order');
  });

  it('bon de régie : brouillon sans prix, signé sur le téléphone, numéroté et figé', async () => {
    const id = uuidv7();
    const input = {
      id,
      projectId,
      day: brusselsDate(new Date()),
      description: 'Remplacement d’un tuyau d’évacuation non prévu.',
      lines: [
        { kind: 'labour', description: 'Karim et Luca', quantity: '2.5', unit: 'h' },
        { kind: 'material', description: 'Tuyau PVC 40 mm', quantity: '2', unit: 'm' },
      ],
    };
    expect((await inject('POST', '/v1/work-orders', input, sessions.luca)).statusCode).toBe(403);
    const draft = await inject('POST', '/v1/work-orders', input, sessions.karim);
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({ status: 'draft', number: null });
    expect(JSON.stringify(draft.json())).not.toMatch(/price|amount/i);
    const sign = await inject(
      'POST',
      `/v1/work-orders/${id}/sign`,
      { signerName: 'Jean Dupont', acceptTerms: true, signaturePath: 'M0 0 L10 10' },
      sessions.karim,
    );
    expect(sign.statusCode).toBe(200);
    expect(sign.json().status).toBe('signed');
    expect(sign.json().number).toMatch(/2026/);
    const pdf = await inject('GET', `/v1/work-orders/${id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await inject('POST', '/v1/work-orders', input, sessions.karim)).statusCode).toBe(409);
    expect(
      (
        await inject(
          'POST',
          `/v1/work-orders/${id}/sign`,
          { signerName: 'Jean Dupont', acceptTerms: true },
          sessions.karim,
        )
      ).statusCode,
    ).toBe(409);
    const audit = await withSystem(t.prisma, (tx) =>
      tx.auditLog.findFirst({ where: { tenantId, action: 'work_order.signed', entityId: id } }),
    );
    expect(audit).not.toBeNull();
    const sig = await withSystem(t.prisma, (tx) =>
      tx.signature.findFirst({ where: { subjectType: 'work_order', subjectId: id } }),
    );
    expect(sig?.documentSha256).toHaveLength(64);
  });

  it('rapport journalier : généré depuis la journée, notes du chef, puis arrêté', async () => {
    const day = brusselsDate(new Date());
    const r = (
      await inject('GET', `/v1/projects/${projectId}/daily-reports/${day}`, undefined, sessions.karim)
    ).json();
    expect(r.workers.map((w: { name: string }) => w.name).sort()).toEqual(['Karim Benali', 'Luca Rossi']);
    expect(r.issues.length).toBeGreaterThanOrEqual(2);
    expect(r.workOrders).toHaveLength(1);
    expect(
      (await inject('PUT', `/v1/projects/${projectId}/daily-reports/${day}`, { notes: 'x' }, sessions.luca))
        .statusCode,
    ).toBe(403);
    const closed = await inject(
      'PUT',
      `/v1/projects/${projectId}/daily-reports/${day}`,
      { notes: 'Faïence murale bien avancée.', weather: 'Ensoleillé', close: true },
      sessions.karim,
    );
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ notes: 'Faïence murale bien avancée.', closedBy: 'Karim Benali' });
  });

  it('Check In and Out : export de secours et relance des présences en échec', async () => {
    const csv = await inject('GET', `/v1/projects/${projectId}/attendance.csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('CH2026-050');
    expect(csv.body).toContain('Luca Rossi');
    expect(
      (await inject('GET', `/v1/projects/${projectId}/attendance.csv`, undefined, sessions.luca)).statusCode,
    ).toBe(403);
    await withSystem(t.prisma, (tx) =>
      tx.timeEntry.updateMany({ where: { projectId, employeeId: emp.luca }, data: { onssStatus: 'failed' } }),
    );
    const retry = await inject('POST', `/v1/projects/${projectId}/attendance/retry`);
    expect(retry.json().count).toBeGreaterThan(0);
    expect((await outbox('attendance.retry_requested.v1')).length).toBe(1);
  });

  it('isolation : un autre tenant ne voit rien du terrain', async () => {
    const other = await signupCompany(t.app, 'Autre BTP');
    expect(
      (await inject('GET', `/v1/projects/${projectId}/issues`, undefined, other)).json().items,
    ).toHaveLength(0);
    expect(
      (await inject('GET', `/v1/projects/${projectId}/timesheet`, undefined, other)).json().rows,
    ).toHaveLength(0);
    expect(
      (await inject('GET', `/v1/projects/${projectId}/work-orders`, undefined, other)).json().items,
    ).toHaveLength(0);
    const clock = await inject(
      'POST',
      '/v1/field/clock',
      { id: uuidv7(), projectId, kind: 'in', at: minutesAgo(1) },
      other,
    );
    expect(clock.statusCode).toBe(400); // pas de fiche employé dans cet autre tenant
  });
});
