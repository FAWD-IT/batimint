/**
 * Libellés des documents PDF, par langue du document (Tenant.documentLocale). FR maintenant,
 * structure prête pour NL (règle 8) : ajouter une entrée `nl` du même type suffit.
 */
export interface DocumentLabels {
  quote: string;
  version: string;
  date: string;
  validUntil: string;
  customer: string;
  site: string;
  enterpriseNumber: string;
  vatNumber: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  vat: string;
  total: string;
  subtotal: string;
  option: string;
  optionSelected: string;
  optionNotSelected: string;
  totalNet: string;
  vatAt: (rate: string) => string;
  reverseChargeLine: string;
  totalGross: string;
  deposit: string;
  paymentSchedule: string;
  reverseChargeMention: string;
  reducedRateMention: string;
  signedBy: (name: string, date: string) => string;
  signatureProof: (ip: string) => string;
  signatureBlock: string;
  signatureHint: string;
  certificateSigned: (date: string) => string;
  terms: string;
  page: (n: number, total: number) => string;
  bank: string;
  changeOrder: (ordinal: number) => string;
  changeOrderTo: (ref: string) => string;
  changeOrderNoDelay: string;
  changeOrderDelay: (days: number, newEnd: string | null) => string;
}

export const LABELS: Record<'fr', DocumentLabels> = {
  fr: {
    quote: 'Devis',
    version: 'version',
    date: 'Date',
    validUntil: "Valable jusqu'au",
    customer: 'Client',
    site: 'Chantier',
    enterpriseNumber: 'BCE',
    vatNumber: 'TVA',
    description: 'Description',
    quantity: 'Quantité',
    unitPrice: 'PU HTVA',
    discount: 'Rem.',
    vat: 'TVA',
    total: 'Total HTVA',
    subtotal: 'Sous-total',
    option: 'Option',
    optionSelected: 'Option retenue',
    optionNotSelected: 'Option non retenue (non comprise dans le total)',
    totalNet: 'Total HTVA',
    vatAt: (rate) => `TVA ${rate} %`,
    reverseChargeLine: 'TVA autoliquidée',
    totalGross: 'Total TVAC',
    deposit: 'Acompte à la signature',
    paymentSchedule: 'Échéancier de paiement',
    reverseChargeMention:
      'Autoliquidation — TVA due par le cocontractant, article 20 de l’AR n° 1 (travaux immobiliers).',
    reducedRateMention:
      'TVA à 6 % : logement privé de plus de 10 ans, sur la base de l’attestation signée du client (AR n° 20, rubrique XXXI).',
    signedBy: (name, date) => `Signé électroniquement par ${name} le ${date}.`,
    signatureProof: (ip) =>
      `Preuve conservée : horodatage, adresse IP ${ip}, navigateur et empreinte SHA-256 du document.`,
    signatureBlock: 'Bon pour accord',
    signatureHint: 'Date, nom et signature du client, précédés de la mention « bon pour accord ».',
    certificateSigned: (date) => `Attestation TVA 6 % signée par le client le ${date}.`,
    terms: 'Conditions générales',
    page: (n, total) => `Page ${n} / ${total}`,
    bank: 'IBAN',
    changeOrder: (n) => `Avenant n°${n}`,
    changeOrderTo: (ref) => `avenant au contrat ${ref}`,
    changeOrderNoDelay: 'Cet avenant ne modifie pas la date de fin prévue des travaux.',
    changeOrderDelay: (days, newEnd) =>
      `Cet avenant prolonge les travaux de ${days} jour${days > 1 ? 's' : ''} ouvrable${days > 1 ? 's' : ''}${
        newEnd ? ` : nouvelle date de fin prévue le ${newEnd}` : ''
      }.`,
  },
};
