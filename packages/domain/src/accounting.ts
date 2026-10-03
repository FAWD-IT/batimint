/**
 * Écritures comptables (03 §13, 07 « Chift ») : ventes, notes de crédit, achats et paiements
 * traduits en écritures équilibrées, avec le plan comptable minimum normalisé belge (PCMN) et les
 * codes TVA belges (grilles de la déclaration). Les comptes, journaux et codes sont paramétrables
 * par tenant ; les valeurs par défaut sont **[à valider]** par le comptable.
 */
import type { IsoDate } from './calendar';
import { type Cents, dec, sumCents } from './money';
import type { VatRegime } from './vat';

export class AccountingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AccountingError';
  }
}

export type PurchaseVatKey = '21' | '12' | '6' | '0' | 'reverse_charge' | 'intra_community';

export interface AccountingMapping {
  accounts: {
    /** 400000 Clients. */
    customers: string;
    /** 440000 Fournisseurs. */
    suppliers: string;
    /** 700000 Chiffre d'affaires (travaux). */
    sales: string;
    /** 604000 Achats de matériaux. */
    purchasesMaterials: string;
    /** 611000 Sous-traitance. */
    purchasesSubcontracting: string;
    /** 451000 TVA à payer. */
    vatDue: string;
    /** 411000 TVA à récupérer. */
    vatDeductible: string;
    /** 550000 Banque. */
    bank: string;
    /** 454000 Retenues 30bis à verser (ONSS / SPF Finances). */
    withholding: string;
  };
  journals: { sales: string; creditNotes: string; purchases: string; bank: string };
  /** Codes TVA du logiciel comptable, par régime de vente. */
  salesVatCodes: Record<VatRegime, string>;
  /** Codes TVA du logiciel comptable, par taux d'achat. */
  purchaseVatCodes: Record<PurchaseVatKey, string>;
}

export const DEFAULT_ACCOUNTING_MAPPING: AccountingMapping = {
  accounts: {
    customers: '400000',
    suppliers: '440000',
    sales: '700000',
    purchasesMaterials: '604000',
    purchasesSubcontracting: '611000',
    vatDue: '451000',
    vatDeductible: '411000',
    bank: '550000',
    withholding: '454000',
  },
  journals: { sales: 'VEN', creditNotes: 'NCV', purchases: 'ACH', bank: 'BQ1' },
  salesVatCodes: {
    standard_21: 'V21',
    intermediate_12: 'V12',
    reduced_6: 'V06',
    zero: 'V00',
    reverse_charge: 'VCC',
    exempt: 'VEX',
    intra_community: 'VIC',
    export: 'VXP',
  },
  purchaseVatCodes: {
    '21': 'A21',
    '12': 'A12',
    '6': 'A06',
    '0': 'A00',
    reverse_charge: 'ACC',
    intra_community: 'AIC',
  },
};

/** Grilles de la déclaration TVA belge correspondant à chaque régime de vente (base ; TVA en 54). */
export const SALES_VAT_GRIDS: Record<VatRegime, { base: string; tax: string | null }> = {
  standard_21: { base: '03', tax: '54' },
  intermediate_12: { base: '02', tax: '54' },
  reduced_6: { base: '01', tax: '54' },
  zero: { base: '00', tax: null },
  reverse_charge: { base: '45', tax: null },
  exempt: { base: '00', tax: null },
  intra_community: { base: '46', tax: null },
  export: { base: '47', tax: null },
};

/** Grilles d'achat : services et biens divers (82) ; autoliquidation 87 + TVA due 56 et déductible 59. */
export const PURCHASE_VAT_GRIDS: Record<PurchaseVatKey, { base: string; tax: string | null }> = {
  '21': { base: '82', tax: '59' },
  '12': { base: '82', tax: '59' },
  '6': { base: '82', tax: '59' },
  '0': { base: '82', tax: null },
  reverse_charge: { base: '87', tax: '56/59' },
  intra_community: { base: '86', tax: '55/59' },
};

/** Fusionne un paramétrage partiel du tenant avec les valeurs par défaut. */
export function resolveAccountingMapping(partial: unknown): AccountingMapping {
  const p = (partial && typeof partial === 'object' ? partial : {}) as Partial<{
    [K in keyof AccountingMapping]: Partial<AccountingMapping[K]>;
  }>;
  return {
    accounts: { ...DEFAULT_ACCOUNTING_MAPPING.accounts, ...(p.accounts ?? {}) },
    journals: { ...DEFAULT_ACCOUNTING_MAPPING.journals, ...(p.journals ?? {}) },
    salesVatCodes: { ...DEFAULT_ACCOUNTING_MAPPING.salesVatCodes, ...(p.salesVatCodes ?? {}) },
    purchaseVatCodes: { ...DEFAULT_ACCOUNTING_MAPPING.purchaseVatCodes, ...(p.purchaseVatCodes ?? {}) },
  };
}

