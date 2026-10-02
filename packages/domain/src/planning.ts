/**
 * Planning (03 §6, 02 P3) : affectations en demi-journées ouvrées, conflits (double affectation,
 * congé), déplacement d'un bloc en gardant sa durée, export iCal. Pur.
 */
import { addDays, brusselsMidnight, type IsoDate, isWorkingDay } from './calendar';

export type Half = 'am' | 'pm';

export interface SlotRange {
  startDay: IsoDate;
  startHalf: Half;
  endDay: IsoDate;
  endHalf: Half;
}

export interface HalfDay {
  day: IsoDate;
  half: Half;
}

const halfKey = (h: HalfDay) => `${h.day}|${h.half}`;
const order = (h: HalfDay) => `${h.day}${h.half === 'am' ? '0' : '1'}`;

/** Une plage est valide si elle commence avant de finir (à la demi-journée près). */
export function isValidRange(r: SlotRange): boolean {
  return order({ day: r.startDay, half: r.startHalf }) <= order({ day: r.endDay, half: r.endHalf });
}

/** Demi-journées ouvrées couvertes (week-ends et fériés belges exclus). */
export function slotHalfDays(r: SlotRange): HalfDay[] {
  const out: HalfDay[] = [];
  if (!isValidRange(r)) return out;
  for (let d = r.startDay; d <= r.endDay; d = addDays(d, 1)) {
    if (!isWorkingDay(d)) continue;
    for (const half of ['am', 'pm'] as const) {
      const h = { day: d, half };
      if (order(h) < order({ day: r.startDay, half: r.startHalf })) continue;
      if (order(h) > order({ day: r.endDay, half: r.endHalf })) continue;
      out.push(h);
    }
  }
  return out;
}

/** Durée en jours ouvrés, au demi-jour : 2,5. */
export function slotWorkingDays(r: SlotRange): number {
  return slotHalfDays(r).length / 2;
}

/** n-ième demi-journée ouvrée à partir d'un point (0 = lui-même s'il est ouvré). */
function shiftHalfDays(from: HalfDay, n: number): HalfDay {
  let cur = from;
  const step = n < 0 ? -1 : 1;
  const next = (h: HalfDay): HalfDay =>
    step > 0
      ? h.half === 'am'
        ? { day: h.day, half: 'pm' }
        : { day: addDays(h.day, 1), half: 'am' }
      : h.half === 'pm'
        ? { day: h.day, half: 'am' }
        : { day: addDays(h.day, -1), half: 'pm' };
  while (!isWorkingDay(cur.day)) cur = next(cur);
  let left = Math.abs(n);
  while (left > 0) {
    cur = next(cur);
    if (isWorkingDay(cur.day)) left--;
  }
  return cur;
}

/**
 * Déplace un bloc pour qu'il commence à `start` en gardant sa durée en demi-journées ouvrées
 * (glisser-déposer : un bloc de 3 jours posé un jeudi finit le lundi suivant).
 */
export function moveSlot(r: SlotRange, start: HalfDay): SlotRange {
  const size = Math.max(1, slotHalfDays(r).length);
  const first = shiftHalfDays(start, 0);
  const last = shiftHalfDays(first, size - 1);
  return { startDay: first.day, startHalf: first.half, endDay: last.day, endHalf: last.half };
}

/** Redimensionne un bloc à `halfDays` demi-journées ouvrées (au moins une). */
export function resizeSlot(r: SlotRange, halfDays: number): SlotRange {
  const first = shiftHalfDays({ day: r.startDay, half: r.startHalf }, 0);
  const last = shiftHalfDays(first, Math.max(1, Math.trunc(halfDays)) - 1);
  return { startDay: first.day, startHalf: first.half, endDay: last.day, endHalf: last.half };
}

export interface PlannedSlot extends SlotRange {
  id: string;
  projectId: string;
  employeeId: string | null;
  teamId: string | null;
}

export interface AbsenceRange {
  employeeId: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  halfDay: Half | null;
}

export type PlanningConflict =
  | { kind: 'double_booking'; employeeId: string; day: IsoDate; half: Half; slotIds: string[] }
  | { kind: 'absence'; employeeId: string; day: IsoDate; half: Half; slotIds: string[] };

/**
 * Conflits par personne et par demi-journée : deux chantiers différents en même temps, ou un
 * congé. Un bloc d'équipe vaut pour chacun de ses membres (`teamMembers`).
 */
