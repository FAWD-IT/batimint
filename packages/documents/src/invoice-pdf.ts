/**
 * PDF des factures et notes de crédit (05 §2, §5) : mentions obligatoires, TVA par taux, retenue
 * de garantie, QR code de virement EPC et communication structurée. Les totaux viennent de
 * `computeDocumentTotals`, comme l'écran et l'UBL.
 */
import {
  computeDocumentTotals,
  epcQrPayload,
  formatEuros,
  formatQuantity,
  formatStructuredCommunication,
  VAT_REGIMES,
} from '@batimint/domain';
import QRCode from 'qrcode';
import type { InvoiceDocumentInput } from './invoice-ubl';
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

export interface InvoicePdfInput extends InvoiceDocumentInput {
  /** Libellé du document (« Facture », « Facture d'acompte », « Note de crédit »…). */
  documentLabel: string;
  brandColor?: string | null;
  logo?: Uint8Array | null;
  retention?: { percent: string; amount: bigint } | null;
  /** Coordonnées complètes du vendeur pour le pied de page. */
  sellerFooter: string[];
}

const t = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const eur = (v: bigint) => t(formatEuros(v));
const day = (iso: string) => formatDateFr(new Date(`${iso}T12:00:00Z`));

function vatLabel(regime: string): string {
  const info = VAT_REGIMES[regime as keyof typeof VAT_REGIMES];
  if (!info) return '';
  return info.category === 'AE' ? 'AL' : `${info.ratePercent} %`;
}

