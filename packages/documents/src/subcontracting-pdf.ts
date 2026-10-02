/**
 * Sous-traitance (03 §9, 05 §7) : contrat de sous-traitance, preuve de consultation 30bis et
 * document de versement de la retenue 30bis aux administrations.
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

function header(
  doc: Pdf,
  input: { tenant: Party & { brandColor?: string | null }; title: string; subtitle: string },
) {
  const accent = safeAccent(input.tenant.brandColor);
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
    .fontSize(18)
    .fillColor(INK)
    .text(input.title, PAGE.margin + 14, y);
  doc
    .font('regular')
    .fontSize(10)
    .fillColor(MUTED)
    .text(input.subtitle, PAGE.margin + 14, doc.y + 2);
  return doc.y + 16;
}

function parties(doc: Pdf, y: number, left: { title: string } & Party, right: { title: string } & Party) {
  const colW = (CONTENT_WIDTH - 20) / 2;
  const col = (x: number, p: { title: string } & Party) => {
    doc.font('semibold').fontSize(7.5).fillColor(MUTED).text(p.title, x, y, { characterSpacing: 0.6 });
    doc
      .font('semibold')
      .fontSize(9.5)
      .fillColor(INK)
      .text(p.name, x, doc.y + 2, { width: colW });
    doc.font('regular').fontSize(9);
    for (const l of p.lines) doc.text(l, x, doc.y, { width: colW });
    return doc.y;
  };
  const a = col(PAGE.margin, left);
  const b = col(PAGE.margin + colW + 20, right);
  return Math.max(a, b) + 16;
}

function section(doc: Pdf, y: number, title: string) {
  doc.font('semibold').fontSize(7.5).fillColor(MUTED).text(title.toUpperCase(), PAGE.margin, y, {
    characterSpacing: 0.6,
  });
  return doc.y + 4;
}

function row(doc: Pdf, y: number, label: string, value: string, bold = false) {
  doc
    .font(bold ? 'semibold' : 'regular')
    .fontSize(9.5)
    .fillColor(INK);
  doc.text(label, PAGE.margin, y, { width: CONTENT_WIDTH - 140 });
  doc.text(t(value), PAGE.margin + CONTENT_WIDTH - 140, y, { width: 140, align: 'right' });
  const end = doc.y + 6;
  doc
    .moveTo(PAGE.margin, end - 3)
    .lineTo(PAGE.margin + CONTENT_WIDTH, end - 3)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke();
  return end;
}

function ensureSpace(doc: Pdf, y: number, needed: number) {
  if (y + needed > PAGE.height - PAGE.margin) {
    doc.addPage();
    return PAGE.margin;
  }
  return y;
}

/* ------------------------------------------------------------------------------------------ */

export interface SubcontractPdfInput {
  tenant: Party & { brandColor?: string | null; enterpriseNumber: string | null };
  subcontractor: Party & { enterpriseNumber: string | null };
  number: string;
  date: Date;
  project: { number: string; name: string; address: string | null };
  post: string | null;
  title: string;
  scope: string | null;
  amount: bigint;
  startDate: Date | null;
  endDate: Date | null;
  installments: { label: string; percent: string; amount: bigint; dueOn: Date | null }[];
  check: { checkedAt: Date; reference: string; hasSocialDebt: boolean; hasTaxDebt: boolean } | null;
  socialPercent: string;
  taxPercent: string;
}

