/**
 * Bibliothèque (03 §3) : articles, ouvrages composés (imbriquables sur un niveau), prix de revient
 * et prix de vente. La mise à jour d'un prix ne modifie jamais un devis existant (les devis copient).
 */
import { type Cents, Dec, dec, type DecimalInput, multiplyCents, roundHalfAwayFromZero } from './money';

export const ITEM_KINDS = [
  'material',
  'labour',
  'subcontracting',
  'equipment',
  'lump_sum',
  'assembly',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const UNITS = ['u', 'm', 'm²', 'm³', 'kg', 't', 'l', 'h', 'j', 'forfait', 'lot', 'ens'] as const;
export type Unit = (typeof UNITS)[number];

const UNIT_ALIASES: Record<string, Unit> = {
  u: 'u',
  pc: 'u',
  pce: 'u',
  pcs: 'u',
  piece: 'u',
  pièce: 'u',
  pieces: 'u',
  st: 'u',
  stuk: 'u',
  unite: 'u',
  unité: 'u',
  m: 'm',
  ml: 'm',
  mct: 'm',
  'm.': 'm',
  metre: 'm',
  mètre: 'm',
  lm: 'm',
  m2: 'm²',
  'm²': 'm²',
  'm^2': 'm²',
  mc: 'm²',
  mcarre: 'm²',
  'mètre carré': 'm²',
  m3: 'm³',
  'm³': 'm³',
  'm^3': 'm³',
  kg: 'kg',
  t: 't',
  tonne: 't',
  l: 'l',
  litre: 'l',
  ltr: 'l',
  h: 'h',
  heure: 'h',
  hr: 'h',
  uur: 'h',
  j: 'j',
  jour: 'j',
  jours: 'j',
  dag: 'j',
  forfait: 'forfait',
  ff: 'forfait',
  fft: 'forfait',
  forf: 'forfait',
  lot: 'lot',
  ens: 'ens',
  ensemble: 'ens',
  set: 'ens',
};

/** Normalise une unité saisie (« m2 », « Pce », « FF ») ; null si inconnue. */
export function normalizeUnit(input: string): Unit | null {
  const key = input.trim().toLowerCase().replace(/\s+/g, ' ');
  return UNIT_ALIASES[key] ?? null;
}

export interface CostableItem {
  id: string;
  kind: ItemKind;
  purchasePrice: Cents;
  laborHours: DecimalInput;
  components?: { item: CostableItem; quantity: DecimalInput }[];
}

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryError';
  }
}

/** Profondeur maximale : ouvrage → sous-ouvrage → articles (03 §3). */
export const MAX_ASSEMBLY_DEPTH = 2;

/** Vérifie la structure d'un ouvrage (profondeur, cycles). */
export function assertAssemblyStructure(item: CostableItem, depth = 1, seen: Set<string> = new Set()): void {
  if (seen.has(item.id)) throw new LibraryError('Un ouvrage ne peut pas se contenir lui-même.');
  if (item.kind !== 'assembly') return;
  if (depth > MAX_ASSEMBLY_DEPTH)
    throw new LibraryError('Les ouvrages ne sont imbriquables que sur un niveau.');
  const next = new Set(seen).add(item.id);
  for (const c of item.components ?? []) assertAssemblyStructure(c.item, depth + 1, next);
}

/** Prix de revient unitaire (centimes) et temps de pose (heures) d'un article ou d'un ouvrage. */
export function computeItemCost(item: CostableItem): { cost: Cents; laborHours: Dec } {
  assertAssemblyStructure(item);
  if (item.kind !== 'assembly') return { cost: item.purchasePrice, laborHours: dec(item.laborHours) };
  let exact = new Dec(0);
  let hours = new Dec(0);
  for (const c of item.components ?? []) {
    const sub = computeItemCost(c.item);
    exact = exact.plus(new Dec(sub.cost.toString()).times(dec(c.quantity)));
    hours = hours.plus(sub.laborHours.times(dec(c.quantity)));
  }
  return { cost: roundHalfAwayFromZero(exact), laborHours: hours };
}

/**
 * Prix de vente unitaire : prix forcé, sinon revient × coefficient (article ou tenant).
 * Coefficient du tenant = frais généraux × marge (paramètres métier).
 */
export function computeSalePrice(input: {
  cost: Cents;
  salePrice?: Cents | null;
  itemCoefficient?: DecimalInput | null;
  overheadCoefficient: DecimalInput;
  marginCoefficient: DecimalInput;
}): Cents {
  if (input.salePrice !== undefined && input.salePrice !== null) return input.salePrice;
  const coef = input.itemCoefficient
    ? dec(input.itemCoefficient)
    : dec(input.overheadCoefficient).times(dec(input.marginCoefficient));
  return multiplyCents(input.cost, coef);
}

/** Taux de marge sur prix de vente : (vente − revient) / vente. */
export function marginRate(sale: Cents, cost: Cents): Dec | null {
  if (sale === 0n) return null;
  return new Dec((sale - cost).toString()).dividedBy(new Dec(sale.toString()));
}
