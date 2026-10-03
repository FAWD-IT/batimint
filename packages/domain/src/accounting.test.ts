import { describe, expect, it } from 'vitest';
import {
  AccountingError,
  canRetrySync,
  DEFAULT_ACCOUNTING_MAPPING,
  paymentEntry,
  purchaseEntry,
  resolveAccountingMapping,
  saleEntry,
} from './accounting';
import { sumCents } from './money';

const m = DEFAULT_ACCOUNTING_MAPPING;
const dupont = { name: 'Jean Dupont', vatNumber: null, enterpriseNumber: null };
const gilson = { name: 'Matériaux Gilson SA', vatNumber: 'BE0412345678', enterpriseNumber: '0412345678' };

describe('écritures de vente', () => {
  it('facture à deux taux : client TVAC au débit, CA et TVA par code, grilles belges', () => {
    const e = saleEntry(
      {
        type: 'invoice',
        number: '2026-120',
        issueDate: '2026-10-01',
        dueDate: '2026-10-31',
        partner: dupont,
        structuredCommunication: '000012012034',
        vatBreakdown: [
          { regimes: ['standard_21'], ratePercent: '21', taxableAmount: 100_000n, taxAmount: 21_000n },
          { regimes: ['reduced_6'], ratePercent: '6', taxableAmount: 500_000n, taxAmount: 30_000n },
        ],
        totalNet: 600_000n,
        totalVat: 51_000n,
        totalGross: 651_000n,
      },
      m,
    );
    expect(e).toMatchObject({ kind: 'sale', journal: 'VEN', reference: '000012012034' });
    expect(e.lines[0]).toMatchObject({ account: '400000', amount: 651_000n });
    expect(
      e.lines.filter((l) => l.account === '700000').map((l) => [l.vatCode, l.vatGrid, l.amount]),
    ).toEqual([
      ['V21', '03', -100_000n],
      ['V06', '01', -500_000n],
    ]);
    expect(e.lines.filter((l) => l.account === '451000').map((l) => l.vatGrid)).toEqual(['54', '54']);
    expect(sumCents(e.lines.map((l) => l.amount))).toBe(0n);
  });

  it('autoliquidation : grille 45, pas de TVA ; note de crédit : sens inversés, journal propre', () => {
    const e = saleEntry(
      {
        type: 'credit_note',
        number: 'NC2026-003',
        issueDate: '2026-10-01',
        dueDate: null,
        partner: gilson,
        structuredCommunication: null,
        vatBreakdown: [
          { regimes: ['reverse_charge'], ratePercent: '0', taxableAmount: 200_000n, taxAmount: 0n },
        ],
        totalNet: 200_000n,
        totalVat: 0n,
        totalGross: 200_000n,
      },
      m,
    );
    expect(e).toMatchObject({ kind: 'credit_note', journal: 'NCV' });
    expect(e.lines).toHaveLength(2);
    expect(e.lines[0]!.amount).toBe(-200_000n);
    expect(e.lines[1]).toMatchObject({ account: '700000', amount: 200_000n, vatCode: 'VCC', vatGrid: '45' });
  });

  it('ventilation incohérente refusée', () => {
    expect(() =>
      saleEntry(
        {
          type: 'invoice',
          number: 'X',
          issueDate: '2026-10-01',
          dueDate: null,
          partner: dupont,
          structuredCommunication: null,
          vatBreakdown: [{ regimes: ['standard_21'], ratePercent: '21', taxableAmount: 1n, taxAmount: 0n }],
          totalNet: 2n,
          totalVat: 0n,
          totalGross: 2n,
        },
        m,
      ),
    ).toThrow(AccountingError);
  });
});

describe('écritures d’achat et de paiement', () => {
  it('matériaux : charge par taux, TVA déductible, fournisseur TVAC au crédit', () => {
    const e = purchaseEntry(
      {
        number: 'F-889',
        issueDate: '2026-09-28',
        dueDate: '2026-10-28',
        partner: gilson,
        subcontracting: false,
        lines: [
          { net: 80_000n, vatRate: '21' },
          { net: 20_000n, vatRate: '21' },
        ],
        totalNet: 100_000n,
        totalVat: 21_000n,
        totalGross: 121_000n,
      },
      m,
    );
    expect(e.lines.map((l) => [l.account, l.amount, l.vatCode])).toEqual([
      ['604000', 100_000n, 'A21'],
      ['411000', 21_000n, null],
      ['440000', -121_000n, null],
    ]);
  });

  it('sous-traitant sans TVA : autoliquidation (grille 87) ; lignes absentes : taux déduit des totaux', () => {
    const cc = purchaseEntry(
      {
        number: 'ST-12',
        issueDate: '2026-09-28',
        dueDate: null,
        partner: gilson,
        subcontracting: true,
        lines: [],
        totalNet: 500_000n,
        totalVat: 0n,
        totalGross: 500_000n,
      },
      m,
    );
    expect(cc.lines[0]).toMatchObject({ account: '611000', vatCode: 'ACC', vatGrid: '87', amount: 500_000n });
    const six = purchaseEntry(
      {
        number: 'F-1',
        issueDate: '2026-09-28',
        dueDate: null,
        partner: gilson,
        subcontracting: false,
        lines: [{ net: 1n, vatRate: '21' }],
        totalNet: 100_000n,
        totalVat: 6_000n,
        totalGross: 106_000n,
      },
      m,
    );
    expect(six.lines[0]).toMatchObject({ vatCode: 'A06', amount: 100_000n });
  });

  it('paiements : banque contre client ; fournisseur soldé avec retenue 30bis', () => {
    const r = paymentEntry(
      {
        direction: 'received',
        number: 'P-1',
        date: '2026-10-02',
        amount: 651_000n,
        partner: dupont,
        documentNumber: '2026-120',
      },
      m,
    );
    expect(r.lines.map((l) => [l.account, l.amount])).toEqual([
      ['550000', 651_000n],
      ['400000', -651_000n],
    ]);
    const s = paymentEntry(
      {
        direction: 'sent',
        number: 'P-2',
        date: '2026-10-02',
        amount: 65_000n,
        withholding: 35_000n,
        partner: gilson,
        documentNumber: 'ST-12',
      },
      m,
    );
    expect(s.lines.map((l) => [l.account, l.amount])).toEqual([
      ['440000', 100_000n],
      ['550000', -65_000n],
      ['454000', -35_000n],
    ]);
    expect(() =>
      paymentEntry(
        {
          direction: 'received',
          number: 'P',
          date: '2026-10-02',
          amount: 0n,
          partner: dupont,
          documentNumber: 'x',
        },
        m,
      ),
    ).toThrow(AccountingError);
  });
});

describe('paramétrage', () => {
  it('un paramétrage partiel garde les valeurs par défaut ; reprise possible en erreur ou en attente', () => {
    const r = resolveAccountingMapping({ accounts: { sales: '705000' }, journals: { sales: 'V1' } });
    expect(r.accounts.sales).toBe('705000');
    expect(r.accounts.customers).toBe('400000');
    expect(r.journals).toMatchObject({ sales: 'V1', purchases: 'ACH' });
    expect(resolveAccountingMapping(null)).toEqual(DEFAULT_ACCOUNTING_MAPPING);
    expect(canRetrySync('error')).toBe(true);
    expect(canRetrySync('waiting')).toBe(true);
    expect(canRetrySync('synced')).toBe(false);
  });
});
