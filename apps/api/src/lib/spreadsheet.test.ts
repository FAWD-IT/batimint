import { describe, expect, it } from 'vitest';
import { parseCsv, parseSpreadsheet } from './spreadsheet';

describe('lecture CSV', () => {
  it('détecte le point-virgule, gère guillemets et retours à la ligne', () => {
    const rows = parseCsv(
      '﻿Code;Désignation;Prix\nA1;"Carrelage ""premium""";12,50\nA2;"Ligne\nsur deux";3\n\n',
    );
    expect(rows).toEqual([
      ['Code', 'Désignation', 'Prix'],
      ['A1', 'Carrelage "premium"', '12,50'],
      ['A2', 'Ligne\nsur deux', '3'],
    ]);
  });

  it('virgule et Windows-1252', async () => {
    const latin = Buffer.from([
      0x43, 0x6f, 0x64, 0x65, 0x2c, 0x44, 0xe9, 0x73, 0x69, 0x67, 0x6e, 0x0a, 0x41, 0x2c, 0x42,
    ]);
    expect(await parseSpreadsheet(latin, 'csv')).toEqual([
      ['Code', 'Désign'],
      ['A', 'B'],
    ]);
  });

  it('refuse un faux Excel avec un message clair', async () => {
    await expect(parseSpreadsheet(Buffer.from('pas un xlsx'), 'xlsx')).rejects.toThrow(/illisible/);
  });
});
