/**
 * Contenu d'une version de devis → entrée des calculs purs (`computeQuote`), partagé par l'API
 * (éditeur, portail, PDF) et le worker (chantier créé à la signature).
 */
import type {
  QuoteInput,
  QuoteLineInput,
  QuoteLineKind,
  QuoteSectionInput,
  VatRegime,
} from '@batimint/domain';
import type { Tx } from './client';

export interface VersionLine extends QuoteLineInput {
  rowId: string;
  itemId: string | null;
  code: string | null;
  vatSuggested: VatRegime;
  vatJustification: string | null;
}

export interface VersionSection extends Omit<QuoteSectionInput, 'lines'> {
  rowId: string;
  description: string | null;
  lines: VersionLine[];
}

export interface VersionContent extends Omit<QuoteInput, 'sections'> {
  sections: VersionSection[];
}

type VersionRow = NonNullable<Awaited<ReturnType<typeof findVersion>>>;

function findVersion(tx: Tx, versionId: string) {
  return tx.quoteVersion.findUnique({
    where: { id: versionId },
    include: {
      sections: {
        orderBy: { position: 'asc' },
        include: { lines: { orderBy: { position: 'asc' } } },
      },
    },
  });
}

/** Les identifiants de calcul sont les clés stables (identiques d'une version à l'autre). */
export function toVersionContent(v: VersionRow): VersionContent {
  return {
    globalDiscountPercent: v.globalDiscountPercent.toString(),
    deposit:
      v.depositKind === 'percent' && v.depositValue
        ? { kind: 'percent', value: v.depositValue.toString() }
        : v.depositKind === 'amount' && v.depositValue
          ? { kind: 'amount', value: BigInt(v.depositValue.toFixed(0)) }
          : null,
    sections: v.sections.map((s) => ({
      id: s.key,
      rowId: s.id,
      title: s.title,
      description: s.description,
      optional: s.optional,
      selected: s.selected,
      lines: s.lines.map((l) => ({
        id: l.key,
        rowId: l.id,
        kind: l.kind as QuoteLineKind,
        itemId: l.itemId,
        code: l.code,
        description: l.description,
        unit: l.unit,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        laborHours: l.laborHours.toString(),
        vatRegime: l.vatRegime as VatRegime,
        vatSuggested: l.vatSuggested as VatRegime,
        vatJustification: l.vatJustification,
        discountPercent: l.discountPercent.toString(),
      })),
    })),
  };
}

export async function loadVersionContent(
  tx: Tx,
  versionId: string,
): Promise<{ version: VersionRow; content: VersionContent } | null> {
  const version = await findVersion(tx, versionId);
  return version ? { version, content: toVersionContent(version) } : null;
}

export interface VersionContentWrite {
  sections: {
    key: string;
    title: string;
    description?: string | null;
    optional: boolean;
    selected: boolean;
    lines: {
      key: string;
      kind: string;
      itemId?: string | null;
      code?: string | null;
      description: string;
      unit: string;
      quantity: string;
      unitPrice: bigint;
      unitCost: bigint;
      laborHours: string;
      vatRegime: string;
      vatSuggested: string;
      vatJustification?: string | null;
      discountPercent: string;
    }[];
  }[];
}

/** Remplace postes et lignes d'une version (les clés sont conservées). */
export async function replaceVersionContent(
  tx: Tx,
  tenantId: string,
  versionId: string,
  content: VersionContentWrite,
): Promise<void> {
  await tx.quoteLine.deleteMany({ where: { versionId } });
  await tx.quoteSection.deleteMany({ where: { versionId } });
  for (const [position, s] of content.sections.entries()) {
    const section = await tx.quoteSection.create({
      data: {
        tenantId,
        versionId,
        key: s.key,
        position,
        title: s.title,
        description: s.description ?? null,
        optional: s.optional,
        selected: s.optional ? s.selected : false,
      },
    });
    if (s.lines.length)
      await tx.quoteLine.createMany({
        data: s.lines.map((l, i) => ({
          tenantId,
          versionId,
          sectionId: section.id,
          key: l.key,
          position: i,
          kind: l.kind,
          itemId: l.itemId ?? null,
          code: l.code ?? null,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          unitCost: l.unitCost,
          laborHours: l.laborHours,
          vatRegime: l.vatRegime,
          vatSuggested: l.vatSuggested,
          vatJustification: l.vatJustification ?? null,
          discountPercent: l.discountPercent,
        })),
      });
  }
}

/** Copie le contenu d'une version vers une autre (nouvelle version, duplication, modèle). */
export async function copyVersionContent(
  tx: Tx,
  tenantId: string,
  fromVersionId: string,
  toVersionId: string,
  options: { freshKeys?: () => string } = {},
): Promise<void> {
  const loaded = await loadVersionContent(tx, fromVersionId);
  if (!loaded) return;
  const k = (key: string) => (options.freshKeys ? options.freshKeys() : key);
  await replaceVersionContent(tx, tenantId, toVersionId, {
    sections: loaded.content.sections.map((s) => ({
      key: k(s.id),
      title: s.title,
      description: s.description,
      optional: s.optional,
      selected: s.selected,
      lines: s.lines.map((l) => ({
        key: k(l.id),
        kind: l.kind,
        itemId: l.itemId,
        code: l.code,
        description: l.description,
        unit: l.unit,
        quantity: String(l.quantity),
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        laborHours: String(l.laborHours),
        vatRegime: l.vatRegime,
        vatSuggested: l.vatSuggested,
        vatJustification: l.vatJustification,
        discountPercent: String(l.discountPercent ?? '0'),
      })),
    })),
  });
}