const partyLines = (p: InvoiceDocumentInput['buyer']) =>
  [
    p.street,
    [p.postalCode, p.city].filter(Boolean).join(' '),
    p.vatNumber ? `TVA ${p.vatNumber}` : null,
  ].filter((x): x is string => Boolean(x));

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const accent = safeAccent(input.brandColor);
  const totals = computeDocumentTotals(input.lines);
  const credit = input.kind === 'credit_note';
  const title = `${input.documentLabel} ${input.number}`;
  const doc = createPdf({
    title: `${title} — ${input.title}`,
    author: input.seller.name,
    createdAt: new Date(`${input.issueDate}T12:00:00Z`),
  });

  // --- En-tête ---
  let y: number = PAGE.margin;
  let drewLogo = false;
  if (input.logo) {
    try {
      doc.image(Buffer.from(input.logo), PAGE.margin, y, { fit: [150, 48] });
      drewLogo = true;
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo)
    doc.font('bold').fontSize(16).fillColor(INK).text(input.seller.name, PAGE.margin, y, { width: 240 });
  doc
    .font('semibold')
    .fontSize(9)
    .fillColor(INK)
    .text(input.seller.name, PAGE.margin + 260, y, { width: CONTENT_WIDTH - 260, align: 'right' });
  doc.font('regular').fillColor(MUTED);
  for (const l of [...partyLines(input.seller), input.seller.email].filter((x): x is string => Boolean(x)))
    doc.text(l, { width: CONTENT_WIDTH - 260, align: 'right' });
  y = Math.max(doc.y, PAGE.margin + 56) + 18;

  doc.rect(PAGE.margin, y, 4, 34).fill(accent);
  doc
    .font('bold')
    .fontSize(20)
    .fillColor(INK)
    .text(title, PAGE.margin + 14, y, { width: CONTENT_WIDTH - 14 });
  doc
    .font('regular')
    .fontSize(10)
    .fillColor(MUTED)
    .text(input.title, PAGE.margin + 14, doc.y + 2, { width: CONTENT_WIDTH - 14 });
  y = doc.y + 16;

  // --- Client et références ---
  const colW = (CONTENT_WIDTH - 24) / 2;
  doc
    .font('semibold')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text('CLIENT', PAGE.margin, y, { characterSpacing: 0.6 });
  doc
    .font('semibold')
    .fontSize(10)
    .fillColor(INK)
    .text(input.buyer.name, PAGE.margin, doc.y + 2, { width: colW });
  doc.font('regular').fontSize(9);
  for (const l of partyLines(input.buyer)) doc.text(l, { width: colW });
  const leftEnd = doc.y;
  const facts: [string, string][] = [
    ['Date', day(input.issueDate)],
    ...(input.dueDate && !credit ? ([['Échéance', day(input.dueDate)]] as [string, string][]) : []),
    ...(input.servicePeriod?.start && input.servicePeriod.end
      ? ([['Période', `${day(input.servicePeriod.start)} – ${day(input.servicePeriod.end)}`]] as [
          string,
          string,
        ][])
      : []),
    ['Référence', input.buyerReference],
    ...(input.billingReference
      ? ([['Facture corrigée', input.billingReference.number]] as [string, string][])
      : []),
    ...(input.deliveryAddress
      ? ([
          [
            'Chantier',
            `${input.deliveryAddress.street}, ${input.deliveryAddress.postalCode} ${input.deliveryAddress.city}`,
          ],
        ] as [string, string][])
      : []),
  ];
  let fy = y;
  for (const [k, v] of facts) {
    doc
      .font('regular')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(k, PAGE.margin + colW + 24, fy, { width: 80 });
    doc
      .font('regular')
      .fontSize(9)
      .fillColor(INK)
      .text(v, PAGE.margin + colW + 104, fy, { width: colW - 80 });
    fy = doc.y + 3;
  }
  y = Math.max(leftEnd, fy) + 16;

  // --- Lignes ---
  const cols = { desc: 236, qty: 70, price: 72, vat: 38 };
  const header = () => {
    doc.rect(PAGE.margin, y, CONTENT_WIDTH, 18).fill(SOFT);
    doc.font('semibold').fontSize(7.5).fillColor(MUTED);
    let x = PAGE.margin + 6;
    doc.text('DÉSIGNATION', x, y + 6, { width: cols.desc });
    x += cols.desc;
    doc.text('QUANTITÉ', x, y + 6, { width: cols.qty, align: 'right' });
    x += cols.qty;
    doc.text('PRIX UNIT.', x, y + 6, { width: cols.price, align: 'right' });
    x += cols.price;
    doc.text('TVA', x, y + 6, { width: cols.vat, align: 'right' });
    doc.text('TOTAL HTVA', PAGE.margin + CONTENT_WIDTH - 86, y + 6, { width: 80, align: 'right' });
    y += 24;
  };
  header();
  input.lines.forEach((l, i) => {
    doc.font('regular').fontSize(9).fillColor(INK);
    const h = Math.max(doc.heightOfString(l.description, { width: cols.desc }), 11) + 8;
    if (y + h > PAGE.height - PAGE.margin - 70) {
      doc.addPage();
      y = PAGE.margin;
      header();
    }
    let x = PAGE.margin + 6;
    doc.text(l.description, x, y, { width: cols.desc });
    x += cols.desc;
    doc.text(t(`${formatQuantity(l.quantity)} ${l.unit}`), x, y, { width: cols.qty, align: 'right' });
    x += cols.qty;
    doc.text(eur(l.unitPrice), x, y, { width: cols.price, align: 'right' });
    x += cols.price;
    doc.text(vatLabel(l.vatRegime), x, y, { width: cols.vat, align: 'right' });
    doc.text(eur(totals.lines[i]!.netAmount), PAGE.margin + CONTENT_WIDTH - 86, y, {
      width: 80,
      align: 'right',
    });
    y += h;
    doc
      .moveTo(PAGE.margin, y - 4)
      .lineTo(PAGE.margin + CONTENT_WIDTH, y - 4)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
  });

  // --- TVA et totaux ---
  if (y > PAGE.height - PAGE.margin - 260) {
    doc.addPage();
    y = PAGE.margin;
  }
  y += 8;
  const right = PAGE.margin + CONTENT_WIDTH - 230;
  const row = (label: string, value: string, bold = false) => {
    doc
      .font(bold ? 'bold' : 'regular')
      .fontSize(bold ? 11 : 9)
      .fillColor(INK)
      .text(label, right, y, { width: 140 });
    doc.text(value, right + 140, y, { width: 90, align: 'right' });
    y = doc.y + 4;
  };
  const ty = y;
  row('Total HTVA', eur(totals.totalNet));
  for (const v of totals.vatBreakdown)
    row(
      v.regimes.some((r) => VAT_REGIMES[r].category === 'AE')
        ? `Autoliquidation (base ${eur(v.taxableAmount)})`
        : `TVA ${v.ratePercent} % sur ${eur(v.taxableAmount)}`,
      eur(v.taxAmount),
    );
  row(credit ? 'Total à créditer TVAC' : 'Total TVAC', eur(totals.totalGross), true);
  if (input.retention && input.retention.amount > 0n && !credit) {
    row(
      `Retenue de garantie ${input.retention.percent.replace('.', ',')} %`,
      `− ${eur(input.retention.amount)}`,
    );
    row('À payer', eur(totals.totalGross - input.retention.amount), true);
  }
  const totalsEnd = y;

  // Mentions à gauche des totaux.
  let my = ty;
  for (const n of input.notes) {
    doc
      .font('regular')
      .fontSize(8)
      .fillColor(MUTED)
      .text(n, PAGE.margin, my, { width: CONTENT_WIDTH - 250 });
    my = doc.y + 4;
  }
  y = Math.max(totalsEnd, my) + 16;

  // --- Paiement : QR EPC + communication structurée ---
  const due = totals.totalGross - (input.retention?.amount ?? 0n);
  if (!credit && input.seller.iban && due > 0n) {
    if (y > PAGE.height - PAGE.margin - 130) {
      doc.addPage();
      y = PAGE.margin;
    }
    const comm = input.paymentReference ? formatStructuredCommunication(input.paymentReference) : null;
    doc.rect(PAGE.margin, y, CONTENT_WIDTH, 112).fill(SOFT);
    const qr = await QRCode.toBuffer(
      epcQrPayload({
        name: input.seller.name,
        iban: input.seller.iban,
        bic: input.seller.bic,
        amount: due,
        remittance: comm ?? input.number,
      }),
      { errorCorrectionLevel: 'M', margin: 1, width: 240 },
    );
    doc.image(qr, PAGE.margin + 10, y + 8, { width: 96 });
    const px = PAGE.margin + 124;
    doc
      .font('semibold')
      .fontSize(10)
      .fillColor(INK)
      .text('Paiement par virement', px, y + 12);
    doc.font('regular').fontSize(9).fillColor(INK);
    doc.text(`Montant : ${eur(due)}`, px, doc.y + 4);
    doc.text(
      t(
        `IBAN : ${input.seller.iban.replace(/(.{4})/g, '$1 ').trim()}${input.seller.bic ? ` · BIC : ${input.seller.bic}` : ''}`,
      ),
    );
    if (comm) doc.font('semibold').text(`Communication structurée : ${comm}`);
    if (input.dueDate) doc.font('regular').text(`À payer au plus tard le ${day(input.dueDate)}.`);
    doc
      .font('regular')
      .fontSize(8)
      .fillColor(MUTED)
      .text('Scannez le QR code avec votre application bancaire.', px, doc.y + 4);
    y += 124;
  }
  if (input.paymentTerms) {
    doc
      .font('regular')
      .fontSize(8)
      .fillColor(MUTED)
      .text(input.paymentTerms, PAGE.margin, y, { width: CONTENT_WIDTH });
  }

  // --- Pied de page sur chaque page ---
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Le pied de page vit dans la marge basse : pas de saut de page automatique.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('regular')
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `${input.sellerFooter.join(' · ')} — page ${i - range.start + 1}/${range.count}`,
        PAGE.margin,
        PAGE.height - PAGE.margin + 10,
        { width: CONTENT_WIDTH, align: 'center', lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }
  return renderToBuffer(doc);
}
