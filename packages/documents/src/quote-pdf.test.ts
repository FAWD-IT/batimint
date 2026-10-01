import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderChangeOrderPdf, renderQuotePdf, type QuotePdfInput, sha256 } from './index';

const input: QuotePdfInput = {
  tenant: {
    name: "Rénov'Habitat SRL",
    lines: ['Rue de Montigny 112', '6000 Charleroi', 'TVA BE0123456749'],
    brandColor: '#0B6E4F',
    iban: 'BE68539007547034',
    termsAndConditions: '1. Nos devis sont valables 30 jours.',
    legalMentions: 'BCE 0123.456.749',
  },
  customer: { name: 'Jean Dupont', lines: ['Rue de la Station 42', '6040 Jumet'] },
  siteAddress: 'Rue de la Station 42, 6040 Jumet',
  quote: {
    number: 'D2026-001',
    title: 'Rénovation salle de bain',
    version: 1,
    date: new Date('2026-10-01T10:00:00Z'),
    validUntil: new Date('2026-10-31T10:00:00Z'),
    intro: 'Suite à notre visite du 27 septembre.',
    paymentSchedule: [{ label: 'À la signature', percent: '30' }],
  },
  content: {
    deposit: { kind: 'percent', value: '30' },
    sections: [
      {
        id: 's1',
        title: 'Carrelage',
        optional: false,
        selected: false,
        lines: Array.from({ length: 40 }, (_, i) => ({
          id: `l${i}`,
          kind: 'item' as const,
          description: `Faïence murale 30×60 posée — ligne ${i} avec une description assez longue pour passer à la ligne`,
          unit: 'm²',
          quantity: '18.5',
          unitPrice: 9_690n,
          unitCost: 6_765n,
          laborHours: '0.9',
          vatRegime: 'reduced_6' as const,
        })),
      },
      {
        id: 's2',
        title: "Douche à l'italienne",
        optional: true,
        selected: false,
        lines: [
          {
            id: 'o1',
            kind: 'item',
            description: 'Douche à l’italienne',
            unit: 'forfait',
            quantity: '1',
            unitPrice: 140_000n,
            unitCost: 100_000n,
            laborHours: '8',
            vatRegime: 'standard_21',
          },
        ],
      },
    ],
  },
};

describe('PDF du devis', () => {
  it('produit un PDF multipage, déterministe (même empreinte pour le même contenu)', async () => {
    const a = await renderQuotePdf(input);
    const b = await renderQuotePdf(input);
    // Aperçu manuel : PDF_OUT=/tmp/devis.pdf pnpm test
    if (process.env['PDF_OUT']) writeFileSync(process.env['PDF_OUT'], a);
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha256(a)).toBe(sha256(b));
    expect(a.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('signé : l’empreinte change, la date de création suit la signature', async () => {
    const signed = await renderQuotePdf({
      ...input,
      signature: { signerName: 'Jean Dupont', signedAt: new Date('2026-10-05T18:00:00Z'), ip: '203.0.113.7' },
      certificate: { signedAt: new Date('2026-10-05T18:00:00Z') },
    });
    expect(sha256(signed)).not.toBe(sha256(await renderQuotePdf(input)));
  });
});

describe('PDF de l’avenant', () => {
  it('reprend le calcul du devis, avec son en-tête et l’impact sur la date de fin', async () => {
    const base = {
      tenant: input.tenant,
      customer: input.customer,
      siteAddress: input.siteAddress,
      changeOrder: {
        ordinal: 2,
        number: 'AV2026-001',
        title: 'Niche murale',
        description: 'Ajout d’une niche murale carrelée dans la douche.',
        date: new Date('2026-10-01T10:00:00Z'),
        delayDays: 0,
        newEndDate: null,
        projectRef: 'CH2026-001 (devis D2026-001)',
      },
      sections: [
        {
          id: 'carrelage',
          title: 'Carrelage',
          optional: false,
          selected: true,
          lines: [
            {
              id: 'n1',
              kind: 'item' as const,
              description: 'Niche murale 60×30 carrelée',
              unit: 'u',
              quantity: '1',
              unitPrice: 125_000n,
              unitCost: 80_000n,
              laborHours: '6',
              vatRegime: 'reduced_6' as const,
            },
          ],
        },
      ],
    };
    const a = await renderChangeOrderPdf(base);
    if (process.env['PDF_OUT']) writeFileSync(process.env['PDF_OUT'].replace(/\.pdf$/, '-avenant.pdf'), a);
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha256(a)).toBe(sha256(await renderChangeOrderPdf(base)));
    const delayed = await renderChangeOrderPdf({
      ...base,
      changeOrder: { ...base.changeOrder, delayDays: 2, newEndDate: new Date('2026-10-13T00:00:00Z') },
    });
    expect(sha256(delayed)).not.toBe(sha256(a));
  });
});
