import { describe, expect, it } from 'vitest';
import {
  allocateInvoice,
  compareWithOrder,
  groupBySupplier,
  lineTotal,
  matchSupplierInvoice,
  normalizeRef,
  pairLine,
  remainingCommitment,
} from './purchasing';

const orders = [
  { id: 'po-17', number: 'BC2026-017', supplierId: 'brico', projectId: 'dupont' },
  { id: 'po-18', number: 'BC2026-018', supplierId: 'facq', projectId: 'lemaire' },
];
const projects = [
  { id: 'dupont', number: 'CH2026-025', street: 'Rue de la Station 42', postalCode: '6040' },
  { id: 'lemaire', number: 'CH2026-002', street: 'Rue des Écoles 108', postalCode: '6041' },
];
const invoice = (patch: Partial<Parameters<typeof matchSupplierInvoice>[0]['invoice']>) => ({
  supplierId: 'brico',
  orderReference: null,
  texts: [],
  deliveryAddress: null,
  ...patch,
});

describe('rapprochement des factures fournisseurs', () => {
  it('par numéro de BC, quelle que soit la typographie', () => {
    expect(normalizeRef('BC-2026/017')).toBe('BC2026017');
    expect(
      matchSupplierInvoice({ invoice: invoice({ orderReference: 'bc 2026-017' }), orders, projects }),
    ).toEqual({
      method: 'purchase_order',
      projectId: 'dupont',
      purchaseOrderId: 'po-17',
      confidence: 0.99,
    });
    // Le BC d'un autre fournisseur reste trouvé, avec moins de confiance.
    expect(
      matchSupplierInvoice({ invoice: invoice({ texts: ['Votre commande BC2026-018'] }), orders, projects })
        ?.confidence,
    ).toBe(0.9);
  });

  it('puis par référence de chantier, puis par adresse ; sinon rien', () => {
    expect(
      matchSupplierInvoice({ invoice: invoice({ texts: ['Chantier CH2026-025 Dupont'] }), orders, projects }),
    ).toMatchObject({
      method: 'project_reference',
      projectId: 'dupont',
    });
    expect(
      matchSupplierInvoice({
        invoice: invoice({ deliveryAddress: 'Livraison : rue des Ecoles 108, 6041 Gosselies' }),
        orders,
        projects,
      }),
    ).toMatchObject({ method: 'address', projectId: 'lemaire', confidence: 0.85 });
    expect(
      matchSupplierInvoice({ invoice: invoice({ texts: ['Colle carrelage C2'] }), orders, projects }),
    ).toBeNull();
    // Une référence trop courte ne suffit pas.
    expect(
      matchSupplierInvoice({
        invoice: invoice({ orderReference: '17' }),
        orders: [{ ...orders[0]!, number: '17' }],
        projects,
      }),
    ).toBeNull();
  });
});

const orderLines = [
  {
    id: 'l1',
    description: 'Faïence murale 30x60 blanc mat',
    supplierCode: 'FAI-3060',
    quantity: '20',
    unitPrice: 2_500n,
    budgetLineId: 'carrelage',
  },
  {
    id: 'l2',
    description: 'Colle carrelage C2TE 25 kg',
    supplierCode: null,
    quantity: '6',
    unitPrice: 1_800n,
    budgetLineId: 'carrelage',
  },
  {
    id: 'l3',
    description: 'Tube multicouche 16 mm',
    supplierCode: 'TMC16',
    quantity: '10',
    unitPrice: 300n,
    budgetLineId: 'plomberie',
  },
];

