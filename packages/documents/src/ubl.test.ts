import { describe, expect, it } from 'vitest';
import { buildSimpleUbl, parseUbl, UblError } from './ubl';

const supplier = {
  name: 'Brico Pro SA',
  vatNumber: 'BE0412.345.678',
  enterpriseNumber: '0412.345.678',
  street: 'Chaussée de Bruxelles 200',
  postalCode: '6040',
  city: 'Jumet',
};

describe('UBL BIS 3.0', () => {
  it('aller-retour : références, livraison, lignes et totaux en centimes', () => {
    const xml = buildSimpleUbl({
      number: 'F-2026-0912',
      issueDate: '2026-09-30',
      dueDate: '2026-10-30',
      supplier,
      buyer: { name: "Rénov'Habitat SRL", vatNumber: 'BE0123456749', enterpriseNumber: '0123.456.749' },
      orderReference: 'BC2026-017',
      buyerReference: 'CH2026-025',
      note: 'Livraison chantier Dupont',
      delivery: { street: 'Rue de la Station 42', postalCode: '6040', city: 'Jumet' },
      lines: [
        {
          description: 'Faïence murale 30x60 blanc mat',
          supplierCode: 'FAI-3060',
          quantity: '20',
          unit: 'MTK',
          unitPrice: 2_500n,
          vatRate: '21',
        },
        { description: 'Colle carrelage C2TE 25 kg', quantity: '6', unitPrice: 1_799n, vatRate: '21' },
      ],
    });
    const u = parseUbl(xml);
    expect(u).toMatchObject({
      kind: 'invoice',
      number: 'F-2026-0912',
      issueDate: '2026-09-30',
      dueDate: '2026-10-30',
      currency: 'EUR',
      orderReference: 'BC2026-017',
      buyerReference: 'CH2026-025',
      deliveryAddress: 'Rue de la Station 42, 6040 Jumet',
      notes: ['Livraison chantier Dupont'],
    });
    expect(u.supplier).toMatchObject({
      name: 'Brico Pro SA',
      vatNumber: 'BE0412345678',
      endpointId: '0412345678',
      endpointScheme: '0208',
      city: 'Jumet',
    });
    expect(u.lines).toEqual([
      {
        description: 'Faïence murale 30x60 blanc mat',
        supplierCode: 'FAI-3060',
        quantity: '20',
        unit: 'MTK',
        unitPrice: 2_500n,
        net: 50_000n,
        vatRate: '21',
      },
      {
        description: 'Colle carrelage C2TE 25 kg',
        supplierCode: null,
        quantity: '6',
        unit: 'C62',
        unitPrice: 1_799n,
        net: 10_794n,
        vatRate: '21',
      },
    ]);
    // 607,94 € HTVA ; TVA 21 % = 127,67 € ; 735,61 € TVAC.
    expect(u.totals).toEqual({ net: 60_794n, vat: 12_767n, gross: 73_561n, payable: 73_561n });
  });

  it('note de crédit, prix par quantité de base ; document invalide refusé', () => {
    const u = parseUbl(`<?xml version="1.0"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>NC-12</cbc:ID><cbc:IssueDate>2026-10-01</cbc:IssueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Facq</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">2.10</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">10.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">12.10</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">12.10</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:CreditNoteLine><cbc:ID>1</cbc:ID><cbc:CreditedQuantity unitCode="C62">100</cbc:CreditedQuantity><cbc:LineExtensionAmount currencyID="EUR">10.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Vis inox</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">10.00</cbc:PriceAmount><cbc:BaseQuantity>100</cbc:BaseQuantity></cac:Price></cac:CreditNoteLine>
</CreditNote>`);
    expect(u).toMatchObject({ kind: 'credit_note', number: 'NC-12', supplier: { name: 'Facq' } });
    expect(u.lines[0]).toMatchObject({ quantity: '100', unitPrice: 10n, net: 1_000n });
    expect(u.totals).toEqual({ net: 1_000n, vat: 210n, gross: 1_210n, payable: 1_210n });
    expect(() => parseUbl('<Order/>')).toThrow(UblError);
  });
});
