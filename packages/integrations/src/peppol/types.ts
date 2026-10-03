/**
 * Peppol (05 §1, 07) — interface du fournisseur d'accès (getpeppr en mode Platform).
 * Chaque tenant devient une « legal entity » rattachée à notre compte maître.
 */

export type LegalEntityStatus = 'pending' | 'active' | 'rejected';

export interface LegalEntityInput {
  tenantId: string;
  name: string;
  enterpriseNumber: string;
  vatNumber: string | null;
  country: string;
  email: string | null;
}

export interface LegalEntity {
  id: string;
  status: LegalEntityStatus;
  participantId: string;
  /** Lien d'autorisation à faire signer par le client en production (P1.5). */
  authorizationUrl: string | null;
  message: string | null;
}

export interface ParticipantLookup {
  reachable: boolean;
  participantId: string;
  name: string | null;
  documentTypes: string[];
}

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed';

export interface SendInvoiceResult {
  id: string;
  status: DeliveryStatus;
}

export interface InboundPeppolDocument {
  id: string;
  receivedAt: Date;
  /** Entité légale destinataire (= tenant). */
  legalEntityId: string;
  senderParticipantId: string;
  ubl: string;
}

export interface PeppolWebhookEvent {
  type: 'document.received' | 'document.status_changed' | 'legal_entity.status_changed';
  data: Record<string, unknown>;
}

export interface PeppolProvider {
  readonly provider: string;
  registerLegalEntity(input: LegalEntityInput): Promise<LegalEntity>;
  getLegalEntityStatus(id: string): Promise<LegalEntity>;
  lookupParticipant(scheme: string, id: string): Promise<ParticipantLookup>;
  sendInvoice(input: { legalEntityId: string; ubl: string; documentId: string }): Promise<SendInvoiceResult>;
  getDeliveryStatus(id: string): Promise<{ id: string; status: DeliveryStatus; message: string | null }>;
  /** Vérifie la signature d'un webhook et le décode. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): PeppolWebhookEvent;
}
