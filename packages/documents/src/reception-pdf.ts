/**
 * Procès-verbal de réception (03 §5, P10) : provisoire avec réserves, ou définitif ; signé à
 * l'écran par le client. Et l'avis de libération de la retenue de garantie.
 */
import { formatEuros } from '@batimint/domain';
import {
  CONTENT_WIDTH,
  createPdf,
  formatDateFr,
  formatDateTimeFr,
  INK,
  LINE,
  MUTED,
  PAGE,
  type Pdf,
  renderToBuffer,
  safeAccent,
  SOFT,
} from './pdf';

const t = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

interface Party {
  name: string;
  lines: string[];
}

function header(doc: Pdf, tenant: Party & { brandColor?: string | null }, title: string, subtitle: string) {
  const accent = safeAccent(tenant.brandColor);
  let y: number = PAGE.margin;
  doc.font('bold').fontSize(16).fillColor(INK).text(tenant.name, PAGE.margin, y, { width: 260 });
  doc.font('regular').fontSize(9).fillColor(MUTED);
  let ly: number = y;
  for (const l of tenant.lines) {
    doc.text(l, PAGE.margin + 260, ly, { width: CONTENT_WIDTH - 260, align: 'right' });
    ly = doc.y;
  }
  y = Math.max(doc.y, PAGE.margin + 50) + 18;
  doc.rect(PAGE.margin, y, 4, 34).fill(accent);
  doc
    .font('bold')
    .fontSize(18)
    .fillColor(INK)
    .text(title, PAGE.margin + 14, y);
  doc
    .font('regular')
    .fontSize(10)
    .fillColor(MUTED)
    .text(subtitle, PAGE.margin + 14, doc.y + 2);
  return doc.y + 16;
}

function label(doc: Pdf, y: number, text: string) {
  doc.font('semibold').fontSize(7.5).fillColor(MUTED).text(text.toUpperCase(), PAGE.margin, y, {
    characterSpacing: 0.6,
  });
  return doc.y + 4;
}

function room(doc: Pdf, y: number, needed: number) {
  if (y + needed > PAGE.height - PAGE.margin) {
    doc.addPage();
    return PAGE.margin;
  }
  return y;
}

export interface ReceptionPdfInput {
  tenant: Party & { brandColor?: string | null };
  customer: Party;
  kind: 'provisional' | 'final';
  number: string;
  receptionDate: Date;
  project: { number: string; name: string; address: string | null };
  attendees: string | null;
  notes: string | null;
  reserves: { description: string; location: string | null; post: string | null }[];
  plannedFinalDate: Date | null;
  retentionAmount: bigint | null;
  signature: { signerName: string; signedAt: Date; ip: string | null } | null;
}

