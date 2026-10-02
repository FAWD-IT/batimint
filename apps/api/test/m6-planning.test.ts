/**
 * M6 — Planning (03 §6, 02 P3) contre un vrai Postgres : affectations en demi-journées,
 * conflits (double affectation, congé), date de début du chantier tenue par le planning,
 * mon planning (terrain), abonnement iCal, droits et isolation.
 */
import { withSystem } from '@batimint/db';
import { addDays, brusselsDate, isWorkingDay } from '@batimint/domain';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/crypto';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
const projects = { dupont: uuidv7(), lemaire: uuidv7() };
const emp = { karim: uuidv7(), luca: uuidv7() };
let teamId: string;
const taskId = uuidv7();
let luca: { cookie: string };
let karim: { cookie: string };

/** Lundi de la semaine prochaine, puis les jours ouvrés suivants. */
let monday = addDays(brusselsDate(new Date()), 7);
while (new Date(`${monday}T12:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, 1);
const day = (n: number) => addDays(monday, n);

const inject = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

async function member(email: string, role: string, name: string) {
  const inv = await inject('POST', '/v1/invitations', { email, role });
  const token = `m6-${uuidv7()}`;
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
  return { cookie, userId: me.user.id as string };
}

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Planning');
  tenantId = (await inject('GET', '/v1/me')).json().tenant.id;
  const k = await member('karim-m6@example.test', 'site_manager', 'Karim Benali');
  const l = await member('luca-m6@example.test', 'worker', 'Luca Rossi');
  karim = k;
  luca = l;
  const customer = (
    await inject('POST', '/v1/customers', { kind: 'individual', firstName: 'Jean', lastName: 'Dupont' })
  ).json();
  teamId = uuidv7();
  await withSystem(t.prisma, async (tx) => {
    await tx.team.create({ data: { id: teamId, tenantId, name: 'Équipe Karim' } });
    await tx.employee.createMany({
      data: [
        { id: emp.karim, tenantId, userId: k.userId, firstName: 'Karim', lastName: 'Benali', teamId },
        { id: emp.luca, tenantId, userId: l.userId, firstName: 'Luca', lastName: 'Rossi', teamId },
      ],
    });
    for (const [id, name, status] of [
      [projects.dupont, 'Salle de bain Dupont', 'preparation'],
      [projects.lemaire, 'Cuisine Lemaire', 'in_progress'],
    ] as const)
      await tx.project.create({
        data: {
          id,
          tenantId,
          number: `CH-${id.slice(-4)}`,
          name,
          customerId: customer.id,
          status,
          contractAmount: 1_000_000n,
        },
      });
    await tx.task.create({
      data: {
        id: taskId,
        tenantId,
        projectId: projects.dupont,
        position: 0,
        title: 'Démolition',
        plannedHours: '16',
      },
    });
    await tx.task.create({
      data: {
        tenantId,
        projectId: projects.dupont,
        position: 1,
        title: 'Faïence murale',
        plannedHours: '24',
      },
    });
    // Karim est en congé le mercredi matin.
    await tx.absence.create({
      data: {
        tenantId,
        employeeId: emp.karim,
        kind: 'leave',
        startsOn: new Date(`${day(2)}T00:00:00Z`),
        endsOn: new Date(`${day(2)}T00:00:00Z`),
        halfDay: 'am',
      },
    });
  });
});

afterAll(async () => {
  await t?.close();
});

describe('M6 — planning', () => {
  const teamSlot = uuidv7();

  it('affecter l’équipe trois jours : durée, date de début du chantier, événement ; rejouer ne double rien', async () => {
    const body = {
      id: teamSlot,
      projectId: projects.dupont,
      teamId,
      taskId,
      startDay: day(0),
      startHalf: 'am',
      endDay: day(2),
      endHalf: 'pm',
    };
    const res = await inject('POST', '/v1/planning/slots', body);
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r.slot).toMatchObject({ workingDays: 3, taskTitle: 'Démolition', employeeId: null, teamId });
    // Congé de Karim le mercredi matin : signalé, pas bloquant.
    expect(r.conflicts).toEqual([
      expect.objectContaining({ kind: 'absence', employeeName: 'Karim Benali', day: day(2), half: 'am' }),
    ]);
    const again = await inject('POST', '/v1/planning/slots', body);
    expect(again.json().slot.id).toBe(teamSlot);
    const project = (await inject('GET', `/v1/projects/${projects.dupont}`)).json();
    expect(project.startDate).toBe(day(0));
    const events = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.findMany({ where: { tenantId, type: 'schedule.changed.v1' } }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ action: 'created', startDate: day(0) });
  });

  it('double affectation : Luca sur un autre chantier le mardi après-midi', async () => {
    const res = await inject('POST', '/v1/planning/slots', {
      id: uuidv7(),
      projectId: projects.lemaire,
      employeeId: emp.luca,
      startDay: day(1),
      startHalf: 'pm',
      endDay: day(1),
      endHalf: 'pm',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().slot.workingDays).toBe(0.5);
    expect(res.json().conflicts).toEqual([
      expect.objectContaining({
        kind: 'double_booking',
        employeeName: 'Luca Rossi',
        day: day(1),
        half: 'pm',
      }),
    ]);
    const grid = (await inject('GET', `/v1/planning?from=${day(0)}&to=${day(6)}`)).json();
    expect(grid.days).toHaveLength(7);
    expect(grid.days.filter((d: { working: boolean }) => !d.working)).toHaveLength(
      [0, 1, 2, 3, 4, 5, 6].filter((n) => !isWorkingDay(day(n))).length,
    );
    expect(grid.slots).toHaveLength(2);
    expect(grid.teams[0]).toMatchObject({
      name: 'Équipe Karim',
      memberIds: expect.arrayContaining([emp.karim, emp.luca]),
    });
    expect(grid.conflicts.map((c: { kind: string }) => c.kind).sort()).toEqual(['absence', 'double_booking']);
    expect(grid.unplannedTasks.map((x: { title: string }) => x.title)).toEqual(['Faïence murale']);
    expect(grid.absences).toHaveLength(1);
  });

  it('déplacer le bloc : la date de début suit, un week-end seul est refusé', async () => {
    const moved = await inject('PATCH', `/v1/planning/slots/${teamSlot}`, {
      startDay: day(3),
      startHalf: 'am',
      endDay: day(7),
      endHalf: 'pm',
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().slot.workingDays).toBe(3); // jeudi, vendredi, lundi
    expect(moved.json().conflicts).toEqual([]);
    expect((await inject('GET', `/v1/projects/${projects.dupont}`)).json().startDate).toBe(day(3));
    const weekend = await inject('PATCH', `/v1/planning/slots/${teamSlot}`, {
      startDay: day(5),
      endDay: day(6),
    });
    expect(weekend.statusCode).toBe(400);
    expect(weekend.json().error.code).toBe('slot_not_working');
    const both = await inject('POST', '/v1/planning/slots', {
      id: uuidv7(),
      projectId: projects.dupont,
      startDay: day(0),
      endDay: day(0),
    });
    expect(both.statusCode).toBe(400);
  });

  it('Ouvrier : lit son planning, ne modifie pas ; le chef lit la grille', async () => {
    const mine = (await inject('GET', '/v1/field/planning?days=31', undefined, luca)).json();
    expect(mine.days.length).toBeGreaterThanOrEqual(3);
    const items = mine.days.flatMap(
      (d: { items: { projectName: string; half: string; teamName: string | null }[] }) => d.items,
    );
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectName: 'Salle de bain Dupont',
          half: 'day',
          teamName: 'Équipe Karim',
        }),
        expect.objectContaining({ projectName: 'Cuisine Lemaire', half: 'pm' }),
      ]),
    );
    expect(
      (
        await inject(
          'POST',
          '/v1/planning/slots',
          {
            id: uuidv7(),
            projectId: projects.dupont,
            employeeId: emp.luca,
            startDay: day(0),
            endDay: day(0),
          },
          luca,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await inject('GET', `/v1/planning?from=${day(0)}&to=${day(6)}`, undefined, karim)).statusCode,
    ).toBe(200);
    expect((await inject('DELETE', `/v1/planning/slots/${teamSlot}`, undefined, karim)).statusCode).toBe(403);
  });

  it('abonnement iCal : lien secret, renouvelable, lecture sans session', async () => {
    const first = await inject('POST', '/v1/planning/calendar-feeds', {}, luca);
    expect(first.statusCode).toBe(200);
    const url = new URL(first.json().url);
    expect(url.pathname).toMatch(/^\/api\/v1\/ical\/[\w-]+\.ics$/);
    const path = url.pathname.replace('/api', '');
    const ics = await t.app.inject({ method: 'GET', url: path });
    expect(ics.statusCode).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('BEGIN:VCALENDAR');
    expect(ics.body).toContain('SUMMARY:Salle de bain Dupont');
    expect(ics.body).toContain('SUMMARY:Cuisine Lemaire');
    expect(ics.body.match(/BEGIN:VEVENT/g)!.length).toBe(4); // 3 jours Dupont + 1 demi-journée Lemaire
    // Renouveler révoque l'ancien lien.
    await inject('POST', '/v1/planning/calendar-feeds', {}, luca);
    expect((await t.app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
    // Le chef ne crée pas le lien d'un autre ; le bureau oui.
    expect(
      (await inject('POST', '/v1/planning/calendar-feeds', { employeeId: emp.luca }, karim)).statusCode,
    ).toBe(403);
    expect((await inject('POST', '/v1/planning/calendar-feeds', { employeeId: emp.luca })).statusCode).toBe(
      200,
    );
  });

  it('supprimer, puis isolation : un autre tenant ne voit ni ne touche rien', async () => {
    const other = await signupCompany(t.app, 'Autre BTP');
    const grid = (await inject('GET', `/v1/planning?from=${day(0)}&to=${day(6)}`, undefined, other)).json();
    expect(grid.slots).toHaveLength(0);
    expect(grid.employees).toHaveLength(0);
    expect((await inject('PATCH', `/v1/planning/slots/${teamSlot}`, { note: 'x' }, other)).statusCode).toBe(
      404,
    );
    expect((await inject('DELETE', `/v1/planning/slots/${teamSlot}`)).statusCode).toBe(200);
    const after = (await inject('GET', `/v1/planning?from=${day(0)}&to=${day(9)}`)).json();
    expect(after.slots).toHaveLength(1);
    expect(after.unplannedTasks).toHaveLength(2);
    expect(
      (await inject('GET', `/v1/planning?from=${day(0)}&to=${addDays(day(0), 90)}`)).json().error.code,
    ).toBe('planning_range');
  });
});
