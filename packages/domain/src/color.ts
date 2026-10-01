/**
 * Couleurs de marque (08) : les portails remplacent l'accent par la couleur du tenant,
 * à condition qu'elle passe le contraste AA (sinon on garde la nôtre).
 */

export const DEFAULT_ACCENT = '#2F4BFF';

export function normalizeHex(input: string): string | null {
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m?.[1]) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${hex.toUpperCase()}`;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`Couleur invalide : ${hex}`);
  const v = Number.parseInt(n.slice(1), 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Ratio de contraste WCAG entre deux couleurs (1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA pour du texte normal : 4,5:1. On vérifie le texte blanc sur la couleur et la couleur sur fond blanc. */
export function passesAA(brand: string, against = '#FFFFFF'): boolean {
  const n = normalizeHex(brand);
  if (!n) return false;
  return contrastRatio(n, against) >= 4.5;
}

/** Couleur d'accent à utiliser sur un portail : celle du tenant si elle est lisible, la nôtre sinon. */
export function portalAccent(brand: string | null | undefined): string {
  if (brand) {
    const n = normalizeHex(brand);
    if (n && passesAA(n)) return n;
  }
  return DEFAULT_ACCENT;
}
