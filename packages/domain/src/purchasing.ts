/**
 * Achats (03 §8, 02 P6) : regroupement des matériaux par fournisseur, rapprochement d'une facture
 * fournisseur (bon de commande → référence de chantier → adresse), ventilation sur les postes,
 * écarts entre BC et facture, engagement restant d'un BC. Pur.
 */
import { allocateProRata, type Cents, dec, roundHalfAwayFromZero, sumCents } from './money';

// ---------------------------------------------------------------------------
// Bons de commande depuis les matériaux du devis
// ---------------------------------------------------------------------------

export interface MaterialLine {
  key: string;
  description: string;
  unit: string;
  quantity: string;
  unitCost: Cents;
  budgetLineId: string | null;
  supplierId: string | null;
  supplierCode?: string | null;
}

/** Regroupe les lignes de matériaux par fournisseur (null = fournisseur à choisir). */
export function groupBySupplier(
  lines: readonly MaterialLine[],
): { supplierId: string | null; lines: MaterialLine[]; total: Cents }[] {
  const groups = new Map<string | null, MaterialLine[]>();
  for (const l of lines) {
    if (dec(l.quantity).lessThanOrEqualTo(0)) continue;
    groups.set(l.supplierId, [...(groups.get(l.supplierId) ?? []), l]);
  }
  return [...groups.entries()]
    .map(([supplierId, ls]) => ({
      supplierId,
      lines: ls,
      total: sumCents(ls.map((l) => lineTotal(l.quantity, l.unitCost))),
    }))
    .sort((a, b) => (a.supplierId === null ? 1 : b.supplierId === null ? -1 : 0));
}

/** Quantité × prix unitaire, arrondi au centime. */
export function lineTotal(quantity: string, unitPrice: Cents): Cents {
  return roundHalfAwayFromZero(dec(quantity).times(dec(unitPrice)));
}

/** Ce qu'un BC engage encore : son total moins ce qui a déjà été facturé dessus (jamais négatif). */
export function remainingCommitment(orderTotal: Cents, invoiced: Cents): Cents {
  return orderTotal > invoiced ? orderTotal - invoiced : 0n;
}

// ---------------------------------------------------------------------------
// Rapprochement d'une facture fournisseur (P6.1)
// ---------------------------------------------------------------------------

/** « BC-2026/017 » et « bc2026017 » se valent. */
export function normalizeRef(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Une référence courte comme « 17 » ne doit pas coïncider partout : 5 caractères au moins. */
function contains(haystack: string, needle: string): boolean {
  const n = normalizeRef(needle);
  return n.length >= 5 && normalizeRef(haystack).includes(n);
}

export interface InvoiceForMatching {
  supplierId: string | null;
  /** Référence d'achat (BuyerReference / OrderReference UBL, ou champ extrait). */
  orderReference: string | null;
  /** Autres textes où chercher : notes, références, libellés des lignes. */
  texts: readonly string[];
  deliveryAddress: string | null;
}

export interface OrderCandidate {
  id: string;
  number: string;
  supplierId: string;
  projectId: string;
}

export interface ProjectCandidate {
  id: string;
  number: string;
  street: string | null;
  postalCode: string | null;
}

export type MatchMethod = 'purchase_order' | 'project_reference' | 'address';

export interface InvoiceMatch {
  method: MatchMethod;
  projectId: string;
  purchaseOrderId: string | null;
  confidence: number;
}

/**
 * Rapprochement déterministe, dans l'ordre de 02 P6 : numéro de BC, puis référence de chantier,
 * puis adresse de livraison. Renvoie null si rien n'est sûr (→ suggestions IA, boîte « À imputer »).
 */
export function matchSupplierInvoice(input: {
  invoice: InvoiceForMatching;
  orders: readonly OrderCandidate[];
  projects: readonly ProjectCandidate[];
}): InvoiceMatch | null {
  const { invoice } = input;
  const all = [invoice.orderReference ?? '', ...invoice.texts].filter(Boolean);
  // 1. Numéro de BC (le même fournisseur de préférence).
  const byOrder = input.orders
    .filter((o) => all.some((t) => contains(t, o.number)))
    .sort(
      (a, b) => Number(b.supplierId === invoice.supplierId) - Number(a.supplierId === invoice.supplierId),
    );
  if (byOrder[0])
    return {
      method: 'purchase_order',
      projectId: byOrder[0].projectId,
      purchaseOrderId: byOrder[0].id,
      confidence: byOrder[0].supplierId === invoice.supplierId || !invoice.supplierId ? 0.99 : 0.9,
    };
  // 2. Référence du chantier (numéro).
  const byProject = input.projects.filter((p) => all.some((t) => contains(t, p.number)));
  if (byProject.length === 1)
    return {
      method: 'project_reference',
      projectId: byProject[0]!.id,
      purchaseOrderId: null,
      confidence: 0.95,
    };
  // 3. Adresse de livraison : rue et code postal.
  const address = normalizeText([invoice.deliveryAddress ?? '', ...invoice.texts].join(' '));
  const byAddress = input.projects.filter((p) => {
    if (!p.street || !p.postalCode) return false;
    const street = normalizeText(p.street);
    return street.length >= 6 && address.includes(street) && address.includes(p.postalCode);
  });
  if (byAddress.length === 1)
    return { method: 'address', projectId: byAddress[0]!.id, purchaseOrderId: null, confidence: 0.85 };
  return null;
}

// ---------------------------------------------------------------------------
// Ventilation et écarts
// ---------------------------------------------------------------------------

export interface OrderLineRef {
  id: string;
  description: string;
  supplierCode: string | null;
  quantity: string;
  unitPrice: Cents;
  budgetLineId: string | null;
}

export interface InvoiceLineRef {
  description: string;
  supplierCode: string | null;
  quantity: string;
  unitPrice: Cents;
  net: Cents;
}

/** Similarité de deux libellés (part de mots communs). */
function similarity(a: string, b: string): number {
  const wa = new Set(
    normalizeText(a)
      .split(' ')
      .filter((w) => w.length > 1),
  );
  const wb = new Set(
    normalizeText(b)
      .split(' ')
      .filter((w) => w.length > 1),
  );
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size);
}

