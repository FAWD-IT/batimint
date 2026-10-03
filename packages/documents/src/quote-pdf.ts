/**
 * PDF du devis (03 §4) : aux couleurs du tenant, postes et lignes, options, TVA par taux,
 * acompte, échéancier, mentions légales (autoliquidation, 6 %), bloc de signature et CGV en
 * annexe. Les totaux viennent de `computeQuote` : écran, portail et PDF sont identiques.
 */
import {
  computeQuote,
  dec,
  formatEuros,
  formatPercent,
  formatQuantity,
  isSectionIncluded,
  type QuoteInput,
  type QuoteSectionInput,
  VAT_REGIMES,
} from '@batimint/domain';
import { type DocumentLabels, LABELS } from './labels';
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

export interface PartyBlock {
  name: string;
  lines: string[];
}

export interface QuotePdfInput {
  locale?: 'fr';
  tenant: PartyBlock & {
    brandColor?: string | null;
    logo?: Uint8Array | null;
    iban?: string | null;
    bic?: string | null;
    termsAndConditions?: string | null;
    legalMentions?: string | null;
  };
  customer: PartyBlock;
  siteAddress?: string | null;
  quote: {
    number: string | null;
    title: string;
    version: number;
    date: Date;
    validUntil: Date | null;
    intro?: string | null;
    notes?: string | null;
    paymentSchedule?: { label: string; percent: string }[];
  };
  content: QuoteInput & { sections: (QuoteSectionInput & { description?: string | null })[] };
  signature?: { signerName: string; signedAt: Date; ip: string | null } | null;
  certificate?: { signedAt: Date } | null;
  /** Titre et sous-titre imposés (avenant) ; par défaut « Devis D… » et « titre · version n ». */
  heading?: { title: string; subtitle: string } | null;
}

const COLS = {
  desc: 206,
  qty: 64,
  price: 74,
  disc: 46,
  vat: 38,
  total: CONTENT_WIDTH - 206 - 64 - 74 - 46 - 38,
};

/** Geist n'a pas les espaces fines insécables utilisées par le formatage belge : espace simple. */
const t = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
const eur = (v: bigint) => t(formatEuros(v));

function vatLabel(regime: string): string {
  const info = VAT_REGIMES[regime as keyof typeof VAT_REGIMES];
  if (!info) return '';
  if (info.category === 'AE') return 'AL';
  return `${info.ratePercent} %`;
}

