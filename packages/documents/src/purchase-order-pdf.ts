/**
 * Bon de commande fournisseur (03 §8, 02 P3.3) : numéro BC à reporter sur la facture (c'est la
 * clé du rapprochement automatique), adresse de livraison du chantier, lignes et total HTVA.
 */
import { formatEuros, formatQuantity, lineTotal } from '@batimint/domain';
import {
  CONTENT_WIDTH,
  createPdf,
  formatDateFr,
  INK,
  LINE,
  MUTED,
  PAGE,
  renderToBuffer,
  safeAccent,
  SOFT,
} from './pdf';

export interface PurchaseOrderPdfInput {
  tenant: { name: string; lines: string[]; brandColor?: string | null };
  supplier: { name: string; lines: string[] };
  number: string;
  date: Date;
  projectRef: string;
  deliveryAddress: string | null;
  expectedOn: Date | null;
  notes: string | null;
  lines: {
    description: string;
    supplierCode: string | null;
    unit: string;
    quantity: string;
    unitPrice: bigint;
  }[];
  totalNet: bigint;
}

const t = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

export function renderPurchaseOrderPdf(input: PurchaseOrderPdfInput): Promise<Buffer> {
  const accent = safeAccent(input.tenant.brandColor);
  const title = `Bon de commande ${input.number}`;
  const doc = createPdf({ title, author: input.tenant.name, createdAt: input.date });
  let y: number = PAGE.margin;
  doc.font('bold').fontSize(16).fillColor(INK).text(input.tenant.name, PAGE.margin, y, { width: 260 });
  doc.font('regular').fontSize(9).fillColor(MUTED);
  let ly: number = y;
  for (const l of input.tenant.lines) {
    doc.text(l, PAGE.margin + 260, ly, { width: CONTENT_WIDTH - 260, align: 'right' });
    ly = doc.y;
  }
  y = Math.max(doc.y, PAGE.margin + 50) + 18;
  doc.rect(PAGE.margin, y, 4, 34).fill(accent);
  doc
    .font('bold')
    .fontSize(20)
    .fillColor(INK)
    .text(title, PAGE.margin + 14, y);
  doc
    .font('regular')
    .fontSize(10)
    .fillColor(MUTED)
    .text(`${formatDateFr(input.date)} · ${input.projectRef}`, PAGE.margin + 14, doc.y + 2);
  y = doc.y + 16;
  const colW = (CONTENT_WIDTH - 20) / 2;
  doc
    .font('semibold')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text('FOURNISSEUR', PAGE.margin, y, { characterSpacing: 0.6 });
  doc
    .font('regular')
    .fontSize(9)
    .fillColor(INK)
    .text(input.supplier.name, PAGE.margin, doc.y, { width: colW });
  for (const l of input.supplier.lines) doc.text(l, { width: colW });
  const leftEnd = doc.y;
  doc
    .font('semibold')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text('LIVRAISON', PAGE.margin + colW + 20, y, { characterSpacing: 0.6 });
  doc
    .font('regular')
    .fontSize(9)
    .fillColor(INK)
    .text(input.deliveryAddress ?? 'À convenir', PAGE.margin + colW + 20, doc.y, { width: colW });
  if (input.expectedOn) doc.text(`Souhaitée le ${formatDateFr(input.expectedOn)}`, { width: colW });
  y = Math.max(leftEnd, doc.y) + 14;
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 18).fill(SOFT);
  doc.font('semibold').fontSize(7.5).fillColor(MUTED);
  doc.text('DÉSIGNATION', PAGE.margin + 6, y + 6, { width: 250 });
  doc.text('QUANTITÉ', PAGE.margin + 270, y + 6, { width: 80, align: 'right' });
  doc.text('PRIX UNIT.', PAGE.margin + 355, y + 6, { width: 70, align: 'right' });
  doc.text('TOTAL HTVA', PAGE.margin + CONTENT_WIDTH - 90, y + 6, { width: 84, align: 'right' });
  y += 24;
  for (const l of input.lines) {
    const label = l.supplierCode ? `${l.description} (réf. ${l.supplierCode})` : l.description;
    doc.font('regular').fontSize(9).fillColor(INK);
    const h = Math.max(doc.heightOfString(label, { width: 250 }), 11) + 8;
    if (y + h > PAGE.height - PAGE.margin - 60) {
      doc.addPage();
      y = PAGE.margin;
    }
    const total = lineTotal(l.quantity, l.unitPrice);
    doc.text(label, PAGE.margin + 6, y, { width: 250 });
    doc.text(t(`${formatQuantity(l.quantity)} ${l.unit}`), PAGE.margin + 270, y, {
      width: 80,
      align: 'right',
    });
    doc.text(t(formatEuros(l.unitPrice)), PAGE.margin + 355, y, { width: 70, align: 'right' });
    doc.text(t(formatEuros(total)), PAGE.margin + CONTENT_WIDTH - 90, y, { width: 84, align: 'right' });
    y += h;
    doc
      .moveTo(PAGE.margin, y - 4)
      .lineTo(PAGE.margin + CONTENT_WIDTH, y - 4)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
  }
  y += 6;
  doc
    .font('bold')
    .fontSize(11)
    .fillColor(INK)
    .text(t(`Total HTVA ${formatEuros(input.totalNet)}`), PAGE.margin, y, {
      width: CONTENT_WIDTH,
      align: 'right',
    });
  y = doc.y + 18;
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 40).fill(SOFT);
  doc
    .font('semibold')
    .fontSize(9)
    .fillColor(INK)
    .text(
      `Merci de reporter le numéro ${input.number} sur votre facture (référence d'achat Peppol).`,
      PAGE.margin + 10,
      y + 10,
      {
        width: CONTENT_WIDTH - 20,
      },
    );
  if (input.notes)
    doc
      .font('regular')
      .fontSize(9)
      .fillColor(MUTED)
      .text(input.notes, PAGE.margin, y + 52, { width: CONTENT_WIDTH });
  return renderToBuffer(doc);
}
