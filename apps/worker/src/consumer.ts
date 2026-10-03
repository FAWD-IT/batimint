/**
 * Consommateurs d'événements (CLAUDE.md règle n°3) : seuls endroits où vivent les effets
 * secondaires. Chaque consommateur est idempotent : (consommateur, événement) n'est traité
 * qu'une fois grâce à ProcessedEvent, inséré dans la même transaction que l'effet.
 */
import type { EventType } from '@batimint/contracts';
import type { RealtimeMessage } from '@batimint/contracts';
import type { FieldCipher, PrismaClient, Tx } from '@batimint/db';
import type { Integrations } from '@batimint/integrations';

export interface ConsumedEvent {
  id: string;
  tenantId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  actor: unknown;
  occurredAt: Date;
}

export interface WorkerDeps {
  prisma: PrismaClient;
  integrations: Integrations;
  appUrl: string;
  /** Déchiffre l'INSS pour la transmission Check In and Out (absent : présence refusée). */
  cipher?: FieldCipher | null;
}

export interface ConsumerContext {
  tx: Tx;
  event: ConsumedEvent;
  deps: WorkerDeps;
  /** Publie un message temps réel, livré au commit de la transaction (pg_notify transactionnel). */
  publish(message: Omit<RealtimeMessage, 'tenantId' | 'at'>): Promise<void>;
}

export interface Consumer {
  /** Nom stable : sert de clé d'idempotence et de nom de file pg-boss. */
  name: string;
  events: readonly EventType[];
  handle(ctx: ConsumerContext): Promise<void>;
}

export function queueName(consumer: Pick<Consumer, 'name'>): string {
  return `consumer.${consumer.name}`;
}