export interface EntryPartner {
  name: string;
  vatNumber: string | null;
  enterpriseNumber: string | null;
}

export interface EntryLine {
  account: string;
  label: string;
  /** Montant au débit (positif) ou au crédit (négatif), en centimes. */
  amount: Cents;
  vatCode: string | null;
  vatGrid: string | null;
}

export type EntryKind = 'sale' | 'credit_note' | 'purchase' | 'payment_received' | 'payment_sent';

export interface AccountingEntry {
  kind: EntryKind;
  journal: string;
  /** Numéro de pièce. */
  number: string;
  date: IsoDate;
  dueDate: IsoDate | null;
  partner: EntryPartner;
  /** Référence de paiement (communication structurée) ou document lettré. */
  reference: string | null;
  totalNet: Cents;
  totalVat: Cents;
  totalGross: Cents;
  lines: EntryLine[];
}

/** Une écriture est équilibrée : débits = crédits. */
export function assertBalanced(entry: AccountingEntry): void {
  const sum = sumCents(entry.lines.map((l) => l.amount));
  if (sum !== 0n)
    throw new AccountingError(
      'unbalanced',
      `L’écriture ${entry.number} n’est pas équilibrée (écart de ${sum} centimes).`,
    );
}

export interface SaleDocument {
  type: 'invoice' | 'credit_note';
  number: string;
  issueDate: IsoDate;
  dueDate: IsoDate | null;
  partner: EntryPartner;
  structuredCommunication: string | null;
  vatBreakdown: readonly {
    regimes: readonly VatRegime[];
    ratePercent: string;
    taxableAmount: Cents;
    taxAmount: Cents;
  }[];
  totalNet: Cents;
  totalVat: Cents;
  totalGross: Cents;
}

/**
 * Vente : client au débit (TVAC), chiffre d'affaires au crédit par code TVA, TVA due au crédit.
 * Une note de crédit inverse les sens. La retenue de garantie ne change pas l'écriture : elle
 * reste due par le client.
 */
export function saleEntry(doc: SaleDocument, mapping: AccountingMapping): AccountingEntry {
  const sign = doc.type === 'credit_note' ? -1n : 1n;
  const a = mapping.accounts;
  if (sumCents(doc.vatBreakdown.map((v) => v.taxableAmount)) !== doc.totalNet)
    throw new AccountingError(
      'breakdown_mismatch',
      `La ventilation TVA de ${doc.number} ne correspond pas au total HTVA.`,
    );
  const lines: EntryLine[] = [
    {
      account: a.customers,
      label: doc.partner.name,
      amount: sign * doc.totalGross,
      vatCode: null,
      vatGrid: null,
    },
  ];
  for (const v of doc.vatBreakdown) {
    const regime = v.regimes[0] ?? 'standard_21';
    const grid = SALES_VAT_GRIDS[regime];
    lines.push({
      account: a.sales,
      label: `Travaux ${v.ratePercent} %`,
      amount: -sign * v.taxableAmount,
      vatCode: mapping.salesVatCodes[regime],
      vatGrid: grid.base,
    });
    if (v.taxAmount !== 0n)
      lines.push({
        account: a.vatDue,
        label: `TVA ${v.ratePercent} %`,
        amount: -sign * v.taxAmount,
        vatCode: mapping.salesVatCodes[regime],
        vatGrid: grid.tax,
      });
  }
  const entry: AccountingEntry = {
    kind: doc.type === 'credit_note' ? 'credit_note' : 'sale',
    journal: doc.type === 'credit_note' ? mapping.journals.creditNotes : mapping.journals.sales,
    number: doc.number,
    date: doc.issueDate,
    dueDate: doc.dueDate,
    partner: doc.partner,
    reference: doc.structuredCommunication,
    totalNet: doc.totalNet,
    totalVat: doc.totalVat,
    totalGross: doc.totalGross,
    lines,
  };
  assertBalanced(entry);
  return entry;
}

export interface PurchaseDocument {
  number: string;
  issueDate: IsoDate;
  dueDate: IsoDate | null;
  partner: EntryPartner;
  subcontracting: boolean;
  /** Lignes (net et taux) ; vides ou incohérentes, une seule ligne au taux déduit des totaux. */
  lines: readonly { net: Cents; vatRate: string | null }[];
  totalNet: Cents;
  totalVat: Cents;
  totalGross: Cents;
}

function purchaseVatKey(rate: string | null, reverse: boolean): PurchaseVatKey {
  if (reverse) return 'reverse_charge';
  const r = dec(rate ?? '0');
  if (r.eq(21)) return '21';
  if (r.eq(12)) return '12';
  if (r.eq(6)) return '6';
  return '0';
}

/**
 * Achat : charge au débit par taux (matériaux ou sous-traitance), TVA à récupérer au débit,
 * fournisseur au crédit (TVAC). Un sous-traitant belge sans TVA facturée est en autoliquidation :
 * la TVA est due et déductible (grilles 87, 56 et 59), sans effet sur le solde.
 */
