/**
 * Quantités et taux : décimaux exacts. En base, numeric(14,4) pour les quantités et numeric(6,4) pour les taux.
 */
import { Dec, dec, type DecimalInput } from './money';

export const QUANTITY_SCALE = 4;
export const RATE_SCALE = 4;

export function quantity(value: DecimalInput): Dec {
  return dec(value).toDecimalPlaces(QUANTITY_SCALE, Dec.ROUND_HALF_UP);
}

export function rate(value: DecimalInput): Dec {
  return dec(value).toDecimalPlaces(RATE_SCALE, Dec.ROUND_HALF_UP);
}

/** Représentation canonique (chaîne) d'une quantité, ex. « 12.5 ». */
export function quantityToString(value: DecimalInput): string {
  return quantity(value).toString();
}

/** Formate une quantité à la belge (« 12,5 »). */
export function formatQuantity(value: DecimalInput, maxDecimals = 2): string {
  const d = dec(value).toDecimalPlaces(maxDecimals, Dec.ROUND_HALF_UP);
  const [int = '0', frac] = d.abs().toFixed().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  return `${d.isNegative() ? '−' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** Formate un pourcentage à partir d'un ratio décimal (0.218 → « 21,8 % »). */
export function formatPercent(ratioValue: DecimalInput, decimals = 1): string {
  const pct = dec(ratioValue).times(100).toDecimalPlaces(decimals, Dec.ROUND_HALF_UP);
  const [int = '0', frac] = pct.abs().toFixed(decimals).split('.');
  const body = frac && /[1-9]/.test(frac) ? `${int},${frac.replace(/0+$/, '')}` : int;
  return `${pct.isNegative() ? '−' : ''}${body}\u202f%`;
}