describe('ventilation et écarts', () => {
  it('apparie par code fournisseur, sinon par libellé', () => {
    expect(
      pairLine(
        { description: 'x', supplierCode: 'fai 3060', quantity: '1', unitPrice: 0n, net: 0n },
        orderLines,
      )?.id,
    ).toBe('l1');
    expect(
      pairLine(
        { description: 'Colle C2TE carrelage', supplierCode: null, quantity: '1', unitPrice: 0n, net: 0n },
        orderLines,
      )?.id,
    ).toBe('l2');
    expect(
      pairLine(
        { description: 'Transport', supplierCode: null, quantity: '1', unitPrice: 0n, net: 0n },
        orderLines,
      ),
    ).toBeNull();
  });

  it('chaque ligne suit son poste ; le reste au prorata du BC ; total exact', () => {
    const lines = [
      {
        description: 'Faïence 30x60',
        supplierCode: 'FAI-3060',
        quantity: '20',
        unitPrice: 2_500n,
        net: 50_000n,
      },
      {
        description: 'Tube multicouche 16 mm',
        supplierCode: 'TMC16',
        quantity: '10',
        unitPrice: 300n,
        net: 3_000n,
      },
      {
        description: 'Frais de livraison',
        supplierCode: null,
        quantity: '1',
        unitPrice: 1_001n,
        net: 1_001n,
      },
    ];
    const alloc = allocateInvoice({ totalNet: 54_001n, lines, orderLines });
    // Reste 1 001 : 60 800 / 3 000 → 954 / 47.
    expect(alloc).toEqual([
      { budgetLineId: 'carrelage', amount: 50_954n },
      { budgetLineId: 'plomberie', amount: 3_047n },
    ]);
    expect(alloc.reduce((s, a) => s + a.amount, 0n)).toBe(54_001n);
    expect(
      allocateInvoice({ totalNet: 12_345n, lines: [], orderLines: [], fallbackBudgetLineId: 'x' }),
    ).toEqual([{ budgetLineId: 'x', amount: 12_345n }]);
  });

  it('signale prix, quantité, ligne non commandée et total', () => {
    const d = compareWithOrder({
      orderLines,
      invoiceNet: 70_000n,
      lines: [
        {
          description: 'Faïence 30x60',
          supplierCode: 'FAI-3060',
          quantity: '22',
          unitPrice: 2_700n,
          net: 59_400n,
        },
        {
          description: 'Colle C2TE carrelage',
          supplierCode: null,
          quantity: '6',
          unitPrice: 1_810n,
          net: 10_860n,
        },
        {
          description: 'Palette consignée',
          supplierCode: null,
          quantity: '1',
          unitPrice: 1_500n,
          net: 1_500n,
        },
      ],
    });
    expect(d).toEqual([
      {
        kind: 'price',
        description: 'Faïence murale 30x60 blanc mat',
        ordered: 2_500n,
        invoiced: 2_700n,
        percent: 8,
      },
      { kind: 'unordered', description: 'Palette consignée', amount: 1_500n },
      { kind: 'quantity', description: 'Faïence murale 30x60 blanc mat', ordered: '20', invoiced: '22' },
      { kind: 'total', ordered: 63_800n, invoiced: 70_000n, percent: 9.7 },
    ]);
  });
});

describe('bons de commande', () => {
  it('regroupe les matériaux par fournisseur ; engagement restant', () => {
    const groups = groupBySupplier([
      {
        key: 'a',
        description: 'Faïence',
        unit: 'm²',
        quantity: '18',
        unitCost: 2_500n,
        budgetLineId: 'c',
        supplierId: 'brico',
      },
      {
        key: 'b',
        description: 'Mitigeur',
        unit: 'pce',
        quantity: '1',
        unitCost: 18_000n,
        budgetLineId: 'p',
        supplierId: null,
      },
      {
        key: 'c',
        description: 'Colle',
        unit: 'sac',
        quantity: '6',
        unitCost: 1_800n,
        budgetLineId: 'c',
        supplierId: 'brico',
      },
      {
        key: 'd',
        description: 'Rien',
        unit: 'pce',
        quantity: '0',
        unitCost: 100n,
        budgetLineId: 'c',
        supplierId: 'brico',
      },
    ]);
    expect(groups.map((g) => [g.supplierId, g.lines.length, g.total])).toEqual([
      ['brico', 2, 55_800n],
      [null, 1, 18_000n],
    ]);
    expect(lineTotal('2.5', 1_999n)).toBe(4_998n);
    expect(remainingCommitment(100_000n, 30_000n)).toBe(70_000n);
    expect(remainingCommitment(100_000n, 120_000n)).toBe(0n);
  });
});
