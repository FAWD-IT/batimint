/**
 * Lecture des fichiers d'import (CSV ou Excel) en tableau de cellules texte.
 */
import ExcelJS from 'exceljs';
import { badRequest } from './errors';

/** Parser CSV RFC 4180 (guillemets, retours à la ligne dans les champs), séparateur détecté. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', ',', '\t', '|']
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
  }
  return String(v);
}

export async function parseXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest(
      'invalid_file',
      'Ce fichier Excel est illisible. Enregistrez-le au format .xlsx ou exportez-le en CSV.',
    );
  }
  const sheet = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (r) => {
    const values: string[] = [];
    for (let c = 1; c <= sheet.actualColumnCount; c++) values.push(cellText(r.getCell(c).value).trim());
    rows.push(values);
  });
  return rows;
}

export async function parseSpreadsheet(buffer: Buffer, ext: 'csv' | 'xlsx'): Promise<string[][]> {
  if (ext === 'xlsx') return parseXlsx(buffer);
  const utf8 = buffer.toString('utf8');
  // Fichiers Excel « CSV » souvent encodés en Windows-1252.
  const text = utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8;
  return parseCsv(text);
}