export function detectConflicts(input: {
  slots: readonly PlannedSlot[];
  absences: readonly AbsenceRange[];
  teamMembers: ReadonlyMap<string, readonly string[]>;
}): PlanningConflict[] {
  const busy = new Map<string, { slotId: string; projectId: string }[]>();
  for (const s of input.slots) {
    const people = s.employeeId
      ? [s.employeeId]
      : s.teamId
        ? [...(input.teamMembers.get(s.teamId) ?? [])]
        : [];
    for (const h of slotHalfDays(s))
      for (const p of people) {
        const k = `${p}|${halfKey(h)}`;
        const list = busy.get(k) ?? [];
        if (!list.some((x) => x.slotId === s.id)) list.push({ slotId: s.id, projectId: s.projectId });
        busy.set(k, list);
      }
  }
  const off = new Set<string>();
  for (const a of input.absences)
    for (const h of slotHalfDays({
      startDay: a.startsOn,
      startHalf: a.halfDay === 'pm' ? 'pm' : 'am',
      endDay: a.endsOn,
      endHalf: a.halfDay === 'am' ? 'am' : 'pm',
    }))
      off.add(`${a.employeeId}|${halfKey(h)}`);

  const out: PlanningConflict[] = [];
  for (const [k, list] of [...busy.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [employeeId, day, half] = k.split('|') as [string, IsoDate, Half];
    if (new Set(list.map((x) => x.projectId)).size > 1)
      out.push({ kind: 'double_booking', employeeId, day, half, slotIds: list.map((x) => x.slotId) });
    if (off.has(k)) out.push({ kind: 'absence', employeeId, day, half, slotIds: list.map((x) => x.slotId) });
  }
  return out;
}

/** Première demi-journée planifiée d'un chantier (date de début annoncée au client). */
export function firstPlannedDay(slots: readonly SlotRange[]): IsoDate | null {
  const days = slots.flatMap((s) =>
    slotHalfDays(s)
      .slice(0, 1)
      .map((h) => h.day),
  );
  return days.length ? days.sort()[0]! : null;
}

// ---------------------------------------------------------------------------
// iCal (RFC 5545)
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  uid: string;
  range: SlotRange;
  summary: string;
  location?: string | null;
  description?: string | null;
  updatedAt: Date;
}

/** Heures de chantier par défaut : matin 8 h – 12 h, après-midi 12 h 30 – 16 h 30. */
const HALF_TIMES = { am: { start: 8 * 60, end: 12 * 60 }, pm: { start: 12 * 60 + 30, end: 16 * 60 + 30 } };

function utcStamp(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function at(day: IsoDate, minutes: number): Date {
  return new Date(brusselsMidnight(day).getTime() + minutes * 60_000);
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Taille UTF-8 d'un caractère (point de code). */
function utf8Bytes(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** Pliage des lignes à 75 octets (UTF-8), suite précédée d'une espace. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = utf8Bytes(ch);
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
      size = n;
    } else {
      cur += ch;
      size += n;
    }
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * Calendrier iCal d'une personne : un événement par jour ouvré planifié (les week-ends et
 * fériés ne sont pas montrés comme travaillés), avec les heures de la demi-journée.
 */
export function buildICal(input: { name: string; events: readonly CalendarEvent[]; now?: Date }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Batimint//Planning//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(input.name)}`,
    'X-WR-TIMEZONE:Europe/Brussels',
  ];
  const stamp = utcStamp(input.now ?? new Date());
  for (const e of input.events) {
    const halves = slotHalfDays(e.range);
    const days = [...new Set(halves.map((h) => h.day))];
    for (const day of days) {
      const mine = halves.filter((h) => h.day === day);
      const start = mine.some((h) => h.half === 'am') ? HALF_TIMES.am.start : HALF_TIMES.pm.start;
      const end = mine.some((h) => h.half === 'pm') ? HALF_TIMES.pm.end : HALF_TIMES.am.end;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.uid}-${day}@batimint`,
        `DTSTAMP:${stamp}`,
        `LAST-MODIFIED:${utcStamp(e.updatedAt)}`,
        `DTSTART:${utcStamp(at(day, start))}`,
        `DTEND:${utcStamp(at(day, end))}`,
        `SUMMARY:${escapeText(e.summary)}`,
        ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
        ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
