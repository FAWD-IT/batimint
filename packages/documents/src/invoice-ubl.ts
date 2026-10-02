/**
 * UBL 2.1 Peppol BIS Billing 3.0 (EN 16931) des factures et notes de crédit émises (05 §1, §4).
 * Les totaux viennent de `computeDocumentTotals` : écran, PDF et UBL donnent toujours les mêmes
 * montants. Validé en test par les règles officielles (CEN-EN16931-UBL + PEPPOL-EN16931-UBL).
 */
import {
  computeDocumentTotals,
  dec,
  type DocumentTotals,
  VAT_REGIMES,
  type VatRegime,
} from '@batimint/domain';

export interface InvoiceParty {
  name: string;
  /** « BE0123456749 » ; null pour un particulier. */
  vatNumber: string | null;
  /** BCE, 10 chiffres. */
  enterpriseNumber: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  email: string | null;
}

export interface InvoiceDocumentLine {
  description: string;
  unit: string;
  quantity: string;
  unitPrice: bigint;
  vatRegime: VatRegime;
}

export interface InvoiceDocumentInput {
  kind: 'invoice' | 'credit_note';
  number: string;
  issueDate: string;
  dueDate: string | null;
  servicePeriod?: { start: string | null; end: string | null } | null;
  /** Référence acheteur (BT-10) : référence du chantier par défaut. */
  buyerReference: string;
  /** Note de crédit : facture corrigée (BG-3). */
  billingReference?: { number: string; issueDate: string | null } | null;
  title: string;
  /** Mentions légales et remarques (BT-22). */
  notes: string[];
  seller: InvoiceParty & { iban: string | null; bic: string | null };
  buyer: InvoiceParty;
  deliveryAddress?: { street: string; postalCode: string; city: string; country: string } | null;
  lines: InvoiceDocumentLine[];
  /** Communication structurée (12 chiffres) — référence de paiement (BT-83). */
  paymentReference: string | null;
  paymentTerms: string | null;
}

const CUSTOMIZATION = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
const PROFILE = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

