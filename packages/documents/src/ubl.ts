/**
 * UBL 2.1 / Peppol BIS Billing 3.0 (05 §1) : lecture des factures et notes de crédit reçues, et
 * production d'un document minimal valide (factures fournisseurs simulées, seed, tests).
 * Les montants sont convertis en centimes (bigint) ; les quantités restent décimales.
 */
import { dec, roundHalfAwayFromZero } from '@batimint/domain';
import { XMLParser } from 'fast-xml-parser';

export interface UblParty {
  name: string | null;
  vatNumber: string | null;
  /** Identifiant Peppol (EndpointID), avec son schéma (0208 = BCE). */
  endpointId: string | null;
  endpointScheme: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

export interface UblLine {
  description: string;
  supplierCode: string | null;
  quantity: string;
  unit: string | null;
  unitPrice: bigint;
  net: bigint;
  vatRate: string | null;
}

export interface ParsedUbl {
  kind: 'invoice' | 'credit_note';
  number: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  supplier: UblParty;
  buyer: UblParty;
  orderReference: string | null;
  buyerReference: string | null;
  deliveryAddress: string | null;
  notes: string[];
  lines: UblLine[];
  totals: { net: bigint; vat: bigint; gross: bigint; payable: bigint };
}

export class UblError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UblError';
  }
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) =>
    ['InvoiceLine', 'CreditNoteLine', 'Note', 'TaxSubtotal', 'PartyTaxScheme', 'Description'].includes(name),
});

/** Texte d'un nœud (`<a>x</a>` ou `<a attr="…">x</a>`). */
function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim() || null;
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object' && '#text' in (v as Node)) return text((v as Node)['#text']);
  return null;
}

function attr(v: unknown, name: string): string | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return text((v as Node)[`@${name}`]);
  return null;
}

const node = (v: unknown): Node =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : Array.isArray(v) ? node(v[0]) : {};

function amount(v: unknown): bigint {
  const s = text(v);
  if (!s) return 0n;
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new UblError(`Montant illisible : ${s}`);
  return roundHalfAwayFromZero(dec(s).times(100));
}

function party(p: unknown): UblParty {
  const pt = node(node(p)['Party']);
  const endpoint = pt['EndpointID'];
  const address = node(pt['PostalAddress']);
  const tax = node(pt['PartyTaxScheme']);
  const legal = node(pt['PartyLegalEntity']);
  return {
    name: text(node(pt['PartyName'])['Name']) ?? text(legal['RegistrationName']),
    vatNumber: text(tax['CompanyID']),
    endpointId: text(endpoint),
    endpointScheme: attr(endpoint, 'schemeID'),
    street: text(address['StreetName']),
    postalCode: text(address['PostalZone']),
    city: text(address['CityName']),
    country: text(node(address['Country'])['IdentificationCode']),
  };
}

/** Lit une facture ou une note de crédit UBL (BIS 3.0). Lève `UblError` si le document est invalide. */
export function parseUbl(xml: string): ParsedUbl {
  let root: Node;
  try {
    root = parser.parse(xml) as Node;
  } catch (err) {
    throw new UblError(`XML illisible : ${(err as Error).message}`);
  }
  const kind = root['Invoice'] ? 'invoice' : root['CreditNote'] ? 'credit_note' : null;
  if (!kind) throw new UblError('Ce document n’est ni une facture ni une note de crédit UBL.');
  const doc = node(root[kind === 'invoice' ? 'Invoice' : 'CreditNote']);
  const totals = node(doc['LegalMonetaryTotal']);
  const taxTotal = node(doc['TaxTotal']);
  const delivery = node(doc['Delivery']);
  const deliveryAddress = node(node(delivery['DeliveryLocation'])['Address']);
  const rawLines =
    (doc[kind === 'invoice' ? 'InvoiceLine' : 'CreditNoteLine'] as unknown[] | undefined) ?? [];
  const lines: UblLine[] = rawLines.map((l) => {
    const line = node(l);
    const item = node(line['Item']);
    const qty = line[kind === 'invoice' ? 'InvoicedQuantity' : 'CreditedQuantity'];
    const price = node(line['Price']);
    const baseQty = text(price['BaseQuantity']);
    let unitPrice = amount(price['PriceAmount']);
    if (baseQty && dec(baseQty).greaterThan(0) && !dec(baseQty).equals(1))
      unitPrice = roundHalfAwayFromZero(dec(unitPrice).dividedBy(dec(baseQty)));
    const descriptions = (item['Description'] as unknown[] | undefined) ?? [];
    return {
      description: text(item['Name']) ?? text(descriptions[0]) ?? '—',
      supplierCode: text(node(item['SellersItemIdentification'])['ID']),
      quantity: text(qty) ?? '1',
      unit: attr(qty, 'unitCode'),
      unitPrice,
      net: amount(line['LineExtensionAmount']),
      vatRate: text(node(item['ClassifiedTaxCategory'])['Percent']),
    };
  });
  const net = amount(totals['TaxExclusiveAmount'] ?? totals['LineExtensionAmount']);
  const gross = amount(totals['TaxInclusiveAmount']);
  const addressText = [
    text(deliveryAddress['StreetName']),
    [text(deliveryAddress['PostalZone']), text(deliveryAddress['CityName'])].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    kind,
    number: text(doc['ID']),
    issueDate: text(doc['IssueDate']),
    dueDate: text(doc['DueDate']) ?? text(node(doc['PaymentMeans'])['PaymentDueDate']),
    currency: text(doc['DocumentCurrencyCode']) ?? 'EUR',
    supplier: party(doc['AccountingSupplierParty']),
    buyer: party(doc['AccountingCustomerParty']),
    orderReference: text(node(doc['OrderReference'])['ID']),
    buyerReference: text(doc['BuyerReference']),
    deliveryAddress: addressText || null,
    notes: ((doc['Note'] as unknown[] | undefined) ?? [])
      .map((n) => text(n))
      .filter((n): n is string => Boolean(n)),
    lines,
    totals: {
      net,
      vat: amount(taxTotal['TaxAmount']),
      gross: gross || net + amount(taxTotal['TaxAmount']),
      payable: amount(totals['PayableAmount']) || gross,
    },
  };
}

