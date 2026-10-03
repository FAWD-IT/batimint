/**
 * Comptabilité (07 « Chift ») : une API unifiée vers le logiciel du comptable (WinBooks, Octopus,
 * Yuki…). Les écritures sont construites dans le domaine (`saleEntry`, `purchaseEntry`,
 * `paymentEntry`) ; l'adaptateur les pousse et renvoie l'identifiant de la pièce.
 */
import type { AccountingEntry } from '@batimint/domain';

export interface AccountingConnection {
  connectionId: string;
  status: 'pending' | 'active';
  /** Logiciel du comptable vu au travers de Chift. */
  software: string;
  /** Flux d'autorisation Chift (production) ; absent en simulation. */
  authorizationUrl: string | null;
}

export interface LedgerAccount {
  number: string;
  label: string;
}

export interface LedgerJournal {
  code: string;
  label: string;
  type: 'sale' | 'purchase' | 'financial' | 'misc';
}

export interface LedgerVatCode {
  code: string;
  label: string;
  ratePercent: string;
  scope: 'sale' | 'purchase';
}

export interface PushResult {
  externalId: string;
}

export interface AccountingSync {
  readonly provider: string;
  connect(input: {
    tenantId: string;
    name: string;
    enterpriseNumber: string | null;
  }): Promise<AccountingConnection>;
  listChartOfAccounts(connectionId: string): Promise<LedgerAccount[]>;
  listJournals(connectionId: string): Promise<LedgerJournal[]>;
  /** Codes TVA du logiciel, à faire correspondre aux régimes belges (`mapVatCodes`). */
  mapVatCodes(connectionId: string): Promise<LedgerVatCode[]>;
  pushSale(connectionId: string, entry: AccountingEntry): Promise<PushResult>;
  pushPurchase(connectionId: string, entry: AccountingEntry): Promise<PushResult>;
  pushPayment(connectionId: string, entry: AccountingEntry): Promise<PushResult>;
}
