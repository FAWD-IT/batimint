/**
 * Simulation déterministe d'un logiciel comptable belge derrière Chift (« WinBooks (simulation) ») :
 * plan comptable PCMN, journaux et codes TVA usuels. Une écriture est refusée, avec un message
 * lisible, si son journal, un compte ou un code TVA n'existe pas, si elle n'est pas équilibrée ou
 * si le numéro de TVA du partenaire est invalide : ces erreurs se corrigent puis se rejouent.
 */
import { type AccountingEntry, isValidEnterpriseNumber, sumCents } from '@batimint/domain';
import { IntegrationError } from '../errors';
import type {
  AccountingConnection,
  AccountingSync,
  LedgerAccount,
  LedgerJournal,
  LedgerVatCode,
  PushResult,
} from './types';

const SOFTWARE = 'WinBooks (simulation)';

const ACCOUNTS: LedgerAccount[] = [
  ['400000', 'Clients'],
  ['411000', 'TVA à récupérer'],
  ['440000', 'Fournisseurs'],
  ['451000', 'TVA à payer'],
  ['454000', 'Retenues 30bis à verser'],
  ['550000', 'Banque'],
  ['600000', 'Achats de matières premières'],
  ['604000', 'Achats de marchandises'],
  ['610000', 'Loyers et charges locatives'],
  ['611000', 'Sous-traitance'],
  ['612000', 'Entretien et réparations'],
  ['700000', 'Ventes et prestations'],
  ['705000', 'Travaux en régie'],
].map(([number, label]) => ({ number: number!, label: label! }));

const JOURNALS: LedgerJournal[] = [
  { code: 'VEN', label: 'Ventes', type: 'sale' },
  { code: 'NCV', label: 'Notes de crédit sur ventes', type: 'sale' },
  { code: 'ACH', label: 'Achats', type: 'purchase' },
  { code: 'BQ1', label: 'Banque', type: 'financial' },
  { code: 'OD', label: 'Opérations diverses', type: 'misc' },
];

const VAT_CODES: LedgerVatCode[] = [
  { code: 'V21', label: 'Ventes 21 %', ratePercent: '21', scope: 'sale' },
  { code: 'V12', label: 'Ventes 12 %', ratePercent: '12', scope: 'sale' },
  { code: 'V06', label: 'Ventes 6 %', ratePercent: '6', scope: 'sale' },
  { code: 'V00', label: 'Ventes 0 %', ratePercent: '0', scope: 'sale' },
  { code: 'VCC', label: 'Ventes cocontractant (autoliquidation)', ratePercent: '0', scope: 'sale' },
  { code: 'VEX', label: 'Ventes exemptées', ratePercent: '0', scope: 'sale' },
  { code: 'VIC', label: 'Livraisons intracommunautaires', ratePercent: '0', scope: 'sale' },
  { code: 'VXP', label: 'Exportations', ratePercent: '0', scope: 'sale' },
  { code: 'A21', label: 'Achats 21 %', ratePercent: '21', scope: 'purchase' },
  { code: 'A12', label: 'Achats 12 %', ratePercent: '12', scope: 'purchase' },
  { code: 'A06', label: 'Achats 6 %', ratePercent: '6', scope: 'purchase' },
  { code: 'A00', label: 'Achats 0 %', ratePercent: '0', scope: 'purchase' },
  { code: 'ACC', label: 'Achats cocontractant (autoliquidation)', ratePercent: '0', scope: 'purchase' },
  { code: 'AIC', label: 'Acquisitions intracommunautaires', ratePercent: '0', scope: 'purchase' },
];

export class MockAccountingSync implements AccountingSync {
  readonly provider = 'mock';

  async connect(input: {
    tenantId: string;
    name: string;
    enterpriseNumber: string | null;
  }): Promise<AccountingConnection> {
    return {
      connectionId: `mock-${input.tenantId.replace(/-/g, '').slice(0, 12)}`,
      status: 'active',
      software: SOFTWARE,
      authorizationUrl: null,
    };
  }

  async listChartOfAccounts(_connectionId: string): Promise<LedgerAccount[]> {
    return ACCOUNTS;
  }

  async listJournals(_connectionId: string): Promise<LedgerJournal[]> {
    return JOURNALS;
  }

  async mapVatCodes(_connectionId: string): Promise<LedgerVatCode[]> {
    return VAT_CODES;
  }

  pushSale(connectionId: string, entry: AccountingEntry): Promise<PushResult> {
    return this.push(connectionId, entry, ['sale']);
  }

  pushPurchase(connectionId: string, entry: AccountingEntry): Promise<PushResult> {
    return this.push(connectionId, entry, ['purchase']);
  }

  pushPayment(connectionId: string, entry: AccountingEntry): Promise<PushResult> {
    return this.push(connectionId, entry, ['financial']);
  }

  private async push(
    connectionId: string,
    entry: AccountingEntry,
    types: LedgerJournal['type'][],
  ): Promise<PushResult> {
    const fail = (message: string): never => {
      throw new IntegrationError('mock', `${SOFTWARE} refuse la pièce ${entry.number} : ${message}`, false);
    };
    if (!connectionId.startsWith('mock-'))
      fail('la connexion comptable n’est pas reconnue. Reconnectez la comptabilité.');
    const journal = JOURNALS.find((j) => j.code === entry.journal);
    if (!journal || !types.includes(journal.type))
      fail(
        `le journal « ${entry.journal} » n’existe pas. Choisissez un journal existant dans Comptabilité → Paramétrage.`,
      );
    const accounts = new Set(ACCOUNTS.map((a) => a.number));
    for (const l of entry.lines) {
      if (!accounts.has(l.account))
        fail(
          `le compte ${l.account} n’existe pas dans le plan comptable. Corrigez le paramétrage des comptes.`,
        );
      if (l.vatCode && !VAT_CODES.some((v) => v.code === l.vatCode))
        fail(`le code TVA « ${l.vatCode} » est inconnu. Corrigez le paramétrage des codes TVA.`);
    }
    if (sumCents(entry.lines.map((l) => l.amount)) !== 0n) fail('l’écriture n’est pas équilibrée.');
    const vat = entry.partner.vatNumber?.replace(/\s|\./g, '').toUpperCase() ?? null;
    if (vat?.startsWith('BE') && !isValidEnterpriseNumber(vat.slice(2)))
      fail(
        `le numéro de TVA ${entry.partner.vatNumber} de « ${entry.partner.name} » est invalide. Corrigez-le dans sa fiche puis relancez.`,
      );
    // Chift déduplique par journal et numéro : renvoyer la même pièce rend le même identifiant.
    return { externalId: `${journal!.code}-${entry.number}`.replace(/\s/g, '') };
  }
}