/** Ligne de BC correspondant à une ligne de facture : code fournisseur, sinon libellé proche. */
export function pairLine(line: InvoiceLineRef, orderLines: readonly OrderLineRef[]): OrderLineRef | null {
  if (line.supplierCode) {
    const code = normalizeRef(line.supplierCode);
    const byCode = orderLines.find((o) => o.supplierCode && normalizeRef(o.supplierCode) === code);
    if (byCode) return byCode;
  }
  let best: OrderLineRef | null = null;
  let score = 0;
  for (const o of orderLines) {
    const s = similarity(line.description, o.description);
    if (s > score) {
      score = s;
      best = o;
    }
  }
  return score >= 0.6 ? best : null;
}

/**
 * Ventilation du montant HTVA d'une facture sur les postes : chaque ligne suit la ligne de BC
 * correspondante ; le reste (lignes sans correspondance, frais) au prorata des postes du BC.
 * Sans BC : un seul poste (ou « non ventilé »). La somme est toujours exactement le total.
 */
export function allocateInvoice(input: {
  totalNet: Cents;
  lines: readonly InvoiceLineRef[];
  orderLines: readonly OrderLineRef[];
  fallbackBudgetLineId?: string | null;
}): { budgetLineId: string | null; amount: Cents }[] {
  const byPost = new Map<string | null, Cents>();
  const add = (k: string | null, v: Cents) => byPost.set(k, (byPost.get(k) ?? 0n) + v);
  let matched = 0n;
  for (const l of input.lines) {
    const o = pairLine(l, input.orderLines);
    if (o) {
      add(o.budgetLineId, l.net);
      matched += l.net;
    }
  }
  const rest = input.totalNet - matched;
  if (rest !== 0n) {
    const weights = new Map<string | null, Cents>();
    for (const o of input.orderLines)
      weights.set(o.budgetLineId, (weights.get(o.budgetLineId) ?? 0n) + lineTotal(o.quantity, o.unitPrice));
    const keys = [...weights.keys()].filter((k) => (weights.get(k) ?? 0n) > 0n);
    if (keys.length) {
      const shares = allocateProRata(
        rest,
        keys.map((k) => weights.get(k)!),
      );
      keys.forEach((k, i) => add(k, shares[i]!));
    } else add(input.fallbackBudgetLineId ?? null, rest);
  }
  return [...byPost.entries()]
    .filter(([, v]) => v !== 0n)
    .map(([budgetLineId, amount]) => ({ budgetLineId, amount }));
}

export type Discrepancy =
  | { kind: 'price'; description: string; ordered: Cents; invoiced: Cents; percent: number }
  | { kind: 'quantity'; description: string; ordered: string; invoiced: string }
  | { kind: 'unordered'; description: string; amount: Cents }
  | { kind: 'total'; ordered: Cents; invoiced: Cents; percent: number };

/**
 * Écarts entre BC et facture (03 §8) : prix unitaire au-delà de la tolérance, quantité facturée
 * supérieure à la commande, ligne non commandée, total au-delà de la tolérance.
 */
export function compareWithOrder(input: {
  lines: readonly InvoiceLineRef[];
  orderLines: readonly OrderLineRef[];
  invoiceNet: Cents;
  tolerancePercent?: number;
}): Discrepancy[] {
  const tol = input.tolerancePercent ?? 2;
  const out: Discrepancy[] = [];
  const pct = (a: Cents, b: Cents) =>
    b === 0n
      ? 0
      : dec(a - b)
          .dividedBy(dec(b))
          .times(100)
          .toDecimalPlaces(1)
          .toNumber();
  const billed = new Map<string, ReturnType<typeof dec>>();
  for (const l of input.lines) {
    const o = pairLine(l, input.orderLines);
    if (!o) {
      if (l.net > 0n) out.push({ kind: 'unordered', description: l.description, amount: l.net });
      continue;
    }
    const p = pct(l.unitPrice, o.unitPrice);
    if (Math.abs(p) > tol)
      out.push({
        kind: 'price',
        description: o.description,
        ordered: o.unitPrice,
        invoiced: l.unitPrice,
        percent: p,
      });
    billed.set(o.id, (billed.get(o.id) ?? dec(0)).plus(dec(l.quantity)));
  }
  for (const o of input.orderLines) {
    const q = billed.get(o.id);
    if (q && q.greaterThan(dec(o.quantity)))
      out.push({ kind: 'quantity', description: o.description, ordered: o.quantity, invoiced: q.toString() });
  }
  const ordered = sumCents(input.orderLines.map((o) => lineTotal(o.quantity, o.unitPrice)));
  const t = pct(input.invoiceNet, ordered);
  if (ordered > 0n && Math.abs(t) > tol)
    out.push({ kind: 'total', ordered, invoiced: input.invoiceNet, percent: t });
  return out;
}
