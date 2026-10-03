import { describe, expect, it } from 'vitest';
import { renderInvoicePdf } from './invoice-pdf';
import { sha256 } from './pdf';

const input = {
  kind: 'invoice' as const,
  documentLabel: 'Facture',
  number: '2026-118',
  issueDate: '2026-08-30',
  dueDate: '2026-09-29',
  servicePeriod: { start: '2026-08-01', end: '2026-08-30' },
  buyerReference: 'CH2026-025',
  title: 'État d’avancement n°3 — 40 %',
  notes: ['Taux réduit de 6 % : attestation du client signée.'],
  seller: {
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
  },
  buyer: {
    name: 'Jean Dupont',
    vatNumber: null,
    enterpriseNumber: null,
    street: 'Rue de la Station 42',
    postalCode: '6040',
    city: 'Jumet',
    country: 'BE',
    email: null,
  },
  lines: [
    {
      description: 'Carrelage — avancement cumulé 40 %',
      unit: 'forfait',
      quantity: '1',
      unitPrice: 1_510_000n,
      vatRegime: 'reduced_6' as const,
    },
    {
      description: 'Déduction de l’acompte',
      unit: 'forfait',
      quantity: '-1',
      unitPrice: 470_000n,
      vatRegime: 'reduced_6' as const,
    },
  ],
  paymentReference: '104260011893',
  paymentTerms: 'Paiement à 30 jours.',
  retention: { percent: '5', amount: 55_120n },
  sellerFooter: ["Rénov'Habitat SRL", 'TVA BE0123456749', 'IBAN BE71 0961 2345 6769'],
};

describe('facture PDF', () => {
  it('produit un PDF déterministe (empreinte reproductible) avec QR EPC', async () => {
    const a = await renderInvoicePdf(input);
    const b = await renderInvoicePdf(input);
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a.length).toBeGreaterThan(5_000);
    expect(sha256(a)).toBe(sha256(b));
  });

  it('note de crédit sans bloc de paiement', async () => {
    const pdf = await renderInvoicePdf({
      ...input,
      kind: 'credit_note',
      documentLabel: 'Note de crédit',
      number: 'NC2026-001',
      billingReference: { number: '2026-118', issueDate: '2026-08-30' },
      retention: null,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
