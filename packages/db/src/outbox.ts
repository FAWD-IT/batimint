/**
 * Transactional outbox (CLAUDE.md règle n°3) : toute mutation métier écrit, dans la même
 * transaction, ses lignes et un événement. Les effets secondaires vivent dans les consommateurs.
 */
import { v7 as uuidv7 } from 'uuid';
import type { Prisma, Tx } from './client';

export interface EventActor {
  type: 'user' | 'system' | 'portal' | 'platform_admin' | 'webhook';
  id?: string | null;
  label?: string | null;
}

export interface NewEvent<P = unknown> {
  tenantId: string;
  /** Type versionné, ex. « quote.signed.v1 ». */
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: P;
  actor?: EventActor | null;
  id?: string;
}

export interface StoredEvent<P = unknown> extends Required<Omit<NewEvent<P>, 'actor'>> {
  actor: EventActor | null;
  version: number;
  occurredAt: Date;
}

const EVENT_TYPE = /^[a-z_]+(\.[a-z_]+)+\.v\d+$/;

/** Sérialise un payload pour JSONB (bigint → chaîne). */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

export async function emitEvent<P>(tx: Tx, event: NewEvent<P>): Promise<StoredEvent<P>> {
  if (!EVENT_TYPE.test(event.type)) throw new Error(`Type d'événement invalide : ${event.type}`);
  const version = Number(event.type.slice(event.type.lastIndexOf('.v') + 2));
  const row = await tx.outboxEvent.create({
    data: {
      id: event.id ?? uuidv7(),
      tenantId: event.tenantId,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: toJsonValue(event.payload),
      actor: event.actor ? toJsonValue(event.actor) : undefined,
      version,
    },
  });
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payload: event.payload,
    actor: event.actor ?? null,
    version: row.version,
    occurredAt: row.occurredAt,
  };
}