export function renderReceptionPdf(input: ReceptionPdfInput): Promise<Buffer> {
  const title =
    input.kind === 'provisional'
      ? 'Procès-verbal de réception provisoire'
      : 'Procès-verbal de réception définitive';
  const doc = createPdf({
    title: `${title} ${input.number}`,
    author: input.tenant.name,
    createdAt: input.signature?.signedAt ?? input.receptionDate,
  });
  let y = header(
    doc,
    input.tenant,
    title,
    `${input.number} · ${formatDateFr(input.receptionDate)} · ${input.project.number} — ${input.project.name}`,
  );
  const colW = (CONTENT_WIDTH - 20) / 2;
  const col = (x: number, heading: string, p: Party) => {
    doc.font('semibold').fontSize(7.5).fillColor(MUTED).text(heading, x, y, { characterSpacing: 0.6 });
    doc
      .font('semibold')
      .fontSize(9.5)
      .fillColor(INK)
      .text(p.name, x, doc.y + 2, { width: colW });
    doc.font('regular').fontSize(9);
    for (const l of p.lines) doc.text(l, x, doc.y, { width: colW });
    return doc.y;
  };
  const a = col(PAGE.margin, 'MAÎTRE D’OUVRAGE', input.customer);
  const b = col(PAGE.margin + colW + 20, 'ENTREPRENEUR', input.tenant);
  y = Math.max(a, b) + 14;
  y = label(doc, y, 'Ouvrage');
  doc
    .font('regular')
    .fontSize(9.5)
    .fillColor(INK)
    .text(
      `${input.project.name}${input.project.address ? ` — ${input.project.address}` : ''}`,
      PAGE.margin,
      y,
      {
        width: CONTENT_WIDTH,
      },
    );
  if (input.attendees) doc.text(`Présents : ${input.attendees}`, { width: CONTENT_WIDTH });
  y = doc.y + 12;
  doc.font('regular').fontSize(9.5).fillColor(INK);
  const statement =
    input.kind === 'provisional'
      ? input.reserves.length
        ? `Le maître d’ouvrage accepte la réception provisoire des travaux, sous les ${input.reserves.length} réserves ci-dessous, que l’entrepreneur s’engage à lever.`
        : 'Le maître d’ouvrage accepte la réception provisoire des travaux, sans réserve.'
      : 'Le maître d’ouvrage accepte la réception définitive des travaux. Les réserves de la réception provisoire sont levées.';
  doc.text(statement, PAGE.margin, y, { width: CONTENT_WIDTH, align: 'justify' });
  y = doc.y + 12;
  if (input.kind === 'provisional' && input.reserves.length) {
    y = label(doc, y, 'Réserves');
    input.reserves.forEach((r, k) => {
      const text = `${k + 1}. ${r.description}${r.location ? ` (${r.location})` : ''}${r.post ? ` — poste ${r.post}` : ''}`;
      doc.font('regular').fontSize(9.5);
      const h = doc.heightOfString(text, { width: CONTENT_WIDTH - 12 }) + 8;
      y = room(doc, y, h);
      doc.fillColor(INK).text(text, PAGE.margin + 6, y, { width: CONTENT_WIDTH - 12 });
      y += h;
      doc
        .moveTo(PAGE.margin, y - 4)
        .lineTo(PAGE.margin + CONTENT_WIDTH, y - 4)
        .lineWidth(0.5)
        .strokeColor(LINE)
        .stroke();
    });
    y += 6;
  }
  if (input.notes) {
    y = room(doc, y, 40);
    y = label(doc, y, 'Remarques');
    doc
      .font('regular')
      .fontSize(9.5)
      .fillColor(INK)
      .text(input.notes, PAGE.margin, y, { width: CONTENT_WIDTH });
    y = doc.y + 12;
  }
  y = room(doc, y, 60);
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 44).fill(SOFT);
  doc.font('regular').fontSize(9).fillColor(INK);
  const guarantee =
    input.kind === 'provisional'
      ? `La réception provisoire ouvre le délai de garantie${
          input.plannedFinalDate
            ? ` ; la réception définitive est prévue le ${formatDateFr(input.plannedFinalDate)}`
            : ''
        }.${input.retentionAmount ? ` La retenue de garantie (${t(formatEuros(input.retentionAmount))}) est libérée à la réception définitive.` : ''}`
      : `La réception définitive met fin au délai de garantie contractuel.${
          input.retentionAmount
            ? ` La retenue de garantie (${t(formatEuros(input.retentionAmount))}) est libérée.`
            : ''
        }`;
  doc.text(guarantee, PAGE.margin + 10, y + 10, { width: CONTENT_WIDTH - 20 });
  y += 58;
  y = room(doc, y, 70);
  doc
    .font('semibold')
    .fontSize(10)
    .fillColor(input.signature ? INK : MUTED)
    .text(
      input.signature
        ? `Signé par ${input.signature.signerName} le ${formatDateTimeFr(input.signature.signedAt)}.`
        : 'Nom et signature du maître d’ouvrage.',
      PAGE.margin,
      y,
      { width: CONTENT_WIDTH },
    );
  if (input.signature)
    doc
      .font('regular')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(
        `Preuve conservée : horodatage, adresse IP ${input.signature.ip ?? '—'}, appareil et empreinte SHA-256 du document.`,
        { width: CONTENT_WIDTH },
      );
  return renderToBuffer(doc);
}

export interface RetentionReleasePdfInput {
  tenant: Party & { brandColor?: string | null; iban: string | null };
  customer: Party;
  project: { number: string; name: string };
  date: Date;
  dueDate: Date;
  invoices: { number: string; issueDate: Date | null; amount: bigint; communication: string | null }[];
  total: bigint;
}

/** Avis de libération de la retenue de garantie (la retenue devient payable, échéance propre). */
export function renderRetentionReleasePdf(input: RetentionReleasePdfInput): Promise<Buffer> {
  const title = 'Libération de la retenue de garantie';
  const doc = createPdf({ title, author: input.tenant.name, createdAt: input.date });
  let y = header(
    doc,
    input.tenant,
    title,
    `${formatDateFr(input.date)} · ${input.project.number} — ${input.project.name}`,
  );
  doc
    .font('regular')
    .fontSize(9.5)
    .fillColor(INK)
    .text(
      `La réception définitive a été signée. Les retenues de garantie suivantes deviennent payables au plus tard le ${formatDateFr(input.dueDate)}${
        input.tenant.iban ? `, sur le compte ${input.tenant.iban}` : ''
      }, avec la communication structurée de chaque facture.`,
      PAGE.margin,
      y,
      { width: CONTENT_WIDTH, align: 'justify' },
    );
  y = doc.y + 12;
  y = label(doc, y, 'Factures');
  for (const i of input.invoices) {
    doc.font('regular').fontSize(9.5).fillColor(INK);
    doc.text(
      `Facture ${i.number}${i.issueDate ? ` du ${formatDateFr(i.issueDate)}` : ''}${i.communication ? ` · ${i.communication}` : ''}`,
      PAGE.margin,
      y,
      { width: CONTENT_WIDTH - 120 },
    );
    doc.text(t(formatEuros(i.amount)), PAGE.margin + CONTENT_WIDTH - 120, y, { width: 120, align: 'right' });
    y = doc.y + 6;
    doc
      .moveTo(PAGE.margin, y - 3)
      .lineTo(PAGE.margin + CONTENT_WIDTH, y - 3)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
  }
  doc
    .font('bold')
    .fontSize(11)
    .fillColor(INK)
    .text(t(`Total à payer ${formatEuros(input.total)}`), PAGE.margin, y + 6, {
      width: CONTENT_WIDTH,
      align: 'right',
    });
  return renderToBuffer(doc);
}
