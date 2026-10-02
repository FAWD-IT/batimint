import { createHash } from 'node:crypto';
import { IntegrationError } from '../errors';
import type {
  CreatePaymentLinkInput,
  PaymentLinkProvider,
  PaymentLinkResult,
  PaymentStatusResult,
} from './types';

/**
 * Mock déterministe : le lien mène à une page de paiement simulée de l'application
 * (`/paiement-simule/:id`), qui confirme le paiement comme le ferait le webhook Mollie.
 */
export class MockPaymentLinkProvider implements PaymentLinkProvider {
  readonly provider = 'mock';
  private readonly links = new Map<string, PaymentStatusResult & { input: CreatePaymentLinkInput }>();

  constructor(private readonly checkoutBaseUrl = 'http://localhost:3000') {}

  async createLink(input: CreatePaymentLinkInput): Promise<PaymentLinkResult> {
    if (input.amount <= 0n) throw new IntegrationError('mock', 'Rien à payer sur cette facture.', false);
    const id = `tr_mock_${createHash('sha256')
      .update(`${input.invoiceId}:${input.amount}:${this.links.size}:${Date.now()}`)
      .digest('hex')
      .slice(0, 12)}`;
    this.links.set(id, { id, status: 'open', amount: input.amount, paidAt: null, method: null, input });
    return {
      id,
      url: `${this.checkoutBaseUrl.replace(/\/$/, '')}/paiement-simule/${id}`,
      status: 'open',
      expiresAt: null,
    };
  }

  async getStatus(id: string): Promise<PaymentStatusResult> {
    const link = this.links.get(id);
    if (!link) return { id, status: 'open', amount: 0n, paidAt: null, method: null };
    const { input: _input, ...status } = link;
    return status;
  }

  /** Simulation : le client a payé (page de paiement simulée). */
  markPaid(id: string, amount?: bigint): void {
    const link = this.links.get(id);
    if (link)
      Object.assign(link, {
        status: 'paid',
        paidAt: new Date(),
        method: 'bancontact',
        amount: amount ?? link.amount,
      });
    else
      this.links.set(id, {
        id,
        status: 'paid',
        amount: amount ?? 0n,
        paidAt: new Date(),
        method: 'bancontact',
        input: {
          tenantId: '',
          invoiceId: '',
          amount: amount ?? 0n,
          description: '',
          redirectUrl: '',
          webhookUrl: '',
        },
      });
  }
}