export function renderSubcontractPdf(input: SubcontractPdfInput): Promise<Buffer> {
  const title = `Contrat de sous-traitance ${input.number}`;
  const doc = createPdf({ title, author: input.tenant.name, createdAt: input.date });
  let y = header(doc, {
    tenant: input.tenant,
    title,
    subtitle: `${formatDateFr(input.date)} · Chantier ${input.project.number} — ${input.project.name}`,
  });
  y = parties(
    doc,
    y,
    { title: 'ENTREPRENEUR PRINCIPAL', ...input.tenant },
    { title: 'SOUS-TRAITANT', ...input.subcontractor },
  );
  y = section(doc, y, 'Objet');
  doc
    .font('semibold')
    .fontSize(10)
    .fillColor(INK)
    .text(input.title, PAGE.margin, y, { width: CONTENT_WIDTH });
  doc.font('regular').fontSize(9).fillColor(INK);
  if (input.post) doc.text(`Poste du chantier : ${input.post}`, { width: CONTENT_WIDTH });
  if (input.project.address)
    doc.text(`Lieu des travaux : ${input.project.address}`, { width: CONTENT_WIDTH });
  if (input.startDate || input.endDate)
    doc.text(
      `Période : ${input.startDate ? `du ${formatDateFr(input.startDate)}` : ''}${
        input.endDate ? ` au ${formatDateFr(input.endDate)}` : ''
      }`.trim(),
      { width: CONTENT_WIDTH },
    );
  if (input.scope) {
    doc.moveDown(0.4);
    doc.fillColor(MUTED).text(input.scope, { width: CONTENT_WIDTH });
  }
  y = doc.y + 14;
  y = section(doc, y, 'Prix et échéancier');
  for (const i of input.installments) {
    y = ensureSpace(doc, y, 20);
    y = row(
      doc,
      y,
      `${i.label} (${i.percent.replace('.', ',')} %)${i.dueOn ? ` · le ${formatDateFr(i.dueOn)}` : ''}`,
      formatEuros(i.amount),
    );
  }
  y = row(doc, y, 'Prix forfaitaire HTVA', formatEuros(input.amount), true);
  y = ensureSpace(doc, y + 8, 110);
  y = section(doc, y, 'Obligations sociales et fiscales (article 30bis)');
  doc.font('regular').fontSize(9).fillColor(INK);
  doc.text(
    `Avant la conclusion du contrat et avant chaque paiement, l'entrepreneur principal consulte les dettes sociales et fiscales du sous-traitant. En cas de dette, il retient ${input.socialPercent.replace('.', ',')} % (dettes sociales, versés à l'ONSS) et ${input.taxPercent.replace('.', ',')} % (dettes fiscales, versés au SPF Finances) du montant HTVA facturé, dans la limite de la dette, et ne verse au sous-traitant que le solde. Le sous-traitant tient à jour ses attestations et son assurance responsabilité civile.`,
    PAGE.margin,
    y,
    { width: CONTENT_WIDTH, align: 'justify' },
  );
  if (input.check) {
    y = doc.y + 8;
    doc.rect(PAGE.margin, y, CONTENT_WIDTH, 30).fill(SOFT);
    doc
      .font('semibold')
      .fontSize(9)
      .fillColor(INK)
      .text(
        `Consultation du ${formatDateTimeFr(input.check.checkedAt)} (réf. ${input.check.reference}) : ${
          input.check.hasSocialDebt || input.check.hasTaxDebt
            ? `dette ${[input.check.hasSocialDebt && 'sociale', input.check.hasTaxDebt && 'fiscale'].filter(Boolean).join(' et ')} — retenue applicable à chaque paiement`
            : 'aucune dette sociale ni fiscale'
        }.`,
        PAGE.margin + 10,
        y + 10,
        { width: CONTENT_WIDTH - 20 },
      );
  }
  y = ensureSpace(doc, doc.y + 30, 80);
  const colW = (CONTENT_WIDTH - 20) / 2;
  doc.font('semibold').fontSize(8).fillColor(MUTED);
  doc.text("Pour l'entrepreneur principal", PAGE.margin, y, { width: colW });
  doc.text('Pour le sous-traitant', PAGE.margin + colW + 20, y, { width: colW });
  doc
    .moveTo(PAGE.margin, y + 56)
    .lineTo(PAGE.margin + colW, y + 56)
    .moveTo(PAGE.margin + colW + 20, y + 56)
    .lineTo(PAGE.margin + CONTENT_WIDTH, y + 56)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke();
  return renderToBuffer(doc);
}

/* ------------------------------------------------------------------------------------------ */

export interface ThirtyBisProofPdfInput {
  tenant: Party & { brandColor?: string | null };
  subcontractor: { name: string; enterpriseNumber: string };
  checkedAt: Date;
  reference: string;
  service: string;
  context: string;
  hasSocialDebt: boolean;
  hasTaxDebt: boolean;
  socialDebtAmount: bigint | null;
  taxDebtAmount: bigint | null;
  checkedBy: string | null;
}

