/**
 * Terrain (03 §7, 02 P4) : pointage géolocalisé avec tolérance, heures prestées à partir des
 * pointages IN/OUT (pause paramétrable), coût main-d'œuvre et sa répartition sur les postes.
 * Pur : sert à l'API, au worker et à l'affichage hors ligne.
 */
import { allocateProRata, type Cents, Dec, dec, roundHalfAwayFromZero } from './money';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Distance à vol d'oiseau (formule de haversine), en mètres. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeofenceResult =
  | { status: 'ok'; distance: number }
  | { status: 'too_far'; distance: number }
  | { status: 'no_position' }
  | { status: 'no_site_position'; distance: null };

/**
 * Vérifie la position du pointage par rapport au chantier. La précision annoncée par le
 * téléphone est ajoutée à la tolérance (un GPS à ± 80 m ne doit pas bloquer un ouvrier sur place).
 */
export function checkGeofence(input: {
  site: GeoPoint | null;
  position: (GeoPoint & { accuracy?: number | null }) | null;
  toleranceMeters: number;
}): GeofenceResult {
  if (!input.position) return { status: 'no_position' };
  if (!input.site) return { status: 'no_site_position', distance: null };
  const distance = Math.trunc(distanceMeters(input.site, input.position) + 0.5);
  const slack = Math.min(Math.max(0, input.position.accuracy ?? 0), 200);
  return distance <= input.toleranceMeters + slack
    ? { status: 'ok', distance }
    : { status: 'too_far', distance };
}

export interface ClockEvent {
  id: string;
  kind: 'in' | 'out';
  at: Date;
}

export interface WorkSession {
  inId: string;
  outId: string | null;
  start: Date;
  end: Date | null;
  minutes: number;
}

export interface WorkedTime {
  sessions: WorkSession[];
  grossMinutes: number;
  breakMinutes: number;
  netMinutes: number;
  /** Arrivée sans départ (journée en cours). */
  openSince: Date | null;
  anomalies: ('double_in' | 'out_without_in')[];
}

/**
 * Heures d'une journée à partir des pointages triés : une session par paire IN → OUT. Deux IN
 * de suite : le dernier gagne (ADR terrain), l'anomalie est signalée. Pause déduite une fois par
 * jour quand le temps brut dépasse le seuil (paramètres de l'entreprise).
 */
export function computeWorkedTime(
  events: readonly ClockEvent[],
  options: { breakMinutes: number; breakAfterMinutes: number; now?: Date },
): WorkedTime {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const sessions: WorkSession[] = [];
  const anomalies: WorkedTime['anomalies'] = [];
  let open: ClockEvent | null = null;
  for (const e of sorted) {
    if (e.kind === 'in') {
      if (open) anomalies.push('double_in');
      open = e;
    } else if (open) {
      sessions.push({
        inId: open.id,
        outId: e.id,
        start: open.at,
        end: e.at,
        minutes: Math.max(0, Math.floor((e.at.getTime() - open.at.getTime()) / 60_000)),
      });
      open = null;
    } else {
      anomalies.push('out_without_in');
    }
  }
  if (open)
    sessions.push({
      inId: open.id,
      outId: null,
      start: open.at,
      end: null,
      minutes: options.now
        ? Math.max(0, Math.floor((options.now.getTime() - open.at.getTime()) / 60_000))
        : 0,
    });
  const closed = sessions.filter((s) => s.end);
  const grossMinutes = closed.reduce((sum, s) => sum + s.minutes, 0);
  const breakMinutes =
    options.breakMinutes > 0 && grossMinutes > options.breakAfterMinutes
      ? Math.min(options.breakMinutes, grossMinutes)
      : 0;
  return {
    sessions,
    grossMinutes,
    breakMinutes,
    netMinutes: grossMinutes - breakMinutes,
    openSince: open ? open.at : null,
    anomalies,
  };
}

/** Coût main-d'œuvre : minutes × coût horaire chargé, arrondi au centime. */
export function labourCost(minutes: number, hourlyCost: Cents): Cents {
  if (minutes <= 0 || hourlyCost <= 0n) return 0n;
  return roundHalfAwayFromZero(new Dec(hourlyCost.toString()).times(minutes).dividedBy(60));
}

/**
 * Répartit un coût de main-d'œuvre sur les postes du chantier : d'abord les postes des tâches
 * avancées ce jour-là, sinon au prorata des heures prévues restantes des postes non terminés.
 * Renvoie une liste vide si rien ne permet de ventiler (coût « non ventilé »).
 */
export function allocateLabour(
  cost: Cents,
  posts: readonly {
    id: string;
    plannedHours: string | number;
    progress: string | number;
    touchedToday?: boolean;
  }[],
): { budgetLineId: string; amount: Cents }[] {
  if (cost <= 0n) return [];
  const touched = posts.filter((p) => p.touchedToday);
  const candidates = touched.length ? touched : posts.filter((p) => dec(p.progress).lessThan(1));
  const weights = candidates.map((p) => {
    const remaining = dec(p.plannedHours).times(new Dec(1).minus(dec(p.progress)));
    const w = touched.length ? dec(p.plannedHours) : remaining;
    return roundHalfAwayFromZero(w.times(100));
  });
  if (!candidates.length || weights.every((w) => w <= 0n)) return [];
  return allocateProRata(cost, weights)
    .map((amount, i) => ({ budgetLineId: candidates[i]!.id, amount }))
    .filter((x) => x.amount !== 0n);
}

/** « 7 h 30 », « 45 min » */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Check In and Out at Work (05 §8) : obligatoire dès 500 000 € HTVA sur le chantier entier. */
export const CHECK_IN_OUT_THRESHOLD: Cents = 50_000_000n;

export function requiresCheckInOut(input: {
  contractAmount: Cents;
  workplaceTotalAmount?: Cents | null;
}): boolean {
  const total =
    input.workplaceTotalAmount && input.workplaceTotalAmount > input.contractAmount
      ? input.workplaceTotalAmount
      : input.contractAmount;
  return total >= CHECK_IN_OUT_THRESHOLD;
}

/** Heure de Bruxelles au format belge : « 8 h 02 ». */
export function formatClockTime(at: Date): string {
  const parts = new Intl.DateTimeFormat('fr-BE', {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Brussels',
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h} h ${m}`;
}