export async function renderQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  const L: DocumentLabels = LABELS[input.locale ?? 'fr'];
  const accent = safeAccent(input.tenant.brandColor);
  const totals = computeQuote(input.content);
  const title = input.heading?.title ?? `${L.quote} ${input.quote.number ?? ''}`.trim();
  const doc = createPdf({
    title: `${title} — ${input.quote.title}`,
    author: input.tenant.name,
    createdAt: input.signature?.signedAt ?? input.quote.date,
  });

  // --- En-tête : logo ou nom, coordonnées de l'entreprise ---
  let y = PAGE.margin;
  if (input.tenant.logo) {
    try {
      doc.image(Buffer.from(input.tenant.logo), PAGE.margin, y, { fit: [150, 48] });
    } catch {
      doc.font('bold').fontSize(16).fillColor(INK).text(input.tenant.name, PAGE.margin, y, { width: 240 });
    }
  } else {
    doc.font('bold').fontSize(16).fillColor(INK).text(input.tenant.name, PAGE.margin, y, { width: 240 });
  }
  doc
    .font('semibold')
    .fontSize(9)
    .fillColor(INK)
    .text(input.tenant.name, PAGE.margin + 260, y, {
      width: CONTENT_WIDTH - 260,
      align: 'right',
    });
  doc.font('regular').fillColor(MUTED);
  for (const l of input.tenant.lines) doc.text(l, { width: CONTENT_WIDTH - 260, align: 'right' });
  y = Math.max(doc.y, PAGE.margin + 56) + 18;

  // --- Titre ---
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
    .text(
      input.heading?.subtitle ?? `${input.quote.title} · ${L.version} ${input.quote.version}`,
      PAGE.margin + 14,
      doc.y + 2,
      {
        width: CONTENT_WIDTH - 14,
      },
    );
  y = doc.y + 16;

  // --- Client, chantier, dates ---
  const colW = (CONTENT_WIDTH - 24) / 3;
  const block = (x: number, label: string, lines: string[]) => {
    doc
      .font('semibold')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(label.toUpperCase(), x, y, { width: colW, characterSpacing: 0.6 });
    doc.font('regular').fontSize(9).fillColor(INK);
    for (const l of lines) doc.text(l, x, doc.y + 1, { width: colW });
    return doc.y;
  };
  const bottoms = [
    block(PAGE.margin, L.customer, [input.customer.name, ...input.customer.lines]),
    block(PAGE.margin + colW + 12, L.site, input.siteAddress ? [input.siteAddress] : ['—']),
    block(PAGE.margin + (colW + 12) * 2, L.date, [
      formatDateFr(input.quote.date),
      ...(input.quote.validUntil ? [`${L.validUntil} ${formatDateFr(input.quote.validUntil)}`] : []),
    ]),
  ];
  y = Math.max(...bottoms) + 16;

  if (input.quote.intro) {
    doc
      .font('regular')
      .fontSize(9.5)
      .fillColor(INK)
      .text(input.quote.intro, PAGE.margin, y, { width: CONTENT_WIDTH });
    y = doc.y + 12;
  }

  // --- Tableau ---
  const bottomLimit = PAGE.height - PAGE.margin - PAGE.footer;
  const header = () => {
    doc.rect(PAGE.margin, y, CONTENT_WIDTH, 18).fill(SOFT);
    doc.font('semibold').fontSize(7.5).fillColor(MUTED);
    let x = PAGE.margin + 6;
    const cell = (t: string, w: number, align: 'left' | 'right') => {
      doc.text(t.toUpperCase(), x, y + 6, { width: w - 10, align, characterSpacing: 0.4 });
      x += w;
    };
    cell(L.description, COLS.desc, 'left');
    cell(L.quantity, COLS.qty, 'right');
    cell(L.unitPrice, COLS.price, 'right');
    cell(L.discount, COLS.disc, 'right');
    cell(L.vat, COLS.vat, 'right');
    cell(L.total, COLS.total, 'right');
    y += 22;
  };
  const ensure = (h: number, withHeader = true) => {
    if (y + h > bottomLimit) {
      doc.addPage();
      y = PAGE.margin;
      if (withHeader) header();
    }
  };
  header();

  const lineTotals = new Map(totals.lines.map((l) => [l.id, l]));
  const sectionTotals = new Map(totals.sections.map((s) => [s.id, s]));
  for (const section of input.content.sections) {
    const included = isSectionIncluded(section);
    const st = sectionTotals.get(section.id);
    ensure(40);
    doc
      .font('bold')
      .fontSize(10)
      .fillColor(INK)
      .text(section.title || '—', PAGE.margin + 6, y, { width: CONTENT_WIDTH - 140 });
    if (section.optional) {
      doc
        .font('semibold')
        .fontSize(7.5)
        .fillColor(included ? accent : MUTED)
        .text((included ? L.optionSelected : L.optionNotSelected).toUpperCase(), PAGE.margin + 6, doc.y + 1, {
          width: CONTENT_WIDTH - 12,
          characterSpacing: 0.4,
        });
    }
    if (section.description) {
      doc
        .font('regular')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(section.description, PAGE.margin + 6, doc.y + 1, {
          width: CONTENT_WIDTH - 12,
        });
    }
    y = doc.y + 6;
    for (const line of section.lines) {
      doc.font('regular').fontSize(9);
      const h = Math.max(doc.heightOfString(line.description || ' ', { width: COLS.desc - 10 }), 11) + 8;
      ensure(h);
      doc.font('regular').fontSize(9);
      const color = included ? INK : MUTED;
      doc.fillColor(color).text(line.description, PAGE.margin + 6, y, { width: COLS.desc - 10 });
      if (line.kind === 'item') {
        const lt = lineTotals.get(line.id);
        let x = PAGE.margin + 6 + COLS.desc;
        const cell = (t: string, w: number) => {
          doc.text(t, x, y, { width: w - 10, align: 'right' });
          x += w;
        };
        cell(t(`${formatQuantity(line.quantity)} ${line.unit}`), COLS.qty);
        cell(eur(line.unitPrice), COLS.price);
        cell(
          line.discountPercent && !dec(line.discountPercent).isZero()
            ? t(`${formatQuantity(line.discountPercent)} %`)
            : '',
          COLS.disc,
        );
        cell(vatLabel(line.vatRegime), COLS.vat);
        doc.font('semibold');
        cell(lt ? eur(lt.netAmount) : '', COLS.total);
      }
      y += h;
      doc
        .moveTo(PAGE.margin, y - 4)
        .lineTo(PAGE.margin + CONTENT_WIDTH, y - 4)
        .lineWidth(0.5)
        .strokeColor(LINE)
        .stroke();
    }
    if (st) {
      ensure(18);
      doc
        .font('semibold')
        .fontSize(9)
        .fillColor(included ? INK : MUTED)
        .text(`${section.optional ? L.option : L.subtotal} : ${eur(st.netAmount)}`, PAGE.margin, y, {
          width: CONTENT_WIDTH - 6,
          align: 'right',
        });
      y = doc.y + 12;
    }
  }

  // --- Totaux ---
  const rows: [string, string, boolean][] = [[L.totalNet, eur(totals.document.totalNet), false]];
  for (const v of totals.document.vatBreakdown) {
    rows.push([
      v.category === 'AE' ? L.reverseChargeLine : `${L.vatAt(v.ratePercent)} (${eur(v.taxableAmount)})`,
      eur(v.taxAmount),
      false,
    ]);
  }
  rows.push([L.totalGross, eur(totals.document.totalGross), true]);
  if (totals.depositAmount > 0n) rows.push([L.deposit, eur(totals.depositAmount), false]);
  ensure(rows.length * 16 + 20, false);
  const boxX = PAGE.margin + CONTENT_WIDTH - 230;
  for (const [label, value, strong] of rows) {
    if (strong) {
      doc.rect(boxX, y - 3, 230, 20).fill(INK);
      doc.font('bold').fontSize(10.5).fillColor('#FFFFFF');
      doc.text(label, boxX + 8, y + 2, { width: 120 });
      doc.text(value, boxX + 120, y + 2, { width: 102, align: 'right' });
      y += 24;
    } else {
      doc.font('regular').fontSize(9).fillColor(INK);
      doc.text(label, boxX + 8, y, { width: 150 });
      doc.text(value, boxX + 120, y, { width: 102, align: 'right' });
      y += 16;
    }
  }
  y += 6;

  const mentions: string[] = [];
  if (totals.document.hasReverseCharge) mentions.push(L.reverseChargeMention);
  if (
    input.content.sections.some(
      (sec) =>
        isSectionIncluded(sec) && sec.lines.some((l) => l.kind === 'item' && l.vatRegime === 'reduced_6'),
    )
  )
    mentions.push(L.reducedRateMention);
  if (input.certificate) mentions.push(L.certificateSigned(formatDateFr(input.certificate.signedAt)));
  for (const m of mentions) {
    ensure(24, false);
    doc.font('regular').fontSize(8).fillColor(MUTED).text(m, PAGE.margin, y, { width: CONTENT_WIDTH });
    y = doc.y + 4;
  }

  if (input.quote.paymentSchedule?.length) {
    ensure(20 + input.quote.paymentSchedule.length * 12, false);
    doc
      .font('semibold')
      .fontSize(9)
      .fillColor(INK)
      .text(L.paymentSchedule, PAGE.margin, y + 6);
    doc.font('regular').fontSize(9);
    for (const p of input.quote.paymentSchedule)
      doc.text(`${p.label} — ${t(formatPercent(dec(p.percent).dividedBy(100), 0))}`);
    y = doc.y + 6;
  }
  if (input.quote.notes) {
    ensure(30, false);
    doc
      .font('regular')
      .fontSize(9)
      .fillColor(INK)
      .text(input.quote.notes, PAGE.margin, y + 6, { width: CONTENT_WIDTH });
    y = doc.y + 6;
  }

  // --- Signature ---
  ensure(80, false);
  y += 10;
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 64).lineWidth(0.8).strokeColor(LINE).stroke();
  doc
    .font('semibold')
    .fontSize(9)
    .fillColor(INK)
    .text(L.signatureBlock, PAGE.margin + 10, y + 10);
  if (input.signature) {
    doc
      .font('regular')
      .fontSize(9)
      .fillColor(INK)
      .text(
        L.signedBy(input.signature.signerName, formatDateTimeFr(input.signature.signedAt)),
        PAGE.margin + 10,
        y + 26,
        { width: CONTENT_WIDTH - 20 },
      );
    doc
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(L.signatureProof(input.signature.ip ?? '—'), { width: CONTENT_WIDTH - 20 });
  } else {
    doc
      .font('regular')
      .fontSize(8)
      .fillColor(MUTED)
      .text(L.signatureHint, PAGE.margin + 10, y + 26, { width: CONTENT_WIDTH - 20 });
  }
  y += 74;

  // --- CGV en annexe ---
  if (input.tenant.termsAndConditions) {
    doc.addPage();
    doc.font('bold').fontSize(13).fillColor(INK).text(L.terms, PAGE.margin, PAGE.margin);
    doc
      .font('regular')
      .fontSize(8.5)
      .fillColor(INK)
      .text(input.tenant.termsAndConditions, PAGE.margin, doc.y + 8, {
        width: CONTENT_WIDTH,
        align: 'justify',
      });
  }

  footer(doc, L, input);
  return renderToBuffer(doc);
}

