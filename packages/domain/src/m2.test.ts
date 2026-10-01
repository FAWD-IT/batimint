import { describe, expect, it } from 'vitest';
import { customerDisplayName, dwellingAge, findDuplicates, leadSpamScore } from './crm';
import {
  assertAssemblyStructure,
  type CostableItem,
  computeItemCost,
  computeSalePrice,
  LibraryError,
  marginRate,
  normalizeUnit,
} from './library';
import { normalizeImportRow, planImport, suggestMapping } from './library-import';

const mat = (id: string, price: bigint, hours = '0'): CostableItem => ({
  id,
  kind: 'material',
  purchasePrice: price,
  laborHours: hours,
});

describe('03 §3 — articles et ouvrages', () => {
  it('normalise les unités courantes', () => {
    expect(normalizeUnit('m2')).toBe('m²');
    expect(normalizeUnit(' Pce ')).toBe('u');
    expect(normalizeUnit('FF')).toBe('forfait');
    expect(normalizeUnit('zorglub')).toBeNull();
  });

  it('calcule le prix de revient et le temps de pose d’un ouvrage', () => {
    const colle = mat('colle', 1250n);
    const carrelage = mat('carreau', 2899n);
    const pose: CostableItem = { id: 'pose', kind: 'labour', purchasePrice: 3600n, laborHours: '1' };
    const ouvrage: CostableItem = {
      id: 'faience',
      kind: 'assembly',
      purchasePrice: 0n,
      laborHours: 0,
      components: [
        { item: carrelage, quantity: '1.1' },
        { item: colle, quantity: '0.25' },
        { item: pose, quantity: '0.8' },
      ],
    };
    // 1,1 × 28,99 + 0,25 × 12,50 + 0,8 × 36,00 = 31,889 + 3,125 + 28,80 = 63,814 → 63,81
    const r = computeItemCost(ouvrage);
    expect(r.cost).toBe(6381n);
    expect(r.laborHours.toString()).toBe('0.8');
  });

  it('ouvrages imbriquables sur un niveau seulement, sans cycle', () => {
    const inner: CostableItem = {
      id: 'in',
      kind: 'assembly',
      purchasePrice: 0n,
      laborHours: 0,
      components: [{ item: mat('a', 100n), quantity: 2 }],
    };
    const outer: CostableItem = {
      id: 'out',
      kind: 'assembly',
      purchasePrice: 0n,
      laborHours: 0,
      components: [{ item: inner, quantity: 3 }],
    };
    expect(computeItemCost(outer).cost).toBe(600n);
    const tooDeep: CostableItem = {
      id: 'top',
      kind: 'assembly',
      purchasePrice: 0n,
      laborHours: 0,
      components: [{ item: outer, quantity: 1 }],
    };
    expect(() => computeItemCost(tooDeep)).toThrow(LibraryError);
    const cyclic: CostableItem = {
      id: 'c',
      kind: 'assembly',
      purchasePrice: 0n,
      laborHours: 0,
      components: [],
    };
    cyclic.components!.push({ item: cyclic, quantity: 1 });
    expect(() => assertAssemblyStructure(cyclic)).toThrow(/lui-même/);
  });

  it('prix de vente : forcé, coefficient article, ou frais généraux × marge du tenant', () => {
    expect(
      computeSalePrice({
        cost: 10000n,
        salePrice: 15000n,
        overheadCoefficient: '1.1',
        marginCoefficient: '1.25',
      }),
    ).toBe(15000n);
    expect(
      computeSalePrice({
        cost: 10000n,
        itemCoefficient: '1.5',
        overheadCoefficient: '1.1',
        marginCoefficient: '1.25',
      }),
    ).toBe(15000n);
    expect(computeSalePrice({ cost: 10000n, overheadCoefficient: '1.1', marginCoefficient: '1.25' })).toBe(
      13750n,
    );
    expect(marginRate(13750n, 10000n)?.toFixed(4)).toBe('0.2727');
    expect(marginRate(0n, 0n)).toBeNull();
  });
});

