/**
 * Catalogue des événements (04 « Catalogue d'événements »). Types versionnés.
 * Chaque payload est validé par zod à l'émission et à la consommation.
 */
import { z } from 'zod';
import { Uuid } from './common';

export const EventPayloads = {
  'diagnostic.ping.v1': z.object({ requestedBy: Uuid, message: z.string().max(200) }),
  'user.invited.v1': z.object({
    invitationId: Uuid,
    email: z.string(),
    role: z.string(),
    invitedBy: Uuid.nullable(),
  }),
  'tenant.created.v1': z.object({ tenantId: Uuid, ownerUserId: Uuid }),
  'tenant.updated.v1': z.object({ fields: z.array(z.string()) }),
  'member.joined.v1': z.object({ userId: Uuid, role: z.string(), invitationId: Uuid.nullable() }),
  'member.updated.v1': z.object({ membershipId: Uuid, role: z.string(), status: z.string() }),
  'lead.received.v1': z.object({ leadId: Uuid, source: z.string() }),
  'customer.created.v1': z.object({ customerId: Uuid, kind: z.string() }),
  'opportunity.created.v1': z.object({ opportunityId: Uuid, customerId: Uuid }),
  'opportunity.stage_changed.v1': z.object({ opportunityId: Uuid, from: z.string(), to: z.string() }),
  'attachment.added.v1': z.object({
    attachmentId: Uuid,
    ownerType: z.string(),
    ownerId: Uuid,
    kind: z.string(),
  }),
  'library.imported.v1': z.object({ created: z.number().int(), updated: z.number().int() }),
  'integration.updated.v1': z.object({ kind: z.string(), status: z.string(), provider: z.string() }),
} as const;

export type EventType = keyof typeof EventPayloads;
export type EventPayload<T extends EventType> = z.infer<(typeof EventPayloads)[T]>;

export const EVENT_TYPES = Object.keys(EventPayloads) as EventType[];

export function parseEventPayload<T extends EventType>(type: T, payload: unknown): EventPayload<T> {
  return EventPayloads[type].parse(payload) as EventPayload<T>;
}

export function isKnownEventType(type: string): type is EventType {
  return type in EventPayloads;
}
