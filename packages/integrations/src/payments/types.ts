/**
 * Paiements en ligne (07 « Paiements — Mollie ») : lien de paiement pour le solde d'une facture
 * (Bancontact, carte, virement), puis webhook → `payment.received`.
 */
export type PaymentLinkStatus = 'open' | 'paid' | 'expired' | 'failed' | 'canceled';

export interface CreatePaymentLinkInput {
  tenantId: string;
  invoiceId: string;
  /** Montant TVAC à payer, en centimes. */
  amount: bigint;
  description: string;
  /** Page où revient le client après paiement (portail). */
  redirectUrl: string;
  /** Webhook appelé par le fournisseur à chaque changement de statut. */
  webhookUrl: string;
}

export interface PaymentLinkResult {
  id: string;
  url: string;
  status: PaymentLinkStatus;
  expiresAt: Date | null;
}

export interface PaymentStatusResult {
  id: string;
  status: PaymentLinkStatus;
  amount: bigint;
  paidAt: Date | null;
  /** Moyen utilisé (bancontact, creditcard, banktransfer…). */
  method: string | null;
}

export interface PaymentLinkProvider {
  readonly provider: string;
  createLink(input: CreatePaymentLinkInput): Promise<PaymentLinkResult>;
  getStatus(id: string): Promise<PaymentStatusResult>;
}