describe('P1.4 — import de bibliothèque', () => {
  it('propose le mapping des colonnes à partir d’en-têtes variés', () => {
    const m = suggestMapping([
      'Référence',
      'Désignation',
      'Unité',
      "Prix d'achat",
      'Prix de vente',
      'Famille',
      'Temps de pose',
      'TVA',
    ]);
    expect(m).toEqual({
      code: 0,
      name: 1,
      unit: 2,
      purchasePrice: 3,
      salePrice: 4,
      category: 5,
      laborHours: 6,
      vatRate: 7,
    });
    expect(suggestMapping(['Artikelcode', 'Omschrijving', 'Eenheid', 'Inkoopprijs'])).toMatchObject({
      code: 0,
      name: 1,
      unit: 2,
      purchasePrice: 3,
    });
  });

  it('normalise les montants belges et européens', () => {
    const m = { code: 0, name: 1, unit: 2, purchasePrice: 3 };
    const p = (price: string) => normalizeImportRow(['A1', 'Article', 'pce', price], m, 2);
    expect(p('1.234,56 €')).toMatchObject({
      ok: true,
      value: { purchasePrice: 123456n, unit: 'u', kind: 'material' },
    });
    expect(p('1,234.56')).toMatchObject({ ok: true, value: { purchasePrice: 123456n } });
    expect(p('12,5')).toMatchObject({ ok: true, value: { purchasePrice: 1250n } });
    expect(p('douze')).toMatchObject({ ok: false });
  });

  it('rapporte des erreurs lisibles, par ligne', () => {
    const m = {
      code: 0,
      name: 1,
      unit: 2,
      purchasePrice: 3,
      kind: 4,
      vatRate: 5,
      laborHours: 6,
      salePrice: 7,
    };
    const r = normalizeImportRow(['', '', 'zorglub', 'x', 'bidule', '19', 'deux', 'y'], m, 7);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.field)).toEqual([
        'code',
        'name',
        'unit',
        'purchasePrice',
        'salePrice',
        'kind',
        'laborHours',
        'vatRate',
      ]);
      expect(r.errors.every((e) => e.row === 7)).toBe(true);
    }
    const long = normalizeImportRow(
      ['X'.repeat(61), 'N', 'u', '1'],
      { code: 0, name: 1, unit: 2, purchasePrice: 3 },
      3,
    );
    expect(long.ok).toBe(false);
    const labour = normalizeImportRow(
      ['MO1', 'Ouvrier', 'h', '36', 'MO', '6', '1,5'],
      { code: 0, name: 1, unit: 2, purchasePrice: 3, kind: 4, vatRate: 5, laborHours: 6 },
      2,
    );
    expect(labour).toMatchObject({
      ok: true,
      value: { kind: 'labour', vatRate: 'reduced_6', laborHours: '1.5' },
    });
  });

  it('planifie créations, mises à jour par code, doublons et lignes vides', () => {
    const mapping = { code: 0, name: 1, unit: 2, purchasePrice: 3 };
    const existing = new Map([
      ['A', { purchasePrice: 100n, salePrice: null, name: 'Alpha', unit: 'u' }],
      ['B', { purchasePrice: 200n, salePrice: null, name: 'Bravo', unit: 'u' }],
    ]);
    const plan = planImport(
      [
        ['A', 'Alpha', 'u', '1,00'],
        ['B', 'Bravo', 'u', '2,50'],
        ['C', 'Charlie', 'm²', '3'],
        ['C', 'Charlie bis', 'm²', '3'],
        ['', '', '', ''],
        ['D', '', 'u', '1'],
      ],
      mapping,
      existing,
    );
    expect(plan.unchanged.map((r) => r.code)).toEqual(['A']);
    expect(plan.toUpdate.map((r) => r.code)).toEqual(['B']);
    expect(plan.toCreate.map((r) => r.code)).toEqual(['C']);
    expect(plan.duplicates[0]?.row).toBe(5);
    expect(plan.errors).toEqual([{ row: 7, field: 'name', message: 'Désignation manquante' }]);
  });

  it('refuse un mapping sans colonne obligatoire', () => {
    const plan = planImport([['A']], { code: 0 }, new Map());
    expect(plan.errors.map((e) => e.field)).toEqual(['name', 'purchasePrice']);
  });
});

describe('03 §2 — CRM', () => {
  it('nom affiché', () => {
    expect(customerDisplayName({ kind: 'individual', firstName: 'Jean', lastName: 'Dupont' })).toBe(
      'Jean Dupont',
    );
    expect(customerDisplayName({ kind: 'company', companyName: 'Brico Pro SA', firstName: 'X' })).toBe(
      'Brico Pro SA',
    );
    expect(customerDisplayName({ kind: 'company', firstName: 'Paul', lastName: 'Martin' })).toBe(
      'Paul Martin',
    );
    expect(customerDisplayName({ kind: 'individual', companyName: 'ACME' })).toBe('ACME');
  });

  it('dédoublonne par TVA, e-mail puis téléphone', () => {
    const c = [
      { id: '1', vatNumber: 'BE0417497106' },
      { id: '2', email: 'jean@dupont.be' },
      { id: '3', phone: '+32 471 12 34 56' },
    ];
    expect(findDuplicates({ enterpriseNumber: '0417.497.106' }, c)).toEqual([{ id: '1', reason: 'vat' }]);
    expect(findDuplicates({ email: ' Jean@Dupont.be ' }, c)).toEqual([{ id: '2', reason: 'email' }]);
    expect(findDuplicates({ phone: '0471/12.34.56' }, c)).toEqual([{ id: '3', reason: 'phone' }]);
    expect(findDuplicates({ phone: '00324711234 56' }, c)).toEqual([{ id: '3', reason: 'phone' }]);
    expect(findDuplicates({ phone: '12' }, c)).toEqual([]);
  });

  it('âge du logement et anti-spam', () => {
    expect(dwellingAge(1975, new Date('2026-06-01'))).toBe(51);
    expect(dwellingAge(null)).toBeUndefined();
    expect(leadSpamScore({ honeypot: 'x' })).toBeGreaterThanOrEqual(100);
    expect(leadSpamScore({ message: 'voir https://a https://b', fillMs: 1000 })).toBe(80);
    expect(leadSpamScore({ message: 'Bonjour, salle de bain à rénover', fillMs: 30_000 })).toBe(0);
  });
});
