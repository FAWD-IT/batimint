import { describe, expect, it } from 'vitest';
import {
  renderSubcontractPdf,
  renderThirtyBisProofPdf,
  renderThirtyBisTransferPdf,
} from './subcontracting-pdf';

const tenant = { name: "Rénov'Habitat SRL", lines: ['Rue de Montigny 112', '6000 Charleroi'] };
const date = new Date('2026-10-02T09:00:00Z');

describe('sous-traitance PDF', () => {
  it('contrat : parties, objet, échéancier, clause 30bis, consultation', async () => {
    const pdf = await renderSubcontractPdf({
      tenant: { ...tenant, enterpriseNumber: '0123.456.749' },
      subcontractor: {
        name: 'Électro Pirson SPRL',
        lines: ['Rue du Pont 8', '6200 Châtelet'],
        enterpriseNumber: '0456.789.034',
      },
      number: 'ST2026-001',
      date,
      project: {
        number: 'CH2026-025',
        name: 'Rénovation Dupont',
        address: 'Rue de la Station 42, 6040 Jumet',
      },
      post: 'Électricité',
      title: 'Électricité complète',
      scope: 'Tableau, circuits, prises et éclairage',
      amount: 1_240_000n,
      startDate: new Date('2026-10-12T00:00:00Z'),
      endDate: new Date('2026-10-23T00:00:00Z'),
      installments: [
        { label: 'Au démarrage', percent: '30', amount: 372_000n, dueOn: null },
        { label: 'À la réception', percent: '70', amount: 868_000n, dueOn: new Date('2026-10-30T00:00:00Z') },
      ],
      check: { checkedAt: date, reference: '30BIS-ABC', hasSocialDebt: false, hasTaxDebt: false },
      socialPercent: '35',
      taxPercent: '15',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2_000);
  });

  it('preuve de consultation et document de versement', async () => {
    const proof = await renderThirtyBisProofPdf({
      tenant: { ...tenant, brandColor: null },
      subcontractor: { name: 'Façades Lemaire', enterpriseNumber: '0899123286' },
      checkedAt: date,
      reference: '30BIS-XYZ',
      service: 'Simulation',
      context: 'Avant paiement',
      hasSocialDebt: true,
      hasTaxDebt: false,
      socialDebtAmount: 1_845_000n,
      taxDebtAmount: null,
      checkedBy: 'Sophie',
    });
    expect(proof.subarray(0, 5).toString()).toBe('%PDF-');
    const transfer = await renderThirtyBisTransferPdf({
      tenant: { ...tenant, enterpriseNumber: '0123.456.749' },
      subcontractor: { name: 'Façades Lemaire', enterpriseNumber: '0899123286', iban: 'BE71 0961 2345 6769' },
      invoice: { number: 'F-12', issueDate: date, net: 1_000_000n, vat: 210_000n, gross: 1_210_000n },
      subcontractNumber: 'ST2026-002',
      projectLabel: 'CH2026-025 — Rénovation Dupont',
      date,
      check: { reference: '30BIS-XYZ', checkedAt: date },
      social: 350_000n,
      tax: 0n,
      socialPercent: '35',
      taxPercent: '15',
      payableToSubcontractor: 860_000n,
    });
    expect(transfer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
