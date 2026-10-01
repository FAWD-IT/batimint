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
