/**
 * Seed M5 (terrain) sur le chantier Dupont : pointages de l'équipe de Karim depuis le début du
 * chantier (validés, sauf la dernière journée à valider), arrivée de 8 h 02 le « jour de la
 * maquette », deux signalements (dont celui à l'origine de l'avenant n°3), un bon de régie signé
 * et des rapports journaliers arrêtés. Les coûts de main-d'œuvre sont déjà portés par le seed M4
 * (lignes agrégées) : ces pointages ne créent pas de coût en double.
 */
import {
  addDays,
  DEFAULT_NUMBER_PATTERNS,
  formatDocumentNumber,
  isWorkingDay,
  type IsoDate,
} from '@batimint/domain';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../src/client';
import { nextSequenceValue } from '../src/sequences';

const at = (d: IsoDate, hhmm: string) => new Date(`${d}T${hhmm}:00+02:00`);
const dayDate = (d: IsoDate) => new Date(`${d}T00:00:00Z`);

function workingDaysFrom(base: IsoDate, n: number): IsoDate {
  let d = base;
  let left = Math.abs(n);
  const step = n < 0 ? -1 : 1;
  while (left > 0) {
    d = addDays(d, step);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

interface TimeEntryRow {
  id: string;
  tenantId: string;
  projectId: string;
  employeeId: string;
  kind: 'in' | 'out';
  at: Date;
  day: Date;
  latitude: string;
  longitude: string;
  accuracyMeters: number;
  distanceMeters: number;
  geofence: string;
  source: string;
  status: 'validated' | 'synced';
  recordedBy: string | null;
  validatedAt?: Date;
  validatedBy?: string | null;
}

/** Rue de la Station 42, 6040 Jumet. */
const DUPONT_SITE = { latitude: '50.440500', longitude: '4.431100' };

export async function seedField(
  tx: Tx,
  tenantId: string,
  users: Map<string, string>,
  today: IsoDate,
): Promise<void> {
  const project = await tx.project.findFirst({
    where: { tenantId, name: 'Rénovation salle de bain Dupont' },
  });
  if (!project?.startDate) return;
  if (await tx.timeEntry.count({ where: { projectId: project.id } })) return;
  const karimUser = users.get('karim@renov-habitat.be') ?? null;
  const people = await tx.employee.findMany({
    where: { tenantId, firstName: { in: ['Karim', 'Luca', 'Yanis'] } },
  });
  const byName = new Map(people.map((p) => [p.firstName, p]));
  const crew = (['Karim', 'Luca', 'Yanis'] as const).map((n) => byName.get(n)).filter((p) => p !== undefined);
  if (crew.length !== 3) return;
  if (project.siteId) await tx.site.update({ where: { id: project.siteId }, data: DUPONT_SITE });

  // Même ancre que le seed M4 : le « jour de la maquette » est aujourd'hui après 13 h 35, sinon la veille.
  const story = new Date() >= at(today, '13:35') ? today : workingDaysFrom(today, -1);
  const toValidate = workingDaysFrom(story, -1);
  const start = project.startDate.toISOString().slice(0, 10) as IsoDate;
  const arrivals = ['07:58', '08:01', '08:03'];
  const departures = ['16:32', '16:30', '16:35'];

  const entries: TimeEntryRow[] = [];
  for (let d = start; d <= story; d = addDays(d, 1)) {
    if (!isWorkingDay(d)) continue;
    const isStory = d === story;
    const validated = d < toValidate;
    crew.forEach((e, i) => {
      const base = {
        tenantId,
        projectId: project.id,
        employeeId: e.id,
        day: dayDate(d),
        latitude: DUPONT_SITE.latitude,
        longitude: DUPONT_SITE.longitude,
        accuracyMeters: 12 + i * 4,
        distanceMeters: 8 + i * 5,
        geofence: 'ok',
        source: 'self',
        status: validated ? ('validated' as const) : ('synced' as const),
        recordedBy: e.userId,
        ...(validated ? { validatedAt: at(d, '17:10'), validatedBy: karimUser } : {}),
      };
      const inAt = isStory ? ['08:02', '08:04', '08:05'][i]! : arrivals[i]!;
      entries.push({ ...base, id: randomUUID(), kind: 'in', at: at(d, inAt) });
      // Le jour de la maquette, l'équipe est encore sur place si c'est aujourd'hui.
      if (!isStory || story !== today)
        entries.push({ ...base, id: randomUUID(), kind: 'out', at: at(d, departures[i]!) });
    });
  }
  // Un pointage loin du chantier (Yanis, passé chez le grossiste) : anomalie visible à la validation.
  const far = entries.find(
    (e) =>
      e.employeeId === byName.get('Yanis')!.id &&
      e.kind === 'in' &&
      e.day.getTime() === dayDate(toValidate).getTime(),
  );
  if (far) Object.assign(far, { geofence: 'too_far', distanceMeters: 2_340 });
  await tx.timeEntry.createMany({ data: entries });

  // Planning de l'équipe de Karim sur Dupont jusqu'à la fin prévue (le planning complet arrive en M6) :
  // la vue terrain ouvre ce chantier chaque matin.
  const teamId = crew[0]!.teamId;
  const end = project.endDate ? (project.endDate.toISOString().slice(0, 10) as IsoDate) : addDays(today, 7);
  if (teamId)
    await tx.scheduleSlot.create({
      data: {
        id: randomUUID(),
        tenantId,
        projectId: project.id,
        teamId,
        startDay: dayDate(start),
        startHalf: 'am',
        endDay: dayDate(end),
        endHalf: 'pm',
        createdBy: karimUser,
      },
    });

  // Arrivée de 8 h 02 (fil et portail : « L'équipe de Karim est chez vous depuis 8 h 02 »).
  await tx.timelineEntry.updateMany({
    where: { projectId: project.id, type: 'team.arrived' },
    data: {
      body: '3 personnes sur place · client prévenu automatiquement',
      data: {
        day: story,
        teamLabel: 'Karim',
        isTeam: true,
        since: at(story, '08:02').toISOString(),
        employeeIds: crew.map((e) => e.id),
      },
    },
  });

  // Signalements : le receveur fissuré (→ avenant n°3) et une prise non conforme, à traiter.
  const luca = byName.get('Luca')!;
  const yanis = byName.get('Yanis')!;
  const lucaUser = users.get('luca@renov-habitat.be') ?? null;
  const co3 = await tx.changeOrder.findFirst({ where: { projectId: project.id, ordinal: 3 } });
  const receveur = await tx.issue.create({
    data: {
      id: randomUUID(),
      tenantId,
      projectId: project.id,
      title: 'Receveur de douche fissuré à la dépose',
      description: 'Fissure sur toute la longueur, impossible de le réutiliser.',
      urgent: false,
      status: co3 ? 'change_order' : 'open',
      changeOrderId: co3?.id ?? null,
      reportedBy: lucaUser,
      reporterLabel: `${luca.firstName} ${luca.lastName}`,
      reportedAt: at(workingDaysFrom(story, -2), '10:15'),
    },
  });
  if (co3) await tx.changeOrder.update({ where: { id: co3.id }, data: { issueId: receveur.id } });
  const prise = await tx.issue.create({
    data: {
      id: randomUUID(),
      tenantId,
      projectId: project.id,
      title: 'Prise électrique non conforme derrière le meuble',
      description: 'Pas de terre sur la prise existante : à voir avec l’électricien.',
      urgent: false,
      reportedBy: null,
      reporterLabel: `${yanis.firstName} ${yanis.lastName}`,
      reportedAt: at(toValidate, '14:40'),
    },
  });
  for (const i of [receveur, prise])
    await tx.timelineEntry.create({
      data: {
        tenantId,
        projectId: project.id,
        customerId: project.customerId,
        type: 'issue.reported',
        title: `Signalement : ${i.title}`,
        body: i.description,
        actorLabel: i.reporterLabel,
        occurredAt: i.reportedAt,
        data: { issueId: i.id, photoIds: [] },
      },
    });

  // Bon de régie signé sur place (repris en facturation régie en M8).
  const woDay = workingDaysFrom(story, -3);
  const year = Number(woDay.slice(0, 4));
  const number = formatDocumentNumber(DEFAULT_NUMBER_PATTERNS.work_order, {
    year,
    sequence: await nextSequenceValue(tx, tenantId, 'work_order', year),
  });
  const woId = randomUUID();
  const signedAt = at(woDay, '15:20');
  const signature = await tx.signature.create({
    data: {
      tenantId,
      subjectType: 'work_order',
      subjectId: woId,
      signerName: 'Jean Dupont',
      acceptedTerms: true,
      ip: '203.0.113.42',
      userAgent: 'Seed de démonstration',
      documentSha256: '0'.repeat(64),
      signedAt,
    },
  });
  await tx.workOrder.create({
    data: {
      id: woId,
      tenantId,
      projectId: project.id,
      number,
      day: dayDate(woDay),
      description: 'Déplacement du radiateur de la salle de bain à la demande du client (hors devis).',
      status: 'signed',
      signerName: 'Jean Dupont',
      signatureId: signature.id,
      signedAt,
      createdBy: karimUser,
      lines: {
        create: [
          {
            tenantId,
            position: 0,
            kind: 'labour',
            description: 'Yanis Dubois',
            employeeId: yanis.id,
            quantity: '2.5',
            unit: 'h',
          },
          {
            tenantId,
            position: 1,
            kind: 'material',
            description: 'Tube multicouche 16 mm',
            quantity: '4',
            unit: 'm',
          },
          {
            tenantId,
            position: 2,
            kind: 'material',
            description: 'Raccords à sertir',
            quantity: '6',
            unit: 'pce',
          },
        ],
      },
    },
  });
  await tx.timelineEntry.create({
    data: {
      tenantId,
      projectId: project.id,
      customerId: project.customerId,
      type: 'work_order.signed',
      title: `Bon de régie ${number} signé par Jean Dupont`,
      body: 'Déplacement du radiateur de la salle de bain à la demande du client (hors devis).',
      actorLabel: 'Karim Benali',
      occurredAt: signedAt,
      visibleToClient: true,
      data: { workOrderId: woId },
    },
  });

  // Rapports journaliers arrêtés par Karim (les deux journées avant la dernière à valider).
  const notes = [
    'Dépose de l’ancienne baignoire terminée, évacuation des gravats. RAS.',
    'Plomberie encastrée posée, essai de pression OK. Livraison faïence confirmée pour demain.',
  ];
  for (const [i, d] of [workingDaysFrom(toValidate, -2), workingDaysFrom(toValidate, -1)].entries()) {
    if (d < start) continue;
    await tx.dailyReport.create({
      data: {
        tenantId,
        projectId: project.id,
        day: dayDate(d),
        notes: notes[i]!,
        weather: i ? 'Couvert, 14 °C' : 'Ensoleillé, 17 °C',
        closedAt: at(d, '17:05'),
        closedBy: karimUser,
      },
    });
  }
}
