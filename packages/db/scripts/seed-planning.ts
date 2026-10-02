/**
 * Seed M6 (planning) : l'équipe de Karim enchaîne Dupont (seed terrain), l'extension arrière puis
 * le remplacement des châssis ; l'équipe Toiture tient son chantier jusqu'à la fin prévue. Les
 * congés existants (Luca, Kevin) apparaissent comme conflits. La mise en conformité électrique
 * reste à planifier (parcours P3).
 */
import { addDays, isWorkingDay, type IsoDate } from '@batimint/domain';
import { randomUUID } from 'node:crypto';
import type { Tx } from '../src/client';

const dayDate = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10) as IsoDate;

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

export async function seedPlanning(
  tx: Tx,
  tenantId: string,
  users: Map<string, string>,
  today: IsoDate,
): Promise<void> {
  const teams = await tx.team.findMany({ where: { tenantId } });
  const karimTeam = teams.find((t) => t.name === 'Équipe Karim');
  const roofTeam = teams.find((t) => t.name === 'Équipe Toiture');
  if (!karimTeam || !roofTeam) return;
  const sophie = users.get('sophie@renov-habitat.be') ?? null;
  const byName = async (name: string) => tx.project.findFirst({ where: { tenantId, name } });
  const dupont = await byName('Rénovation salle de bain Dupont');
  const extension = await byName('Extension arrière 20 m²');
  const chassis = await byName('Remplacement des châssis');
  const roof = await byName('Remplacement de la toiture');
  if (!dupont?.endDate || !extension || !chassis || !roof) return;
  // Déjà planifié (hors Dupont, posé par le seed terrain) : on ne double pas.
  if (await tx.scheduleSlot.count({ where: { tenantId, projectId: { not: dupont.id } } })) return;

  const slot = (
    projectId: string,
    teamId: string,
    start: IsoDate,
    end: IsoDate,
    note: string | null = null,
  ) => ({
    id: randomUUID(),
    tenantId,
    projectId,
    teamId,
    startDay: dayDate(start),
    startHalf: 'am',
    endDay: dayDate(end),
    endHalf: 'pm',
    note,
    createdBy: sophie,
  });

  const afterDupont = workingDaysFrom(iso(dupont.endDate), 1);
  const extensionEnd = workingDaysFrom(afterDupont, 2);
  const chassisStart = workingDaysFrom(extensionEnd, 1);
  const chassisEnd = workingDaysFrom(chassisStart, 4);
  const roofStart = roof.startDate ? iso(roof.startDate) : workingDaysFrom(today, -6);
  const roofEnd = roof.endDate ? iso(roof.endDate) : workingDaysFrom(today, 10);

  await tx.scheduleSlot.createMany({
    data: [
      slot(extension.id, karimTeam.id, afterDupont, extensionEnd, 'Gros œuvre : dalle et maçonnerie'),
      slot(chassis.id, karimTeam.id, chassisStart, chassisEnd, 'Livraison des châssis la veille'),
      slot(roof.id, roofTeam.id, roofStart, roofEnd),
    ],
  });
  // En préparation, la date de début suit le planning (et a déjà été annoncée au client).
  await tx.project.update({
    where: { id: chassis.id },
    data: {
      startDate: dayDate(chassisStart),
      endDate: dayDate(chassisEnd),
      arrivalNotifiedOn: dayDate(chassisStart),
    },
  });
}
