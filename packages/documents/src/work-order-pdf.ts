/**
 * Bon de régie (02 P4.5) : travaux hors devis constatés et signés par le client sur le chantier.
 * Pas de prix : les heures et le matériel sont valorisés au moment de la facture de régie (M8).
 */
import { formatQuantity } from '@batimint/domain';
import {
  CONTENT_WIDTH,
  createPdf,
  formatDateFr,
  formatDateTimeFr,
  INK,
  LINE,
  MUTED,
  PAGE,
  renderToBuffer,
  safeAccent,
  SOFT,
} from './pdf';

export interface WorkOrderPdfInput {
  tenant: { name: string; lines: string[]; brandColor?: string | null };
  customer: { name: string };
  site: string | null;
  projectRef: string;
  workOrder: {
    number: string | null;
    day: Date;
    description: string;
    lines: { kind: 'labour' | 'material'; description: string; quantity: string; unit: string }[];
  };
  signature?: { signerName: string; signedAt: Date; ip: string | null } | null;
}

const t = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

export function renderWorkOrderPdf(input: WorkOrderPdfInput): Promise<Buffer> {
  const accent = safeAccent(input.tenant.brandColor);
  const title = `Bon de régie${input.workOrder.number ? ` ${input.workOrder.number}` : ''}`;
  const doc = createPdf({
    title,
    author: input.tenant.name,
    createdAt: input.signature?.signedAt ?? input.workOrder.day,
  });
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
    .text(`${input.projectRef} · ${formatDateFr(input.workOrder.day)}`, PAGE.margin + 14, doc.y + 2);
  y = doc.y + 16;
  doc
    .font('semibold')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text('CLIENT', PAGE.margin, y, { characterSpacing: 0.6 });
  doc.font('regular').fontSize(9).fillColor(INK).text(input.customer.name);
  if (input.site) doc.text(input.site);
  y = doc.y + 14;
  doc.font('semibold').fontSize(10).fillColor(INK).text('Travaux réalisés', PAGE.margin, y);
  doc
    .font('regular')
    .fontSize(9.5)
    .text(input.workOrder.description, PAGE.margin, doc.y + 4, { width: CONTENT_WIDTH });
  y = doc.y + 14;
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 18).fill(SOFT);
  doc.font('semibold').fontSize(7.5).fillColor(MUTED);
  doc.text('NATURE', PAGE.margin + 6, y + 6, { width: 80 });
  doc.text('DÉSIGNATION', PAGE.margin + 90, y + 6, { width: 300 });
  doc.text('QUANTITÉ', PAGE.margin + CONTENT_WIDTH - 110, y + 6, { width: 104, align: 'right' });
  y += 24;
  for (const l of input.workOrder.lines) {
    doc.font('regular').fontSize(9).fillColor(INK);
    const h = Math.max(doc.heightOfString(l.description, { width: 300 }), 11) + 8;
    doc.text(l.kind === 'labour' ? 'Main-d’œuvre' : 'Matériel', PAGE.margin + 6, y, { width: 80 });
    doc.text(l.description, PAGE.margin + 90, y, { width: 300 });
    doc.text(t(`${formatQuantity(l.quantity)} ${l.unit}`), PAGE.margin + CONTENT_WIDTH - 110, y, {
      width: 104,
      align: 'right',
    });
    y += h;
    doc
      .moveTo(PAGE.margin, y - 4)
      .lineTo(PAGE.margin + CONTENT_WIDTH, y - 4)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
  }
  y += 16;
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 64).lineWidth(0.8).strokeColor(LINE).stroke();
  doc
    .font('semibold')
    .fontSize(9)
    .fillColor(INK)
    .text('Pour accord du client', PAGE.margin + 10, y + 10);
  doc
    .font('regular')
    .fontSize(8.5)
    .fillColor(input.signature ? INK : MUTED);
  doc.text(
    input.signature
      ? `Signé sur le chantier par ${input.signature.signerName} le ${formatDateTimeFr(input.signature.signedAt)}.`
      : 'Nom et signature du client.',
    PAGE.margin + 10,
    y + 26,
    { width: CONTENT_WIDTH - 20 },
  );
  if (input.signature)
    doc
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `Preuve conservée : horodatage, adresse IP ${input.signature.ip ?? '—'}, appareil et empreinte SHA-256 du document.`,
        { width: CONTENT_WIDTH - 20 },
      );
  return renderToBuffer(doc);
}
