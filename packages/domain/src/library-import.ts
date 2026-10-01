/**
 * Import de bibliothèque (02 P1.4, 03 §3) : mapping assisté des colonnes, aperçu, rapport d'erreurs,
 * mise à jour par code article. Pur : le parsing CSV/Excel et l'écriture en base sont ailleurs.
 */
import { normalizeUnit, type ItemKind, type Unit } from './library';
import { type Cents, eurosToCents, MoneyError } from './money';

export const IMPORT_FIELDS = [
  'code',
  'name',
  'description',
  'unit',
  'purchasePrice',
  'salePrice',
  'kind',
  'trade',
  'category',
  'laborHours',
  'vatRate',
  'supplierCode',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_IMPORT_FIELDS: readonly ImportField[] = ['code', 'name', 'unit', 'purchasePrice'];

const SYNONYMS: Record<ImportField, string[]> = {
  code: ['code', 'reference', 'ref', 'référence', 'code article', 'article', 'sku', 'artikelcode', 'id'],
  name: [
    'designation',
    'désignation',
    'libelle',
    'libellé',
    'nom',
    'name',
    'intitule',
    'intitulé',
    'omschrijving',
    'description courte',
  ],
  description: ['description', 'description longue', 'detail', 'détail', 'commentaire', 'remarque'],
  unit: ['unite', 'unité', 'unit', 'u', 'eenheid', 'um'],
  purchasePrice: [
    'prix achat',
    "prix d'achat",
    'pa',
    'achat',
    'cout',
    'coût',
    'prix de revient',
    'prix net',
    'purchase price',
    'inkoopprijs',
    'prix',
  ],
  salePrice: ['prix vente', 'prix de vente', 'pv', 'vente', 'sale price', 'verkoopprijs', 'prix public'],
  kind: ['type', 'nature', 'categorie article', 'kind'],
  trade: ['metier', 'métier', 'corps de metier', 'corps de métier', 'lot', 'trade'],
  category: ['categorie', 'catégorie', 'famille', 'groupe', 'category', 'rubrique'],
  laborHours: ['temps de pose', 'temps', 'heures', 'mo', "main d'oeuvre", 'main-d’œuvre', 'duree', 'durée'],
  vatRate: ['tva', 'taux tva', 'vat', 'btw'],
  supplierCode: ['code fournisseur', 'ref fournisseur', 'référence fournisseur', 'supplier code'],
};

function normHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Propose un mapping colonne → champ à partir des en-têtes (une colonne au plus par champ). */
export function suggestMapping(headers: readonly string[]): Partial<Record<ImportField, number>> {
  const normalized = headers.map(normHeader);
  const result: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  // Correspondances exactes d'abord, puis inclusions.
  for (const pass of ['exact', 'contains'] as const) {
    for (const field of IMPORT_FIELDS) {
      if (result[field] !== undefined) continue;
      const syns = SYNONYMS[field].map(normHeader);
      const idx = normalized.findIndex(
        (h, i) =>
          !used.has(i) &&
          h.length > 0 &&
          (pass === 'exact' ? syns.includes(h) : syns.some((s) => s.length > 2 && h.includes(s))),
      );
      if (idx >= 0) {
        result[field] = idx;
        used.add(idx);
      }
    }
  }
  return result;
}

export interface ImportRowError {
  row: number;
  field: ImportField | null;
  message: string;
}

export interface NormalizedImportRow {
  row: number;
  code: string;
  name: string;
  description: string | null;
  unit: Unit;
  purchasePrice: Cents;
  salePrice: Cents | null;
  kind: Exclude<ItemKind, 'assembly'>;
  trade: string | null;
  category: string | null;
  laborHours: string;
  vatRate: string;
  supplierCode: string | null;
}

const KIND_ALIASES: Record<string, Exclude<ItemKind, 'assembly'>> = {
  materiau: 'material',
  matériau: 'material',
  materiaux: 'material',
  matériaux: 'material',
  material: 'material',
  fourniture: 'material',
  mat: 'material',
  'main d oeuvre': 'labour',
  "main d'oeuvre": 'labour',
  'main-d’œuvre': 'labour',
  mo: 'labour',
  labour: 'labour',
  labor: 'labour',
  'sous traitance': 'subcontracting',
  'sous-traitance': 'subcontracting',
  st: 'subcontracting',
  subcontracting: 'subcontracting',
  materiel: 'equipment',
  matériel: 'equipment',
  location: 'equipment',
  equipment: 'equipment',
  forfait: 'lump_sum',
  lump_sum: 'lump_sum',
};

function parseMoney(raw: string): Cents {
  const cleaned = raw.replace(/[€\s\u00a0\u202f]/g, '').replace(/EUR/i, '');
  // « 1.234,56 » ou « 1,234.56 » ou « 12,5 »
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) normalized = cleaned.replace(/,/g, '');
  else normalized = cleaned.replace(',', '.');
  return eurosToCents(normalized);
}

function parseDecimal(raw: string): string {
  const s = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new MoneyError('nombre');
  return s;
}

const VAT_ALIASES: Record<string, string> = {
  '21': 'standard_21',
  '12': 'intermediate_12',
  '6': 'reduced_6',
  '0': 'zero',
  auto: 'auto',
  '': 'auto',
};

