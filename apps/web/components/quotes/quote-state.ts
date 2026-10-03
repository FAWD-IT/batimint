/**
 * État de l'éditeur de devis : saisie libre (virgules acceptées), conversion vers le contrat de
 * l'API et calcul en direct avec `computeQuote` (mêmes fonctions que le serveur et le PDF).
 */
import type { QuoteDto, QuoteLineDto, QuoteSectionDto } from '@batimint/contracts';
import { computeQuote, type QuoteInput, type QuoteTotals, type VatRegime } from '@batimint/domain';
import { v7 as uuidv7 } from 'uuid';

export interface EditLine {
  key: string;
  kind: 'item' | 'text';
  itemId: string | null;
  code: string | null;
  description: string;
  unit: string;
  /** Saisie brute (« 18,5 »). */
  quantity: string;
  unitPrice: number;
  unitCost: number;
  laborHours: string;
  vatRegime: VatRegime;
  vatSuggested: VatRegime;
  vatJustification: string | null;
  discountPercent: string;
}

export interface EditSection {
  key: string;
  title: string;
  description: string | null;
  optional: boolean;
  selected: boolean;
  lines: EditLine[];
}

export interface EditDoc {
  title: string;
  intro: string;
  notes: string;
  validityDays: number;
  globalDiscountPercent: string;
  deposit: { kind: 'percent'; value: string } | { kind: 'amount'; value: number } | null;
  sections: EditSection[];
}

/** « 18,5 » → « 18.5 » ; chaîne vide ou invalide → null. */
export function toDecimal(input: string): string | null {
  const s = input.trim().replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

export function fromDecimal(s: string): string {
  const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return t.replace('.', ',');
}

function lineFromDto(l: QuoteLineDto): EditLine {
  return {
    key: l.key,
    kind: l.kind,
    itemId: l.itemId,
    code: l.code,
    description: l.description,
    unit: l.unit,
    quantity: fromDecimal(l.quantity),
    unitPrice: l.unitPrice,
    unitCost: l.unitCost ?? 0,
    laborHours: l.laborHours,
    vatRegime: l.vatRegime as VatRegime,
    vatSuggested: l.vatSuggested as VatRegime,
    vatJustification: l.vatJustification,
    discountPercent: l.discountPercent === '0' ? '' : fromDecimal(l.discountPercent),
  };
}

export function docFromQuote(q: QuoteDto): EditDoc {
  const v = q.currentVersion;
  return {
    title: q.title,
    intro: v.intro ?? '',
    notes: v.notes ?? '',
    validityDays: q.validityDays,
    globalDiscountPercent: v.globalDiscountPercent === '0' ? '' : fromDecimal(v.globalDiscountPercent),
    deposit: v.deposit
      ? v.deposit.kind === 'percent'
        ? { kind: 'percent', value: fromDecimal(String(v.deposit.value)) }
        : { kind: 'amount', value: Number(v.deposit.value) }
      : null,
    sections: v.sections.map((s: QuoteSectionDto) => ({
      key: s.key,
      title: s.title,
      description: s.description,
      optional: s.optional,
      selected: s.selected,
      lines: s.lines.map(lineFromDto),
    })),
  };
}

/** Contenu envoyé à l'API (PUT /quotes/:id/content). */
export function contentBody(doc: EditDoc, revision: number) {
  return {
    revision,
    title: doc.title.trim().length >= 2 ? doc.title.trim() : undefined,
    validityDays: doc.validityDays,
    intro: doc.intro,
    notes: doc.notes,
    globalDiscountPercent: toDecimal(doc.globalDiscountPercent || '0') ?? '0',
    deposit: doc.deposit
      ? doc.deposit.kind === 'percent'
        ? { kind: 'percent' as const, value: toDecimal(doc.deposit.value || '0') ?? '0' }
        : { kind: 'amount' as const, value: doc.deposit.value }
      : null,
    sections: doc.sections.map((s) => ({
      key: s.key,
      title: s.title,
      description: s.description,
      optional: s.optional,
      selected: s.selected,
      lines: s.lines.map((l) => ({
        key: l.key,
        kind: l.kind,
        itemId: l.itemId,
        code: l.code,
        description: l.description,
        unit: l.unit || 'u',
        quantity: toDecimal(l.quantity) ?? '0',
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        laborHours: toDecimal(l.laborHours) ?? '0',
        vatRegime: l.vatRegime,
        vatJustification: l.vatRegime === l.vatSuggested ? null : l.vatJustification,
        discountPercent: toDecimal(l.discountPercent || '0') ?? '0',
      })),
    })),
  };
}

export function totalsOf(doc: EditDoc): QuoteTotals {
  const input: QuoteInput = {
    globalDiscountPercent: toDecimal(doc.globalDiscountPercent || '0') ?? '0',
    deposit: doc.deposit
      ? doc.deposit.kind === 'percent'
        ? { kind: 'percent', value: toDecimal(doc.deposit.value || '0') ?? '0' }
        : { kind: 'amount', value: BigInt(doc.deposit.value) }
      : null,
    sections: doc.sections.map((s) => ({
      id: s.key,
      title: s.title,
      optional: s.optional,
      selected: s.selected,
      lines: s.lines.map((l) => ({
        id: l.key,
        kind: l.kind,
        description: l.description,
        unit: l.unit,
        quantity: toDecimal(l.quantity) ?? '0',
        unitPrice: BigInt(l.unitPrice),
        unitCost: BigInt(l.unitCost),
        laborHours: toDecimal(l.laborHours) ?? '0',
        vatRegime: l.vatRegime,
        discountPercent: toDecimal(l.discountPercent || '0') ?? '0',
      })),
    })),
  };
  return computeQuote(input);
}

export function newLine(suggested: VatRegime, over: Partial<EditLine> = {}): EditLine {
  return {
    key: uuidv7(),
    kind: 'item',
    itemId: null,
    code: null,
    description: '',
    unit: 'u',
    quantity: '1',
    unitPrice: 0,
    unitCost: 0,
    laborHours: '0',
    vatRegime: suggested,
    vatSuggested: suggested,
    vatJustification: null,
    discountPercent: '',
    ...over,
  };
}

export function newSection(title = ''): EditSection {
  return { key: uuidv7(), title, description: null, optional: false, selected: false, lines: [] };
}

/** Régime proposé pour un article de la bibliothèque (taux imposé ou « auto »). */
export function itemSuggestion(vatRate: string, quoteRegime: VatRegime): VatRegime {
  return vatRate && vatRate !== 'auto' ? (vatRate as VatRegime) : quoteRegime;
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}
