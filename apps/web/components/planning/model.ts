/**
 * Mise en page du planning : période affichée, lignes (équipes, personnes, chantiers), position
 * des blocs en demi-journées et empilement quand deux blocs se chevauchent sur une ligne.
 */
import type { PlanningDto, PlanningSlotDto } from '@batimint/contracts';
import { addDays, type Half } from '@batimint/domain';

export type Zoom = 'week' | 'month';
export type Grouping = 'teams' | 'people' | 'projects';

/** Lundi de la semaine d'un jour (AAAA-MM-JJ). */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = dimanche
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function period(anchor: string, zoom: Zoom): { from: string; to: string } {
  if (zoom === 'week') {
    const from = mondayOf(anchor);
    return { from, to: addDays(from, 6) };
  }
  // Mois : du lundi de la semaine du 1er au dimanche de la semaine du dernier jour.
  const first = `${anchor.slice(0, 7)}-01`;
  const next = new Date(`${first}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(next.toISOString().slice(0, 10), -1);
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) };
}

export function shift(anchor: string, zoom: Zoom, dir: -1 | 1): string {
  if (zoom === 'week') return addDays(anchor, 7 * dir);
  const d = new Date(`${anchor.slice(0, 7)}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + dir);
  return d.toISOString().slice(0, 10);
}

/** Colonne (0…) d'une demi-journée dans la période. */
export function columnOf(from: string, day: string, half: Half): number {
  const days = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return days * 2 + (half === 'pm' ? 1 : 0);
}

export function cellAt(from: string, column: number): { day: string; half: Half } {
  return { day: addDays(from, Math.floor(column / 2)), half: column % 2 ? 'pm' : 'am' };
}

export interface Placed {
  slot: PlanningSlotDto;
  start: number;
  end: number;
  lane: number;
  /** Le bloc continue avant / après la période affichée. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** Place les blocs d'une ligne et les empile sur des « couloirs » s'ils se chevauchent. */
export function place(
  slots: PlanningSlotDto[],
  from: string,
  columns: number,
): { items: Placed[]; lanes: number } {
  const items: Placed[] = [];
  const laneEnds: number[] = [];
  const sorted = [...slots].sort(
    (a, b) => columnOf(from, a.startDay, a.startHalf) - columnOf(from, b.startDay, b.startHalf),
  );
  for (const slot of sorted) {
    const rawStart = columnOf(from, slot.startDay, slot.startHalf);
    const rawEnd = columnOf(from, slot.endDay, slot.endHalf);
    if (rawEnd < 0 || rawStart >= columns) continue;
    const start = Math.max(0, rawStart);
    const end = Math.min(columns - 1, rawEnd);
    let lane = laneEnds.findIndex((e) => e < start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else laneEnds[lane] = end;
    items.push({ slot, start, end, lane, clippedStart: rawStart < 0, clippedEnd: rawEnd >= columns });
  }
  return { items, lanes: Math.max(1, laneEnds.length) };
}

export interface Row {
  key: string;
  kind: 'team' | 'employee' | 'project';
  id: string;
  label: string;
  sublabel: string | null;
  /** Ligne secondaire (membre sous son équipe). */
  nested: boolean;
  slots: PlanningSlotDto[];
  /** Affectations de l'équipe montrées en filigrane sur la ligne d'une personne. */
  inherited: PlanningSlotDto[];
  absences: PlanningDto['absences'];
  /** Où déposer : ressource implicite de la ligne. */
  drop: { employeeId: string | null; teamId: string | null } | null;
}

export function rows(data: PlanningDto, grouping: Grouping): Row[] {
  const absencesOf = (employeeId: string) => data.absences.filter((a) => a.employeeId === employeeId);
  const person = (e: PlanningDto['employees'][number], nested: boolean): Row => ({
    key: `e:${e.id}`,
    kind: 'employee',
    id: e.id,
    label: e.name,
    sublabel: e.jobTitle,
    nested,
    slots: data.slots.filter((s) => s.employeeId === e.id),
    inherited: e.teamId ? data.slots.filter((s) => s.teamId === e.teamId) : [],
    absences: absencesOf(e.id),
    drop: { employeeId: e.id, teamId: null },
  });
  if (grouping === 'people') return data.employees.map((e) => person(e, false));
  if (grouping === 'projects') {
    const used = new Set(data.slots.map((s) => s.projectId));
    return data.projects
      .filter((p) => used.has(p.id) || p.status !== 'suspended')
      .map((p) => ({
        key: `p:${p.id}`,
        kind: 'project' as const,
        id: p.id,
        label: p.shortLabel,
        sublabel: p.name,
        nested: false,
        slots: data.slots.filter((s) => s.projectId === p.id),
        inherited: [],
        absences: [],
        drop: null,
      }));
  }
  const out: Row[] = [];
  for (const team of data.teams) {
    out.push({
      key: `t:${team.id}`,
      kind: 'team',
      id: team.id,
      label: team.name,
      sublabel: null,
      nested: false,
      slots: data.slots.filter((s) => s.teamId === team.id),
      inherited: [],
      absences: [],
      drop: { employeeId: null, teamId: team.id },
    });
    for (const e of data.employees.filter((x) => x.teamId === team.id))
      out.push({ ...person(e, true), inherited: [] });
  }
  for (const e of data.employees.filter((x) => !x.teamId)) out.push(person(e, false));
  return out;
}

/** Couleurs de chantier : liseré foncé + fond clair, texte toujours en encre (contraste AA). */
const PALETTE = ['#2F4BFF', '#B4570B', '#1E7B45', '#9333EA', '#0E7490', '#BE123C', '#4D7C0F', '#A16207'];

export function projectColor(projectId: string): string {
  let h = 0;
  for (const ch of projectId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Durée par défaut d'une tâche déposée : heures prévues / 4 h par demi-journée, au moins une. */
export function halfDaysForHours(hours: string): number {
  const h = Number(hours);
  return Number.isFinite(h) && h > 0 ? Math.max(1, Math.ceil(h / 4)) : 2;
}
