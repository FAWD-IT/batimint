/**
 * Calendrier belge : jours fériés légaux et jours ouvrés (lundi → vendredi hors fériés).
 * Les dates sont manipulées en chaînes ISO `YYYY-MM-DD` (date civile, sans fuseau) pour éviter
 * les décalages UTC ↔ Europe/Brussels.
 */

export type IsoDate = string;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function isoDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function toUtc(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
}

function fromUtc(d: Date): IsoDate {
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const t = toUtc(d);
  t.setUTCDate(t.getUTCDate() + days);
  return fromUtc(t);
}

/** Date civile à Bruxelles d'un instant donné. */
export function brusselsDate(at: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return parts;
}

/** Instant de minuit (heure de Bruxelles, été comme hiver) au début d'un jour civil. */
export function brusselsMidnight(d: IsoDate): Date {
  const guess = new Date(`${d}T00:00:00Z`);
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(guess.getTime() - offsetHours * 3_600_000);
    if (brusselsDate(candidate) === d && brusselsDate(new Date(candidate.getTime() - 1)) !== d)
      return candidate;
  }
  return new Date(guess.getTime() - 3_600_000);
}

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

/** Les 10 jours fériés légaux belges. */
export function belgianPublicHolidays(year: number): { date: IsoDate; key: string }[] {
  const easter = easterSunday(year);
  return [
    { date: isoDate(year, 1, 1), key: 'new_year' },
    { date: addDays(easter, 1), key: 'easter_monday' },
    { date: isoDate(year, 5, 1), key: 'labour_day' },
    { date: addDays(easter, 39), key: 'ascension' },
    { date: addDays(easter, 50), key: 'whit_monday' },
    { date: isoDate(year, 7, 21), key: 'national_day' },
    { date: isoDate(year, 8, 15), key: 'assumption' },
    { date: isoDate(year, 11, 1), key: 'all_saints' },
    { date: isoDate(year, 11, 11), key: 'armistice' },
    { date: isoDate(year, 12, 25), key: 'christmas' },
  ];
}

const holidayCache = new Map<number, Set<IsoDate>>();

export function isBelgianPublicHoliday(d: IsoDate): boolean {
  const year = Number(d.slice(0, 4));
  let set = holidayCache.get(year);
  if (!set) {
    set = new Set(belgianPublicHolidays(year).map((h) => h.date));
    holidayCache.set(year, set);
  }
  return set.has(d);
}

export function isWorkingDay(d: IsoDate): boolean {
  const dow = toUtc(d).getUTCDay();
  return dow !== 0 && dow !== 6 && !isBelgianPublicHoliday(d);
}

/** Nombre de jours ouvrés entre deux dates incluses (0 si fin < début). */
export function workingDaysBetween(start: IsoDate, end: IsoDate): number {
  if (end < start) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkingDay(d)) n++;
  return n;
}

/** Ajoute n jours ouvrés (n ≥ 0) : renvoie le n-ième jour ouvré après `d`. */
export function addWorkingDays(d: IsoDate, n: number): IsoDate {
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (isWorkingDay(cur)) left--;
  }
  return cur;
}
