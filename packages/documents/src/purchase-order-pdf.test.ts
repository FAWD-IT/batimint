import { describe, expect, it } from 'vitest';
import { renderPurchaseOrderPdf } from './purchase-order-pdf';

describe('bon de commande PDF', () => {
  it('produit un PDF avec numéro, livraison et lignes', async () => {
    const pdf = await renderPurchaseOrderPdf({
      tenant: { name: "Rénov'Habitat SRL", lines: ['Rue de Montigny 112', '6000 Charleroi'] },
      supplier: { name: 'Brico Pro SA', lines: ['Chaussée de Bruxelles 200', '6040 Jumet'] },
      number: 'BC2026-017',
      date: new Date('2026-10-02T09:00:00Z'),
      projectRef: 'CH2026-025 — Rénovation salle de bain Dupont',
      deliveryAddress: 'Rue de la Station 42, 6040 Jumet',
      expectedOn: new Date('2026-10-06T00:00:00Z'),
      notes: 'Livraison avant 8 h, sonner chez la voisine.',
      lines: [
        {
          description: 'Faïence murale 30x60',
          supplierCode: 'FAI-3060',
          unit: 'm²',
          quantity: '20',
          unitPrice: 2_500n,
        },
        {
          description: 'Colle C2TE 25 kg',
          supplierCode: null,
          unit: 'sac',
          quantity: '6',
          unitPrice: 1_800n,
        },
      ],
      totalNet: 60_800n,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2_000);
  });
});