export function purchaseEntry(doc: PurchaseDocument, mapping: AccountingMapping): AccountingEntry {
  const a = mapping.accounts;
  const reverse = doc.subcontracting && doc.totalVat === 0n && doc.totalNet > 0n;
  const account = doc.subcontracting ? a.purchasesSubcontracting : a.purchasesMaterials;
  const linesOk = doc.lines.length > 0 && sumCents(doc.lines.map((l) => l.net)) === doc.totalNet;
  const groups = new Map<PurchaseVatKey, Cents>();
  if (linesOk) {
    for (const l of doc.lines) {
      const k = purchaseVatKey(l.vatRate, reverse);
      groups.set(k, (groups.get(k) ?? 0n) + l.net);
    }
  } else {
    const rate = doc.totalNet
      ? dec(doc.totalVat.toString()).times(100).dividedBy(doc.totalNet.toString()).toDecimalPlaces(0)
      : dec(0);
    groups.set(purchaseVatKey(rate.toString(), reverse), doc.totalNet);
  }
  const lines: EntryLine[] = [];
  for (const [k, net] of groups)
    lines.push({
      account,
      label: doc.subcontracting ? 'Sous-traitance' : 'Achats',
      amount: net,
      vatCode: mapping.purchaseVatCodes[k],
      vatGrid: PURCHASE_VAT_GRIDS[k].base,
    });
  if (doc.totalVat !== 0n)
    lines.push({
      account: a.vatDeductible,
      label: 'TVA déductible',
      amount: doc.totalVat,
      vatCode: null,
      vatGrid: '59',
    });
  lines.push({
    account: a.suppliers,
    label: doc.partner.name,
    amount: -doc.totalGross,
    vatCode: null,
    vatGrid: null,
  });
  const entry: AccountingEntry = {
    kind: 'purchase',
    journal: mapping.journals.purchases,
    number: doc.number,
    date: doc.issueDate,
    dueDate: doc.dueDate,
    partner: doc.partner,
    reference: null,
    totalNet: doc.totalNet,
    totalVat: doc.totalVat,
    totalGross: doc.totalGross,
    lines,
  };
  assertBalanced(entry);
  return entry;
}

export interface PaymentDocument {
  direction: 'received' | 'sent';
  /** Identifiant de pièce du paiement (unique). */
  number: string;
  date: IsoDate;
  amount: Cents;
  partner: EntryPartner;
  /** Document lettré (numéro de facture). */
  documentNumber: string;
  /** Retenue 30bis versée aux administrations (paiement fournisseur). */
  withholding?: Cents;
}

/**
 * Paiement : banque contre client (reçu) ou fournisseur contre banque (envoyé). Une retenue 30bis
 * solde le fournisseur sans passer par sa banque : elle va au compte de retenues à verser.
 */
export function paymentEntry(doc: PaymentDocument, mapping: AccountingMapping): AccountingEntry {
  if (doc.amount <= 0n) throw new AccountingError('invalid_amount', 'Un paiement est un montant positif.');
  const a = mapping.accounts;
  const withholding = doc.withholding ?? 0n;
  const lines: EntryLine[] =
    doc.direction === 'received'
      ? [
          {
            account: a.bank,
            label: `Paiement ${doc.documentNumber}`,
            amount: doc.amount,
            vatCode: null,
            vatGrid: null,
          },
          {
            account: a.customers,
            label: doc.partner.name,
            amount: -doc.amount,
            vatCode: null,
            vatGrid: null,
          },
        ]
      : [
          {
            account: a.suppliers,
            label: doc.partner.name,
            amount: doc.amount + withholding,
            vatCode: null,
            vatGrid: null,
          },
          {
            account: a.bank,
            label: `Paiement ${doc.documentNumber}`,
            amount: -doc.amount,
            vatCode: null,
            vatGrid: null,
          },
          ...(withholding
            ? [
                {
                  account: a.withholding,
                  label: 'Retenue 30bis',
                  amount: -withholding,
                  vatCode: null,
                  vatGrid: null,
                },
              ]
            : []),
        ];
  const entry: AccountingEntry = {
    kind: doc.direction === 'received' ? 'payment_received' : 'payment_sent',
    journal: mapping.journals.bank,
    number: doc.number,
    date: doc.date,
    dueDate: null,
    partner: doc.partner,
    reference: doc.documentNumber,
    totalNet: doc.amount + withholding,
    totalVat: 0n,
    totalGross: doc.amount + withholding,
    lines,
  };
  assertBalanced(entry);
  return entry;
}

export type AccountingSyncStatus = 'waiting' | 'pending' | 'synced' | 'error';

/** Reprise : une erreur est rejouée à la main ; une attente part dès la connexion active. */
export function canRetrySync(status: AccountingSyncStatus): boolean {
  return status === 'error' || status === 'waiting';
}
