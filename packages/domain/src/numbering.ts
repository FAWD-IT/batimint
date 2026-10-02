/**
 * Numérotation légale (05 §2, CLAUDE.md règle n°4) : continue, sans trou, par tenant, série et année.
 * L'allocation atomique se fait en base (verrou de ligne sur NumberSequence) ; ici, le formatage
 * et les vérifications pures.
 */

export type NumberedDocumentType =
  | 'quote'
  | 'invoice'
  | 'credit_note'
  | 'purchase_order'
  | 'change_order'
  | 'progress_statement'
  | 'work_order'
  | 'subcontract';

export const DEFAULT_NUMBER_PATTERNS: Record<NumberedDocumentType, string> = {
  quote: 'D{YYYY}-{SEQ:3}',
  invoice: '{YYYY}-{SEQ:3}',
  credit_note: 'NC{YYYY}-{SEQ:3}',
  purchase_order: 'BC{YYYY}-{SEQ:3}',
  change_order: 'AV{YYYY}-{SEQ:3}',
  progress_statement: 'EA{YYYY}-{SEQ:3}',
  work_order: 'BR{YYYY}-{SEQ:3}',
  subcontract: 'ST{YYYY}-{SEQ:3}',
};

export class NumberingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NumberingError';
  }
}

/** Formate un numéro de document. Jetons : {YYYY}, {YY}, {SEQ}, {SEQ:n} (n chiffres minimum). */
export function formatDocumentNumber(pattern: string, input: { year: number; sequence: number }): string {
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new NumberingError('La séquence commence à 1.');
  }
  if (!/\{SEQ(?::\d+)?\}/.test(pattern)) throw new NumberingError('Le modèle doit contenir {SEQ}.');
  return pattern
    .replace(/\{YYYY\}/g, input.year.toString().padStart(4, '0'))
    .replace(/\{YY\}/g, (input.year % 100).toString().padStart(2, '0'))
    .replace(/\{SEQ(?::(\d+))?\}/g, (_m, width: string | undefined) =>
      input.sequence.toString().padStart(width ? Number.parseInt(width, 10) : 1, '0'),
    );
}

/** Valide un modèle de numérotation saisi par l'utilisateur. */
export function isValidNumberPattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 40) return false;
  if (!/\{SEQ(?::\d+)?\}/.test(pattern)) return false;
  const withoutTokens = pattern.replace(/\{(YYYY|YY|SEQ(?::\d+)?)\}/g, '');
  return /^[A-Za-z0-9\-_/.]*$/.test(withoutTokens);
}

/**
 * Vérifie qu'une suite de séquences est continue et sans doublon à partir de 1.
 * Renvoie les trous et doublons détectés.
 */
export function checkSequenceContinuity(sequences: readonly number[]): {
  ok: boolean;
  gaps: number[];
  duplicates: number[];
} {
  const sorted = [...sequences].sort((a, b) => a - b);
  const gaps: number[] = [];
  const duplicates: number[] = [];
  let expected = 1;
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i] as number;
    if (i > 0 && current === sorted[i - 1]) {
      duplicates.push(current);
      continue;
    }
    while (expected < current) {
      gaps.push(expected);
      expected++;
    }
    expected = current + 1;
  }
  return { ok: gaps.length === 0 && duplicates.length === 0, gaps, duplicates };
}