function footer(doc: Pdf, L: DocumentLabels, input: QuotePdfInput): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = PAGE.height - PAGE.margin - 14;
    const legal = [
      input.tenant.legalMentions,
      input.tenant.iban
        ? `${L.bank} ${input.tenant.iban}${input.tenant.bic ? ` · BIC ${input.tenant.bic}` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    // Écrire dans la marge basse sans déclencher de saut de page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('regular')
      .fontSize(7)
      .fillColor(MUTED)
      .text(legal, PAGE.margin, y, { width: CONTENT_WIDTH - 70, lineBreak: true, height: 24 });
    doc.text(L.page(i - range.start + 1, range.count), PAGE.margin + CONTENT_WIDTH - 70, y, {
      width: 70,
      align: 'right',
    });
    doc.page.margins.bottom = bottom;
  }
}

export interface ChangeOrderPdfInput extends Omit<
  QuotePdfInput,
  'quote' | 'content' | 'heading' | 'certificate'
> {
  changeOrder: {
    ordinal: number;
    number: string | null;
    title: string;
    description: string | null;
    date: Date;
    delayDays: number;
    newEndDate: Date | null;
    projectRef: string;
  };
  /** Un poste par cible (poste existant ou nouveau poste). */
  sections: QuotePdfInput['content']['sections'];
}

/** PDF d'avenant (02 P5) : mêmes calculs, mêmes mentions et même bloc de signature que le devis. */
export function renderChangeOrderPdf(input: ChangeOrderPdfInput): Promise<Buffer> {
  const L = LABELS[input.locale ?? 'fr'];
  const co = input.changeOrder;
  const delay =
    co.delayDays > 0
      ? L.changeOrderDelay(co.delayDays, co.newEndDate ? formatDateFr(co.newEndDate) : null)
      : L.changeOrderNoDelay;
  return renderQuotePdf({
    ...input,
    heading: {
      title: `${L.changeOrder(co.ordinal)}${co.number ? ` · ${co.number}` : ''}`,
      subtitle: `${co.title} · ${L.changeOrderTo(co.projectRef)}`,
    },
    quote: {
      number: co.number,
      title: co.title,
      version: 1,
      date: co.date,
      validUntil: null,
      intro: co.description,
      notes: delay,
    },
    content: { sections: input.sections },
  });
}