/** Unités UN/ECE Rec. 20 (BT-130). */
export function unitCode(unit: string): string {
  const u = unit.trim().toLowerCase().replace('²', '2').replace('³', '3');
  const map: Record<string, string> = {
    m2: 'MTK',
    'm²': 'MTK',
    m3: 'MTQ',
    m: 'MTR',
    ml: 'MTR',
    h: 'HUR',
    heure: 'HUR',
    heures: 'HUR',
    j: 'DAY',
    jour: 'DAY',
    jours: 'DAY',
    kg: 'KGM',
    t: 'TNE',
    l: 'LTR',
    forfait: 'LS',
    ff: 'LS',
    lot: 'LS',
    ens: 'LS',
  };
  return map[u] ?? 'C62';
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Montant en euros avec deux décimales (« 1234.50 », « -12.00 »). */
export function ublAmount(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function exemption(category: string): string {
  switch (category) {
    case 'AE':
      return '<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Autoliquidation</cbc:TaxExemptionReason>';
    case 'E':
      return '<cbc:TaxExemptionReason>Exonération de TVA</cbc:TaxExemptionReason>';
    case 'K':
      return '<cbc:TaxExemptionReasonCode>VATEX-EU-IC</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Livraison intracommunautaire</cbc:TaxExemptionReason>';
    case 'G':
      return '<cbc:TaxExemptionReasonCode>VATEX-EU-G</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Exportation</cbc:TaxExemptionReason>';
    default:
      return '';
  }
}

function endpoint(p: InvoiceParty): string {
  // Un particulier n'a pas d'adresse Peppol : sa facture part par e-mail et l'UBL sert à
  // l'archivage (EN 16931). Seule la règle PEPPOL-EN16931-R010 ne peut alors pas être satisfaite.
  return p.enterpriseNumber
    ? `<cbc:EndpointID schemeID="0208">${esc(p.enterpriseNumber)}</cbc:EndpointID>`
    : '';
}

function party(p: InvoiceParty, role: 'seller' | 'buyer'): string {
  const address = `<cac:PostalAddress>${p.street ? `<cbc:StreetName>${esc(p.street)}</cbc:StreetName>` : ''}${
    p.city ? `<cbc:CityName>${esc(p.city)}</cbc:CityName>` : ''
  }${p.postalCode ? `<cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone>` : ''}<cac:Country><cbc:IdentificationCode>${esc(
    p.country,
  )}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>`;
  const tax = p.vatNumber
    ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(p.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
    : '';
  const legal = `<cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName>${
    p.enterpriseNumber ? `<cbc:CompanyID schemeID="0208">${esc(p.enterpriseNumber)}</cbc:CompanyID>` : ''
  }</cac:PartyLegalEntity>`;
  const contact = p.email
    ? `<cac:Contact><cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail></cac:Contact>`
    : '';
  const wrapper = role === 'seller' ? 'AccountingSupplierParty' : 'AccountingCustomerParty';
  return `<cac:${wrapper}><cac:Party>${endpoint(p)}<cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName>${address}${tax}${legal}${contact}</cac:Party></cac:${wrapper}>`;
}

function taxCategory(
  regime: VatRegime,
  wrapper: 'TaxCategory' | 'ClassifiedTaxCategory',
  withReason: boolean,
): string {
  const info = VAT_REGIMES[regime];
  return `<cac:${wrapper}><cbc:ID>${info.category}</cbc:ID><cbc:Percent>${dec(info.ratePercent).toFixed(2)}</cbc:Percent>${
    withReason ? exemption(info.category) : ''
  }<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:${wrapper}>`;
}

export function invoiceTotals(input: Pick<InvoiceDocumentInput, 'lines'>): DocumentTotals {
  return computeDocumentTotals(input.lines);
}

export function buildInvoiceUbl(input: InvoiceDocumentInput): string {
  const totals = invoiceTotals(input);
  const credit = input.kind === 'credit_note';
  const root = credit ? 'CreditNote' : 'Invoice';
  const lineTag = credit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = credit ? 'CreditedQuantity' : 'InvoicedQuantity';
  const ns = credit
    ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
    : 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
  // PEPPOL-EN16931-R002 : une seule note au niveau du document.
  const noteText = [input.title, ...input.notes].filter(Boolean).join('\n');
  const notes = noteText ? `<cbc:Note>${esc(noteText)}</cbc:Note>` : '';
  const period =
    input.servicePeriod && (input.servicePeriod.start || input.servicePeriod.end)
      ? `<cac:InvoicePeriod>${input.servicePeriod.start ? `<cbc:StartDate>${input.servicePeriod.start}</cbc:StartDate>` : ''}${
          input.servicePeriod.end ? `<cbc:EndDate>${input.servicePeriod.end}</cbc:EndDate>` : ''
        }</cac:InvoicePeriod>`
      : '';
  const billing = input.billingReference
    ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(input.billingReference.number)}</cbc:ID>${
        input.billingReference.issueDate
          ? `<cbc:IssueDate>${input.billingReference.issueDate}</cbc:IssueDate>`
          : ''
      }</cac:InvoiceDocumentReference></cac:BillingReference>`
    : '';
  const delivery = input.deliveryAddress
    ? `<cac:Delivery><cac:DeliveryLocation><cac:Address><cbc:StreetName>${esc(input.deliveryAddress.street)}</cbc:StreetName><cbc:CityName>${esc(
        input.deliveryAddress.city,
      )}</cbc:CityName><cbc:PostalZone>${esc(input.deliveryAddress.postalCode)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${esc(
        input.deliveryAddress.country,
      )}</cbc:IdentificationCode></cac:Country></cac:Address></cac:DeliveryLocation></cac:Delivery>`
    : '';
  const payment =
    input.seller.iban && !credit
      ? `<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>${
          input.paymentReference ? `<cbc:PaymentID>${esc(input.paymentReference)}</cbc:PaymentID>` : ''
        }<cac:PayeeFinancialAccount><cbc:ID>${esc(input.seller.iban.replace(/\s/g, ''))}</cbc:ID>${
          input.seller.bic
            ? `<cac:FinancialInstitutionBranch><cbc:ID>${esc(input.seller.bic)}</cbc:ID></cac:FinancialInstitutionBranch>`
            : ''
        }</cac:PayeeFinancialAccount></cac:PaymentMeans>`
      : '';
  const terms = input.paymentTerms
    ? `<cac:PaymentTerms><cbc:Note>${esc(input.paymentTerms)}</cbc:Note></cac:PaymentTerms>`
    : '';
  const subtotals = totals.vatBreakdown
    .map(
      (v) =>
        `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">${ublAmount(v.taxableAmount)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">${ublAmount(
          v.taxAmount,
        )}</cbc:TaxAmount>${taxCategory(v.regimes[0]!, 'TaxCategory', true)}</cac:TaxSubtotal>`,
    )
    .join('');
  const lines = input.lines
    .map((l, i) => {
      const c = totals.lines[i]!;
      return `<cac:${lineTag}><cbc:ID>${i + 1}</cbc:ID><cbc:${qtyTag} unitCode="${unitCode(l.unit)}">${dec(l.quantity).toString()}</cbc:${qtyTag}><cbc:LineExtensionAmount currencyID="EUR">${ublAmount(
        c.netAmount,
      )}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${esc(l.description.slice(0, 200))}</cbc:Name>${taxCategory(
        l.vatRegime,
        'ClassifiedTaxCategory',
        false,
      )}</cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">${ublAmount(l.unitPrice)}</cbc:PriceAmount></cac:Price></cac:${lineTag}>`;
    })
    .join('');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${root} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`,
    `<cbc:CustomizationID>${CUSTOMIZATION}</cbc:CustomizationID>`,
    `<cbc:ProfileID>${PROFILE}</cbc:ProfileID>`,
    `<cbc:ID>${esc(input.number)}</cbc:ID>`,
    `<cbc:IssueDate>${input.issueDate}</cbc:IssueDate>`,
    !credit && input.dueDate ? `<cbc:DueDate>${input.dueDate}</cbc:DueDate>` : '',
    `<cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${credit ? '381' : '380'}</cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>`,
    notes,
    '<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>',
    `<cbc:BuyerReference>${esc(input.buyerReference)}</cbc:BuyerReference>`,
    period,
    billing,
    party(input.seller, 'seller'),
    party(input.buyer, 'buyer'),
    delivery,
    payment,
    terms,
    `<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${ublAmount(totals.totalVat)}</cbc:TaxAmount>${subtotals}</cac:TaxTotal>`,
    `<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">${ublAmount(totals.totalNet)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">${ublAmount(
      totals.totalNet,
    )}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">${ublAmount(totals.totalGross)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">${ublAmount(
      totals.totalGross,
    )}</cbc:PayableAmount></cac:LegalMonetaryTotal>`,
    lines,
    `</${root}>`,
  ]
    .filter(Boolean)
    .join('\n');
}
