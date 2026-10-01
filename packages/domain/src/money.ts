/**
 * Argent : toujours en centimes entiers (bigint). Jamais de flottant (CLAUDE.md, règle n°2).
 * Les quantités, taux et coefficients sont des décimaux exacts (Decimal).
 */
import Decimal from 'decimal.js';

/** Décimal exact, arrondi « half away from zero » (arrondi commercial, EN 16931). */
export const Dec = Decimal.clone({
  precision: 50,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
});
export type Dec = InstanceType<typeof Dec>;
export type DecimalInput = Dec | string | number | bigint;

/** Montant en centimes d'euro. */
export type Cents = bigint;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function dec(value: DecimalInput): Dec {
  if (value instanceof Dec) return value;
  if (typeof value === 'bigint') return new Dec(value.toString());
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MoneyError(`Valeur décimale invalide : ${value}`);
    return new Dec(value);
  }
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) throw new MoneyError(`Valeur décimale invalide : « ${value} »`);
  return new Dec(normalized);
}

/** Convertit un entier (number sûr, bigint ou chaîne d'entier) en centimes. */
export function cents(value: bigint | number | string): Cents {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      throw new MoneyError(`Un montant en centimes doit être un entier : ${value}`);
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value.trim())) throw new MoneyError(`Montant en centimes invalide : « ${value} »`);
  return BigInt(value.trim());
}

/** Arrondit un décimal à l'entier le plus proche, 0,5 s'éloignant de zéro. */
export function roundHalfAwayFromZero(value: DecimalInput): bigint {
  const d = dec(value).toDecimalPlaces(0, Dec.ROUND_HALF_UP);
  return BigInt(d.toFixed(0));
}

/** Convertit des euros (« 12,345 », « 12.34 », 12) en centimes, arrondis à 2 décimales (EN 16931). */
export function eurosToCents(value: DecimalInput): Cents {
  return roundHalfAwayFromZero(dec(value).times(100));
}

/** Centimes → décimal en euros (exact). */
export function centsToEuros(value: Cents): Dec {
  return new Dec(value.toString()).dividedBy(100);
}

/** Centimes → chaîne décimale « 1234.56 » (format UBL / exports). */
export function centsToDecimalString(value: Cents): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const units = abs / 100n;
  const rest = abs % 100n;
  return `${negative ? '-' : ''}${units.toString()}.${rest.toString().padStart(2, '0')}`;
}

/** Multiplie un montant par un facteur décimal exact, résultat arrondi au centime. */
export function multiplyCents(amount: Cents, factor: DecimalInput): Cents {
  return roundHalfAwayFromZero(new Dec(amount.toString()).times(dec(factor)));
}

/** Pourcentage d'un montant (« 21 » pour 21 %), arrondi au centime. */
export function percentOf(amount: Cents, percent: DecimalInput): Cents {
  return roundHalfAwayFromZero(new Dec(amount.toString()).times(dec(percent)).dividedBy(100));
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

export function maxCents(a: Cents, b: Cents): Cents {
  return a > b ? a : b;
}

export function minCents(a: Cents, b: Cents): Cents {
  return a < b ? a : b;
}

export function absCents(a: Cents): Cents {
  return a < 0n ? -a : a;
}

/** Ratio a / b en décimal exact (null si b = 0). */
export function ratio(a: Cents, b: Cents): Dec | null {
  if (b === 0n) return null;
  return new Dec(a.toString()).dividedBy(new Dec(b.toString()));
}

/**
 * Répartit un montant entre plusieurs bases au prorata, sans perdre un centime
 * (méthode du plus fort reste). La somme des parts vaut exactement `total`.
 */
export function allocateProRata(total: Cents, weights: readonly Cents[]): Cents[] {
  if (weights.length === 0) return [];
  const weightSum = sumCents(weights);
  if (weightSum === 0n) {
    // Répartition égale si toutes les bases sont nulles.
    return allocateProRata(
      total,
      weights.map(() => 1n),
    );
  }
  const sign = total < 0n ? -1n : 1n;
  const absTotal = absCents(total);
  const parts = weights.map((w) => (absTotal * w) / weightSum);
  const remainders = weights.map((w, i) => ({ i, r: (absTotal * w) % weightSum }));
  let remaining = absTotal - sumCents(parts);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (remaining <= 0n) break;
    parts[i] = (parts[i] ?? 0n) + 1n;
    remaining -= 1n;
  }
  return parts.map((p) => p * sign);
}

const NBSP = ' ';

/**
 * Formate un montant en euros, à la belge (« 1 234,56 € »). Exact pour tout bigint.
 */
export function formatEuros(
  value: Cents,
  options: { withSymbol?: boolean; decimals?: boolean } = {},
): string {
  const { withSymbol = true, decimals = true } = options;
  const negative = value < 0n;
  let abs = negative ? -value : value;
  if (!decimals) abs = roundHalfAwayFromZero(new Dec(abs.toString()).dividedBy(100)) * 100n;
  const units = (abs / 100n).toString();
  const rest = (abs % 100n).toString().padStart(2, '0');
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const body = decimals ? `${grouped},${rest}` : grouped;
  return `${negative ? '−' : ''}${body}${withSymbol ? `${NBSP}€` : ''}`;
}
