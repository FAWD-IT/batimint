import { createHash } from 'node:crypto';
import { IntegrationError } from '../errors';
import type {
  DeliveryStatus,
  LegalEntity,
  LegalEntityInput,
  ParticipantLookup,
  PeppolProvider,
  PeppolWebhookEvent,
  SendInvoiceResult,
} from './types';

/**
 * Mock déterministe : l'entité légale passe « active » à la première vérification (02 P1.5 :
 * « le mock passe à actif en dev »). Un numéro BCE se terminant par 00 n'est pas joignable
 * dans l'annuaire (pour tester le repli e-mail).
 */
export class MockPeppolProvider implements PeppolProvider {
  readonly provider = 'mock';
  private readonly entities = new Map<string, LegalEntity>();
  private readonly deliveries = new Map<string, DeliveryStatus>();
  readonly sent: { legalEntityId: string; ubl: string; documentId: string; id: string }[] = [];

  async registerLegalEntity(input: LegalEntityInput): Promise<LegalEntity> {
    if (!/^\d{10}$/.test(input.enterpriseNumber)) {
      throw new IntegrationError(
        'mock',
        "Numéro d'entreprise invalide : impossible d'inscrire l'entreprise sur Peppol.",
        false,
      );
    }
    const id = `le_${createHash('sha256').update(input.tenantId).digest('hex').slice(0, 16)}`;
    const entity: LegalEntity = {
      id,
      status: 'pending',
      participantId: `0208:${input.enterpriseNumber}`,
      authorizationUrl: null,
      message: 'Vérification en cours (simulation).',
    };
    this.entities.set(id, entity);
    return entity;
  }

  async getLegalEntityStatus(id: string): Promise<LegalEntity> {
    const e = this.entities.get(id) ?? {
      id,
      status: 'pending' as const,
      participantId: '0208:0000000000',
      authorizationUrl: null,
      message: null,
    };
    const active: LegalEntity = {
      ...e,
      status: 'active',
      message: 'Entreprise inscrite sur le réseau Peppol (simulation).',
    };
    this.entities.set(id, active);
    return active;
  }

  async lookupParticipant(scheme: string, id: string): Promise<ParticipantLookup> {
    const reachable = scheme === '0208' && /^\d{10}$/.test(id) && !id.endsWith('00');
    return {
      reachable,
      participantId: `${scheme}:${id}`,
      name: reachable ? `Participant ${id}` : null,
      documentTypes: reachable
        ? ['urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0']
        : [],
    };
  }

  async sendInvoice(input: {
    legalEntityId: string;
    ubl: string;
    documentId: string;
  }): Promise<SendInvoiceResult> {
    if (!input.ubl.includes('<Invoice') && !input.ubl.includes('<CreditNote')) {
      throw new IntegrationError('mock', 'Document UBL refusé par la validation Peppol (simulation).', false);
    }
    const id = `doc_${createHash('sha256').update(input.documentId).digest('hex').slice(0, 16)}`;
    this.sent.push({ ...input, id });
    this.deliveries.set(id, 'sent');
    return { id, status: 'sent' };
  }

  async getDeliveryStatus(id: string) {
    const current = this.deliveries.get(id) ?? 'queued';
    const next: DeliveryStatus = current === 'sent' ? 'delivered' : current;
    this.deliveries.set(id, next);
    return {
      id,
      status: next,
      message: next === 'delivered' ? 'Livrée au destinataire (simulation).' : null,
    };
  }

  parseWebhook(rawBody: string): PeppolWebhookEvent {
    const body = JSON.parse(rawBody) as PeppolWebhookEvent;
    if (!body.type) throw new IntegrationError('mock', 'Webhook Peppol invalide.', false);
    return body;
  }
}