// ---------------------------------------------------------------------------
// Production d'un document minimal (simulation Peppol, seed, tests)
// ---------------------------------------------------------------------------

export interface SimpleUblInput {
  number: string;
  issueDate: string;
  dueDate?: string | null;
  supplier: {
    name: string;
    vatNumber: string;
    enterpriseNumber: string;
    street?: string;
    postalCode?: string;
    city?: string;
  };
  buyer: { name: string; vatNumber: string | null; enterpriseNumber: string | null };
  orderReference?: string | null;
  buyerReference?: string | null;
  note?: string | null;
  delivery?: { street: string; postalCode: string; city: string } | null;
  lines: {
    description: string;
    supplierCode?: string | null;
    quantity: string;
    unit?: string;
    unitPrice: bigint;
    vatRate: string;
  }[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (c: bigint) => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
};

/** Facture UBL BIS 3.0 minimale (une catégorie de TVA par taux). */
export function buildSimpleUbl(input: SimpleUblInput): string {
  const lines = input.lines.map((l) => ({
    ...l,
    net: roundHalfAwayFromZero(dec(l.quantity).times(dec(l.unitPrice))),
  }));
  const byRate = new Map<string, bigint>();
  for (const l of lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0n) + l.net);
  const subtotals = [...byRate.entries()].map(([rate, base]) => ({
    rate,
    base,
    tax: roundHalfAwayFromZero(dec(base).times(dec(rate)).dividedBy(100)),
  }));
  const net = lines.reduce((s, l) => s + l.net, 0n);
  const vat = subtotals.reduce((s, x) => s + x.tax, 0n);
  const be = (vat: string | null) => (vat ? vat.replace(/\s|\./g, '') : '');
  const partyXml = (p: {
    name: string;
    vatNumber: string | null;
    enterpriseNumber: string | null;
    street?: string;
    postalCode?: string;
    city?: string;
  }) => `
      <cac:Party>
        ${p.enterpriseNumber ? `<cbc:EndpointID schemeID="0208">${esc(p.enterpriseNumber.replace(/\D/g, ''))}</cbc:EndpointID>` : ''}
        <cac:PartyName><cbc:Name>${esc(p.name)}</cbc:Name></cac:PartyName>
        <cac:PostalAddress>
          ${p.street ? `<cbc:StreetName>${esc(p.street)}</cbc:StreetName>` : ''}
          ${p.city ? `<cbc:CityName>${esc(p.city)}</cbc:CityName>` : ''}
          ${p.postalCode ? `<cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone>` : ''}
          <cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country>
        </cac:PostalAddress>
        ${p.vatNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(be(p.vatNumber))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
        <cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
      </cac:Party>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(input.number)}</cbc:ID>
  <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>
  ${input.dueDate ? `<cbc:DueDate>${input.dueDate}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${input.note ? `<cbc:Note>${esc(input.note)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  ${input.buyerReference ? `<cbc:BuyerReference>${esc(input.buyerReference)}</cbc:BuyerReference>` : ''}
  ${input.orderReference ? `<cac:OrderReference><cbc:ID>${esc(input.orderReference)}</cbc:ID></cac:OrderReference>` : ''}
  <cac:AccountingSupplierParty>${partyXml(input.supplier)}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${partyXml(input.buyer)}
  </cac:AccountingCustomerParty>
  ${
    input.delivery
      ? `<cac:Delivery><cac:DeliveryLocation><cac:Address><cbc:StreetName>${esc(input.delivery.street)}</cbc:StreetName><cbc:CityName>${esc(input.delivery.city)}</cbc:CityName><cbc:PostalZone>${esc(input.delivery.postalCode)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>BE</cbc:IdentificationCode></cac:Country></cac:Address></cac:DeliveryLocation></cac:Delivery>`
      : ''
  }
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${money(vat)}</cbc:TaxAmount>
    ${subtotals
      .map(
        (s) => `<cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${money(s.base)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${money(s.tax)}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${s.rate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>`,
      )
      .join('\n    ')}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${money(net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${money(net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${money(net + vat)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${money(net + vat)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lines
    .map(
      (l, i) => `<cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(l.unit ?? 'C62')}">${l.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${money(l.net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(l.description)}</cbc:Name>
      ${l.supplierCode ? `<cac:SellersItemIdentification><cbc:ID>${esc(l.supplierCode)}</cbc:ID></cac:SellersItemIdentification>` : ''}
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>${l.vatRate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${money(l.unitPrice)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n  ')}
</Invoice>
`;
}
