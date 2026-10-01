import { parseEventPayload, userChannel } from '@batimint/contracts';
import type { Consumer } from '../consumer';

/** diagnostic.ping → notification in-app au demandeur + message temps réel. */
export const diagnosticNotification: Consumer = {
  name: 'notify-diagnostic',
  events: ['diagnostic.ping.v1'],
  async handle({ tx, event, publish }) {
    const payload = parseEventPayload('diagnostic.ping.v1', event.payload);
    const notification = await tx.notification.create({
      data: {
        tenantId: event.tenantId,
        userId: payload.requestedBy,
        type: 'diagnostic.ping',
        title: payload.message,
        body: 'Événement reçu par le worker et diffusé en direct.',
        eventId: event.id,
        data: { emittedAt: event.occurredAt.toISOString() },
      },
    });
    await publish({
      channel: userChannel(payload.requestedBy),
      topic: 'notifications',
      ref: notification.id,
      data: { eventId: event.id, title: notification.title, type: notification.type },
    });
  },
};