/** Valide et normalise une ligne du fichier. `row` = numéro de ligne affiché à l'utilisateur. */
export function normalizeImportRow(
  cells: readonly (string | null | undefined)[],
  mapping: Partial<Record<ImportField, number>>,
  row: number,
): { ok: true; value: NormalizedImportRow } | { ok: false; errors: ImportRowError[] } {
  const get = (f: ImportField) => {
    const idx = mapping[f];
    if (idx === undefined) return '';
    return String(cells[idx] ?? '').trim();
  };
  const errors: ImportRowError[] = [];
  const code = get('code');
  const name = get('name');
  if (!code) errors.push({ row, field: 'code', message: 'Code article manquant' });
  else if (code.length > 60)
    errors.push({ row, field: 'code', message: 'Code article trop long (60 caractères max.)' });
  if (!name) errors.push({ row, field: 'name', message: 'Désignation manquante' });
  const unitRaw = get('unit');
  const unit = normalizeUnit(unitRaw || 'u');
  if (!unit)
    errors.push({ row, field: 'unit', message: `Unité inconnue « ${unitRaw} » (ex. u, m, m², h, forfait)` });
  let purchasePrice: Cents = 0n;
  try {
    purchasePrice = parseMoney(get('purchasePrice') || '0');
    if (purchasePrice < 0n) errors.push({ row, field: 'purchasePrice', message: "Prix d'achat négatif" });
  } catch {
    errors.push({
      row,
      field: 'purchasePrice',
      message: `Prix d'achat illisible « ${get('purchasePrice')} »`,
    });
  }
  let salePrice: Cents | null = null;
  if (get('salePrice')) {
    try {
      salePrice = parseMoney(get('salePrice'));
    } catch {
      errors.push({ row, field: 'salePrice', message: `Prix de vente illisible « ${get('salePrice')} »` });
    }
  }
  const kindRaw = get('kind').toLowerCase();
  const kind = kindRaw ? KIND_ALIASES[kindRaw] : unit === 'h' ? 'labour' : 'material';
  if (!kind)
    errors.push({
      row,
      field: 'kind',
      message: `Type inconnu « ${get('kind')} » (matériau, main-d'œuvre, sous-traitance, matériel, forfait)`,
    });
  let laborHours = '0';
  if (get('laborHours')) {
    try {
      laborHours = parseDecimal(get('laborHours'));
    } catch {
      errors.push({ row, field: 'laborHours', message: `Temps de pose illisible « ${get('laborHours')} »` });
    }
  }
  const vatKey = get('vatRate').replace('%', '').replace(',', '.').trim().toLowerCase();
  const vatRate = VAT_ALIASES[vatKey];
  if (vatRate === undefined)
    errors.push({
      row,
      field: 'vatRate',
      message: `Taux de TVA non pris en charge « ${get('vatRate')} » (21, 12, 6 ou 0)`,
    });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      row,
      code,
      name: name.slice(0, 300),
      description: get('description') || null,
      unit: unit!,
      purchasePrice,
      salePrice,
      kind: kind!,
      trade: get('trade') || null,
      category: get('category') || null,
      laborHours,
      vatRate: vatRate!,
      supplierCode: get('supplierCode') || null,
    },
  };
}

export interface ImportPlan {
  toCreate: NormalizedImportRow[];
  toUpdate: NormalizedImportRow[];
  unchanged: NormalizedImportRow[];
  errors: ImportRowError[];
  duplicates: ImportRowError[];
}

/**
 * Prépare l'import : valide toutes les lignes, détecte les doublons de code dans le fichier,
 * et répartit entre créations, mises à jour (par code) et lignes inchangées.
 */
export function planImport(
  rows: readonly (readonly (string | null | undefined)[])[],
  mapping: Partial<Record<ImportField, number>>,
  existing: ReadonlyMap<
    string,
    { purchasePrice: Cents; salePrice: Cents | null; name: string; unit: string }
  >,
  options: { firstDataRow?: number } = {},
): ImportPlan {
  const missing = REQUIRED_IMPORT_FIELDS.filter((f) => mapping[f] === undefined && f !== 'unit');
  if (missing.length) {
    return {
      toCreate: [],
      toUpdate: [],
      unchanged: [],
      errors: missing.map((f) => ({ row: 0, field: f, message: `Colonne obligatoire non associée : ${f}` })),
      duplicates: [],
    };
  }
  const first = options.firstDataRow ?? 2;
  const plan: ImportPlan = { toCreate: [], toUpdate: [], unchanged: [], errors: [], duplicates: [] };
  const seen = new Map<string, number>();
  rows.forEach((cells, i) => {
    const rowNumber = i + first;
    if (cells.every((c) => !String(c ?? '').trim())) return;
    const r = normalizeImportRow(cells, mapping, rowNumber);
    if (!r.ok) {
      plan.errors.push(...r.errors);
      return;
    }
    const key = r.value.code.toLowerCase();
    if (seen.has(key)) {
      plan.duplicates.push({
        row: rowNumber,
        field: 'code',
        message: `Code « ${r.value.code} » déjà présent ligne ${seen.get(key)} : ligne ignorée`,
      });
      return;
    }
    seen.set(key, rowNumber);
    const current = existing.get(r.value.code);
    if (!current) plan.toCreate.push(r.value);
    else if (
      current.purchasePrice !== r.value.purchasePrice ||
      (r.value.salePrice !== null && current.salePrice !== r.value.salePrice) ||
      current.name !== r.value.name ||
      current.unit !== r.value.unit
    ) {
      plan.toUpdate.push(r.value);
    } else plan.unchanged.push(r.value);
  });
  return plan;
}
