/**
 * Exports tabulaires (03 §12 « Exports CSV et Excel de chaque liste ») : un même descriptif de
 * colonnes produit un CSV pour Excel belge (UTF-8 avec BOM, point-virgule, virgule décimale) ou un
 * classeur .xlsx (montants en euros formatés, en-tête figé).
 */
import { centsToDecimalString } from '@batimint/domain';
import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';

export type ColumnType = 'text' | 'money' | 'number' | 'date' | 'percent' | 'hours';

export interface Column<R> {
  label: string;
  type?: ColumnType;
  value: (row: R) => string | number | bigint | null | undefined;
}

export interface Table<R> {
  /** Nom de fichier sans extension. */
  filename: string;
  sheet: string;
  columns: Column<R>[];
  rows: readonly R[];
}

/** Centimes → euros pour les cellules Excel (affichage ; le CSV reste exact). */
const euros = (v: number | bigint) => Number(v) / 100;

function cell<R>(c: Column<R>, row: R): string | number | Date | null {
  const v = c.value(row);
  if (v === null || v === undefined || v === '') return null;
  switch (c.type ?? 'text') {
    case 'money':
      return euros(typeof v === 'string' ? BigInt(v) : v);
    case 'number':
      return Number(v);
    case 'percent':
      return Number(v);
    case 'hours':
      return Math.round((Number(v) / 60) * 100) / 100;
    case 'date':
      return String(v).slice(0, 10);
    default:
      return String(v);
  }
}

const csvEscape = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function csvValue<R>(c: Column<R>, row: R): string {
  if (c.type === 'money') {
    // Montant exact depuis les centimes (pas d'arrondi flottant dans le fichier).
    const raw = c.value(row);
    if (raw === null || raw === undefined || raw === '') return '';
    return centsToDecimalString(BigInt(raw)).replace('.', ',');
  }
  const v = cell(c, row);
  if (v === null) return '';
  if (typeof v === 'number') {
    const decimals = c.type === 'hours' ? 2 : c.type === 'percent' ? 4 : undefined;
    return (decimals === undefined ? String(v) : v.toFixed(decimals)).replace('.', ',');
  }
  return csvEscape(String(v));
}

export function toCsv<R>(t: Table<R>): string {
  const lines = [
    t.columns.map((c) => csvEscape(c.label)).join(';'),
    ...t.rows.map((r) => t.columns.map((c) => csvValue(c, r)).join(';')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export async function toXlsx<R>(t: Table<R>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Batimint';
  const ws = wb.addWorksheet(t.sheet.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = t.columns.map((c) => ({
    header: c.label,
    width: Math.min(Math.max(c.label.length + 4, c.type === 'text' || !c.type ? 24 : 14), 60),
    style:
      c.type === 'money'
        ? { numFmt: '#,##0.00 "€"' }
        : c.type === 'percent'
          ? { numFmt: '0.0%' }
          : c.type === 'hours'
            ? { numFmt: '0.00' }
            : {},
  }));
  ws.getRow(1).font = { bold: true };
  for (const r of t.rows) ws.addRow(t.columns.map((c) => cell(c, r)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function sendTable<R>(reply: FastifyReply, t: Table<R>, format: 'csv' | 'xlsx') {
  if (format === 'csv')
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${t.filename}.csv"`)
      .send(toCsv(t));
  return reply
    .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('content-disposition', `attachment; filename="${t.filename}.xlsx"`)
    .send(await toXlsx(t));
}
