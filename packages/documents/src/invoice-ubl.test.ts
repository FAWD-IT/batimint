import { computeDocumentTotals } from '@batimint/domain';
import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { buildInvoiceUbl, type InvoiceDocumentInput, ublAmount, unitCode } from './invoice-ubl';
import { validatePeppolUbl } from './peppol-validator';

const seller: InvoiceDocumentInput['seller'] = {
  name: "Rénov'Habitat SRL",
  vatNumber: 'BE0123456749',
  enterpriseNumber: '0123456749',
  street: 'Rue de Montigny 112',
  postalCode: '6000',
  city: 'Charleroi',
  country: 'BE',
  email: 'facturation@renov-habitat.be',
  iban: 'BE71096123456769',
  bic: 'GKCCBEBB',
};

const consumer: InvoiceDocumentInput['buyer'] = {
  name: 'Jean Dupont',
  vatNumber: null,
  enterpriseNumber: null,
  street: 'Rue de la Station 42',
  postalCode: '6040',
  city: 'Jumet',
  country: 'BE',
  email: 'jean.dupont@example.be',
};

const company: InvoiceDocumentInput['buyer'] = {
  name: 'Brico Pro SA',
  vatNumber: 'BE0417497106',
  enterpriseNumber: '0417497106',
  street: 'Chaussée de Bruxelles 210',
  postalCode: '6040',
  city: 'Jumet',
  country: 'BE',
  email: 'compta@bricopro.example',
};

const base = (patch: Partial<InvoiceDocumentInput>): InvoiceDocumentInput => ({
  kind: 'invoice',
  number: '2026-118',
  issueDate: '2026-08-30',
  dueDate: '2026-09-29',
  servicePeriod: { start: '2026-08-01', end: '2026-08-30' },
  buyerReference: 'CH2026-025',
  title: 'État d’avancement n°3 — 40 %',
  notes: ['Taux réduit de 6 % : attestation du client signée le 12/08/2026 (logement de plus de 10 ans).'],
  seller,
  buyer: consumer,
  deliveryAddress: { street: 'Rue de la Station 42', postalCode: '6040', city: 'Jumet', country: 'BE' },
  lines: [
    {
      description: 'Carrelage — avancement cumulé 40 %',
      unit: 'forfait',
      quantity: '1',
      unitPrice: 1_510_000n,
      vatRegime: 'reduced_6',
    },
    {
      description: 'Plomberie — avancement cumulé 60 %',
      unit: 'forfait',
      quantity: '1',
      unitPrice: 476_000n,
      vatRegime: 'reduced_6',
    },
    {
      description: 'Déduction de l’acompte (facture 2026-101)',
      unit: 'forfait',
      quantity: '-1',
      unitPrice: 470_000n,
      vatRegime: 'reduced_6',
    },
  ],
  paymentReference: '104260011893',
  paymentTerms: 'Paiement à 30 jours. Communication : +++104/2600/11893+++',
  ...patch,
});

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
const fatal = (xml: string, b2c = false) =>
  validatePeppolUbl(xml).filter((v) => v.flag === 'fatal' && !(b2c && v.id === 'PEPPOL-EN16931-R010'));

describe('UBL Peppol BIS Billing 3.0 des factures émises (05 §1, §4)', () => {
  it('facture d’avancement B2C à 6 % avec déduction de l’acompte : valide EN 16931 + Peppol', () => {
    const input = base({});
    const xml = buildInvoiceUbl(input);
    // Particulier : facture envoyée par e-mail, UBL d'archive sans adresse Peppol (R010).
    expect(fatal(xml, true)).toEqual([]);
    // Mêmes totaux que l'écran et le PDF (computeDocumentTotals).
    const totals = computeDocumentTotals(input.lines);
    const doc = parser.parse(xml).Invoice;
    expect(doc.LegalMonetaryTotal.TaxExclusiveAmount['#text']).toBe(Number(ublAmount(totals.totalNet)));
    expect(doc.LegalMonetaryTotal.PayableAmount['#text']).toBe(Number(ublAmount(totals.totalGross)));
    expect(doc.TaxTotal.TaxAmount['#text']).toBe(Number(ublAmount(totals.totalVat)));
    expect(doc.InvoiceLine[2].InvoicedQuantity['#text']).toBe(-1);
    expect(doc.PaymentMeans.PaymentID).toBe(104260011893);
  }, 120_000);

  it('B2B en autoliquidation et lignes mixtes 21 % : valide', () => {
    const xml = buildInvoiceUbl(
      base({
        number: '2026-119',
        buyer: company,
        notes: ['Autoliquidation — article 51, § 2, 5° du Code de la TVA. TVA due par le cocontractant.'],
        lines: [
          {
            description: 'Pose de carrelage',
            unit: 'm²',
            quantity: '42.5',
            unitPrice: 4_850n,
            vatRegime: 'reverse_charge',
          },
          {
            description: 'Location échafaudage',
            unit: 'j',
            quantity: '3',
            unitPrice: 12_000n,
            vatRegime: 'standard_21',
          },
        ],
      }),
    );
    expect(fatal(xml)).toEqual([]);
    expect(xml).toContain('<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode>');
    expect(xml).toContain('unitCode="MTK"');
  }, 120_000);

  it('note de crédit liée à la facture d’origine : valide', () => {
    const xml = buildInvoiceUbl(
      base({
        kind: 'credit_note',
        number: 'NC2026-001',
        title: 'Note de crédit sur la facture 2026-118',
        billingReference: { number: '2026-118', issueDate: '2026-08-30' },
        dueDate: null,
        lines: [
          {
            description: 'Carrelage — geste commercial',
            unit: 'forfait',
            quantity: '1',
            unitPrice: 25_000n,
            vatRegime: 'reduced_6',
          },
        ],
      }),
    );
    expect(xml).toContain('<CreditNote ');
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(fatal(xml, true)).toEqual([]);
  }, 120_000);

  it('les règles officielles détectent bien une facture fausse', () => {
    const xml = buildInvoiceUbl(base({ buyer: company })).replace(
      /<cbc:PayableAmount currencyID="EUR">[\d.]+</,
      '<cbc:PayableAmount currencyID="EUR">1.00<',
    );
    expect(fatal(xml).map((v) => v.id)).toContain('BR-CO-16');
  }, 120_000);

  it('unités UN/ECE', () => {
    expect(unitCode('m²')).toBe('MTK');
    expect(unitCode('h')).toBe('HUR');
    expect(unitCode('forfait')).toBe('LS');
    expect(unitCode('sac')).toBe('C62');
    expect(ublAmount(-1_205n)).toBe('-12.05');
  });
});