export function renderThirtyBisProofPdf(input: ThirtyBisProofPdfInput): Promise<Buffer> {
  const title = 'Preuve de consultation 30bis';
  const doc = createPdf({ title, author: input.tenant.name, createdAt: input.checkedAt });
  let y = header(doc, {
    tenant: input.tenant,
    title,
    subtitle: `${formatDateTimeFr(input.checkedAt)} · réf. ${input.reference}`,
  });
  y = section(doc, y, 'Entreprise consultée');
  y = row(doc, y, input.subcontractor.name, input.subcontractor.enterpriseNumber);
  y = section(doc, y + 8, 'Résultat');
  y = row(
    doc,
    y,
    'Dettes sociales (ONSS)',
    input.hasSocialDebt
      ? `Oui${input.socialDebtAmount !== null ? ` · ${formatEuros(input.socialDebtAmount)}` : ''}`
      : 'Non',
    input.hasSocialDebt,
  );
  y = row(
    doc,
    y,
    'Dettes fiscales (SPF Finances)',
    input.hasTaxDebt
      ? `Oui${input.taxDebtAmount !== null ? ` · ${formatEuros(input.taxDebtAmount)}` : ''}`
      : 'Non',
    input.hasTaxDebt,
  );
  y = section(doc, y + 8, 'Consultation');
  y = row(doc, y, 'Motif', input.context);
  y = row(doc, y, 'Service consulté', input.service);
  if (input.checkedBy) y = row(doc, y, 'Consultée par', input.checkedBy);
  doc
    .font('regular')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      'Document conservé comme preuve de la consultation (article 30bis de la loi du 27 juin 1969 et article 402 du CIR 92). Il ne peut pas être modifié.',
      PAGE.margin,
      y + 12,
      { width: CONTENT_WIDTH },
    );
  return renderToBuffer(doc);
}

/* ------------------------------------------------------------------------------------------ */

export interface ThirtyBisTransferPdfInput {
  tenant: Party & { brandColor?: string | null; enterpriseNumber: string | null };
  subcontractor: { name: string; enterpriseNumber: string; iban: string | null };
  invoice: { number: string | null; issueDate: Date | null; net: bigint; vat: bigint; gross: bigint };
  subcontractNumber: string | null;
  projectLabel: string | null;
  date: Date;
  check: { reference: string; checkedAt: Date };
  social: bigint;
  tax: bigint;
  socialPercent: string;
  taxPercent: string;
  payableToSubcontractor: bigint;
}

export function renderThirtyBisTransferPdf(input: ThirtyBisTransferPdfInput): Promise<Buffer> {
  const title = 'Retenue 30bis — document de versement';
  const doc = createPdf({ title, author: input.tenant.name, createdAt: input.date });
  let y = header(doc, {
    tenant: input.tenant,
    title,
    subtitle: `${formatDateFr(input.date)} · facture ${input.invoice.number ?? 'sans numéro'} de ${input.subcontractor.name}`,
  });
  y = section(doc, y, 'Facture du sous-traitant');
  y = row(doc, y, `${input.subcontractor.name} (${input.subcontractor.enterpriseNumber})`, '');
  if (input.subcontractNumber || input.projectLabel)
    y = row(doc, y, [input.subcontractNumber, input.projectLabel].filter(Boolean).join(' · '), '');
  y = row(doc, y, 'Montant HTVA', formatEuros(input.invoice.net));
  y = row(doc, y, 'TVA', formatEuros(input.invoice.vat));
  y = row(doc, y, 'Montant TVAC', formatEuros(input.invoice.gross), true);
  y = section(
    doc,
    y + 8,
    `Retenues (consultation ${input.check.reference} du ${formatDateTimeFr(input.check.checkedAt)})`,
  );
  if (input.social > 0n)
    y = row(
      doc,
      y,
      `À verser à l'ONSS — ${input.socialPercent.replace('.', ',')} % du HTVA (dettes sociales)`,
      formatEuros(input.social),
      true,
    );
  if (input.tax > 0n)
    y = row(
      doc,
      y,
      `À verser au SPF Finances — ${input.taxPercent.replace('.', ',')} % du HTVA (dettes fiscales)`,
      formatEuros(input.tax),
      true,
    );
  y = row(
    doc,
    y,
    `À payer au sous-traitant${input.subcontractor.iban ? ` (${input.subcontractor.iban})` : ''}`,
    formatEuros(input.payableToSubcontractor),
    true,
  );
  y = ensureSpace(doc, y + 10, 90);
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 64).fill(SOFT);
  doc
    .font('regular')
    .fontSize(9)
    .fillColor(INK)
    .text(
      `Mentionnez sur chaque versement : le numéro d'entreprise du sous-traitant (${input.subcontractor.enterpriseNumber}), celui de l'entrepreneur principal (${input.tenant.enterpriseNumber ?? '—'}) et la référence de la facture. Les coordonnées de paiement de l'ONSS et du SPF Finances sont à reprendre sur les sites officiels [à valider]. Le versement libère d'autant votre responsabilité solidaire.`,
      PAGE.margin + 10,
      y + 10,
      { width: CONTENT_WIDTH - 20 },
    );
  return renderToBuffer(doc);
}
